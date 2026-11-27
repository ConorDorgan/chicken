'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, MapPin, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorNote, PlayersEditor, Screen } from '@/components/game-ui';
import { askForLocation } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';
import { lastGame, rememberGame } from '@/lib/util';

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [players, setPlayers] = useState([]);
  const [locWarning, setLocWarning] = useState(null);
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
    setLocWarning(null);
    try {
      let loc = null;
      let weakGps = false;
      if (isTeamCode) {
        // teams must share their location: it's how the chicken sees them coming
        const r = await askForLocation();
        if (r.denied) {
          setError('Location is blocked. Allow location for this site in your phone’s browser settings, then tap Join again. The chicken needs to see where teams are.');
          setBusy(false);
          return;
        }
        weakGps = !!r.unavailable;
        if (r.unavailable) setLocWarning('Couldn’t get a GPS fix yet. You’re in, but step outside or check location is on so the chicken can see you.');
        loc = r.pos || null;
      }
      const rows = await rpc('join_game', {
        code,
        team_name: isTeamCode ? name : null,
        players: isTeamCode ? players : null,
        lat: loc?.lat ?? null,
        lng: loc?.lng ?? null,
      });
      const { game_id, role } = rows[0];
      rememberGame(game_id, role);
      if (weakGps) await new Promise((r) => setTimeout(r, 2500));
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
        {isTeamCode && (
          <div className="pop-in space-y-2">
            <Label htmlFor="player" className="text-base font-extrabold">Who’s on the team?</Label>
            <PlayersEditor value={players} onChange={setPlayers} />
            <p className="text-sm font-semibold text-muted-foreground">Every player gets a pint at every wrong pub, and their own tally in the recap.</p>
          </div>
        )}
        {isTeamCode && (
          <p className="flex items-start gap-2 rounded-2xl border-2 border-border bg-card-2 px-3 py-2.5 text-sm font-semibold">
            <MapPin className="mt-0.5 size-4 shrink-0 text-hunt" aria-hidden />
            Joining shares your location with the chicken for the rest of the game. Your phone will ask to allow it.
          </p>
        )}
        <ErrorNote>{error}</ErrorNote>
        <ErrorNote>{locWarning}</ErrorNote>
        <Button size="lg" block disabled={busy || !code.trim() || (isTeamCode && (!name.trim() || players.length === 0))}>
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
