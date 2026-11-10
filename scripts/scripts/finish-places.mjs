// Turns place fragments, park boundaries, and the search list into gzipped files for upload.
// Usage: node finish-places.mjs pfragDir parksDir index.ndjson outDir
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [fragDir, parksDir, indexFile, outDir] = process.argv.slice(2);
const gz = (obj) => zlib.gzipSync(JSON.stringify(obj), { level: 9 });
const placesOut = path.join(outDir, 'places', 'v1');
const parksOut = path.join(outDir, 'parks', 'v1');
fs.mkdirSync(path.join(placesOut, 'tiles'), { recursive: true });
fs.mkdirSync(path.join(parksOut, 'b'), { recursive: true });

let tiles = 0;
for (const file of fs.existsSync(fragDir) ? fs.readdirSync(fragDir) : []) {
  if (!file.endsWith('.ndjson')) continue;
  const [i, j] = file.replace('.ndjson', '').split('_');
  const p = new Map(), k = new Map();
  for (const line of fs.readFileSync(path.join(fragDir, file), 'utf8').split('\n')) {
    if (!line) continue;
    const [kind, ...row] = JSON.parse(line);
    (kind === 'p' ? p : k).set(row[0], row);
  }
  fs.mkdirSync(path.join(placesOut, 'tiles', i), { recursive: true });
  fs.writeFileSync(path.join(placesOut, 'tiles', i, `${j}.json`), gz({ v: 1, p: [...p.values()], k: [...k.values()] }));
  tiles++;
}

// Nationwide search list. A park that crosses a state line appears once, with both states.
const byId = new Map();
for (const line of fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf8').split('\n') : []) {
  if (!line) continue;
  const row = JSON.parse(line);
  const had = byId.get(row[0]);
  if (had) { if (!had[5].split('/').includes(row[5])) had[5] += `/${row[5]}`; } else byId.set(row[0], row);
}
const items = [...byId.values()];
fs.writeFileSync(path.join(placesOut, 'index.json'), gz({ v: 1, built: new Date().toISOString().slice(0, 10), items }));

// Park boundaries, and the list of state parks for badges.
let boundaries = 0;
const stateParks = [];
for (const file of fs.existsSync(parksDir) ? fs.readdirSync(parksDir) : []) {
  const park = JSON.parse(fs.readFileSync(path.join(parksDir, file), 'utf8'));
  park.st = byId.get(park.id)?.[5] ?? park.st;
  fs.writeFileSync(path.join(parksOut, 'b', file), gz(park));
  boundaries++;
  if (park.kind === 'State park') stateParks.push([park.id, park.name, park.st, park.center[0], park.center[1], park.bbox]);
}
stateParks.sort((a, b) => a[2].localeCompare(b[2]) || a[1].localeCompare(b[1]));
fs.writeFileSync(path.join(parksOut, 'state-parks.json'), gz({ v: 1, built: new Date().toISOString().slice(0, 10), parks: stateParks }));
const kinds = {};
for (const r of items) kinds[r[2]] = (kinds[r[2]] || 0) + 1;
console.log(`${tiles} place tiles, ${items.length} searchable (${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}), ${boundaries} park boundaries, ${stateParks.length} state parks`);
