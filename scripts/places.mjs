// Reads one state's places and parks (osmium export, GeoJSON sequence) and adds them to place fragments,
// park boundaries, and the nationwide search list.
// Usage: node places.mjs places.geojsonseq <state-slug> <fragDir> <parksDir> <index.ndjson>
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const [file, slug, fragDir, parksDir, indexFile] = process.argv.slice(2);
const ST = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district-of-columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new-hampshire': 'NH', 'new-jersey': 'NJ', 'new-mexico': 'NM', 'new-york': 'NY', 'north-carolina': 'NC', 'north-dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode-island': 'RI', 'south-carolina': 'SC', 'south-dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west-virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'puerto-rico': 'PR', 'us-virgin-islands': 'VI' };
const st = ST[slug] ?? slug.toUpperCase();
const PER_DEGREE = 4;
const HISTORIC = /^(ruins|fort|archaeological_site|mine|castle|battlefield|homestead|lighthouse)$/;
// Searchable nationwide (the rest are found nearby, or through Apple Maps).
const INDEXED = new Set(['Waterfall', 'Hot spring', 'Cave']);
const round = (x) => Math.round(x * 1e5) / 1e5;

function placeKind(t) {
  if (t.waterway === 'waterfall') return 'Waterfall';
  if (t.natural === 'peak') return 'Peak';
  if (t.natural === 'cave_entrance') return 'Cave';
  if (t.natural === 'hot_spring') return 'Hot spring';
  if (t.tourism === 'viewpoint') return 'Viewpoint';
  if (t.natural === 'beach') return 'Beach';
  if (t.natural === 'water' && (!t.water || /^(lake|reservoir|pond|lagoon)$/.test(t.water))) return 'Lake';
  if (HISTORIC.test(t.historic ?? '')) return 'Historic site';
  return null;
}
function parkKind(t) {
  const label = `${t.name} ${t.protection_title ?? ''}`;
  if (t.boundary === 'national_park' || /national park\b/i.test(label)) return 'National park';
  if (/state park|state recreation area|state beach/i.test(label)) return 'State park';
  if (/state forest/i.test(label)) return 'State forest';
  if (/national forest/i.test(label)) return 'National forest';
  if (/wilderness/i.test(label)) return 'Wilderness';
  if (/national (recreation area|seashore|lakeshore|monument|preserve)/i.test(label)) return 'National recreation area';
  if (t.leisure === 'nature_reserve' || /preserve|nature area|natural area|sanctuary|wildlife refuge/i.test(label)) return 'Nature preserve';
  if (t.leisure === 'park' || t.boundary === 'protected_area') return 'Park';
  return null;
}

// Polygon helpers (on small areas, flat-earth math is plenty).
const rings = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
function areaAndCenter(g) {
  let area = 0, cx = 0, cy = 0;
  for (const poly of rings(g)) {
    const ring = poly[0];
    if (!ring || ring.length < 4) continue;
    const k = Math.cos((ring[0][1] * Math.PI) / 180) * 111.32 * 110.57; // km² per degree²
    let a = 0, x = 0, y = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      const c = x1 * y2 - x2 * y1;
      a += c; x += (x1 + x2) * c; y += (y1 + y2) * c;
    }
    if (!a) continue;
    area += Math.abs(a / 2) * k; cx += x / 3 * Math.sign(a) * k; cy += y / 3 * Math.sign(a) * k;
  }
  if (!area) return null;
  return { km2: area, lon: cx / area, lat: cy / area };
}
function bbox(g) {
  let a = 180, b = 90, c = -180, d = -90;
  for (const poly of rings(g)) for (const [x, y] of poly[0] ?? []) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return [round(a), round(b), round(c), round(d)];
}
// Douglas-Peucker, so boundaries stay small but accurate to about 30 m.
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let best = 0, idx = -1;
    const [x1, y1] = pts[s], [x2, y2] = pts[e];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1e-12;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / len;
      if (d > best) { best = d; idx = i; }
    }
    if (best > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]).map(([x, y]) => [round(x), round(y)]);
}
// A closed ring starts and ends at the same point, so simplify its two halves separately.
function simplifyRing(ring, tol) {
  if (ring.length < 5) return ring.map(([x, y]) => [round(x), round(y)]);
  let far = 1, best = -1;
  for (let i = 1; i < ring.length - 1; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > best) { best = d; far = i; }
  }
  const a = simplify(ring.slice(0, far + 1), tol), b = simplify(ring.slice(far), tol);
  return [...a, ...b.slice(1)];
}

const tileKeys = ([w, s, e, n]) => {
  const keys = [];
  for (let i = Math.floor(s * PER_DEGREE); i <= Math.floor(n * PER_DEGREE); i++)
    for (let j = Math.floor(w * PER_DEGREE); j <= Math.floor(e * PER_DEGREE); j++) keys.push(`${i}_${j}`);
  return keys;
};

const tiles = new Map(); // key -> { p: [], k: [] }
const tile = (k) => { let t = tiles.get(k); if (!t) { t = { p: [], k: [] }; tiles.set(k, t); } return t; };
const index = [];
let places = 0, parks = 0;
fs.mkdirSync(fragDir, { recursive: true });
fs.mkdirSync(parksDir, { recursive: true });

const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
for await (const raw of rl) {
  const line = raw.replace(/^\x1e/, '').trim();
  if (!line) continue;
  let f;
  try { f = JSON.parse(line); } catch { continue; }
  const t = f.properties ?? {};
  const name = (t.name ?? '').trim();
  if (!name || name.length > 80) continue;
  const id = `${(t['@type'] ?? 'x')[0]}${t['@id'] ?? ''}`;
  const g = f.geometry;
  if (!g) continue;

  const pk = g.type !== 'Point' ? parkKind(t) : null;
  if (pk) {
    const ac = areaAndCenter(g);
    if (!ac) continue;
    if (pk === 'Park' && ac.km2 < 0.4) continue; // skip small city parks (under about 100 acres)
    if (pk !== 'Park' && ac.km2 < 0.02) continue;
    const box = bbox(g);
    const row = [id, name, pk, round(ac.lat), round(ac.lon), st];
    index.push(row);
    for (const k of tileKeys(box)) tile(k).k.push([id, name, pk, round(ac.lat), round(ac.lon)]);
    if (pk !== 'Park') {
      const outline = rings(g).map((poly) => simplifyRing(poly[0], 0.0003)).filter((r) => r.length >= 4).slice(0, 40);
      fs.writeFileSync(path.join(parksDir, `${id}.json`), JSON.stringify({ v: 1, id, name, kind: pk, st, km2: Math.round(ac.km2 * 100) / 100, center: [round(ac.lat), round(ac.lon)], bbox: box, rings: outline }));
    }
    parks++;
    continue;
  }

  const kind = placeKind(t);
  if (!kind) continue;
  let lat, lon;
  if (g.type === 'Point') { [lon, lat] = g.coordinates; }
  else {
    const ac = areaAndCenter(g);
    if (!ac) continue;
    if (kind === 'Lake' && ac.km2 < 0.04) continue; // skip ponds under about 10 acres
    ({ lat, lon } = ac);
  }
  if (kind === 'Lake' && g.type === 'Point') continue;
  const row = [id, name, kind, round(lat), round(lon)];
  tile(`${Math.floor(lat * PER_DEGREE)}_${Math.floor(lon * PER_DEGREE)}`).p.push(row);
  if (INDEXED.has(kind)) index.push([...row, st]);
  places++;
}

for (const [k, t] of tiles) {
  const lines = [...t.p.map((r) => JSON.stringify(['p', ...r])), ...t.k.map((r) => JSON.stringify(['k', ...r]))];
  fs.appendFileSync(path.join(fragDir, `${k}.ndjson`), lines.join('\n') + '\n');
}
fs.appendFileSync(indexFile, index.map((r) => JSON.stringify(r)).join('\n') + (index.length ? '\n' : ''));
console.log(`${st}: ${places} places, ${parks} parks, ${tiles.size} place tiles`);
