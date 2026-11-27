'use client';
import { use, useMemo, useState } from 'react';
import Map from '@/components/Map';
import { useLiveData } from '@/lib/hooks';
import { select, supabase } from '@/lib/supabase';
import { fmtDuration, fmtTime, signedUrls } from '@/lib/util';

const COLORS = ['#3e8ed0', '#e5484d', '#46a758', '#8e4ec6', '#f76b15', '#12a594', '#d6409f', '#978365'];

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
  return {
    game,
    secret,
    pubs: pubs.map((r) => r.pubs).filter(Boolean),
    teams: teams.filter((t) => !t.removed),
    visits,
    alerts,
    clues,
    locations,
    photos,
  };
}

export default function Recap({ params }) {
  const { id } = use(params);
  const { data, error } = useLiveData(id, ['games'], () => loadRecap(id), 60000);
  const [copied, setCopied] = useState(false);

  const stats = useMemo(() => (data ? computeStats(data) : null), [data]);

  if (error && !data) return <div className="err">{error} <a href="/">Home</a></div>;
  if (!data) return <p className="muted">Loading…</p>;
  if (data.game.status !== 'ended') {
    return (
      <div className="card center">
        <p>This game is still going. The recap appears when it ends.</p>
        <a href="/">Home</a>
      </div>
    );
  }

  const { game, pubs, teams, visits, clues, photos } = data;
  const pubById = Object.fromEntries(pubs.map((p) => [p.id, p]));
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const hide = pubById[data.secret?.chicken_pub_id];
  const colorOf = Object.fromEntries(teams.map((t, i) => [t.id, COLORS[i % COLORS.length]]));
  const start = new Date(game.hunt_starts_at || game.started_at || game.created_at).getTime();

  const order = [...teams].sort((a, b) => (a.finish_position ?? 999) - (b.finish_position ?? 999));
  const lastFound = teams.filter((t) => t.finish_position).length;
  const unfound = teams.filter((t) => !t.finish_position);

  const routes = teams.map((t) => ({
    color: colorOf[t.id],
    points: visits.filter((v) => v.team_id === t.id).map((v) => [pubById[v.pub_id]?.lat, pubById[v.pub_id]?.lng]).filter((p) => p[0] != null),
  }));

  return (
    <>
      <div className="center" style={{ fontSize: 56, marginTop: 12 }}>🐔</div>
      <h1 className="center">The chicken was in {hide?.name || '…'}</h1>
      <p className="center muted small">
        {game.started_at && `${new Date(game.started_at).toLocaleDateString()} · ${fmtTime(game.started_at)}–${fmtTime(game.ended_at)}`}
      </p>

      <Map
        height="50vh"
        pubs={pubs.map((p) => ({ ...p, icon: p.id === hide?.id ? '🐔' : '🍺', highlight: p.id === hide?.id }))}
        routes={routes}
      />
      <div className="row small" style={{ marginTop: 6 }}>
        {teams.map((t) => (
          <span key={t.id}><span style={{ color: colorOf[t.id] }}>●</span> {t.name}</span>
        ))}
      </div>

      <h2>Finishing order</h2>
      <ul className="list card">
        {order.map((t) => {
          const isLoser = unfound.length ? false : t.finish_position === lastFound && teams.length > 1;
          return (
            <li key={t.id} className="row">
              <b style={{ width: 28 }}>{t.finish_position ? `${t.finish_position}.` : '–'}</b>
              <span className="grow">
                {t.name} {isLoser && <span className="badge badge-red">Last! Buys the round</span>}
              </span>
              <span className="small muted">{t.found_at ? fmtDuration(new Date(t.found_at) - start) : 'didn’t find'}</span>
            </li>
          );
        })}
      </ul>
      {unfound.length > 0 && <p className="small muted">The game ended before {unfound.map((t) => t.name).join(', ')} found the chicken.</p>}

      <h2>Routes</h2>
      {teams.map((t) => {
        const tv = visits.filter((v) => v.team_id === t.id);
        const pints = tv.filter((v) => v.status === 'done' || v.status === 'locked').length;
        return (
          <div key={t.id} className="card">
            <b style={{ color: colorOf[t.id] }}>{t.name}</b> <span className="small muted">· {pints} pint{pints === 1 ? '' : 's'}</span>
            <ol className="small" style={{ margin: '6px 0 0', paddingLeft: 20 }}>
              {tv.map((v) => (
                <li key={v.id}>
                  {pubById[v.pub_id]?.name} <span className="muted">{fmtTime(v.arrived_at)}</span>
                  {v.status === 'found' && ' 🐔'}
                  {v.rejected && ' ❌ wrong claim'}
                  {v.left_early_flagged && ' 🏃 left early'}
                </li>
              ))}
              {!tv.length && <li className="muted">Never checked in anywhere 🤔</li>}
            </ol>
          </div>
        );
      })}

      <h2>Hall of shame</h2>
      <ul className="list card">
        {stats.shame.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
        {!stats.shame.length && <li className="muted">Suspiciously well behaved.</li>}
      </ul>

      <h2>Stats</h2>
      <div className="card">
        <ul className="list">
          {stats.facts.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </div>

      {clues.length > 0 && (
        <>
          <h2>Clues</h2>
          <ul className="list card">
            {clues.map((c) => (
              <li key={c.id} className="row">
                <span className="grow">{c.text}</span>
                <span className="small muted">{fmtTime(c.created_at)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Photo wall</h2>
      <div className="feed">
        {visits.flatMap((v) =>
          [
            v.arrive_photo && { src: photos[v.arrive_photo], cap: `📍 ${teamById[v.team_id]?.name} at ${pubById[v.pub_id]?.name}`, k: v.id + 'a' },
            v.leave_photo && { src: photos[v.leave_photo], cap: `🍺 ${teamById[v.team_id]?.name} leaving ${pubById[v.pub_id]?.name}`, k: v.id + 'l' },
          ].filter(Boolean)
        ).map((p) => (
          <figure key={p.k}>
            {p.src ? <img src={p.src} alt="" loading="lazy" /> : <div style={{ aspectRatio: 1 }} />}
            <figcaption>{p.cap}</figcaption>
          </figure>
        ))}
      </div>

      <div className="spacer" />
      <button
        className="btn btn-primary btn-block"
        onClick={() => {
          navigator.clipboard?.writeText(window.location.href);
          setCopied(true);
        }}
      >
        {copied ? 'Link copied' : 'Copy recap link'}
      </button>
      <p className="center small"><a href="/">Home</a></p>
    </>
  );
}

function computeStats({ game, teams, visits, alerts, locations, pubs }) {
  const name = (tid) => teams.find((t) => t.id === tid)?.name || 'Someone';
  const pubName = (pid) => pubs.find((p) => p.id === pid)?.name || 'a pub';
  const shame = [];
  const facts = [];

  for (const t of teams) {
    const early = alerts.filter((a) => a.kind === 'left_early' && a.team_id === t.id).length;
    if (early) shame.push(`🏃 ${t.name} left early ${early} time${early > 1 ? 's' : ''}`);
    const wrong = visits.filter((v) => v.team_id === t.id && v.rejected).length;
    if (wrong) shame.push(`❌ ${t.name} wrongly claimed to find the chicken ${wrong} time${wrong > 1 ? 's' : ''}`);
  }

  const pints = visits.filter((v) => v.left_at);
  const slowest = pints.reduce((m, v) => {
    const d = new Date(v.left_at) - new Date(v.arrived_at);
    return !m || d > m.d ? { v, d } : m;
  }, null);
  if (slowest) shame.push(`🐢 Slowest pint: ${name(slowest.v.team_id)} at ${pubName(slowest.v.pub_id)} (${fmtDuration(slowest.d)})`);

  // longest gap between location pings while the hunt was on
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
  if (quiet && quiet.gap > 10 * 60000) shame.push(`📵 Longest gone dark: ${quiet.t.name} (${fmtDuration(quiet.gap)})`);

  const totalPints = visits.filter((v) => v.status === 'done' || v.status === 'locked').length;
  facts.push(`🍺 Pints drunk: ${totalPints}`);
  const counts = teams.map((t) => [t, visits.filter((v) => v.team_id === t.id).length]).sort((a, b) => b[1] - a[1]);
  if (counts[0]?.[1]) facts.push(`🗺️ Most pubs checked: ${counts[0][0].name} (${counts[0][1]})`);
  const first = teams.filter((t) => t.finish_position === 1)[0];
  if (first?.found_at) facts.push(`⚡ Fastest find: ${first.name} in ${fmtDuration(new Date(first.found_at) - huntStart)}`);
  if (game.started_at && game.ended_at) facts.push(`⏱️ Game length: ${fmtDuration(new Date(game.ended_at) - new Date(game.started_at))}`);
  facts.push(`📍 Pubs in play: ${pubs.length}`);
  return { shame, facts };
}
