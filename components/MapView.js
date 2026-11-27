'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

// Thin wrapper around Leaflet. All markers are emoji/div icons so no image assets are needed.
// props:
//   pubs:   [{ id, name, lat, lng, icon, dim, highlight }]
//   people: [{ id, lat, lng, label, stale, me }]
//   zone:   { center_lat, center_lng, radius_m } | null
//   routes: [{ color, points: [[lat,lng], ...] }]
//   onPubClick(pub), onMapClick({lat,lng})
//   height (css), fitKey (change to re-fit bounds)
export default function MapView({
  pubs = [],
  people = [],
  zone = null,
  routes = [],
  onPubClick,
  onMapClick,
  height = '45vh',
  fitKey,
}) {
  const el = useRef(null);
  const map = useRef(null);
  const L = useRef(null);
  const layer = useRef(null);
  const cbs = useRef({});
  cbs.current = { onPubClick, onMapClick };
  const fitted = useRef(null);

  useEffect(() => {
    let alive = true;
    import('leaflet').then((mod) => {
      if (!alive || map.current) return;
      L.current = mod.default || mod;
      map.current = L.current.map(el.current, { zoomControl: true, attributionControl: true });
      L.current
        .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap',
        })
        .addTo(map.current);
      map.current.setView([53.35, -6.26], 13);
      map.current.on('click', (e) => cbs.current.onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
      layer.current = L.current.layerGroup().addTo(map.current);
      draw();
    });
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubs, people, zone, routes, fitKey]);

  function draw() {
    const Lf = L.current;
    if (!Lf || !map.current) return;
    layer.current.clearLayers();
    const bounds = [];

    if (zone) {
      Lf.circle([zone.center_lat, zone.center_lng], {
        radius: zone.radius_m,
        color: '#e5484d',
        weight: 3,
        fillColor: '#e5484d',
        fillOpacity: 0.06,
        dashArray: '8 6',
      }).addTo(layer.current);
    }

    for (const r of routes) {
      if (r.points.length > 1) {
        Lf.polyline(r.points, { color: r.color, weight: 4, opacity: 0.8 }).addTo(layer.current);
      }
    }

    for (const p of pubs) {
      const icon = Lf.divIcon({
        className: '',
        html: `<div class="pin ${p.dim ? 'pin-dim' : ''} ${p.highlight ? 'pin-hi' : ''}">${p.icon || '🍺'}</div>
               <div class="pin-label ${p.dim ? 'pin-dim' : ''}">${escapeHtml(p.name)}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      const m = Lf.marker([p.lat, p.lng], { icon }).addTo(layer.current);
      m.on('click', (e) => {
        Lf.DomEvent.stopPropagation(e);
        cbs.current.onPubClick?.(p);
      });
      bounds.push([p.lat, p.lng]);
    }

    for (const t of people) {
      if (t.lat == null) continue;
      const icon = Lf.divIcon({
        className: '',
        html: `<div class="person ${t.stale ? 'person-stale' : ''} ${t.me ? 'person-me' : ''}">${escapeHtml(
          t.label
        )}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      Lf.marker([t.lat, t.lng], { icon, zIndexOffset: 1000 }).addTo(layer.current);
      bounds.push([t.lat, t.lng]);
    }

    const key = fitKey ?? (bounds.length ? 'auto' : null);
    if (bounds.length && fitted.current !== key) {
      fitted.current = key;
      map.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
    }
  }

  return <div ref={el} className="map" style={{ height }} />;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
