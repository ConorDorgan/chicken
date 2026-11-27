'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------- confirm dialogs
// `const ask = useConfirm(); if (await ask({ title, body, action, variant })) ...`
const ConfirmCtx = createContext(null);

export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null);
  const resolver = useRef(null);
  const ask = useCallback(
    (opts) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setReq(opts);
      }),
    []
  );
  const done = (v) => {
    resolver.current?.(v);
    resolver.current = null;
    setReq(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <AlertDialog open={!!req} onOpenChange={(o) => !o && done(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{req?.title}</AlertDialogTitle>
            {req?.body && <AlertDialogDescription>{req.body}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => done(false)}>{req?.cancel || 'Not yet'}</AlertDialogCancel>
            <AlertDialogAction variant={req?.variant || 'default'} onClick={() => done(true)}>
              {req?.action || 'Yes'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmCtx);
}

// ---------------------------------------------------------------- layout
export function Screen({ children, tabs, className }) {
  return (
    <div
      className={cn(
        'mx-auto w-full max-w-[560px] px-4 pt-[max(16px,env(safe-area-inset-top))]',
        tabs ? 'pb-[calc(104px+env(safe-area-inset-bottom))]' : 'pb-[calc(32px+env(safe-area-inset-bottom))]',
        className
      )}
    >
      {children}
    </div>
  );
}

const TILE = {
  chicken: 'border-chick-edge bg-chick [--sticker-edge:var(--chick-edge)]',
  hunt: 'border-hunt-edge bg-hunt [--sticker-edge:var(--hunt-edge)]',
  plain: 'border-border bg-card-2',
};

export function TopBar({ title, emoji, right, sub, tone = 'chicken' }) {
  return (
    <header className="mb-4 flex items-center gap-3">
      {emoji && (
        <span className={cn('sticker grid size-12 shrink-0 place-items-center rounded-2xl border-2 text-2xl', TILE[tone])}>
          {emoji}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-extrabold">{title}</h1>
        {sub && <p className="truncate text-sm font-semibold text-muted-foreground">{sub}</p>}
      </div>
      {right}
    </header>
  );
}

// Bottom tab bar, within thumb reach. items: [{ key, label, icon, badge }]
export function TabBar({ items, value, onChange }) {
  return (
    <nav
      aria-label="Game sections"
      className="fixed inset-x-0 bottom-0 z-40 border-t-2 bg-card pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-[560px] gap-1 px-2 py-2">
        {items.map((it) => {
          const on = it.key === value;
          const Icon = it.icon;
          return (
            <li key={it.key} className="flex-1">
              <button
                onClick={() => onChange(it.key)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-2xl text-xs font-extrabold transition-colors duration-200',
                  on ? 'bg-hunt text-hunt-ink' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="size-6" aria-hidden />
                {it.label}
                {!!it.badge && (
                  <span className="absolute top-1 right-[calc(50%-22px)] grid min-w-5 place-items-center rounded-full border-2 border-card bg-alert px-1 text-[11px] leading-4 text-alert-ink">
                    {it.badge}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------- content blocks
const TONES = {
  hunt: 'bg-hunt text-hunt-ink border-hunt-edge [--sticker-edge:var(--hunt-edge)]',
  found: 'bg-found text-found-ink border-found-edge [--sticker-edge:var(--found-edge)]',
  alert: 'bg-alert text-alert-ink border-alert-edge [--sticker-edge:var(--alert-edge)]',
  clue: 'bg-clue text-clue-ink border-clue-edge [--sticker-edge:var(--clue-edge)]',
  chicken: 'bg-chick text-chick-ink border-chick-edge [--sticker-edge:var(--chick-edge)]',
  head: 'bg-head text-head-ink border-head-edge [--sticker-edge:var(--head-edge)]',
  plain: 'bg-card text-card-foreground border-border',
};

// A big flat-colour card that says what state you're in, readable across a table
export function Hero({ tone = 'plain', emoji, kicker, title, children, className }) {
  return (
    <section className={cn('pop-in sticker mb-4 rounded-3xl border-2 p-5', TONES[tone], className)}>
      {emoji && <div className="bob mb-1 text-5xl" aria-hidden>{emoji}</div>}
      {kicker && <p className="text-sm font-extrabold tracking-wide uppercase opacity-80">{kicker}</p>}
      {title && <h2 className="text-3xl font-extrabold">{title}</h2>}
      {children && <div className="mt-3 space-y-3">{children}</div>}
    </section>
  );
}

export function BigNumber({ children, className }) {
  return <div className={cn('font-display text-6xl leading-none font-extrabold tabular-nums', className)}>{children}</div>;
}

export function Panel({ title, action, children, className }) {
  return (
    <section className={cn('pop-in sticker mb-4 rounded-3xl border-2 bg-card p-4', className)}>
      {(title || action) && (
        <div className="mb-2 flex items-center gap-2">
          {title && <h2 className="flex-1 text-xl font-extrabold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Rows({ children }) {
  return <ul className="divide-y-2 divide-border">{children}</ul>;
}

export function Row({ lead, children, trail, className, ...rest }) {
  return (
    <li className={cn('flex min-h-14 items-center gap-3 py-2.5', className)} {...rest}>
      {lead && <span className="grid w-8 shrink-0 place-items-center text-xl" aria-hidden>{lead}</span>}
      <div className="min-w-0 flex-1">{children}</div>
      {trail}
    </li>
  );
}

export function Empty({ emoji = '🥚', children }) {
  return (
    <div className="py-6 text-center text-muted-foreground">
      <div className="mb-1 text-4xl" aria-hidden>{emoji}</div>
      <p className="font-semibold">{children}</p>
    </div>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="pop-in my-3 rounded-2xl border-2 border-alert-edge bg-alert/15 px-4 py-3 font-semibold text-foreground">
      {children}
    </p>
  );
}

export function PhotoGrid({ items, empty }) {
  if (!items.length) return <Empty emoji="📷">{empty}</Empty>;
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((p) => (
        <figure key={p.k} className="pop-in sticker overflow-hidden rounded-2xl border-2 bg-card-2">
          {p.src ? (
            <img src={p.src} alt={p.cap} loading="lazy" className="aspect-square w-full object-cover" />
          ) : (
            <div className="aspect-square" />
          )}
          <figcaption className="px-2.5 py-2 text-xs font-bold text-muted-foreground">{p.cap}</figcaption>
        </figure>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- celebration
export function Confetti({ fire }) {
  const [bits, setBits] = useState([]);
  useEffect(() => {
    if (!fire) return;
    const emoji = ['🐔', '🍺', '🎉', '🥚', '⭐'];
    setBits(
      Array.from({ length: 28 }, (_, i) => ({
        i,
        e: emoji[i % emoji.length],
        left: Math.random() * 100,
        dx: `${(Math.random() - 0.5) * 30}vw`,
        rot: `${(Math.random() - 0.5) * 720}deg`,
        delay: Math.random() * 0.6,
      }))
    );
    const t = setTimeout(() => setBits([]), 3500);
    return () => clearTimeout(t);
  }, [fire]);
  return bits.map((b) => (
    <span
      key={b.i}
      className="confetti-bit"
      aria-hidden
      style={{ left: `${b.left}%`, '--dx': b.dx, '--rot': b.rot, animationDelay: `${b.delay}s` }}
    >
      {b.e}
    </span>
  ));
}

// ---------------------------------------------------------------- team players
// Chips for each name, plus a box to add more. `value` is an array of names.
export function PlayersEditor({ value, onChange, id = 'player', autoFocus }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const n = draft.trim();
    if (!n) return;
    if (!value.some((v) => v.toLowerCase() === n.toLowerCase())) onChange([...value, n]);
    setDraft('');
  };
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Players">
          {value.map((n) => (
            <li key={n} className="pop-in inline-flex items-center gap-1 rounded-full border-2 border-hunt-edge bg-hunt/15 py-0.5 pr-1 pl-3 font-extrabold">
              {n}
              <button
                type="button"
                aria-label={`Remove ${n}`}
                onClick={() => onChange(value.filter((v) => v !== n))}
                className="grid size-8 place-items-center rounded-full text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={id}
          autoFocus={autoFocus}
          value={draft}
          maxLength={30}
          placeholder={value.length ? 'Add another player' : 'Player name'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          className="h-12 min-w-0 flex-1 rounded-xl border-2 border-input bg-background px-4 text-lg font-semibold outline-none placeholder:text-muted-foreground focus-visible:border-ring"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="sticker press min-h-12 rounded-2xl border-2 border-hunt-edge bg-hunt px-4 font-display text-lg font-bold text-hunt-ink disabled:opacity-45 [--sticker-edge:var(--hunt-edge)]"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function PlayerList({ players, className }) {
  if (!players?.length) return null;
  return <p className={cn('text-sm font-semibold text-muted-foreground', className)}>👥 {players.join(', ')}</p>;
}
