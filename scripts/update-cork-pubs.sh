#!/usr/bin/env bash
# Refresh lib/cork-pubs.json (the Cork pub list shipped with the app) from OpenStreetMap.
set -euo pipefail
cd "$(dirname "$0")/.."
Q='[out:json][timeout:60];nwr["amenity"~"^(pub|bar)$"](51.84,-8.58,51.94,-8.35);out center tags;'
tmp=$(mktemp)
curl -sf -m 90 --data-urlencode "data=$Q" https://maps.mail.ru/osm/tools/overpass/api/interpreter -o "$tmp" \
  || curl -sf -m 90 --data-urlencode "data=$Q" https://overpass-api.de/api/interpreter -o "$tmp"
node -e '
const els = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).elements;
const out = [];
for (const e of els) {
  const t = e.tags || {}, lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
  if (!t.name || lat == null) continue;
  const p = { osmId: `${e.type}/${e.id}`, name: t.name.trim(), lat: +lat.toFixed(6), lng: +lng.toFixed(6),
    street: [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") };
  const dup = out.find((q) => q.name.toLowerCase() === p.name.toLowerCase() && Math.abs(q.lat - p.lat) + Math.abs(q.lng - p.lng) < 0.001);
  if (dup) { if (!dup.street) dup.street = p.street; continue; }
  out.push(p);
}
out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
require("fs").writeFileSync("lib/cork-pubs.json", JSON.stringify(out));
console.log(out.length + " pubs written to lib/cork-pubs.json");
' "$tmp"
rm -f "$tmp"
