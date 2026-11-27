-- Find the Chicken: database setup
-- Paste this whole file into Supabase -> SQL Editor -> Run.
-- It is safe to re-run: it drops and recreates the app's objects.
--
-- BEFORE RUNNING: change the admin password on the line marked "ADMIN PASSWORD" near the bottom.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- clean slate
drop schema if exists chicken_private cascade;
drop table if exists public.clues, public.alerts, public.locations, public.visits,
  public.teams, public.members, public.zones, public.game_pubs, public.game_secrets,
  public.game_codes, public.games, public.pubs, public.admins, public.app_settings cascade;

-- older versions of functions whose parameters have since changed
drop function if exists public.join_game(text, text);

create schema chicken_private;
revoke all on schema chicken_private from public, anon, authenticated;

-- admin password hash lives in a schema clients can't reach
create table chicken_private.config (
  id int primary key default 1 check (id = 1),
  admin_password_hash text not null
);

-- ---------------------------------------------------------------- tables
create table public.app_settings (
  id int primary key default 1 check (id = 1),
  head_start_min int not null default 15,
  pint_min int not null default 15,
  nearby_m int not null default 75,
  left_early_m int not null default 100,
  shrink_interval_min int not null default 30,
  shrink_factor numeric not null default 0.6 check (shrink_factor > 0.1 and shrink_factor < 1),
  zone_floor_pubs int not null default 3
);
insert into public.app_settings default values;

create table public.admins (
  uid uuid primary key,
  created_at timestamptz not null default now()
);

create table public.pubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'lobby' check (status in ('lobby','live','ended')),
  started_at timestamptz,
  hunt_starts_at timestamptz,
  ended_at timestamptz,
  next_shrink_at timestamptz,
  settings jsonb not null,
  chicken_ready boolean not null default false
);

-- codes: only admins can read (to hand them out)
create table public.game_codes (
  game_id uuid primary key references public.games on delete cascade,
  team_code text not null unique,
  chicken_code text not null unique
);

-- the chicken's pub: only the chicken can read, everyone after the game ends
create table public.game_secrets (
  game_id uuid primary key references public.games on delete cascade,
  chicken_pub_id uuid references public.pubs on delete set null
);

create table public.game_pubs (
  game_id uuid references public.games on delete cascade,
  pub_id uuid references public.pubs on delete cascade,
  primary key (game_id, pub_id)
);

create table public.zones (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games on delete cascade,
  seq int not null,
  center_lat double precision not null,
  center_lng double precision not null,
  radius_m double precision not null,
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games on delete cascade,
  name text not null,
  status text not null default 'hunting'
    check (status in ('hunting','inside','locked','pending','found')),
  current_visit_id uuid,
  found_at timestamptz,
  finish_position int,
  last_active_at timestamptz,
  last_lat double precision,
  last_lng double precision,
  removed boolean not null default false,
  players text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (game_id, name)
);

create table public.members (
  uid uuid not null,
  game_id uuid not null references public.games on delete cascade,
  role text not null check (role in ('chicken','team')),
  team_id uuid references public.teams on delete cascade,
  primary key (uid, game_id)
);

-- one row per pub visit
-- status: inside (just checked in) -> locked (no chicken / rejected claim, owes a pint) -> done (left)
--         inside -> claimed (waiting for the chicken) -> found | locked (rejected)
create table public.visits (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games on delete cascade,
  team_id uuid not null references public.teams on delete cascade,
  pub_id uuid not null references public.pubs on delete cascade,
  status text not null default 'inside'
    check (status in ('inside','locked','claimed','found','done')),
  rejected boolean not null default false,
  arrived_at timestamptz not null default now(),
  arrive_photo text not null,
  arrive_lat double precision,
  arrive_lng double precision,
  left_at timestamptz,
  leave_photo text,
  leave_lat double precision,
  leave_lng double precision,
  left_early_flagged boolean not null default false
);

create table public.locations (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games on delete cascade,
  team_id uuid not null references public.teams on delete cascade,
  lat double precision not null,
  lng double precision not null,
  at timestamptz not null default now()
);

create table public.alerts (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games on delete cascade,
  team_id uuid references public.teams on delete cascade,
  kind text not null check (kind in ('nearby','left_early','claim','checkin','joined')),
  message text not null,
  created_at timestamptz not null default now()
);

create table public.clues (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games on delete cascade,
  text text not null check (length(text) between 1 and 500),
  created_at timestamptz not null default now()
);

create index on public.visits (game_id);
create index on public.locations (game_id, team_id, at);
create index on public.alerts (game_id, created_at);
create index on public.clues (game_id, created_at);
create index on public.zones (game_id, seq);
create index on public.teams (game_id);

-- ---------------------------------------------------------------- helpers
create function chicken_private.dist_m(lat1 double precision, lng1 double precision,
                                       lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

create function chicken_private.gen_code(prefix text, len int) returns text
language plpgsql volatile as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  out text := '';
begin
  for i in 1..len loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return prefix || '-' || out;
end $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where uid = auth.uid())
$$;

create or replace function public.my_role(g uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from members where uid = auth.uid() and game_id = g
$$;

create or replace function public.my_team(g uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from members where uid = auth.uid() and game_id = g
$$;

create or replace function public.game_ended(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'ended' from games where id = g), false)
$$;

create or replace function public.is_chicken(g uuid) returns boolean
language sql stable as $$ select public.my_role(g) = 'chicken' $$;

create or replace function public.is_member(g uuid) returns boolean
language sql stable as $$ select public.my_role(g) is not null $$;

-- teams that have found the chicken get to see other teams' photos
create or replace function public.my_team_found(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'found' from teams where id = public.my_team(g)), false)
$$;

-- ---------------------------------------------------------------- row level security
alter table public.app_settings enable row level security;
alter table public.admins       enable row level security;
alter table public.pubs         enable row level security;
alter table public.games        enable row level security;
alter table public.game_codes   enable row level security;
alter table public.game_secrets enable row level security;
alter table public.game_pubs    enable row level security;
alter table public.zones        enable row level security;
alter table public.teams        enable row level security;
alter table public.members      enable row level security;
alter table public.visits       enable row level security;
alter table public.locations    enable row level security;
alter table public.alerts       enable row level security;
alter table public.clues        enable row level security;

create policy "read settings" on public.app_settings for select to authenticated using (true);
create policy "admin edits settings" on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "admin sees self" on public.admins for select to authenticated using (uid = auth.uid());

create policy "read pubs" on public.pubs for select to authenticated using (true);
create policy "admin adds pubs" on public.pubs for insert to authenticated with check (public.is_admin());
create policy "admin edits pubs" on public.pubs for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin deletes pubs" on public.pubs for delete to authenticated using (public.is_admin());

-- games: anyone signed in may read a game row (needed for the recap link); no secrets live here
create policy "read games" on public.games for select to authenticated using (true);

create policy "admin reads codes" on public.game_codes for select to authenticated using (public.is_admin());

create policy "chicken or ended reads secret" on public.game_secrets for select to authenticated
  using (public.is_chicken(game_id) or public.game_ended(game_id));

create policy "read game pubs" on public.game_pubs for select to authenticated
  using (public.is_member(game_id) or public.is_admin() or public.game_ended(game_id));

create policy "members read zones" on public.zones for select to authenticated
  using (public.is_member(game_id) or public.game_ended(game_id));

create policy "read teams" on public.teams for select to authenticated
  using (public.is_chicken(game_id) or id = public.my_team(game_id) or public.game_ended(game_id));

create policy "read own membership" on public.members for select to authenticated using (uid = auth.uid());

create policy "read visits" on public.visits for select to authenticated
  using (public.is_chicken(game_id) or team_id = public.my_team(game_id) or public.game_ended(game_id));

create policy "chicken reads locations" on public.locations for select to authenticated
  using (public.is_chicken(game_id) or public.game_ended(game_id));

create policy "chicken reads alerts" on public.alerts for select to authenticated
  using (public.is_chicken(game_id) or public.game_ended(game_id));

create policy "members read clues" on public.clues for select to authenticated
  using (public.is_member(game_id) or public.game_ended(game_id));

-- all writes go through the functions below
grant select on all tables in schema public to authenticated;
grant update on public.app_settings to authenticated;
grant insert, update, delete on public.pubs to authenticated;

-- ---------------------------------------------------------------- zone logic
-- shrink the zone once: new circle is inside the old one, contains the chicken's pub
-- off-centre, and still holds at least zone_floor_pubs pubs. Returns false if at the floor.
create function chicken_private.shrink_zone(g uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  z zones%rowtype;
  p pubs%rowtype;
  s jsonb;
  factor double precision;
  floor_pubs int;
  new_r double precision;
  cand_lat double precision;
  cand_lng double precision;
  ang double precision;
  off double precision;
  m_per_deg_lat constant double precision := 111320;
  m_per_deg_lng double precision;
  inside_count int;
begin
  select * into z from zones where game_id = g order by seq desc limit 1;
  select pubs.* into p from game_secrets join pubs on pubs.id = game_secrets.chicken_pub_id
    where game_secrets.game_id = g;
  if z.id is null or p.id is null then return false; end if;
  select settings into s from games where id = g;
  factor := (s->>'shrink_factor')::double precision;
  floor_pubs := (s->>'zone_floor_pubs')::int;
  new_r := z.radius_m * factor;
  m_per_deg_lng := m_per_deg_lat * cos(radians(p.lat));

  for attempt in 1..200 loop
    ang := random() * 2 * pi();
    off := new_r * (0.25 + random() * 0.6);   -- pub sits 25-85% of the way out from the centre
    cand_lat := p.lat + (off * sin(ang)) / m_per_deg_lat;
    cand_lng := p.lng + (off * cos(ang)) / m_per_deg_lng;
    if chicken_private.dist_m(cand_lat, cand_lng, z.center_lat, z.center_lng) + new_r <= z.radius_m * 1.0001 then
      select count(*) into inside_count from game_pubs gp join pubs on pubs.id = gp.pub_id
        where gp.game_id = g and chicken_private.dist_m(pubs.lat, pubs.lng, cand_lat, cand_lng) <= new_r;
      if inside_count >= floor_pubs then
        insert into zones (game_id, seq, center_lat, center_lng, radius_m)
          values (g, z.seq + 1, cand_lat, cand_lng, new_r);
        return true;
      end if;
    end if;
  end loop;
  return false;  -- can't shrink any further without breaking the floor
end $$;

-- ---------------------------------------------------------------- admin functions
create or replace function public.admin_login(password text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from chicken_private.config
             where admin_password_hash = crypt(password, admin_password_hash)) then
    insert into admins (uid) values (auth.uid()) on conflict do nothing;
    return true;
  end if;
  return false;
end $$;

create or replace function public.admin_logout() returns void
language sql security definer set search_path = public as $$
  delete from admins where uid = auth.uid()
$$;

create or replace function public.admin_set_password(new_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if length(new_password) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  update chicken_private.config set admin_password_hash = crypt(new_password, gen_salt('bf'));
end $$;

create or replace function public.admin_create_game(pub_ids uuid[])
returns table (game_id uuid, team_code text, chicken_code text)
language plpgsql security definer set search_path = public as $$
declare
  g uuid;
  tc text;
  cc text;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if coalesce(array_length(pub_ids, 1), 0) < 2 then raise exception 'Pick at least 2 pubs'; end if;
  insert into games (settings)
    select to_jsonb(s) - 'id' from app_settings s
    returning id into g;
  insert into game_pubs (game_id, pub_id) select g, unnest(pub_ids) on conflict do nothing;
  loop
    tc := chicken_private.gen_code('CLUCK', 4);
    cc := chicken_private.gen_code('EGG', 6);
    exit when not exists (select 1 from game_codes c where c.team_code = tc or c.chicken_code = cc);
  end loop;
  insert into game_codes values (g, tc, cc);
  insert into game_secrets (game_id) values (g);
  return query select g, tc, cc;
end $$;

create or replace function public.admin_delete_game(g uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  -- photos are removed by the admin screen through the Storage API before this runs
  delete from games where id = g;
end $$;

-- "blind" control: ends a stuck game without revealing anything first
create or replace function public.admin_force_end(g uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update games set status = 'ended', ended_at = now() where id = g and status <> 'ended';
end $$;

-- ---------------------------------------------------------------- joining
-- clean a list of player names: trimmed, no blanks, no duplicates (ignoring case), at most 12
create or replace function chicken_private.clean_players(names text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(n order by first_pos), '{}')
  from (
    select min(trim(x)) as n, min(pos) as first_pos
    from unnest(coalesce(names, '{}')) with ordinality as u(x, pos)
    where trim(x) <> ''
    group by lower(trim(x))
  ) s
$$;


create or replace function public.join_game(code text, team_name text default null, players text[] default null,
                                            lat double precision default null, lng double precision default null)
returns table (game_id uuid, role text, team_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  c game_codes%rowtype;
  gm games%rowtype;
  existing members%rowtype;
  t uuid;
  clean_code text := upper(trim(code));
  clean_name text := trim(team_name);
  names text[] := chicken_private.clean_players(players);
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into c from game_codes where chicken_code = clean_code or team_code = clean_code;
  if c.game_id is null then raise exception 'No game with that code'; end if;
  select * into gm from games where id = c.game_id;
  if gm.status = 'ended' then raise exception 'That game has finished'; end if;

  select * into existing from members m where m.uid = auth.uid() and m.game_id = c.game_id;
  if existing.uid is not null then
    return query select existing.game_id, existing.role, existing.team_id;
    return;
  end if;

  if clean_code = c.chicken_code then
    insert into members (uid, game_id, role) values (auth.uid(), c.game_id, 'chicken');
    return query select c.game_id, 'chicken'::text, null::uuid;
    return;
  end if;

  if clean_name is null or clean_name = '' then raise exception 'Enter a team name'; end if;
  if length(clean_name) > 40 then raise exception 'Team name is too long'; end if;
  if exists (select 1 from unnest(names) n where length(n) > 30) then raise exception 'Keep each name under 30 characters'; end if;
  if cardinality(names) > 12 then raise exception 'That''s a big team! 12 players at most'; end if;

  -- rejoining an existing team by name (a teammate's phone, or a lost session): add any new names
  select id into t from teams where teams.game_id = c.game_id and lower(name) = lower(clean_name) and not removed;
  if t is null then
    if cardinality(names) = 0 then raise exception 'Add at least one player'; end if;
    insert into teams (game_id, name, players) values (c.game_id, clean_name, names) returning id into t;
    insert into alerts (game_id, team_id, kind, message)
      values (c.game_id, t, 'joined', clean_name || ' joined the game (' || array_to_string(names, ', ') || ')');
  else
    update teams set players = chicken_private.clean_players(teams.players || names) where id = t;
  end if;
  insert into members (uid, game_id, role, team_id) values (auth.uid(), c.game_id, 'team', t);

  if lat is not null then
    update teams set last_lat = lat, last_lng = lng, last_active_at = now() where id = t;
    insert into locations (game_id, team_id, lat, lng) values (c.game_id, t, lat, lng);
  end if;
  return query select c.game_id, 'team'::text, t;
end $$;


-- change the team's player list (any phone on the team, until the game ends)
create or replace function public.team_set_players(g uuid, players text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  names text[] := chicken_private.clean_players(players);
  t uuid := public.my_team(g);
begin
  if t is null then raise exception 'You are not on a team in this game'; end if;
  if public.game_ended(g) then raise exception 'That game has finished'; end if;
  if cardinality(names) = 0 then raise exception 'A team needs at least one player'; end if;
  if cardinality(names) > 12 then raise exception 'That''s a big team! 12 players at most'; end if;
  if exists (select 1 from unnest(names) n where length(n) > 30) then raise exception 'Keep each name under 30 characters'; end if;
  update teams set players = names where id = t;
end $$;


-- teams can see how many teams have found the chicken, but not which
create or replace function public.game_progress(g uuid) returns table (found int, total int)
language sql stable security definer set search_path = public as $$
  select count(*) filter (where status = 'found')::int, count(*)::int
  from teams where game_id = g and not removed and public.is_member(g)
$$;

-- ---------------------------------------------------------------- chicken functions
create or replace function public.chicken_choose_pub(g uuid, pub uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_chicken(g) then raise exception 'Only the chicken can do that'; end if;
  if (select status from games where id = g) <> 'lobby' then raise exception 'The game has already started'; end if;
  if not exists (select 1 from game_pubs where game_id = g and pub_id = pub) then
    raise exception 'That pub is not in this game';
  end if;
  update game_secrets set chicken_pub_id = pub where game_id = g;
  update games set chicken_ready = true where id = g;
end $$;

create or replace function public.chicken_start(g uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s jsonb;
  c_lat double precision;
  c_lng double precision;
  r double precision;
begin
  if not is_chicken(g) then raise exception 'Only the chicken can do that'; end if;
  if (select status from games where id = g) <> 'lobby' then raise exception 'Already started'; end if;
  if (select chicken_pub_id from game_secrets where game_id = g) is null then
    raise exception 'Choose your pub first';
  end if;
  select settings into s from games where id = g;

  -- starting zone: a circle around the middle of all pubs that covers every one, plus margin
  select avg(lat), avg(lng) into c_lat, c_lng
    from pubs join game_pubs gp on gp.pub_id = pubs.id where gp.game_id = g;
  select max(chicken_private.dist_m(lat, lng, c_lat, c_lng)) * 1.15 + 150 into r
    from pubs join game_pubs gp on gp.pub_id = pubs.id where gp.game_id = g;
  insert into zones (game_id, seq, center_lat, center_lng, radius_m) values (g, 0, c_lat, c_lng, r);

  update games set
    status = 'live',
    started_at = now(),
    hunt_starts_at = now() + make_interval(mins => (s->>'head_start_min')::int),
    next_shrink_at = now() + make_interval(mins => (s->>'head_start_min')::int + (s->>'shrink_interval_min')::int)
  where id = g;
end $$;

create or replace function public.chicken_shrink_now(g uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  ok boolean;
begin
  if not is_chicken(g) then raise exception 'Only the chicken can do that'; end if;
  if (select status from games where id = g) <> 'live' then raise exception 'Game is not live'; end if;
  ok := chicken_private.shrink_zone(g);
  update games set next_shrink_at = now() + make_interval(mins => (settings->>'shrink_interval_min')::int)
    where id = g;
  return ok;
end $$;

-- called by any player's screen; shrinks the zone when the timer is due
create or replace function public.tick_zone(g uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  gm games%rowtype;
begin
  if not is_member(g) then return; end if;
  select * into gm from games where id = g for update;
  if gm.status = 'live' and gm.next_shrink_at <= now() then
    perform chicken_private.shrink_zone(g);
    update games set next_shrink_at = now() + make_interval(mins => (settings->>'shrink_interval_min')::int)
      where id = g;
  end if;
end $$;

create or replace function public.chicken_send_clue(g uuid, clue text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_chicken(g) then raise exception 'Only the chicken can do that'; end if;
  if trim(clue) = '' then raise exception 'Clue is empty'; end if;
  insert into clues (game_id, text) values (g, trim(clue));
end $$;

create function chicken_private.maybe_end(g uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from teams where game_id = g and not removed and status <> 'found')
     and exists (select 1 from teams where game_id = g and not removed) then
    update games set status = 'ended', ended_at = now() where id = g;
  end if;
end $$;

create or replace function public.chicken_resolve_claim(v uuid, confirm boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  vis visits%rowtype;
  pos int;
begin
  select * into vis from visits where id = v for update;
  if vis.id is null or not is_chicken(vis.game_id) then raise exception 'Only the chicken can do that'; end if;
  if vis.status <> 'claimed' then raise exception 'That claim has already been dealt with'; end if;
  if confirm then
    select coalesce(max(finish_position), 0) + 1 into pos from teams where game_id = vis.game_id;
    update visits set status = 'found' where id = v;
    update teams set status = 'found', found_at = now(), finish_position = pos where id = vis.team_id;
    perform chicken_private.maybe_end(vis.game_id);
  else
    update visits set status = 'locked', rejected = true where id = v;
    update teams set status = 'locked' where id = vis.team_id;
  end if;
end $$;

create or replace function public.chicken_remove_team(t uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  g uuid;
begin
  select game_id into g from teams where id = t;
  if g is null or not is_chicken(g) then raise exception 'Only the chicken can do that'; end if;
  update teams set removed = true where id = t;
  delete from members where team_id = t;
  perform chicken_private.maybe_end(g);
end $$;

-- undo a wrongly confirmed find: the team goes back to "inside" that pub
create or replace function public.chicken_undo_find(t uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tm teams%rowtype;
begin
  select * into tm from teams where id = t;
  if tm.id is null or not is_chicken(tm.game_id) then raise exception 'Only the chicken can do that'; end if;
  if tm.status <> 'found' then raise exception 'That team has not been found'; end if;
  if (select status from games where id = tm.game_id) = 'ended' then raise exception 'Game has ended'; end if;
  update visits set status = 'inside' where team_id = t and status = 'found';
  update teams set status = 'inside', found_at = null, finish_position = null where id = t;
  -- close the gap in finishing positions
  update teams set finish_position = finish_position - 1
    where game_id = tm.game_id and finish_position > tm.finish_position;
end $$;

create or replace function public.chicken_end_game(g uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_chicken(g) then raise exception 'Only the chicken can do that'; end if;
  update games set status = 'ended', ended_at = now() where id = g and status <> 'ended';
end $$;

-- ---------------------------------------------------------------- team functions
create function chicken_private.my_live_team(g uuid) returns teams
language plpgsql security definer set search_path = public as $$
declare
  tm teams%rowtype;
  gm games%rowtype;
begin
  select * into gm from games where id = g;
  if gm.status <> 'live' then raise exception 'The game is not running'; end if;
  if gm.hunt_starts_at > now() then raise exception 'The chicken still has a head start!'; end if;
  select * into tm from teams where id = public.my_team(g) for update;
  if tm.id is null or tm.removed then raise exception 'You are not on a team in this game'; end if;
  return tm;
end $$;

create or replace function public.team_check_in(g uuid, pub uuid, photo text, lat double precision, lng double precision)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  tm teams%rowtype;
  v uuid;
  pub_name text;
begin
  tm := chicken_private.my_live_team(g);
  if tm.status <> 'hunting' then raise exception 'Finish at your current pub first'; end if;
  if not exists (select 1 from game_pubs where game_id = g and pub_id = pub) then
    raise exception 'That pub is not in this game';
  end if;
  if photo is null or photo not like g::text || '/' || tm.id::text || '/%' then
    raise exception 'Take a photo of the pub from outside first';
  end if;
  insert into visits (game_id, team_id, pub_id, arrive_photo, arrive_lat, arrive_lng)
    values (g, tm.id, pub, photo, lat, lng) returning id into v;
  update teams set status = 'inside', current_visit_id = v,
    last_active_at = now(), last_lat = coalesce(lat, last_lat), last_lng = coalesce(lng, last_lng)
    where id = tm.id;
  if lat is not null then insert into locations (game_id, team_id, lat, lng) values (g, tm.id, lat, lng); end if;
  select name into pub_name from pubs where id = pub;
  insert into alerts (game_id, team_id, kind, message)
    values (g, tm.id, 'checkin', tm.name || ' checked in at ' || pub_name);
  return v;
end $$;

create or replace function public.team_no_chicken(g uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tm teams%rowtype;
begin
  tm := chicken_private.my_live_team(g);
  if tm.status <> 'inside' then raise exception 'You are not checked in anywhere'; end if;
  update visits set status = 'locked' where id = tm.current_visit_id;
  update teams set status = 'locked' where id = tm.id;
end $$;

create or replace function public.team_claim_found(g uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tm teams%rowtype;
begin
  tm := chicken_private.my_live_team(g);
  if tm.status <> 'inside' then raise exception 'Check in at the pub first'; end if;
  update visits set status = 'claimed' where id = tm.current_visit_id;
  update teams set status = 'pending' where id = tm.id;
  insert into alerts (game_id, team_id, kind, message)
    values (g, tm.id, 'claim', tm.name || ' says they found you!');
end $$;

create or replace function public.team_leave(g uuid, photo text, lat double precision, lng double precision) returns void
language plpgsql security definer set search_path = public as $$
declare
  tm teams%rowtype;
  vis visits%rowtype;
  pint_min int;
begin
  tm := chicken_private.my_live_team(g);
  if tm.status <> 'locked' then raise exception 'You can only leave once you owe a pint'; end if;
  select * into vis from visits where id = tm.current_visit_id;
  select (settings->>'pint_min')::int into pint_min from games where id = g;
  if vis.arrived_at + make_interval(mins => pint_min) > now() then
    raise exception 'Not so fast, keep drinking!';
  end if;
  if photo is null or photo not like g::text || '/' || tm.id::text || '/%' then
    raise exception 'Take a photo of the empty pints first';
  end if;
  update visits set status = 'done', left_at = now(), leave_photo = photo, leave_lat = lat, leave_lng = lng
    where id = vis.id;
  update teams set status = 'hunting', current_visit_id = null, last_active_at = now(),
    last_lat = coalesce(lat, last_lat), last_lng = coalesce(lng, last_lng)
    where id = tm.id;
  if lat is not null then insert into locations (game_id, team_id, lat, lng) values (g, tm.id, lat, lng); end if;
end $$;

-- called whenever a team has the app open. Positions are recorded from the moment a team joins;
-- "nearby" and "left early" alerts only fire once the hunt is live.
create or replace function public.report_location(g uuid, lat double precision, lng double precision) returns void
language plpgsql security definer set search_path = public as $$
declare
  tm teams%rowtype;
  gm games%rowtype;
  hide pubs%rowtype;
  vis visits%rowtype;
  vpub pubs%rowtype;
begin
  select * into gm from games where id = g;
  if gm.status = 'ended' then return; end if;
  select * into tm from teams where id = public.my_team(g);
  if tm.id is null or tm.removed then return; end if;

  update teams set last_active_at = now(), last_lat = lat, last_lng = lng where id = tm.id;
  -- keep the trail light: at most one point every 20 seconds
  if not exists (select 1 from locations where team_id = tm.id and at > now() - interval '20 seconds') then
    insert into locations (game_id, team_id, lat, lng) values (g, tm.id, lat, lng);
  end if;

  if gm.status <> 'live' or tm.status = 'found' then return; end if;

  select pubs.* into hide from game_secrets join pubs on pubs.id = game_secrets.chicken_pub_id
    where game_secrets.game_id = g;
  if hide.id is not null
     and chicken_private.dist_m(lat, lng, hide.lat, hide.lng) <= (gm.settings->>'nearby_m')::int
     and not exists (select 1 from alerts where team_id = tm.id and kind = 'nearby'
                     and created_at > now() - interval '10 minutes') then
    insert into alerts (game_id, team_id, kind, message) values (g, tm.id, 'nearby', tm.name || ' is nearby!');
  end if;

  if tm.status in ('inside','locked','pending') and tm.current_visit_id is not null then
    select * into vis from visits where id = tm.current_visit_id;
    select * into vpub from pubs where id = vis.pub_id;
    if not vis.left_early_flagged
       and chicken_private.dist_m(lat, lng, vpub.lat, vpub.lng) > (gm.settings->>'left_early_m')::int then
      update visits set left_early_flagged = true where id = vis.id;
      insert into alerts (game_id, team_id, kind, message)
        values (g, tm.id, 'left_early', tm.name || ' left ' || vpub.name || ' early!');
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------- function permissions
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

-- ---------------------------------------------------------------- realtime
do $$
declare t text;
begin
  foreach t in array array['games','zones','teams','visits','alerts','clues','pubs','game_pubs','app_settings']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
             when undefined_object then null;  -- no realtime publication (local testing)
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------- photo storage
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
      on conflict (id) do nothing;

    drop policy if exists "chicken photos upload" on storage.objects;
    drop policy if exists "chicken photos read" on storage.objects;
    drop policy if exists "chicken photos admin delete" on storage.objects;

    -- path is {game_id}/{team_id}/{file}; a team may only upload into its own folder
    create policy "chicken photos upload" on storage.objects for insert to authenticated
      with check (
        bucket_id = 'photos'
        and (storage.foldername(name))[2]::uuid = public.my_team((storage.foldername(name))[1]::uuid)
      );

    create policy "chicken photos read" on storage.objects for select to authenticated
      using (
        bucket_id = 'photos' and (
          public.is_chicken((storage.foldername(name))[1]::uuid)
          or public.game_ended((storage.foldername(name))[1]::uuid)
          or (storage.foldername(name))[2]::uuid = public.my_team((storage.foldername(name))[1]::uuid)
          or public.my_team_found((storage.foldername(name))[1]::uuid)
          or public.is_admin()
        )
      );

    create policy "chicken photos admin delete" on storage.objects for delete to authenticated
      using (bucket_id = 'photos' and public.is_admin());
  end if;
end $$;

-- ---------------------------------------------------------------- ADMIN PASSWORD
-- Change 'change-me-please' to your own admin password before running.
insert into chicken_private.config (admin_password_hash)
  values (extensions.crypt('change-me-please', extensions.gen_salt('bf')));
