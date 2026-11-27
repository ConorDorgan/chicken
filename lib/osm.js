'use client';

// Cork city and suburbs
export const CORK = { south: 51.84, west: -8.58, north: 51.94, east: -8.35 };

// Public Overpass servers (OpenStreetMap's query API); tried in order
const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const cache = new Map();

// Every named pub and bar inside the box, as [{ osmId, name, lat, lng, street }]
export async function fetchPubs({ south, west, north, east }) {
  const key = [south, west, north, east].map((n) => n.toFixed(3)).join(',');
  if (cache.has(key)) return cache.get(key);

  const query = `[out:json][timeout:25];nwr["amenity"~"^(pub|bar)$"](${south},${west},${north},${east});out center tags;`;
  let lastError;
  for (const url of SERVERS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const pubs = json.elements
        .map((e) => ({
          osmId: `${e.type}/${e.id}`,
          name: e.tags?.name,
          lat: e.lat ?? e.center?.lat,
          lng: e.lon ?? e.center?.lon,
          street: [e.tags?.['addr:housenumber'], e.tags?.['addr:street']].filter(Boolean).join(' '),
        }))
        .filter((p) => p.name && p.lat != null)
        .sort((a, b) => a.name.localeCompare(b.name));
      cache.set(key, pubs);
      return pubs;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`Couldn’t load pubs from OpenStreetMap (${lastError?.message || 'no response'}). Try again in a minute.`);
}
