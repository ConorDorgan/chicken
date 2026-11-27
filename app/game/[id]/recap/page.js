'use client';
import { use, useMemo } from 'react';
import { Link2 } from 'lucide-react';
import { toast } from 'sonner';
import Map from '@/components/Map';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, ErrorNote, Hero, Panel, PhotoGrid, Row, Rows, Screen } from '@/components/game-ui';
import { useLiveData } from '@/lib/hooks';
import { select, supabase } from '@/lib/supabase';
import { fmtDuration, fmtTime, signedUrls, TEAM_COLORS } from '@/lib/util';

async function loadRecap(gameId) {
  const sb = supabase();
  const [game, secret, pubs, teams, visits, alerts, clues, locations] = await Promise.all([
    select(sb.from('games').select('*').eq('id', gameId).single()),
    select(sb.from('game_secrets').select('*').eq('game_id', gameId).maybeSingle()),
    select(sb.from('game_pubs').select('pubs(*)').eq('game_id', gameId)),
    select(sb.from('teams').select('*').eq('game_id', gameId).order('created_at')),
    select(sb.from('visits').select('*').eq('game_id', gameId).order('arrived_at')),
    select(sb.from('alerts').select('*').eq('game_id', gameId).order('id')),
    select(sb.from('clues').select('*').eq('game_id', gameId).order('id')),
    select(sb.from('locations').select('team_id, at').eq('game_id', gameId).order('at').limit(10000)),
  ]);
  const photos = game.status === 'ended' ? await signedUrls(visits.flatMap((v) => [v.arrive_photo, v.leave_photo])) : {};
  return { game, secret, pubs: pubs.map((r) => r.pubs).filter(Boolean), teams: teams.filter((t) => !t.removed), visits, alerts, clues, locations, photos };
}

const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default function Recap({ params }) {
  const { id } = use(params);
  const { data, error } = useLiveData(id, ['games'], () => loadRecap(id), 60000);
  const stats = useMemo(() => (data ? computeStats(data) : null), [data]);

  if (error && !data) {
    return (
      <Screen>
        <ErrorNote>{error}</ErrorNote>
        <Button variant="secondary" asChild><a href="/">Go home</a></Button>
      </Screen>
    );
  }
  if (!data) return <Screen><p className="pt-10 text-center font-bold text-muted-foreground">Loading…</p></Screen>;
  if (data.game.status !== 'ended') {
    return (
      <Screen>
        <Hero tone="plain" emoji="⏳" title="Still hunting">
          <p className="font-semibold text-muted-foreground">The recap appears here when the last team finds the chicken.</p>
          <Button variant="secondary" asChild><a href="/">Go home</a></Button>
        </Hero>
      </Screen>
    );
  }

  const { game, pubs, teams, visits, clues, photos } = data;
  const pubById = Object.fromEntries(pubs.map((p) => [p.id, p]));
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const hide = pubById[data.secret?.chicken_pub_id];
  const colorOf = Object.fromEntries(teams.map((t, i) => [t.id, TEAM_COLORS[i % TEAM_COLORS.length]]));
  const start = new Date(game.hunt_starts_at || game.started_at || game.created_at).getTime();

  const order = [...teams].sort((a, b) => (a.finish_position ?? 999) - (b.finish_position ?? 999));
  const lastFound = teams.filter((t) => t.finish_position).length;
  const unfound = teams.filter((t) => !t.finish_position);

  const routes = teams.map((t) => ({
    color: colorOf[t.id],
    points: visits.filter((v) => v.team_id === t.id).map((v) => [pubById[v.pub_id]?.lat, pubById[v.pub_id]?.lng]).filter((p) => p[0] != null),
  }));

  const photoItems = visits.flatMap((v) =>
    [
      v.arrive_photo && { src: photos[v.arrive_photo], cap: `📍 ${teamById[v.team_id]?.name} at ${pubById[v.pub_id]?.name}`, k: v.id + 'a' },
      v.leave_photo && { src: photos[v.leave_photo], cap: `🍺 ${teamById[v.team_id]?.name} leaving ${pubById[v.pub_id]?.name}`, k: v.id + 'l' },
    ].filter(Boolean)
  );

  return (
    <Screen>
      <Hero tone="chicken" emoji="🐔" kicker="The chicken was in…" title={hide?.name || 'a secret pub'}>
        {game.started_at && (
          <p className="font-bold">
            {new Date(game.started_at).toLocaleDateString()} · {fmtTime(game.started_at)} to {fmtTime(game.ended_at)}
          </p>
        )}
      </Hero>

      <Map
        height="46vh"
        pubs={pubs.map((p) => ({ ...p, icon: p.id === hide?.id ? '🐔' : '🍺', tone: p.id === hide?.id ? 'chicken' : '' }))}
        routes={routes}
      />
      <div className="mt-3 mb-4 flex flex-wrap gap-2">
        {teams.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1.5 rounded-full border-2 bg-card px-3 py-0.5 text-sm font-extrabold" style={{ borderColor: colorOf[t.id] }}>
            <span className="size-2.5 rounded-full" style={{ background: colorOf[t.id] }} aria-hidden />
            {t.name}
          </span>
        ))}
      </div>

      <Panel title="Finishing order">
        <Rows>
          {order.map((t) => {
            const isLoser = !unfound.length && t.finish_position === lastFound && teams.length > 1;
            return (
              <Row
                key={t.id}
                lead={<span className="font-display text-2xl font-extrabold">{MEDAL[t.finish_position] || t.finish_position || '–'}</span>}
                trail={<span className="text-sm font-bold text-muted-foreground">{t.found_at ? fmtDuration(new Date(t.found_at) - start) : 'didn’t find'}</span>}
              >
                <span className="block text-lg font-extrabold">{t.name}</span>
                {isLoser && <Badge variant="alert">Last in · buys the round</Badge>}
              </Row>
            );
          })}
        </Rows>
        {unfound.length > 0 && (
          <p className="mt-2 text-sm font-semibold text-muted-foreground">The game ended before {unfound.map((t) => t.name).join(', ')} found the chicken.</p>
        )}
      </Panel>

      <h2 className="mt-6 mb-3 text-xl font-extrabold">Routes</h2>
      {teams.map((t) => {
        const tv = visits.filter((v) => v.team_id === t.id);
        const pints = tv.filter((v) => v.status === 'done' || v.status === 'locked').length;
        return (
          <Panel
            key={t.id}
            title={<span className="inline-flex items-center gap-2"><span className="size-3.5 rounded-full" style={{ background: colorOf[t.id] }} aria-hidden />{t.name}</span>}
            action={<Badge variant="chicken">🍺 {pints}</Badge>}
          >
            {tv.length ? (
              <ol className="space-y-1.5">
                {tv.map((v, i) => (
                  <li key={v.id} className="flex items-baseline gap-2 font-semibold">
                    <span className="w-5 shrink-0 text-sm font-extrabold text-muted-foreground">{i + 1}</span>
                    <span className="flex-1">
                      {pubById[v.pub_id]?.name}
                      {v.status === 'found' && ' 🐔'}
                      {v.rejected && <Badge variant="alert" className="ml-1">wrong claim</Badge>}
                      {v.left_early_flagged && <Badge variant="clue" className="ml-1">left early</Badge>}
                    </span>
                    <span className="text-sm font-bold text-muted-foreground">{fmtTime(v.arrived_at)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty emoji="🤔">Never checked in anywhere.</Empty>
            )}
          </Panel>
        );
      })}

      <Panel title="Hall of shame" className="border-alert-edge">
        {stats.shame.length ? (
          <Rows>
            {stats.shame.map((s, i) => (
              <Row key={i} lead={s.e}><span className="font-bold">{s.t}</span></Row>
            ))}
          </Rows>
        ) : (
          <Empty emoji="😇">Suspiciously well behaved.</Empty>
        )}
      </Panel>

      <div className="mb-4 grid grid-cols-2 gap-3">
        {stats.facts.map((f, i) => (
          <div key={i} className="pop-in sticker rounded-3xl border-2 bg-card p-4">
            <div className="text-2xl" aria-hidden>{f.e}</div>
            <div className="font-display text-3xl font-extrabold">{f.v}</div>
            <div className="text-sm font-bold text-muted-foreground">{f.l}</div>
          </div>
        ))}
      </div>

      {clues.length > 0 && (
        <Panel title="Clues" className="border-clue-edge">
          <Rows>
            {clues.map((c) => (
              <Row key={c.id} lead="💬" trail={<span className="text-sm font-bold text-muted-foreground">{fmtTime(c.created_at)}</span>}>
                <span className="font-semibold">{c.text}</span>
              </Row>
            ))}
          </Rows>
        </Panel>
      )}

      <h2 className="mt-6 mb-3 text-xl font-extrabold">Photo wall</h2>
      <PhotoGrid items={photoItems} empty="No photos from this game." />

      <Button
        size="lg"
        block
        variant="chicken"
        className="mt-6"
        onClick={() => {
          navigator.clipboard?.writeText(window.location.href);
          toast.success('Recap link copied. Paste it in the group chat.');
        }}
      >
        <Link2 aria-hidden /> Copy recap link
      </Button>
      <p className="mt-4 text-center">
        <a href="/" className="inline-flex min-h-11 items-center px-3 font-bold text-muted-foreground">Home</a>
      </p>
    </Screen>
  );
}

function computeStats({ game, teams, visits, alerts, locations, pubs }) {
  const name = (tid) => teams.find((t) => t.id === tid)?.name || 'Someone';
  const pubName = (pid) => pubs.find((p) => p.id === pid)?.name || 'a pub';
  const shame = [];
  const facts = [];

  for (const t of teams) {
    const early = alerts.filter((a) => a.kind === 'left_early' && a.team_id === t.id).length;
    if (early) shame.push({ e: '🏃', t: `${t.name} left early ${early} time${early > 1 ? 's' : ''}` });
    const wrong = visits.filter((v) => v.team_id === t.id && v.rejected).length;
    if (wrong) shame.push({ e: '❌', t: `${t.name} wrongly claimed the chicken ${wrong} time${wrong > 1 ? 's' : ''}` });
  }

  const pints = visits.filter((v) => v.left_at);
  const slowest = pints.reduce((m, v) => {
    const d = new Date(v.left_at) - new Date(v.arrived_at);
    return !m || d > m.d ? { v, d } : m;
  }, null);
  if (slowest) shame.push({ e: '🐢', t: `Slowest pint: ${name(slowest.v.team_id)} at ${pubName(slowest.v.pub_id)} (${fmtDuration(slowest.d)})` });

  const huntStart = new Date(game.hunt_starts_at || 0).getTime();
  const huntEnd = new Date(game.ended_at || Date.now()).getTime();
  let quiet = null;
  for (const t of teams) {
    const pts = locations.filter((l) => l.team_id === t.id).map((l) => new Date(l.at).getTime()).filter((x) => x >= huntStart);
    const stops = [huntStart, ...pts, t.found_at ? new Date(t.found_at).getTime() : huntEnd];
    for (let i = 1; i < stops.length; i++) {
      const gap = stops[i] - stops[i - 1];
      if (!quiet || gap > quiet.gap) quiet = { t, gap };
    }
  }
  if (quiet && quiet.gap > 10 * 60000) shame.push({ e: '📵', t: `Longest gone dark: ${quiet.t.name} (${fmtDuration(quiet.gap)})` });

  facts.push({ e: '🍺', v: visits.filter((v) => v.status === 'done' || v.status === 'locked').length, l: 'pints drunk' });
  const counts = teams.map((t) => [t, visits.filter((v) => v.team_id === t.id).length]).sort((a, b) => b[1] - a[1]);
  if (counts[0]?.[1]) facts.push({ e: '🗺️', v: counts[0][1], l: `most pubs: ${counts[0][0].name}` });
  const first = teams.find((t) => t.finish_position === 1);
  if (first?.found_at) facts.push({ e: '⚡', v: fmtDuration(new Date(first.found_at) - huntStart), l: `fastest find: ${first.name}` });
  if (game.started_at && game.ended_at) facts.push({ e: '⏱️', v: fmtDuration(new Date(game.ended_at) - new Date(game.started_at)), l: 'game length' });
  return { shame, facts };
}
