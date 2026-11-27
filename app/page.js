'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorNote, Screen } from '@/components/game-ui';
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
    <Screen>
      <section className="pt-6 pb-8 text-center">
        <div className="bob mb-2 text-8xl" aria-hidden>🐔</div>
        <h1 className="text-5xl font-extrabold">
          Find the{' '}
          <span className="sticker mt-1 inline-block -rotate-2 rounded-2xl border-2 border-chick-edge bg-chick px-3 text-chick-ink [--sticker-edge:var(--chick-edge)]">Chicken</span>
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-lg font-semibold text-muted-foreground">
          One chicken. A city of pubs. A pint at every wrong door.
        </p>
      </section>

      {resume && (
        <Button
          variant="secondary"
          block
          className="mb-4"
          onClick={() => router.push(`/game/${resume.gameId}/${resume.role === 'chicken' ? 'chicken' : 'team'}`)}
        >
          <RotateCcw aria-hidden /> Back to my game
        </Button>
      )}

      <form onSubmit={join} className="pop-in sticker space-y-4 rounded-3xl border-2 bg-card p-5">
        <div className="space-y-2">
          <Label htmlFor="code" className="text-base font-extrabold">Game code</Label>
          <Input
            id="code"
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="CLUCK-XXXX"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="font-display text-2xl tracking-widest uppercase"
          />
        </div>
        {isTeamCode && (
          <div className="pop-in space-y-2">
            <Label htmlFor="name" className="text-base font-extrabold">Team name</Label>
            <Input id="name" placeholder="e.g. Beer Goggles" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
            <p className="text-sm font-semibold text-muted-foreground">Joining on a second phone? Type the exact same team name.</p>
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
        <Button size="lg" block disabled={busy || !code.trim() || (isTeamCode && !name.trim())}>
          {busy ? 'Joining…' : 'Join the hunt'} <ArrowRight aria-hidden />
        </Button>
      </form>

      <p className="mt-10 text-center">
        <a href="/admin" className="inline-flex min-h-11 items-center px-3 text-sm font-bold text-muted-foreground underline-offset-4 hover:underline">
          Admin
        </a>
      </p>
    </Screen>
  );
}
