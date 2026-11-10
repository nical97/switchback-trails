// Merges tile fragments from all states into gzipped tile files plus a coverage list.
// Usage: node finish.mjs fragDir outDir
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [fragDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const keys = [];
let bytes = 0;
for (const file of fs.readdirSync(fragDir)) {
  if (!file.endsWith('.ndjson')) continue;
  const key = file.replace('.ndjson', '');
  const ways = new Map();
  const rels = new Map(); // relId -> { tags, members: Map(ref -> [ref, role, flat]) }
  for (const line of fs.readFileSync(path.join(fragDir, file), 'utf8').split('\n')) {
    if (!line) continue;
    const row = JSON.parse(line);
    if (row[0] === 'w') ways.set(row[1], [row[1], row[2], row[3]]);
    else {
      const r = rels.get(row[1]) ?? { tags: row[2], members: new Map() };
      for (const m of row[3]) r.members.set(`${m[0]}:${m[1]}`, m);
      rels.set(row[1], r);
    }
  }
  const tile = { v: 1, w: [...ways.values()], r: [...rels].map(([id, r]) => [id, r.tags, [...r.members.values()]]) };
  const [i, j] = key.split('_');
  fs.mkdirSync(path.join(outDir, i), { recursive: true });
  const gz = zlib.gzipSync(JSON.stringify(tile), { level: 9 });
  fs.writeFileSync(path.join(outDir, i, `${j}.json`), gz);
  bytes += gz.length;
  keys.push(key);
}
const coverage = { v: 1, built: new Date().toISOString().slice(0, 10), perDegree: 4, tiles: keys.sort() };
fs.writeFileSync(path.join(outDir, 'coverage.json'), zlib.gzipSync(JSON.stringify(coverage), { level: 9 }));
console.log(`${keys.length} tiles, ${(bytes / 1e6).toFixed(1)} MB compressed`);
