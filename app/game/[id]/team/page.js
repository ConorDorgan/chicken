'use client';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Map from '@/components/Map';
import PhotoButton from '@/components/PhotoButton';
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
  if (!team) throw new Error('This phone is not on a team in this game.');
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
  const now = useNow(1000);
  const { data, error, refresh } = useLiveData(
    id,
    ['games', 'teams', 'visits', 'clues', 'zones'],
    () => loadTeam(id),
    15000
  );
  const [selected, setSelected] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [toast, setToast] = useState(null);
  const seen = useRef(null);

  const live = data?.game.status === 'live';
  const { fix, error: gpsError } = useLocation(live, (f) => {
    rpc('report_location', { g: id, lat: f.lat, lng: f.lng }).catch(() => {});
  });

  // new clue / zone shrink notifications
  useEffect(() => {
    if (!data) return;
    const sig = { clue: data.clues[0]?.id ?? 0, zone: data.zone?.seq ?? -1 };
    if (seen.current) {
      if (sig.clue > seen.current.clue) {
        ping('🐔 New clue', data.clues[0].text);
        setToast(`🐔 Clue: ${data.clues[0].text}`);
        setTimeout(() => setToast(null), 8000);
      } else if (sig.zone > seen.current.zone && sig.zone > 0) {
        ping('🔴 The zone has shrunk!', 'Check the map');
        setToast('🔴 The zone has shrunk!');
        setTimeout(() => setToast(null), 6000);
      }
    }
    seen.current = sig;
  }, [data]);

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
      if (ok) setSelected(null);
    } catch (e) {
      setActionError(e.message);
    }
  }

  if (error && !data) return <div className="err">{error} <a href="/">Home</a></div>;
  if (!data) return <p className="muted">Loading…</p>;

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
    dim: !inZone(p, zone),
    highlight: selected === p.id,
  }));

  const Header = (
    <>
      <div className="row">
        <h1 className="grow">{team.name}</h1>
        <span className="badge badge-yolk">🐔 {progress.found}/{progress.total} found</span>
      </div>
      {gpsError && <p className="small err">Location is off: {gpsError}. The chicken can’t see you, and that looks suspicious.</p>}
    </>
  );

  // ------------------------------------------------ lobby / head start
  if (game.status === 'lobby') {
    return (
      <>
        {Header}
        <div className="card center stack">
          <div style={{ fontSize: 56 }}>🥚</div>
          <p>Waiting for the chicken to start the game…</p>
          <button className="btn btn-block" onClick={askNotifications}>🔔 Turn on alerts</button>
        </div>
        <Map pubs={mapPubs} />
      </>
    );
  }

  if (headStartLeft > 0) {
    return (
      <>
        {Header}
        <div className="card card-hi center">
          <div className="muted">The chicken is running to their pub…</div>
          <div className="big">{fmtCountdown(headStartLeft)}</div>
          <div className="small muted">Hunt starts at {fmtTime(game.hunt_starts_at)}</div>
        </div>
        <button className="btn btn-block" onClick={askNotifications}>🔔 Turn on alerts</button>
        <Map pubs={mapPubs} zone={zone} people={fix ? [{ id: 'me', ...fix, label: 'You', me: true }] : []} />
      </>
    );
  }

  // ------------------------------------------------ live
  const pintLeft = current ? new Date(current.arrived_at).getTime() + game.settings.pint_min * 60000 - now : 0;

  return (
    <>
      {Header}
      {shrinkLeft !== null && <p className="small muted">🔴 Zone shrinks in {fmtCountdown(shrinkLeft)}</p>}

      {team.status === 'found' && (
        <div className="card card-green center stack">
          <div style={{ fontSize: 56 }}>🐔🎉</div>
          <h2 style={{ margin: 0 }}>You found the chicken! #{team.finish_position}</h2>
          <p>Stay at {pubById[current?.pub_id]?.name || 'the pub'} and keep quiet. Wait for the rest.</p>
          <p className="muted small">{progress.total - progress.found} team{progress.total - progress.found === 1 ? '' : 's'} still hunting.</p>
        </div>
      )}

      {team.status === 'pending' && (
        <div className="card card-hi center">
          <div style={{ fontSize: 40 }}>⏳</div>
          <p>Waiting for the chicken to confirm…</p>
        </div>
      )}

      {team.status === 'inside' && current && (
        <div className="card card-hi stack">
          <h2 style={{ marginTop: 0 }}>📍 {pubById[current.pub_id]?.name}</h2>
          <p>Have a proper look around. Is the chicken here?</p>
          <button className="btn btn-green btn-block" onClick={() => confirm('Found the chicken? They’ll have to confirm.') && act('team_claim_found', { g: id })}>
            🐔 Found the chicken!
          </button>
          <button className="btn btn-block" onClick={() => act('team_no_chicken', { g: id })}>
            No chicken here
          </button>
        </div>
      )}

      {team.status === 'locked' && current && (
        <div className="card card-red stack center">
          {current.rejected && <p><b>The chicken says no 🐔❌</b></p>}
          <h2 style={{ marginTop: 0 }}>🍺 Drink up at {pubById[current.pub_id]?.name}</h2>
          {pintLeft > 0 ? (
            <>
              <div className="big">{fmtCountdown(pintLeft)}</div>
              <p className="muted small">You can leave after the timer, with a photo of the empty pints.</p>
            </>
          ) : (
            <p>Timer’s done. Show us those empty glasses.</p>
          )}
          <PhotoButton
            label="Empty pints photo"
            disabled={pintLeft > 0}
            className="btn btn-primary btn-block"
            onPhoto={(file) => photoThen('leave', file, 'team_leave')}
          />
        </div>
      )}

      {team.status === 'hunting' && (
        <div className="card stack">
          {selected ? (
            <>
              <b>Check in at {pubById[selected]?.name}</b>
              <p className="small muted">Take a photo of the pub from outside to prove you’re there.</p>
              <PhotoButton
                label="Photo of the pub from outside"
                className="btn btn-primary btn-block"
                onPhoto={(file) => photoThen('arrive', file, 'team_check_in', { pub: selected })}
              />
              <button className="btn btn-block" onClick={() => setSelected(null)}>Cancel</button>
            </>
          ) : (
            <p className="muted">Tap a pub on the map or in the list to check in.</p>
          )}
        </div>
      )}
      {actionError && <div className="err">{actionError}</div>}

      <Map
        zone={zone}
        pubs={mapPubs}
        people={fix ? [{ id: 'me', ...fix, label: 'You', me: true }] : []}
        onPubClick={(p) => team.status === 'hunting' && setSelected(p.id)}
        fitKey={zone?.seq}
      />

      {clues.length > 0 && (
        <>
          <h2>🐔 Clues</h2>
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

      <h2>Pubs</h2>
      <ul className="list card">
        {sortedPubs.map((p) => {
          const out = !inZone(p, zone);
          const here = current?.pub_id === p.id;
          return (
            <li key={p.id} className="row" style={{ opacity: out ? 0.45 : 1 }}>
              <span>{here ? '📍' : checked.has(p.id) ? '✅' : out ? '⛔' : '⬜'}</span>
              <span className="grow">
                {p.name}
                {fix && <span className="small muted"> · {Math.round(distM(fix, p))} m</span>}
                {out && <span className="small muted"> · outside zone</span>}
              </span>
              {team.status === 'hunting' && (
                <button className={`btn btn-sm ${selected === p.id ? 'btn-primary' : ''}`} onClick={() => setSelected(p.id)}>
                  Check in
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
    </>
  );
}
