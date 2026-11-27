'use client';
import { useEffect, useState } from 'react';
import { Beer, Copy, Flag, KeyRound, LogOut, MapPin, Plus, Search, Settings2, Trash2, Trophy } from 'lucide-react';
import Map from '@/components/Map';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Empty, ErrorNote, Panel, Row, Rows, Screen, TabBar, TopBar, useConfirm } from '@/components/game-ui';
import { ensureSession, rpc, select, supabase } from '@/lib/supabase';
import { fmtTime } from '@/lib/util';
import { toast } from 'sonner';

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

  if (state === 'loading') return <Screen><p className="pt-10 text-center font-bold text-muted-foreground">Loading…</p></Screen>;
  if (state === 'login') return <Login onIn={() => setState('in')} initialError={error} />;

  return (
    <Screen tabs>
      <TopBar emoji="🛠️" tone="plain" title="Admin" sub="Set up before the game. The chicken’s pub never shows here." />
      {tab === 'games' && <Games />}
      {tab === 'pubs' && <Pubs />}
      {tab === 'settings' && <Settings onLogout={() => setState('login')} />}
      <TabBar
        value={tab}
        onChange={setTab}
        items={[
          { key: 'games', label: 'Games', icon: Trophy },
          { key: 'pubs', label: 'Pubs', icon: Beer },
          { key: 'settings', label: 'Settings', icon: Settings2 },
        ]}
      />
    </Screen>
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
      else setError('That password isn’t right. Check with whoever set up the game.');
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }
  return (
    <Screen>
      <form onSubmit={submit} className="pop-in sticker mt-12 space-y-4 rounded-3xl border-2 bg-card p-5">
        <div className="text-5xl" aria-hidden>🛠️</div>
        <h1 className="text-3xl font-extrabold">Admin login</h1>
        <div className="space-y-2">
          <Label htmlFor="pw" className="text-base font-extrabold">Password</Label>
          <Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <ErrorNote>{error}</ErrorNote>
        <Button size="lg" block disabled={busy || !pw}><KeyRound aria-hidden /> Log in</Button>
        <a href="/" className="inline-flex min-h-11 items-center font-bold text-muted-foreground">← Back</a>
      </form>
    </Screen>
  );
}

// ---------------------------------------------------------------- pubs
function Pubs() {
  const ask = useConfirm();
  const [pubs, setPubs] = useState([]);
  const [draft, setDraft] = useState(null);
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
      const params = new URLSearchParams({ q: query, format: 'json', limit: '6' });
      if (pubs.length) {
        const lats = pubs.map((p) => p.lat);
        const lngs = pubs.map((p) => p.lng);
        const pad = 0.05;
        params.set('viewbox', `${Math.min(...lngs) - pad},${Math.max(...lats) + pad},${Math.max(...lngs) + pad},${Math.min(...lats) - pad}`);
      }
      const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
      const json = await r.json();
      setResults(json);
      if (!json.length) setError('No matches. Try the street name too, or tap the map to drop a pin.');
    } catch {
      setError('Search isn’t responding. Tap the map to drop a pin instead.');
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
      toast.success(`${name.trim()} added`);
      setDraft(null);
      setName('');
      setQuery('');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(p) {
    const ok = await ask({
      title: `Delete ${p.name}?`,
      body: 'It also disappears from any games that use it, including their history.',
      action: 'Delete pub',
      variant: 'alert',
    });
    if (!ok) return;
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
      <form className="mb-3 flex gap-2" onSubmit={search}>
        <Input className="flex-1" placeholder="Search for a pub…" aria-label="Search for a pub" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button size="icon" variant="secondary" aria-label="Search"><Search aria-hidden /></Button>
      </form>
      {results.length > 0 && (
        <Panel>
          <Rows>
            {results.map((r) => (
              <Row key={r.place_id} lead="📍">
                <button className="min-h-11 w-full text-left font-semibold" onClick={() => pick(r)}>{r.display_name}</button>
              </Row>
            ))}
          </Rows>
        </Panel>
      )}
      <p className="mb-2 text-sm font-semibold text-muted-foreground">Or tap the map to drop a pin.</p>
      <Map pubs={mapPubs} onMapClick={(ll) => setDraft(ll)} fitKey={pubs.length} />
      {draft && (
        <Panel className="mt-4 border-chick-edge">
          <div className="space-y-3">
            <Label htmlFor="pubname" className="text-base font-extrabold">Pub name</Label>
            <Input id="pubname" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="flex gap-2">
              <Button className="flex-1" variant="found" disabled={!name.trim()} onClick={add}><Plus aria-hidden /> Add pub</Button>
              <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
            </div>
          </div>
        </Panel>
      )}
      <ErrorNote>{error}</ErrorNote>
      <Panel title={`Pubs (${pubs.length})`} className="mt-4">
        {pubs.length ? (
          <Rows>
            {pubs.map((p) => (
              <Row
                key={p.id}
                lead="🍺"
                trail={<Button size="icon" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => remove(p)}><Trash2 aria-hidden /></Button>}
              >
                <span className="font-bold">{p.name}</span>
              </Row>
            ))}
          </Rows>
        ) : (
          <Empty emoji="🍺">Add your first pub: search above or tap the map.</Empty>
        )}
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- games
function Games() {
  const ask = useConfirm();
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
    const ok = await ask({
      title: 'End this game now?',
      body: 'Everyone jumps to the recap, and the chicken’s pub is revealed.',
      action: 'End game',
      variant: 'alert',
    });
    if (!ok) return;
    try {
      await rpc('admin_force_end', { g: g.id });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(g) {
    const ok = await ask({ title: 'Delete this game?', body: 'The game, its recap and all its photos go for good.', action: 'Delete game', variant: 'alert' });
    if (!ok) return;
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

      <Panel
        title="New game"
        action={<Badge variant="hunt">{chosen.size} pubs</Badge>}
      >
        <div className="mb-2 flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setChosen(new Set(pubs.map((p) => p.id)))}>All</Button>
          <Button size="sm" variant="secondary" onClick={() => setChosen(new Set())}>None</Button>
        </div>
        {pubs.length ? (
          <Rows>
            {pubs.map((p) => (
              <Row key={p.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 font-bold">
                  <Checkbox checked={chosen.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                  {p.name}
                </label>
              </Row>
            ))}
          </Rows>
        ) : (
          <Empty emoji="🍺">Add pubs in the Pubs tab first.</Empty>
        )}
        <Button size="lg" block className="mt-3" variant="chicken" disabled={busy || chosen.size < 2} onClick={create}>
          <Plus aria-hidden /> Create game
        </Button>
      </Panel>
      <ErrorNote>{error}</ErrorNote>

      <h2 className="mt-6 mb-3 text-xl font-extrabold">Games</h2>
      {games.map((g) => (
        <Panel
          key={g.id}
          title={`${new Date(g.created_at).toLocaleDateString()} · ${fmtTime(g.created_at)}`}
          action={<Badge variant={g.status === 'live' ? 'alert' : g.status === 'ended' ? 'default' : 'found'}>{g.status === 'lobby' ? 'Waiting' : g.status === 'live' ? 'Live' : 'Ended'}</Badge>}
        >
          {codes[g.id] && g.status !== 'ended' && (
            <details className="mb-3">
              <summary className="min-h-11 cursor-pointer py-2 font-bold text-muted-foreground">Show codes</summary>
              <Codes codes={{ ...codes[g.id], game_id: g.id }} origin={origin} />
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            {g.status === 'ended' && (
              <Button size="sm" variant="clue" asChild><a href={`/game/${g.id}/recap`}><Trophy aria-hidden /> Recap</a></Button>
            )}
            {g.status !== 'ended' && <Button size="sm" variant="secondary" onClick={() => forceEnd(g)}><Flag aria-hidden /> Force end</Button>}
            <Button size="sm" variant="ghost" onClick={() => remove(g)}><Trash2 aria-hidden /> Delete</Button>
          </div>
        </Panel>
      ))}
      {!games.length && <Empty emoji="🎲">No games yet. Create one above.</Empty>}
    </>
  );
}

function Codes({ codes, origin, onClose }) {
  const link = `${origin}/?code=${codes.team_code}`;
  const body = (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-hunt-edge bg-hunt/15 p-4">
        <p className="text-sm font-extrabold uppercase opacity-80">Team code · share with everyone</p>
        <p className="font-display text-4xl font-extrabold tracking-widest">{codes.team_code}</p>
        <p className="mb-3 text-sm font-semibold break-all text-muted-foreground">{link}</p>
        <Button
          size="sm"
          onClick={() => {
            navigator.clipboard?.writeText(`Find the Chicken 🐔 join here: ${link}`);
            toast.success('Join link copied');
          }}
        >
          <Copy aria-hidden /> Copy join link
        </Button>
      </div>
      <div className="rounded-2xl border-2 border-chick-edge bg-chick/15 p-4">
        <p className="text-sm font-extrabold uppercase opacity-80">Chicken code · ONLY for the chicken</p>
        <p className="font-display text-4xl font-extrabold tracking-widest">{codes.chicken_code}</p>
      </div>
    </div>
  );
  if (!onClose) return body;
  return (
    <Panel title="Game created 🎉" className="border-found-edge">
      {body}
      <Button block variant="secondary" className="mt-4" onClick={onClose}>Done</Button>
    </Panel>
  );
}

// ---------------------------------------------------------------- settings
const FIELDS = [
  ['head_start_min', 'Chicken head start', 'minutes'],
  ['pint_min', 'Minimum time in a wrong pub', 'minutes'],
  ['nearby_m', '“Team nearby” alert distance', 'metres'],
  ['left_early_m', '“Left early” distance', 'metres'],
  ['shrink_interval_min', 'Zone shrinks every', 'minutes'],
  ['shrink_factor', 'Each new zone’s size (0.6 = 60% of the last)', 'fraction'],
  ['zone_floor_pubs', 'Stop shrinking when this many pubs are left', 'pubs'],
];

function Settings({ onLogout }) {
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);
  const [pw, setPw] = useState('');

  useEffect(() => {
    select(supabase().from('app_settings').select('*').single()).then(setS, (e) => setError(e.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    setError(null);
    try {
      const { id, ...rest } = s;
      const clean = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, Number(v)]));
      await select(supabase().from('app_settings').update(clean).eq('id', 1));
      toast.success('Settings saved. New games will use them.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function changePw(e) {
    e.preventDefault();
    setError(null);
    try {
      await rpc('admin_set_password', { new_password: pw });
      setPw('');
      toast.success('Admin password changed');
    } catch (err) {
      setError(err.message);
    }
  }

  async function logout() {
    await rpc('admin_logout');
    onLogout();
  }

  if (!s) return error ? <ErrorNote>{error}</ErrorNote> : <p className="font-bold text-muted-foreground">Loading…</p>;
  return (
    <>
      <Panel title="Game settings">
        <form className="space-y-4" onSubmit={save}>
          {FIELDS.map(([k, label, unit]) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={k} className="font-extrabold">{label}</Label>
              <div className="flex items-center gap-3">
                <Input
                  id={k}
                  type="number"
                  inputMode="decimal"
                  step={k === 'shrink_factor' ? '0.05' : '1'}
                  min={k === 'shrink_factor' ? '0.15' : '0'}
                  max={k === 'shrink_factor' ? '0.95' : undefined}
                  value={s[k]}
                  onChange={(e) => setS({ ...s, [k]: e.target.value })}
                  className="w-32"
                />
                <span className="font-semibold text-muted-foreground">{unit}</span>
              </div>
            </div>
          ))}
          <Button size="lg" block>Save settings</Button>
        </form>
      </Panel>
      <ErrorNote>{error}</ErrorNote>
      <Panel title="Admin password">
        <form className="space-y-3" onSubmit={changePw}>
          <Input type="password" aria-label="New admin password" placeholder="New password (6+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
          <Button block variant="secondary" disabled={pw.length < 6}><KeyRound aria-hidden /> Change password</Button>
        </form>
      </Panel>
      <Button block variant="ghost" onClick={logout}><LogOut aria-hidden /> Log out of admin</Button>
    </>
  );
}
