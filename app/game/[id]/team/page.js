'use client';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Beer, Check, Compass, List, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import Map from '@/components/Map';
import PhotoButton from '@/components/PhotoButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BigNumber, Confetti, Empty, ErrorNote, Hero, Panel, Row, Rows, Screen, TabBar, TopBar, useConfirm } from '@/components/game-ui';
import { currentPosition, useLiveData, useLocation, useNow } from '@/lib/hooks';
import { rpc, select, supabase } from '@/lib/supabase';
import { askNotifications, distM, fmtCountdown, fmtTime, inZone, ping, uploadPhoto } from '@/lib/util';

async function loadTeam(gameId) {
  const sb = supabase();
  const [game, pubs, teams, visits, clues, zones, progress] = await Promise.all([
    select(sb.from('games').select('*').eq('id', gameId).single()),
    select(sb.from('game_pubs').select('pubs(*)').eq('game_id', gameId)),
    select(sb.from('teams').select('*').eq('game_id', gameId)),
    select(sb.from('visits').select('*').eq('game_id', gameId).order('arrived_at')),
    select(sb.from('clues').select('*').eq('game_id', gameId).order('id', { ascending: false })),
    select(sb.from('zones').select('*').eq('game_id', gameId).order('seq', { ascending: false }).limit(1)),
    rpc('game_progress', { g: gameId }),
  ]);
  const team = teams[0];
  if (!team) throw new Error('This phone isn’t on a team in this game. Join with the team code on the home page.');
  return {
    game,
    team,
    pubs: pubs.map((r) => r.pubs).filter(Boolean),
    visits,
    clues,
    zone: zones[0] || null,
    progress: progress[0] || { found: 0, total: 0 },
  };
}

export default function TeamPage({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const ask = useConfirm();
  const now = useNow(1000);
  const { data, error, refresh } = useLiveData(id, ['games', 'teams', 'visits', 'clues', 'zones'], () => loadTeam(id), 15000);
  const [tab, setTab] = useState('hunt');
  const [selected, setSelected] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [unreadClues, setUnreadClues] = useState(0);
  const [celebrate, setCelebrate] = useState(0);
  const seen = useRef(null);

  const live = data?.game.status === 'live';
  const { fix, error: gpsError } = useLocation(live, (f) => {
    rpc('report_location', { g: id, lat: f.lat, lng: f.lng }).catch(() => {});
  });

  // new clue / zone shrink / found notifications
  useEffect(() => {
    if (!data) return;
    const sig = { clue: data.clues[0]?.id ?? 0, zone: data.zone?.seq ?? -1, status: data.team.status };
    const prev = seen.current;
    if (prev) {
      if (sig.clue > prev.clue) {
        ping('🐔 New clue', data.clues[0].text);
        toast('🐔 New clue', { description: data.clues[0].text, duration: 10000 });
        setUnreadClues((n) => n + 1);
      }
      if (sig.zone > prev.zone && sig.zone > 0) {
        ping('🔴 The zone has shrunk!', 'Check the map');
        toast.error('🔴 The zone has shrunk!', { description: 'Greyed-out pubs are out of play.' });
      }
      if (sig.status === 'found' && prev.status !== 'found') setCelebrate((n) => n + 1);
      if (sig.status === 'locked' && prev.status === 'pending') toast.error('The chicken says no 🐔❌');
    }
    seen.current = sig;
  }, [data]);

  useEffect(() => {
    if (tab === 'clues') setUnreadClues(0);
  }, [tab]);

  useEffect(() => {
    if (live && data.game.next_shrink_at && new Date(data.game.next_shrink_at) <= now) {
      rpc('tick_zone', { g: id }).catch(() => {});
    }
  }, [now, data, live, id]);

  useEffect(() => {
    if (data?.game.status === 'ended') router.replace(`/game/${id}/recap`);
  }, [data, id, router]);

  async function act(fn, args) {
    setActionError(null);
    try {
      await rpc(fn, args);
      refresh();
      return true;
    } catch (e) {
      setActionError(e.message);
      return false;
    }
  }

  async function photoThen(kind, file, fn, extra) {
    setActionError(null);
    try {
      const [path, pos] = await Promise.all([uploadPhoto(id, data.team.id, kind, file), currentPosition()]);
      const ok = await act(fn, { g: id, photo: path, lat: pos?.lat ?? null, lng: pos?.lng ?? null, ...extra });
      if (ok) {
        setSelected(null);
        setTab('hunt');
      }
    } catch (e) {
      setActionError(e.message);
    }
  }

  if (error && !data) {
    return (
      <Screen>
        <ErrorNote>{error}</ErrorNote>
        <Button variant="secondary" asChild><a href="/">Go home</a></Button>
      </Screen>
    );
  }
  if (!data) return <Screen><p className="pt-10 text-center font-bold text-muted-foreground">Loading…</p></Screen>;

  const { game, team, pubs, visits, clues, zone, progress } = data;
  const pubById = Object.fromEntries(pubs.map((p) => [p.id, p]));
  const checked = new Set(visits.map((v) => v.pub_id));
  const current = visits.find((v) => v.id === team.current_visit_id);
  const headStartLeft = game.hunt_starts_at ? new Date(game.hunt_starts_at) - now : null;
  const shrinkLeft = game.next_shrink_at ? new Date(game.next_shrink_at) - now : null;

  const sortedPubs = [...pubs].sort((a, b) => {
    const za = inZone(a, zone) ? 0 : 1;
    const zb = inZone(b, zone) ? 0 : 1;
    if (za !== zb) return za - zb;
    if (fix) return distM(fix, a) - distM(fix, b);
    return a.name.localeCompare(b.name);
  });

  const mapPubs = pubs.map((p) => ({
    ...p,
    icon: current?.pub_id === p.id ? '📍' : checked.has(p.id) ? '✅' : '🍺',
    tone: checked.has(p.id) ? 'checked' : '',
    dim: !inZone(p, zone),
    highlight: selected === p.id,
  }));
  const me = fix ? [{ id: 'me', ...fix, label: 'You', me: true }] : [];

  const header = (
    <>
      <TopBar
        emoji="🍻"
        tone="hunt"
        title={team.name}
        right={<Badge variant="found" className="text-sm">🐔 {progress.found}/{progress.total} found</Badge>}
      />
      {gpsError && (
        <ErrorNote>Location is off ({gpsError}). Turn it on in your browser settings, or the chicken sees you as gone dark.</ErrorNote>
      )}
    </>
  );

  // ------------------------------------------------ lobby / head start
  if (game.status === 'lobby' || headStartLeft > 0) {
    return (
      <Screen>
        {header}
        {game.status === 'lobby' ? (
          <Hero tone="plain" emoji="🥚" kicker="Get ready" title="Waiting for the chicken to start">
            <p className="font-semibold text-muted-foreground">Turn on alerts so you hear clues and zone shrinks.</p>
          </Hero>
        ) : (
          <Hero tone="head" emoji="🏃" kicker="Head start" title="The chicken is running…">
            <BigNumber>{fmtCountdown(headStartLeft)}</BigNumber>
            <p className="font-bold">Hunt opens at {fmtTime(game.hunt_starts_at)}</p>
          </Hero>
        )}
        <Button block variant="secondary" className="mb-4" onClick={askNotifications}><Bell aria-hidden /> Turn on alerts</Button>
        <Map pubs={mapPubs} zone={zone} people={me} />
      </Screen>
    );
  }

  // ------------------------------------------------ live
  const pintLeft = current ? new Date(current.arrived_at).getTime() + game.settings.pint_min * 60000 - now : 0;
  const zoneLine = shrinkLeft !== null && (
    <p className="mb-2 flex items-center gap-2 font-bold text-alert">
      <span className="zone-ring inline-block size-3 rounded-full bg-alert" aria-hidden /> Zone shrinks in {fmtCountdown(shrinkLeft)}
    </p>
  );

  let hero = null;
  if (team.status === 'found') {
    const left = progress.total - progress.found;
    hero = (
      <Hero tone="found" emoji="🐔" kicker={`You finished #${team.finish_position}`} title="You found the chicken!">
        <p className="font-bold">Stay at {pubById[current?.pub_id]?.name || 'the pub'} and keep it quiet. {left} team{left === 1 ? '' : 's'} still hunting.</p>
      </Hero>
    );
  } else if (team.status === 'pending') {
    hero = (
      <Hero tone="clue" emoji="⏳" kicker="Claim sent" title="Waiting for the chicken to confirm…">
        <p className="font-bold">Stay where you are.</p>
      </Hero>
    );
  } else if (team.status === 'inside' && current) {
    hero = (
      <Hero tone="head" kicker="You’re in" title={pubById[current.pub_id]?.name}>
        <p className="font-bold">Have a proper look around. Is the chicken here?</p>
        <Button
          size="lg"
          block
          variant="chicken"
          onClick={async () => {
            const ok = await ask({ title: 'Found the chicken?', body: 'They’ll get a pop-up to confirm. Get it wrong and you owe a pint.', action: 'We found them!', variant: 'chicken' });
            if (ok) act('team_claim_found', { g: id });
          }}
        >
          🐔 Found the chicken!
        </Button>
        <Button size="lg" block variant="secondary" onClick={() => act('team_no_chicken', { g: id })}>
          No chicken here
        </Button>
      </Hero>
    );
  } else if (team.status === 'locked' && current) {
    hero = (
      <Hero tone="alert" kicker={current.rejected ? 'The chicken says no 🐔❌' : 'Wrong pub'} title={`Drink up at ${pubById[current.pub_id]?.name}`}>
        {pintLeft > 0 ? (
          <>
            <BigNumber>{fmtCountdown(pintLeft)}</BigNumber>
            <p className="font-bold">When the timer’s done, snap your empty glasses to move on.</p>
          </>
        ) : (
          <p className="font-bold">Timer’s done. Show us those empty glasses.</p>
        )}
        {pintLeft > 0 ? (
          <Button size="lg" block variant="secondary" disabled>
            🔒 Photo unlocks when the timer ends
          </Button>
        ) : (
          <PhotoButton label="Photo of the empty pints" onPhoto={(file) => photoThen('leave', file, 'team_leave')} />
        )}
      </Hero>
    );
  } else if (team.status === 'hunting') {
    hero = selected ? (
      <Hero tone="hunt" kicker="Check in" title={pubById[selected]?.name}>
        <p className="font-bold">Take a photo of the pub from outside to prove you’re here.</p>
        <PhotoButton label="Photo of the pub from outside" onPhoto={(file) => photoThen('arrive', file, 'team_check_in', { pub: selected })} />
        <Button block variant="secondary" onClick={() => setSelected(null)}>Cancel</Button>
      </Hero>
    ) : (
      <Hero tone="hunt" kicker="Hunting" title="Where’s the chicken?">
        <p className="font-bold">Tap a pub on the map, or pick one from the list, to check in.</p>
      </Hero>
    );
  }

  const choose = (pid) => {
    if (team.status !== 'hunting') return;
    setSelected(pid);
    setTab('hunt');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <Screen tabs>
      {header}
      <Confetti fire={celebrate} />

      {tab === 'hunt' && (
        <>
          {hero}
          <ErrorNote>{actionError}</ErrorNote>
          {zoneLine}
          <Map zone={zone} pubs={mapPubs} people={me} onPubClick={(p) => choose(p.id)} fitKey={zone?.seq} />
          {clues[0] && (
            <button onClick={() => setTab('clues')} className="pop-in sticker mt-4 flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 border-clue-edge bg-card p-3 text-left [--sticker-edge:var(--clue-edge)]">
              <span className="text-2xl" aria-hidden>💬</span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-extrabold text-clue uppercase">Latest clue · {fmtTime(clues[0].created_at)}</span>
                <span className="block truncate font-bold">{clues[0].text}</span>
              </span>
            </button>
          )}
        </>
      )}

      {tab === 'clues' && (
        <Panel title="Clues from the chicken" className="border-clue-edge">
          {clues.length ? (
            <Rows>
              {clues.map((c) => (
                <Row key={c.id} lead="💬" trail={<span className="text-sm font-bold text-muted-foreground">{fmtTime(c.created_at)}</span>}>
                  <span className="text-lg font-bold">{c.text}</span>
                </Row>
              ))}
            </Rows>
          ) : (
            <Empty emoji="🤫">No clues yet. The chicken’s keeping quiet.</Empty>
          )}
        </Panel>
      )}

      {tab === 'pubs' && (
        <Panel title="Pubs">
          {zoneLine}
          <Rows>
            {sortedPubs.map((p) => {
              const out = !inZone(p, zone);
              const here = current?.pub_id === p.id;
              return (
                <Row
                  key={p.id}
                  lead={here ? '📍' : checked.has(p.id) ? '✅' : out ? '⛔' : '🍺'}
                  className={out ? 'opacity-45' : ''}
                  trail={
                    team.status === 'hunting' && !out ? (
                      <Button size="sm" variant={checked.has(p.id) ? 'secondary' : 'default'} onClick={() => choose(p.id)}>
                        <Check aria-hidden /> Check in
                      </Button>
                    ) : null
                  }
                >
                  <span className="block font-bold">{p.name}</span>
                  <span className="block text-sm font-semibold text-muted-foreground">
                    {fix ? `${Math.round(distM(fix, p))} m` : ''}
                    {out ? `${fix ? ' · ' : ''}outside the zone` : checked.has(p.id) ? `${fix ? ' · ' : ''}checked` : ''}
                  </span>
                </Row>
              );
            })}
          </Rows>
        </Panel>
      )}

      <TabBar
        value={tab}
        onChange={setTab}
        items={[
          { key: 'hunt', label: 'Hunt', icon: Compass },
          { key: 'clues', label: 'Clues', icon: MessageCircle, badge: unreadClues },
          { key: 'pubs', label: 'Pubs', icon: List },
        ]}
      />
    </Screen>
  );
}
