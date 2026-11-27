'use client';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Map from '@/components/Map';
import { useLiveData, useNow } from '@/lib/hooks';
import { rpc, select, supabase } from '@/lib/supabase';
import { askNotifications, fmtAgo, fmtCountdown, fmtTime, ping, signedUrls } from '@/lib/util';

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
  if (!secret) throw new Error('This phone is not the chicken for this game.');
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

export default function ChickenPage({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const now = useNow(1000);
  const { data, error, refresh } = useLiveData(
    id,
    ['games', 'teams', 'visits', 'alerts', 'clues', 'zones'],
    () => loadChicken(id),
    15000
  );
  const [tab, setTab] = useState('map');
  const [toast, setToast] = useState(null);
  const [actionError, setActionError] = useState(null);
  const seenAlert = useRef(null);

  // ring + toast for new alerts
  useEffect(() => {
    if (!data) return;
    const newest = data.alerts[0]?.id ?? 0;
    if (seenAlert.current === null) {
      seenAlert.current = newest;
      return;
    }
    const fresh = data.alerts.filter((a) => a.id > seenAlert.current && a.kind !== 'checkin' && a.kind !== 'joined');
    seenAlert.current = newest;
    if (fresh.length) {
      const a = fresh[0];
      const title = a.kind === 'nearby' ? '🚨 Team nearby' : a.kind === 'claim' ? '🐔 Found you?' : '🏃 Left early';
      ping(title, a.message);
      setToast(`${title}: ${a.message}`);
      setTimeout(() => setToast(null), 6000);
    }
  }, [data]);

  // anyone's open screen keeps the zone timer moving
  useEffect(() => {
    if (data?.game.status === 'live' && data.game.next_shrink_at && new Date(data.game.next_shrink_at) <= now) {
      rpc('tick_zone', { g: id }).catch(() => {});
    }
  }, [now, data, id]);

  useEffect(() => {
    if (data?.game.status === 'ended') router.replace(`/game/${id}/recap`);
  }, [data, id, router]);

  async function act(fn, args, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    setActionError(null);
    try {
      const r = await rpc(fn, args);
      refresh();
      return r;
    } catch (e) {
      setActionError(e.message);
    }
  }

  if (error && !data) return <div className="err">{error} <a href="/">Home</a></div>;
  if (!data) return <p className="muted">Loading…</p>;

  const { game, secret, pubs, teams, visits, alerts, clues, zone, photos } = data;
  const myPub = pubs.find((p) => p.id === secret.chicken_pub_id);
  const pending = visits.filter((v) => v.status === 'claimed');
  const pubName = (pid) => pubs.find((p) => p.id === pid)?.name || 'a pub';
  const teamName = (tid) => teams.find((t) => t.id === tid)?.name || 'A team';

  // ------------------------------------------------ lobby
  if (game.status === 'lobby') {
    return (
      <>
        <h1>🐔 You’re the chicken</h1>
        <p className="muted">Pick your hiding pub. Only you can see this.</p>
        <Map
          pubs={pubs.map((p) => ({ ...p, icon: p.id === secret.chicken_pub_id ? '🐔' : '🍺', highlight: p.id === secret.chicken_pub_id }))}
          onPubClick={(p) => act('chicken_choose_pub', { g: id, pub: p.id })}
        />
        <ul className="list card">
          {pubs.map((p) => (
            <li key={p.id} className="row">
              <span className="grow">{p.id === secret.chicken_pub_id ? '🐔 ' : ''}{p.name}</span>
              <button
                className={`btn btn-sm ${p.id === secret.chicken_pub_id ? 'btn-primary' : ''}`}
                onClick={() => act('chicken_choose_pub', { g: id, pub: p.id })}
              >
                {p.id === secret.chicken_pub_id ? 'Hiding here' : 'Hide here'}
              </button>
            </li>
          ))}
        </ul>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Teams joined ({teams.length})</h3>
          <p>{teams.map((t) => t.name).join(', ') || <span className="muted">Nobody yet</span>}</p>
        </div>
        {actionError && <div className="err">{actionError}</div>}
        <button
          className="btn btn-primary btn-block"
          disabled={!myPub}
          onClick={() => {
            askNotifications();
            act('chicken_start', { g: id }, `Start the hunt? You’ll get ${game.settings.head_start_min} minutes’ head start to reach ${myPub?.name}.`);
          }}
        >
          {myPub ? `Start the hunt (hiding in ${myPub.name})` : 'Pick a pub first'}
        </button>
      </>
    );
  }

  // ------------------------------------------------ live
  const headStartLeft = new Date(game.hunt_starts_at) - now;
  const shrinkLeft = game.next_shrink_at ? new Date(game.next_shrink_at) - now : null;
  const found = teams.filter((t) => t.status === 'found').length;

  return (
    <>
      {pending.length > 0 && (
        <div className="banner" onClick={() => setTab('teams')}>
          🐔 {pending.length} team{pending.length > 1 ? 's say' : ' says'} they found you. Confirm below
        </div>
      )}
      <div className="row">
        <h1 className="grow">🐔 {myPub?.name}</h1>
        <span className="badge badge-yolk">{found}/{teams.length} found</span>
      </div>

      {headStartLeft > 0 ? (
        <div className="card card-hi center">
          <div className="muted">Head start: get to {myPub?.name}!</div>
          <div className="big">{fmtCountdown(headStartLeft)}</div>
        </div>
      ) : (
        shrinkLeft !== null && <p className="small muted">🔴 Zone shrinks in {fmtCountdown(shrinkLeft)}</p>
      )}

      {pending.map((v) => (
        <div key={v.id} className="card card-red stack">
          <b>{teamName(v.team_id)} say they’ve found you at {pubName(v.pub_id)}</b>
          {photos[v.arrive_photo] && <img src={photos[v.arrive_photo]} alt="" style={{ width: '100%', borderRadius: 10 }} />}
          <div className="row">
            <button className="btn btn-green grow" onClick={() => act('chicken_resolve_claim', { v: v.id, confirm: true })}>✅ Yes, they found me</button>
            <button className="btn btn-red grow" onClick={() => act('chicken_resolve_claim', { v: v.id, confirm: false })}>❌ No</button>
          </div>
        </div>
      ))}
      {actionError && <div className="err">{actionError}</div>}

      <div className="tabs">
        {[['map', 'Map'], ['teams', 'Teams'], ['alerts', 'Alerts'], ['photos', 'Photos'], ['clues', 'Clues']].map(([k, l]) => (
          <button key={k} className={`btn tab btn-sm ${tab === k ? 'tab-on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'map' && (
        <>
          <Map
            height="55vh"
            zone={zone}
            pubs={pubs.map((p) => ({ ...p, icon: p.id === myPub?.id ? '🐔' : '🍺', highlight: p.id === myPub?.id }))}
            people={teams.map((t) => ({
              id: t.id,
              lat: t.last_lat,
              lng: t.last_lng,
              label: `${t.status === 'found' ? '✅ ' : ''}${t.name} · ${fmtAgo(t.last_active_at, now)}`,
              stale: !t.last_active_at || now - new Date(t.last_active_at) > STALE_MS,
            }))}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="btn grow"
              onClick={async () => {
                const ok = await act('chicken_shrink_now', { g: id }, 'Shrink the zone now?');
                if (ok === false) setActionError('The zone is as small as it can go.');
              }}
            >
              🔴 Shrink now
            </button>
          </div>
        </>
      )}

      {tab === 'teams' && (
        <ul className="list card">
          {teams.map((t) => {
            const v = visits.find((x) => x.id === t.current_visit_id);
            const stale = !t.last_active_at || now - new Date(t.last_active_at) > STALE_MS;
            return (
              <li key={t.id} className="stack">
                <div className="row">
                  <b className="grow">{t.name}</b>
                  <StatusBadge t={t} />
                </div>
                <div className="small muted">
                  {v ? `At ${pubName(v.pub_id)} since ${fmtTime(v.arrived_at)} · ` : ''}
                  <span style={{ color: stale ? 'var(--red)' : undefined }}>last active {fmtAgo(t.last_active_at, now)}</span>
                  {' · '}{visits.filter((x) => x.team_id === t.id).length} pubs checked
                </div>
                <div className="row">
                  {t.status === 'found' && (
                    <button className="btn btn-sm" onClick={() => act('chicken_undo_find', { t: t.id }, `Undo ${t.name}’s find?`)}>Undo find</button>
                  )}
                  <button className="btn btn-sm" onClick={() => act('chicken_remove_team', { t: t.id }, `Remove ${t.name} from the game?`)}>Remove</button>
                </div>
              </li>
            );
          })}
          {!teams.length && <li className="muted">No teams.</li>}
        </ul>
      )}

      {tab === 'alerts' && (
        <ul className="list card">
          {alerts.map((a) => (
            <li key={a.id} className="row">
              <span>{{ nearby: '🚨', left_early: '🏃', claim: '🐔', checkin: '📍', joined: '👋' }[a.kind]}</span>
              <span className="grow">{a.message}</span>
              <span className="small muted">{fmtTime(a.created_at)}</span>
            </li>
          ))}
          {!alerts.length && <li className="muted">Nothing yet.</li>}
        </ul>
      )}

      {tab === 'photos' && (
        <div className="feed">
          {visits.flatMap((v) =>
            [
              v.leave_photo && { src: photos[v.leave_photo], cap: `🍺 ${teamName(v.team_id)} leaving ${pubName(v.pub_id)}`, k: v.id + 'l' },
              v.arrive_photo && { src: photos[v.arrive_photo], cap: `📍 ${teamName(v.team_id)} at ${pubName(v.pub_id)}`, k: v.id + 'a' },
            ].filter(Boolean)
          ).map((p) => (
            <figure key={p.k}>
              {p.src ? <img src={p.src} alt="" loading="lazy" /> : <div style={{ aspectRatio: 1 }} />}
              <figcaption>{p.cap}</figcaption>
            </figure>
          ))}
          {!visits.length && <p className="muted">No photos yet.</p>}
        </div>
      )}

      {tab === 'clues' && <ClueBox gameId={id} clues={clues} onSent={refresh} />}

      <div className="spacer" />
      <button className="btn btn-block btn-ghost" onClick={() => act('chicken_end_game', { g: id }, 'End the game for everyone now?')}>
        End game
      </button>

      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
    </>
  );
}

function StatusBadge({ t }) {
  const map = {
    hunting: ['Hunting', ''],
    inside: ['Checked in', 'badge-yolk'],
    locked: ['Drinking 🍺', 'badge-yolk'],
    pending: ['Claims found', 'badge-red'],
    found: [`Found #${t.finish_position}`, 'badge-green'],
  };
  const [label, cls] = map[t.status] || [t.status, ''];
  return <span className={`badge ${cls}`}>{label}</span>;
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
      onSent();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <>
      <form className="card stack" onSubmit={send}>
        <label htmlFor="clue">Send a clue to every team</label>
        <textarea id="clue" rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. I can see a river" />
        {error && <div className="err">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={!text.trim()}>Send clue</button>
      </form>
      <ul className="list card">
        {clues.map((c) => (
          <li key={c.id} className="row">
            <span className="grow">{c.text}</span>
            <span className="small muted">{fmtTime(c.created_at)}</span>
          </li>
        ))}
        {!clues.length && <li className="muted">No clues sent yet.</li>}
      </ul>
    </>
  );
}
