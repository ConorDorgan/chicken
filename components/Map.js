'use client';
import dynamic from 'next/dynamic';

// Leaflet touches `window`, so only load it in the browser
const Map = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => (
    <div className="grid h-[45vh] w-full place-items-center rounded-3xl border-2 bg-card-2 font-bold text-muted-foreground">Loading map…</div>
  ),
});
export default Map;
