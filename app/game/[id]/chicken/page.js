'use client';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Camera, Check, Flag, Map as MapIcon, MessageCircle, Send, Shrink, Undo2, UserMinus, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import Map from '@/components/Map';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { BigNumber, Empty, ErrorNote, Hero, Panel, PhotoGrid, PlayerList, Row, Rows, Screen, TabBar, TopBar, useConfirm } from '@/components/game-ui';
import { useLiveData, useNow } from '@/lib/hooks';
import { rpc, select, supabase } from '@/lib/supabase';
import { askNotifications, fmtAgo, fmtCountdown, fmtTime, ping, signedUrls, TEAM_COLORS } from '@/lib/util';

const STALE_MS = 3 * 60 * 1000;

async function loadChicken(gameId) {
  const sb = supabase();
  const [game, secret, pubs, teams, visits, alerts, clues, zones] = await Promise.all([
    select(sb.from('games').select('*').eq('id', gameId).single()),
    select(sb.from('game_secrets').select('*').eq('game_id', gameId).maybeSingle()),
    select(sb.from('game_pubs').select('pubs(*)').eq('game_id', gameId)),
    select(sb.from('teams').select('*').eq('game_id', gameId).order('created_at')),
    select(sb.from('visits').select('*').eq('game_id', gameId).order('arrived_at', { ascending: false })),
    select(sb.from('alerts').select('*').eq('game_id', gameId).order('id', { ascending: false }).limit(100)),
    select(sb.from('clues').select('*').eq('game_id', gameId).order('id', { ascending: false })),
    select(sb.from('zones').select('*').eq('game_id', gameId).order('seq', { ascending: false }).limit(1)),
  ]);
  if (!secret) throw new Error('This phone isn’t the chicken for this game. Join with the chicken code on the home page.');
  const photos = await signedUrls(visits.flatMap((v) => [v.arrive_photo, v.leave_photo]));
  return {
    game,
    secret,
    pubs: pubs.map((r) => r.pubs).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)),
    teams: teams.filter((t) => !t.removed),
    visits,
    alerts,
    clues,
    zone: zones[0] || null,
    photos,
  };
}

const ALERT_ICON = { nearby: '🚨', left_early: '🏃', claim: '🐔', checkin: '📍', joined: '👋' };

export default function ChickenPage({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const ask = useConfirm();
  const now = useNow(1000);
  const { data, error, refresh } = useLiveData(id, ['games', 'teams', 'visits', 'alerts', 'clues', 'zones'], () => loadChicken(id), 15000);
  const [tab, setTab] = useState('map');
  const [actionError, setActionError] = useState(null);
  const [lastSeenAlerts, setLastSeenAlerts] = useState(0);
  const seenAlert = useRef(null);

  // ring + toast for new alerts
  useEffect(() => {
    if (!data) return;
    const newest = data.alerts[0]?.id ?? 0;
    if (seenAlert.current === null) {
      seenAlert.current = newest;
      setLastSeenAlerts(newest);
      return;
    }
    const fresh = data.alerts.filter((a) => a.id > seenAlert.current && a.kind !== 'checkin' && a.kind !== 'joined');
    seenAlert.current = newest;
    if (fresh.length) {
      const a = fresh[0];
      const title = a.kind === 'nearby' ? '🚨 Team nearby' : a.kind === 'claim' ? '🐔 Found you?' : '🏃 Left early';
      ping(title, a.message);
      (a.kind === 'claim' ? toast.warning : toast.error)(title, { description: a.message, duration: 8000 });
    }
  }, [data]);

  useEffect(() => {
    if (tab === 'alerts' && data) setLastSeenAlerts(data.alerts[0]?.id ?? 0);
  }, [tab, data]);

  // any open screen keeps the zone timer moving
  useEffect(() => {
    if (data?.game.status === 'live' && data.game.next_shrink_at && new Date(data.game.next_shrink_at) <= now) {
      rpc('tick_zone', { g: id }).catch(() => {});
    }
  }, [now, data, id]);

  useEffect(() => {
    if (data?.game.status === 'ended') router.replace(`/game/${id}/recap`);
  }, [data, id, router]);

  async function act(fn, args, confirmOpts) {
    if (confirmOpts && !(await ask(confirmOpts))) return;
    setActionError(null);
    try {
      const r = await rpc(fn, args);
      refresh();
      return r;
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

  const { game, secret, pubs, teams, visits, alerts, clues, zone, photos } = data;
  const myPub = pubs.find((p) => p.id === secret.chicken_pub_id);
  const pending = visits.filter((v) => v.status === 'claimed');
  const pubName = (pid) => pubs.find((p) => p.id === pid)?.name || 'a pub';
  const teamName = (tid) => teams.find((t) => t.id === tid)?.name || 'A team';
  const colorOf = Object.fromEntries(teams.map((t, i) => [t.id, TEAM_COLORS[i % TEAM_COLORS.length]]));

  // ------------------------------------------------ lobby: pick a pub
  if (game.status === 'lobby') {
    return (
      <Screen>
        <TopBar emoji="🐔" title="You’re the chicken" sub="Pick your hiding pub. Only you can see this." />
        <Map
          pubs={pubs.map((p) => ({ ...p, icon: p.id === myPub?.id ? '🐔' : '🍺', tone: p.id === myPub?.id ? 'chicken' : '' }))}
          onPubClick={(p) => act('chicken_choose_pub', { g: id, pub: p.id })}
        />
        <Panel title="Where are you hiding?" className="mt-4">
          <Rows>
            {pubs.map((p) => {
              const on = p.id === myPub?.id;
              return (
                <Row
                  key={p.id}
                  lead={on ? '🐔' : '🍺'}
                  trail={
                    <Button size="sm" variant={on ? 'chicken' : 'secondary'} onClick={() => act('chicken_choose_pub', { g: id, pub: p.id })}>
                      {on ? 'Hiding here' : 'Hide here'}
                    </Button>
                  }
                >
                  <span className="font-bold">{p.name}</span>
                </Row>
              );
            })}
          </Rows>
        </Panel>
        <Panel title={`Teams in (${teams.length})`}>
          {teams.length ? (
            <div className="flex flex-wrap gap-2">
              {teams.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1.5 rounded-full border-2 bg-card-2 px-3 py-1 font-extrabold" style={{ borderColor: colorOf[t.id] }}>
                  <span className="size-2.5 rounded-full" style={{ background: colorOf[t.id] }} aria-hidden />
                  {t.name}
                  {t.players?.length > 0 && <span className="font-semibold text-muted-foreground">· {t.players.length}</span>}
                </span>
              ))}
            </div>
          ) : (
            <Empty emoji="👀">No teams yet. Send them the team link.</Empty>
          )}
        </Panel>
        <ErrorNote>{actionError}</ErrorNote>
        <Button
          size="lg"
          block
          variant="chicken"
          disabled={!myPub}
          onClick={() => {
            askNotifications();
            act('chicken_start', { g: id }, {
              title: 'Start the hunt?',
              body: `You get ${game.settings.head_start_min} minutes’ head start to get to ${myPub?.name}. Go!`,
              action: 'Start the hunt',
              variant: 'chicken',
            });
          }}
        >
          {myPub ? 'Start the hunt' : 'Pick a pub first'}
        </Button>
      </Screen>
    );
  }

  // ------------------------------------------------ live
  const headStartLeft = new Date(game.hunt_starts_at) - now;
  const shrinkLeft = game.next_shrink_at ? new Date(game.next_shrink_at) - now : null;
  const found = teams.filter((t) => t.status === 'found').length;
  const unread = alerts.filter((a) => a.id > lastSeenAlerts && a.kind !== 'checkin' && a.kind !== 'joined').length;

  const photoItems = visits.flatMap((v) =>
    [
      v.leave_photo && { src: photos[v.leave_photo], cap: `🍺 ${teamName(v.team_id)} leaving ${pubName(v.pub_id)}`, k: v.id + 'l' },
      v.arrive_photo && { src: photos[v.arrive_photo], cap: `📍 ${teamName(v.team_id)} at ${pubName(v.pub_id)}`, k: v.id + 'a' },
    ].filter(Boolean)
  );

  return (
    <Screen tabs>
      <TopBar
        emoji="🐔"
        title={myPub?.name}
        sub="Your hiding pub"
        right={<Badge variant="found" className="text-sm">{found}/{teams.length} found</Badge>}
      />

      {headStartLeft > 0 && (
        <Hero tone="head" kicker="Head start" title={`Get to ${myPub?.name}!`}>
          <BigNumber>{fmtCountdown(headStartLeft)}</BigNumber>
        </Hero>
      )}

      {pending.map((v) => (
        <Hero key={v.id} tone="alert" kicker="Claim" title={`${teamName(v.team_id)} say they’ve found you`}>
          <p className="font-semibold">At {pubName(v.pub_id)}, checked in {fmtTime(v.arrived_at)}.</p>
          {photos[v.arrive_photo] && <img src={photos[v.arrive_photo]} alt={`${teamName(v.team_id)} outside ${pubName(v.pub_id)}`} className="w-full rounded-2xl border-2 border-alert-edge" />}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="found" size="lg" onClick={() => act('chicken_resolve_claim', { v: v.id, confirm: true })}><Check aria-hidden /> Yes</Button>
            <Button variant="secondary" size="lg" onClick={() => act('chicken_resolve_claim', { v: v.id, confirm: false })}><X aria-hidden /> No</Button>
          </div>
        </Hero>
      ))}
      <ErrorNote>{actionError}</ErrorNote>

      {tab === 'map' && (
        <>
          {headStartLeft <= 0 && shrinkLeft !== null && (
            <p className="mb-2 flex items-center gap-2 font-bold text-alert">
              <span className="zone-ring inline-block size-3 rounded-full bg-alert" aria-hidden /> Zone shrinks in {fmtCountdown(shrinkLeft)}
            </p>
          )}
          <Map
            height="52vh"
            zone={zone}
            pubs={pubs.map((p) => ({ ...p, icon: p.id === myPub?.id ? '🐔' : '🍺', tone: p.id === myPub?.id ? 'chicken' : '' }))}
            people={teams.map((t) => ({
              id: t.id,
              lat: t.last_lat,
              lng: t.last_lng,
              color: colorOf[t.id],
              label: `${t.status === 'found' ? '✅ ' : ''}${t.name} · ${fmtAgo(t.last_active_at, now)}`,
              stale: !t.last_active_at || now - new Date(t.last_active_at) > STALE_MS,
            }))}
          />
          <Button
            block
            variant="alert"
            className="mt-4"
            onClick={async () => {
              const ok = await act('chicken_shrink_now', { g: id }, {
                title: 'Shrink the zone now?',
                body: 'Every team gets told. The timer to the next automatic shrink starts again.',
                action: 'Shrink it',
                variant: 'alert',
              });
              if (ok === false) toast('The zone is as small as it can go.');
            }}
          >
            <Shrink aria-hidden /> Shrink the zone
          </Button>
        </>
      )}

      {tab === 'teams' && (
        <Panel title="Teams">
          {teams.length ? (
            <Rows>
              {teams.map((t) => {
                const v = visits.find((x) => x.id === t.current_visit_id);
                const stale = !t.last_active_at || now - new Date(t.last_active_at) > STALE_MS;
                return (
                  <Row key={t.id} lead={<span className="size-4 rounded-full" style={{ background: colorOf[t.id] }} />} className="items-start">
                    <div className="flex items-center gap-2">
                      <b className="flex-1 text-lg">{t.name}</b>
                      <StatusBadge t={t} />
                    </div>
                    <PlayerList players={t.players} />
                    <p className="text-sm font-semibold text-muted-foreground">
                      {v ? `At ${pubName(v.pub_id)} since ${fmtTime(v.arrived_at)} · ` : ''}
                      <span className={stale ? 'text-alert' : ''}>active {fmtAgo(t.last_active_at, now)}</span>
                      {' · '}{visits.filter((x) => x.team_id === t.id).length} pubs
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {t.status === 'found' && (
                        <Button size="sm" variant="secondary" onClick={() => act('chicken_undo_find', { t: t.id }, { title: `Undo ${t.name}’s find?`, body: 'They go back to being inside the pub, unconfirmed.', action: 'Undo find' })}>
                          <Undo2 aria-hidden /> Undo find
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => act('chicken_remove_team', { t: t.id }, { title: `Remove ${t.name}?`, body: 'They drop out of the game and the recap.', action: 'Remove team', variant: 'alert' })}>
                        <UserMinus aria-hidden /> Remove
                      </Button>
                    </div>
                  </Row>
                );
              })}
            </Rows>
          ) : (
            <Empty>No teams.</Empty>
          )}
        </Panel>
      )}

      {tab === 'alerts' && (
        <Panel title="Alerts">
          {alerts.length ? (
            <Rows>
              {alerts.map((a) => (
                <Row key={a.id} lead={ALERT_ICON[a.kind]} trail={<span className="text-sm font-bold text-muted-foreground">{fmtTime(a.created_at)}</span>}>
                  <span className={a.kind === 'nearby' || a.kind === 'left_early' ? 'font-extrabold' : 'font-semibold'}>{a.message}</span>
                </Row>
              ))}
            </Rows>
          ) : (
            <Empty emoji="🔕">Quiet so far. Alerts land here.</Empty>
          )}
        </Panel>
      )}

      {tab === 'photos' && <PhotoGrid items={photoItems} empty="No photos yet. They arrive as teams check in and drink up." />}

      {tab === 'clues' && <ClueBox gameId={id} clues={clues} onSent={refresh} />}

      <Button
        block
        variant="ghost"
        className="mt-6"
        onClick={() => act('chicken_end_game', { g: id }, { title: 'End the game for everyone?', body: 'Everyone jumps to the recap and your pub is revealed.', action: 'End game', variant: 'alert' })}
      >
        <Flag aria-hidden /> End game
      </Button>

      <TabBar
        value={tab}
        onChange={setTab}
        items={[
          { key: 'map', label: 'Map', icon: MapIcon },
          { key: 'teams', label: 'Teams', icon: Users, badge: pending.length },
          { key: 'alerts', label: 'Alerts', icon: Bell, badge: tab === 'alerts' ? 0 : unread },
          { key: 'photos', label: 'Photos', icon: Camera },
          { key: 'clues', label: 'Clues', icon: MessageCircle },
        ]}
      />
    </Screen>
  );
}

function StatusBadge({ t }) {
  const map = {
    hunting: ['Hunting', 'hunt'],
    inside: ['Checked in', 'head'],
    locked: ['Drinking 🍺', 'chicken'],
    pending: ['Says found', 'alert'],
    found: [`Found #${t.finish_position}`, 'found'],
  };
  const [label, variant] = map[t.status] || [t.status, 'default'];
  return <Badge variant={variant}>{label}</Badge>;
}

function ClueBox({ gameId, clues, onSent }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  async function send(e) {
    e.preventDefault();
    setError(null);
    try {
      await rpc('chicken_send_clue', { g: gameId, clue: text });
      setText('');
      toast.success('Clue sent to every team');
      onSent();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <>
      <Panel title="Send a clue" className="border-clue-edge">
        <form className="space-y-3" onSubmit={send}>
          <Textarea aria-label="Clue" rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. I can see a river" />
          <ErrorNote>{error}</ErrorNote>
          <Button block variant="clue" disabled={!text.trim()}><Send aria-hidden /> Send to every team</Button>
        </form>
      </Panel>
      <Panel title="Sent">
        {clues.length ? (
          <Rows>
            {clues.map((c) => (
              <Row key={c.id} lead="💬" trail={<span className="text-sm font-bold text-muted-foreground">{fmtTime(c.created_at)}</span>}>
                <span className="font-semibold">{c.text}</span>
              </Row>
            ))}
          </Rows>
        ) : (
          <Empty emoji="🤫">No clues yet. Throw them a bone if they’re lost.</Empty>
        )}
      </Panel>
    </>
  );
}
