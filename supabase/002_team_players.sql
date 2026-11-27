-- Find the Chicken: update 002 (team players, GPS from the moment a team joins)
-- Run this ONCE in Supabase -> SQL Editor if you set up the database before this update.
-- It keeps all existing pubs and games.

alter table public.teams add column if not exists players text[] not null default '{}';

-- join_game gains parameters, so the old version is removed first
drop function if exists public.join_game(text, text);

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

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
