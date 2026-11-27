'use client';
import dynamic from 'next/dynamic';

// Leaflet touches `window`, so only load it in the browser
const Map = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div className="map map-loading">Loading map…</div>,
});
export default Map;
