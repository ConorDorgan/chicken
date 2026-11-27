'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { rpc } from '@/lib/supabase';
import { lastGame, rememberGame } from '@/lib/util';

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resume, setResume] = useState(null);

  useEffect(() => {
    setResume(lastGame());
    const fromUrl = new URLSearchParams(window.location.search).get('code');
    if (fromUrl) setCode(fromUrl.toUpperCase());
  }, []);

  const isTeamCode = code.trim().toUpperCase().startsWith('CLUCK');

  async function join(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const rows = await rpc('join_game', { code, team_name: isTeamCode ? name : null });
      const { game_id, role } = rows[0];
      rememberGame(game_id, role);
      router.push(`/game/${game_id}/${role === 'chicken' ? 'chicken' : 'team'}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="center" style={{ fontSize: 72, marginTop: 24 }}>🐔</div>
      <h1 className="center">Find the Chicken</h1>
      <p className="center muted">One chicken. A city of pubs. A pint at every wrong door.</p>

      {resume && (
        <div className="card">
          <p>You were in a game on this phone.</p>
          <button
            className="btn btn-block"
            onClick={() => router.push(`/game/${resume.gameId}/${resume.role === 'chicken' ? 'chicken' : 'team'}`)}
          >
            Back to my game
          </button>
        </div>
      )}

      <form className="card stack" onSubmit={join}>
        <div>
          <label htmlFor="code">Game code</label>
          <input
            id="code"
            type="text"
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="CLUCK-XXXX"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </div>
        {isTeamCode && (
          <div>
            <label htmlFor="name">Team name</label>
            <input
              id="name"
              type="text"
              placeholder="e.g. Beer Goggles"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="small muted">Joining from a second phone? Use the exact same team name.</p>
          </div>
        )}
        {error && <div className="err">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy || !code.trim() || (isTeamCode && !name.trim())}>
          {busy ? 'Joining…' : 'Join'}
        </button>
      </form>

      <p className="center small muted" style={{ marginTop: 32 }}>
        <a href="/admin">Admin</a>
      </p>
    </>
  );
}
