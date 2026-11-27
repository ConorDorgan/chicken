'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureSession, supabase } from './supabase';

// Re-render every `ms` so countdowns tick
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// Loads data with `load()`, then reloads whenever any of `tables` change for this game
// (Supabase realtime), when the tab becomes visible again, and every `pollMs` as a fallback.
export function useLiveData(gameId, tables, load, pollMs = 20000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const pending = useRef(null);

  const refresh = useCallback(async () => {
    try {
      await ensureSession();
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // collapse bursts of change events into one reload
  const soon = useCallback(() => {
    clearTimeout(pending.current);
    pending.current = setTimeout(refresh, 250);
  }, [refresh]);

  useEffect(() => {
    if (!gameId) return;
    refresh();
    let channel;
    let cancelled = false;
    ensureSession().then(() => {
      if (cancelled) return;
      const sb = supabase();
      channel = sb.channel(`game-${gameId}-${Math.random().toString(36).slice(2)}`);
      for (const table of tables) {
        const filter = table === 'games' ? `id=eq.${gameId}` : `game_id=eq.${gameId}`;
        channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, soon);
      }
      channel.subscribe();
    });
    const poll = setInterval(refresh, pollMs);
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearTimeout(pending.current);
      document.removeEventListener('visibilitychange', onVis);
      if (channel) supabase().removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  return { data, error, refresh };
}

// Watches GPS while the page is open and visible. Returns the latest fix.
// `onFix` is called at most every `minMs` (or sooner after a big move).
export function useLocation(enabled, onFix, minMs = 30000) {
  const [fix, setFix] = useState(null);
  const [error, setError] = useState(null);
  const last = useRef({ at: 0, lat: 0, lng: 0 });
  const cb = useRef(onFix);
  cb.current = onFix;

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const f = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
        setFix(f);
        setError(null);
        const moved = Math.abs(f.lat - last.current.lat) + Math.abs(f.lng - last.current.lng) > 0.0005;
        if (Date.now() - last.current.at > minMs || moved) {
          last.current = { at: Date.now(), ...f };
          cb.current?.(f);
        }
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, minMs]);

  return { fix, error };
}

// One-off position, used when taking a photo
export function currentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}

// Ask for location when joining. Resolves { pos } | { denied: true } | { unavailable: true }.
export function askForLocation() {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve({ unavailable: true });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ pos: { lat: p.coords.latitude, lng: p.coords.longitude } }),
      (err) => resolve(err.code === 1 ? { denied: true } : { unavailable: true }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  });
}
