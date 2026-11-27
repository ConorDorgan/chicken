'use client';
import corkPubs from './cork-pubs.json';

// Cork city and suburbs
export const CORK = { south: 51.84, west: -8.58, north: 51.94, east: -8.35 };

// Every named pub and bar in Cork, taken from OpenStreetMap and shipped with the app,
// so the Pubs tab never waits on a public server. Refresh with scripts/update-cork-pubs.sh.
export const CORK_PUBS = corkPubs;

// Public Overpass servers (OpenStreetMap's query API). All are asked at once; first good answer wins.
const SERVERS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const cache = new Map();

// Every named pub and bar inside the box, as [{ osmId, name, lat, lng, street }]
export async function fetchPubs({ south, west, north, east }) {
  const key = [south, west, north, east].map((n) => n.toFixed(3)).join(',');
  if (cache.has(key)) return cache.get(key);

  const query = `[out:json][timeout:20];nwr["amenity"~"^(pub|bar)$"](${south},${west},${north},${east});out center tags;`;
  const ask = async (url) => {
    const res = await fetch(url, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json.elements)) throw new Error('bad response');
    return json.elements;
  };

  let elements;
  try {
    elements = await Promise.any(SERVERS.map(ask));
  } catch {
    throw new Error('OpenStreetMap’s servers are busy right now. Try again in a minute, or drop pins by hand.');
  }

  const pubs = [];
  for (const e of elements) {
    const p = {
      osmId: `${e.type}/${e.id}`,
      name: e.tags?.name?.trim(),
      lat: e.lat ?? e.center?.lat,
      lng: e.lon ?? e.center?.lon,
      street: [e.tags?.['addr:housenumber'], e.tags?.['addr:street']].filter(Boolean).join(' '),
    };
    if (!p.name || p.lat == null) continue;
    // the same pub is sometimes mapped twice (a point and a building outline)
    if (pubs.some((q) => q.name.toLowerCase() === p.name.toLowerCase() && Math.abs(q.lat - p.lat) + Math.abs(q.lng - p.lng) < 0.001)) continue;
    pubs.push(p);
  }
  pubs.sort((a, b) => a.name.localeCompare(b.name));
  cache.set(key, pubs);
  return pubs;
}
