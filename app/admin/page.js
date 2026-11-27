'use client';
import { useEffect, useState } from 'react';
import Map from '@/components/Map';
import { ensureSession, rpc, select, supabase } from '@/lib/supabase';
import { fmtTime } from '@/lib/util';

export default function Admin() {
  const [state, setState] = useState('loading'); // loading | login | in
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('games');

  useEffect(() => {
    (async () => {
      try {
        await ensureSession();
        const me = await select(supabase().from('admins').select('uid'));
        setState(me.length ? 'in' : 'login');
      } catch (e) {
        setError(e.message);
        setState('login');
      }
    })();
  }, []);

  if (state === 'loading') return <p className="muted">Loading…</p>;
  if (state === 'login') return <Login onIn={() => setState('in')} initialError={error} />;

  return (
    <>
      <div className="row">
        <h1 className="grow">🐔 Admin</h1>
        <a href="/" className="small">Home</a>
      </div>
      <p className="small muted">You set things up here before the game. Nothing here shows where the chicken is.</p>
      <div className="tabs">
        {['games', 'pubs', 'settings'].map((t) => (
          <button key={t} className={`btn tab ${tab === t ? 'tab-on' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'games' && <Games />}
      {tab === 'pubs' && <Pubs />}
      {tab === 'settings' && <Settings onLogout={() => setState('login')} />}
    </>
  );
}

function Login({ onIn, initialError }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ok = await rpc('admin_login', { password: pw });
      if (ok) onIn();
      else setError('Wrong password');
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }
  return (
    <form className="card stack" onSubmit={submit} style={{ marginTop: 48 }}>
      <h1>Admin login</h1>
      <input type="password" placeholder="Admin password" value={pw} onChange={(e) => setPw(e.target.value)} />
      {error && <div className="err">{error}</div>}
      <button className="btn btn-primary btn-block" disabled={busy || !pw}>Log in</button>
      <p className="small muted"><a href="/">Back</a></p>
    </form>
  );
}

// ---------------------------------------------------------------- pubs
function Pubs() {
  const [pubs, setPubs] = useState([]);
  const [draft, setDraft] = useState(null); // {lat,lng}
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  async function load() {
    try {
      setPubs(await select(supabase().from('pubs').select('*').order('name')));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function search(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setError(null);
    try {
      // OpenStreetMap search, biased to the area the pubs are already in
      const params = new URLSearchParams({ q: query, format: 'json', limit: '6' });
      if (pubs.length) {
        const lats = pubs.map((p) => p.lat);
        const lngs = pubs.map((p) => p.lng);
        const pad = 0.05;
        params.set('viewbox', `${Math.min(...lngs) - pad},${Math.max(...lats) + pad},${Math.max(...lngs) + pad},${Math.min(...lats) - pad}`);
      }
      const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
      setResults(await r.json());
    } catch {
      setError('Search failed. Tap the map to drop a pin instead.');
    }
  }

  function pick(r) {
    setDraft({ lat: Number(r.lat), lng: Number(r.lon) });
    setName(r.name || r.display_name.split(',')[0]);
    setResults([]);
  }

  async function add() {
    setError(null);
    try {
      await select(supabase().from('pubs').insert({ name: name.trim(), lat: draft.lat, lng: draft.lng }));
      setDraft(null);
      setName('');
      setQuery('');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(p) {
    if (!confirm(`Delete ${p.name}? It will also be removed from any games that use it.`)) return;
    try {
      await select(supabase().from('pubs').delete().eq('id', p.id));
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const mapPubs = pubs.map((p) => ({ ...p, icon: '🍺' }));
  if (draft) mapPubs.push({ id: 'draft', name: name || 'New pub', ...draft, icon: '📍', highlight: true });

  return (
    <>
      <h2>Pubs ({pubs.length})</h2>
      <form className="row" onSubmit={search}>
        <input className="grow" type="text" placeholder="Search for a pub…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn">Search</button>
      </form>
      {results.length > 0 && (
        <ul className="list card">
          {results.map((r) => (
            <li key={r.place_id}>
              <button className="btn btn-ghost btn-sm" onClick={() => pick(r)} style={{ textAlign: 'left' }}>
                {r.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">Or tap the map to drop a pin.</p>
      <Map pubs={mapPubs} onMapClick={(ll) => setDraft(ll)} fitKey={pubs.length} />
      {draft && (
        <div className="card card-hi stack">
          <label htmlFor="pubname">Pub name</label>
          <input id="pubname" type="text" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="row">
            <button className="btn btn-primary grow" disabled={!name.trim()} onClick={add}>Add pub</button>
            <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <div className="err">{error}</div>}
      <ul className="list card">
        {pubs.map((p) => (
          <li key={p.id} className="row">
            <span className="grow">{p.name}</span>
            <button className="btn btn-sm" onClick={() => remove(p)}>Delete</button>
          </li>
        ))}
        {!pubs.length && <li className="muted">No pubs yet.</li>}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------- games
function Games() {
  const [pubs, setPubs] = useState([]);
  const [chosen, setChosen] = useState(new Set());
  const [games, setGames] = useState([]);
  const [codes, setCodes] = useState({});
  const [created, setCreated] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const sb = supabase();
      const [p, g, c] = await Promise.all([
        select(sb.from('pubs').select('*').order('name')),
        select(sb.from('games').select('id, created_at, status, started_at, ended_at').order('created_at', { ascending: false })),
        select(sb.from('game_codes').select('*')),
      ]);
      setPubs(p);
      setChosen((prev) => (prev.size ? prev : new Set(p.map((x) => x.id))));
      setGames(g);
      setCodes(Object.fromEntries(c.map((x) => [x.game_id, x])));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function toggle(id) {
    const n = new Set(chosen);
    n.has(id) ? n.delete(id) : n.add(id);
    setChosen(n);
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const rows = await rpc('admin_create_game', { pub_ids: [...chosen] });
      setCreated(rows[0]);
      load();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  async function forceEnd(g) {
    if (!confirm('Force-end this game? Everyone will see the recap and the chicken’s pub.')) return;
    try {
      await rpc('admin_force_end', { g: g.id });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(g) {
    if (!confirm('Delete this game and all its photos for good?')) return;
    try {
      const store = supabase().storage.from('photos');
      const { data: folders } = await store.list(g.id, { limit: 1000 });
      for (const f of folders || []) {
        const { data: files } = await store.list(`${g.id}/${f.name}`, { limit: 1000 });
        const paths = (files || []).map((x) => `${g.id}/${f.name}/${x.name}`);
        if (paths.length) await store.remove(paths);
      }
      await rpc('admin_delete_game', { g: g.id });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <>
      {created && <Codes codes={created} origin={origin} onClose={() => setCreated(null)} />}

      <h2>New game</h2>
      <div className="card">
        <div className="row">
          <span className="grow">Pubs in play tonight: <b>{chosen.size}</b></span>
          <button className="btn btn-sm" onClick={() => setChosen(new Set(pubs.map((p) => p.id)))}>All</button>
          <button className="btn btn-sm" onClick={() => setChosen(new Set())}>None</button>
        </div>
        <ul className="list">
          {pubs.map((p) => (
            <li key={p.id}>
              <label className="row" style={{ color: 'var(--text)', margin: 0 }}>
                <input type="checkbox" checked={chosen.has(p.id)} onChange={() => toggle(p.id)} />
                <span>{p.name}</span>
              </label>
            </li>
          ))}
          {!pubs.length && <li className="muted">Add pubs first (Pubs tab).</li>}
        </ul>
        <button className="btn btn-primary btn-block" disabled={busy || chosen.size < 2} onClick={create}>
          Create game
        </button>
      </div>
      {error && <div className="err">{error}</div>}

      <h2>Games</h2>
      {games.map((g) => (
        <div className="card" key={g.id}>
          <div className="row">
            <b className="grow">{new Date(g.created_at).toLocaleDateString()} {fmtTime(g.created_at)}</b>
            <span className={`badge ${g.status === 'live' ? 'badge-yolk' : g.status === 'ended' ? '' : 'badge-green'}`}>{g.status}</span>
          </div>
          {codes[g.id] && g.status !== 'ended' && (
            <details style={{ marginTop: 8 }}>
              <summary className="small muted">Show codes</summary>
              <Codes codes={{ ...codes[g.id], game_id: g.id }} origin={origin} />
            </details>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            {g.status === 'ended' && <a className="btn btn-sm" href={`/game/${g.id}/recap`}>Recap</a>}
            {g.status !== 'ended' && <button className="btn btn-sm" onClick={() => forceEnd(g)}>Force end</button>}
            <button className="btn btn-sm" onClick={() => remove(g)}>Delete</button>
          </div>
        </div>
      ))}
      {!games.length && <p className="muted">No games yet.</p>}
    </>
  );
}

function Codes({ codes, origin, onClose }) {
  const link = `${origin}/?code=${codes.team_code}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className={onClose ? 'card card-hi stack' : 'stack'}>
      {onClose && <h2 style={{ marginTop: 0 }}>Game created 🎉</h2>}
      <div>
        <label>Team code: share with everyone</label>
        <div className="code">{codes.team_code}</div>
        <div className="row">
          <span className="small muted grow" style={{ wordBreak: 'break-all' }}>{link}</span>
          <button
            className="btn btn-sm"
            onClick={() => {
              navigator.clipboard?.writeText(`Find the Chicken 🐔 join here: ${link}`);
              setCopied(true);
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>
      <div>
        <label>Chicken code: give this ONLY to the chicken</label>
        <div className="code">{codes.chicken_code}</div>
      </div>
      {onClose && <button className="btn" onClick={onClose}>Done</button>}
    </div>
  );
}

// ---------------------------------------------------------------- settings
const FIELDS = [
  ['head_start_min', 'Chicken head start (minutes)'],
  ['pint_min', 'Minimum time in a wrong pub (minutes)'],
  ['nearby_m', '“Team nearby” alert distance (metres)'],
  ['left_early_m', '“Left early” distance (metres)'],
  ['shrink_interval_min', 'Zone shrinks every (minutes)'],
  ['shrink_factor', 'Each new zone is this fraction of the last (0.6 = 60%)'],
  ['zone_floor_pubs', 'Stop shrinking when this many pubs are left in the zone'],
];

function Settings({ onLogout }) {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [pw, setPw] = useState('');

  useEffect(() => {
    select(supabase().from('app_settings').select('*').single()).then(setS, (e) => setError(e.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    try {
      const { id, ...rest } = s;
      const clean = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, Number(v)]));
      await select(supabase().from('app_settings').update(clean).eq('id', 1));
      setMsg('Saved. New games will use these settings.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function changePw(e) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    try {
      await rpc('admin_set_password', { new_password: pw });
      setPw('');
      setMsg('Admin password changed.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function logout() {
    await rpc('admin_logout');
    onLogout();
  }

  if (!s) return error ? <div className="err">{error}</div> : <p className="muted">Loading…</p>;
  return (
    <>
      <h2>Game settings</h2>
      <form className="card stack" onSubmit={save}>
        {FIELDS.map(([k, label]) => (
          <div key={k}>
            <label htmlFor={k}>{label}</label>
            <input
              id={k}
              type="number"
              step={k === 'shrink_factor' ? '0.05' : '1'}
              min={k === 'shrink_factor' ? '0.15' : '0'}
              max={k === 'shrink_factor' ? '0.95' : undefined}
              value={s[k]}
              onChange={(e) => setS({ ...s, [k]: e.target.value })}
            />
          </div>
        ))}
        <button className="btn btn-primary btn-block">Save settings</button>
      </form>
      {msg && <div className="ok">{msg}</div>}
      {error && <div className="err">{error}</div>}

      <h2>Admin password</h2>
      <form className="card stack" onSubmit={changePw}>
        <input type="password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn btn-block" disabled={pw.length < 6}>Change password</button>
      </form>
      <button className="btn btn-block" onClick={logout}>Log out of admin</button>
    </>
  );
}
