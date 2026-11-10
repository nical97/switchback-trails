// Reads one state's ways (OPL, with node locations) and its hiking routes, and adds them to tile fragments.
// Usage: osmium cat ... -t way -f opl | node state.mjs rel.opl fragDir
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

const [relFile, fragDir] = process.argv.slice(2);
const PER_DEGREE = 4; // tiles are 0.25° squares, about 17 by 12 miles in the middle of the US
const JUNK = /^(source|note|fixme|FIXME|created_by|check_date|survey|tiger:|import|attribution|lastcheck|description:)/;

const unesc = (s) => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
function parseTags(t) {
  const tags = {};
  if (!t) return tags;
  for (const kv of t.split(',')) {
    const i = kv.indexOf('=');
    if (i < 1) continue;
    const k = unesc(kv.slice(0, i));
    if (!JUNK.test(k)) tags[k] = unesc(kv.slice(i + 1));
  }
  return tags;
}
const fields = (line) => {
  const out = {};
  for (const f of line.split(' ')) out[f[0]] = f.slice(1);
  return out;
};
const round = (x) => Math.round(x * 1e5) / 1e5;

// Hiking routes: which ways they use.
const routes = new Map(); // relId -> { tags }
const routesOfWay = new Map(); // wayId -> [[relId, role]]
for (const line of fs.readFileSync(relFile, 'utf8').split('\n')) {
  if (!line.startsWith('r')) continue;
  const f = fields(line);
  const id = Number(line.slice(1, line.indexOf(' ')));
  const tags = parseTags(f.T);
  if (!/^(hiking|foot)$/.test(tags.route ?? '')) continue;
  routes.set(id, { tags });
  for (const m of (f.M ?? '').split(',')) {
    if (!m.startsWith('w')) continue;
    const at = m.indexOf('@');
    const ref = Number(m.slice(1, at));
    const list = routesOfWay.get(ref) ?? [];
    list.push([id, unesc(m.slice(at + 1))]);
    routesOfWay.set(ref, list);
  }
}

// The same rule the app sends to the public servers.
const isTrailWay = (t) =>
  /^(path|footway|bridleway)$/.test(t.highway ?? '') && !!t.name &&
  !/^(sidewalk|crossing)$/.test(t.footway ?? '') && !/^(private|no)$/.test(t.access ?? '');

const tiles = new Map(); // "i_j" -> { w: [], r: Map(relId -> members[]) }
const tile = (k) => { let t = tiles.get(k); if (!t) { t = { w: [], r: new Map() }; tiles.set(k, t); } return t; };
function keysFor(flat) {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    a = Math.min(a, flat[i]); b = Math.max(b, flat[i]); c = Math.min(c, flat[i + 1]); d = Math.max(d, flat[i + 1]);
  }
  const keys = [];
  for (let i = Math.floor(a * PER_DEGREE); i <= Math.floor(b * PER_DEGREE); i++)
    for (let j = Math.floor(c * PER_DEGREE); j <= Math.floor(d * PER_DEGREE); j++) keys.push(`${i}_${j}`);
  return keys;
}

let ways = 0;
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.startsWith('w')) continue;
  const id = Number(line.slice(1, line.indexOf(' ')));
  const trail = routesOfWay.get(id);
  const f = fields(line);
  const tags = parseTags(f.T);
  const wanted = isTrailWay(tags);
  if (!wanted && !trail) continue;
  const flat = [];
  for (const n of (f.N ?? '').split(',')) {
    const x = n.indexOf('x'), y = n.indexOf('y');
    if (x < 0 || y < 0) continue;
    const lon = Number(n.slice(x + 1, y)), lat = Number(n.slice(y + 1));
    if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) flat.push(round(lat), round(lon));
  }
  if (flat.length < 4) continue;
  for (const k of keysFor(flat)) {
    const t = tile(k);
    if (wanted) t.w.push([id, tags, flat]);
    for (const [rel, role] of trail ?? []) {
      const members = t.r.get(rel) ?? [];
      members.push([id, role, flat]);
      t.r.set(rel, members);
    }
  }
  ways++;
}

fs.mkdirSync(fragDir, { recursive: true });
for (const [k, t] of tiles) {
  const lines = t.w.map((w) => JSON.stringify(['w', ...w]));
  for (const [rel, members] of t.r) lines.push(JSON.stringify(['r', rel, routes.get(rel).tags, members]));
  fs.appendFileSync(path.join(fragDir, `${k}.ndjson`), lines.join('\n') + '\n');
}
console.log(`${ways} ways, ${routes.size} hiking routes, ${tiles.size} tiles`);
