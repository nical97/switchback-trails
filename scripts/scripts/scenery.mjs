// Picks Switchback's built-in nature photos from Wikimedia Commons, using the app's own nature rules,
// and saves them (with credits) for upload to Switchback's storage.
// Usage: node scenery.mjs outDir
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] ?? 'out/scenery/v1';
const KEYWORDS = ['forest trail', 'mountain lake', 'waterfall', 'canyon', 'desert landscape', 'coastline', 'wetland', 'mountain landscape', 'forest stream', 'meadow'];
const PER_POOL = 24;
const UA = 'SwitchbackTrailTiles/1.0 (https://github.com/nical97/switchback-trails; Nical97@gmail.com)';
const API = 'https://commons.wikimedia.org/w/api.php';
const IMAGEINFO = 'prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1280'
  + '&iiextmetadatafilter=Artist|LicenseShortName|Categories|ImageDescription';

/* ---------- Copied from the app (src/lib/photos.ts) so both use the same rules ---------- */
// Words in a photo's title, categories, or description that suggest a nature scene, or not.
const NATURE = /\b(trails?|hiking|hike|footpath|forests?|woods|woodland|mountains?|peaks?|summit|canyons?|creeks?|streams?|rivers?|lakes?|ponds?|waterfalls?|falls|meadows?|parks?|nature|landscapes?|wilderness|valleys?|ridges?|rocks?|cliffs?|hills?|prairie|wildflowers?|flowers|trees?|open space|views?|scenery|preserve|reserve|outdoors?|vista|overlook|snow|autumn|foliage|desert|dunes?|marsh|wetlands?|gorge|ravine|bluffs?|buttes?|mesas?|glaciers?|alpine|sunset|sunrise|national forest|state park|national park|coast|beach|shore)\b/gi;
const NOT_NATURE = /\b(buildings?|houses?|homes?|church|chapel|interiors?|people|persons?|portraits?|men|women|man|woman|children|streets?|roads?|highways?|cars?|automobiles?|vehicles?|bus|buses|trucks?|trains?|stations?|signs?|signage|events?|concerts?|festivals?|sports?|stadium|schools?|university|college|campus|hotels?|restaurants?|shops?|stores?|museums?|construction|aircraft|airplanes?|airports?|parking|offices?|apartments?|residential|neighbou?rhoods?|graffiti|statues?|memorials?|graves?|cemetery|food|meals?|selfies?|maps?|diagrams?|logos?|animals in captivity|zoo)\b/gi;
// File names that are usually maps, diagrams, or signs rather than scenery.
const NOT_SCENERY_FILE = /\b(map|karte|carte|plan|diagram|logo|sign|schild|chart|profile|elevation|route|track|gpx|locator|svg|books?|cover|poster|flyer|brochure|leaflet|scan|page|screenshot|document|aerial|satellite|orthophotos?|orthoimage|landsat|sentinel|lidar|topographic|relief|drone)\b/i;
// Words that count toward "nature" but can't prove it alone (a photo filed under "Parks in X County" can show anything).
const WEAK_NATURE = new Set(['park', 'parks', 'nature', 'view', 'views', 'scenery', 'sunset', 'sunrise', 'outdoor', 'outdoors', 'vista', 'state park', 'national park', 'reserve', 'preserve']);
// "Park" phrases that aren't nature at all.
const NOT_NATURE_PARKS = /\b(office|business|industrial|research|technology|science|retail|corporate|car|amusement|theme|water|skate|trailer|ball|mobile home|dog|memorial|sculpture)\s+parks?\b/gi;
// More things that are never trail scenery.
const NOT_NATURE_MORE = /\b(books?|bookstores?|bookshops?|booksellers?|library|libraries|bookshelf|bookshelves|shelves|reading|newspapers?|magazines?|posters?|paintings?|drawings?|illustrations?|artworks?|sculptures?|toys?|products?|shopping|mall|retail|business(es)?|companies|company|playgrounds?|furniture|equipment|vending|kiosks?|exhibits?|documents?|text|aerial|satellite|orthophotos?|landsat|sentinel|imagery|from space|nasa|iss|astronaut|lidar|topographic|relief|drones?|bird's-eye)\b/gi;

function uniqueMatches(text, re) {
  return new Set((text.match(re) ?? []).map((m) => m.toLowerCase())).size;
}

/** Keeps a photo only if it reads as an outdoor or nature scene. */
// Pictures taken from above (planes, drones, satellites) never count as trail scenery.
const FROM_ABOVE = /\b(aerial|satellite|orthophotos?|orthoimage|landsat|sentinel-?2?|from space|astronaut|bird's-eye|drone|lidar)\b/i;

function looksLikeScenery(text) {
  if (FROM_ABOVE.test(text)) return false;
  const clean = text.replace(NOT_NATURE_PARKS, ' ');
  const words = new Set((clean.match(NATURE) ?? []).map((m) => m.toLowerCase()));
  const strong = [...words].filter((w) => !WEAK_NATURE.has(w)).length;
  const neg = uniqueMatches(text, NOT_NATURE_PARKS) + uniqueMatches(clean, NOT_NATURE) + uniqueMatches(clean, NOT_NATURE_MORE);
  return strong >= 1 && words.size > neg * 2;
}

/* ---------- end of copied rules ---------- */

const STRUCTURES = /\b(visitor cent(er|re)s?|buildings?|houses?|cabins?|church(es)?|chapels?|interiors?|hotels?|lodges?|restaurants?|museums?|stations?|parking|people|persons?|portraits?|crowds?|tourists?|vehicles?|cars?|roads?|bridges?|towns?|cit(y|ies)|villages?|signs?|fences?)\b/i;

const stripHtml = (s) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, as = 'json') {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
    if (res.ok) return as === 'json' ? res.json() : Buffer.from(await res.arrayBuffer());
    if (attempt === 3) throw new Error(`${res.status} for ${url.slice(0, 120)}`);
    await sleep(5000 * attempt); // be polite to Wikimedia when it's busy
  }
}

/** Same checks as the app: real photo, big enough, landscape, not a map or sign, and reads as nature. */
function pick(p) {
  const info = p.imageinfo?.[0];
  if (!info?.thumburl || !info.descriptionurl) return null;
  if (info.mime && !/^image\/(jpeg|png|webp)$/.test(info.mime)) return null;
  const w = info.width ?? 0, h = info.height ?? 0;
  if (w < 800 || h < 500 || w < h * 1.2) return null;
  if (NOT_SCENERY_FILE.test(p.title)) return null;
  const meta = info.extmetadata ?? {};
  const text = [p.title, meta.Categories?.value ?? '', stripHtml(meta.ImageDescription?.value ?? '')].join(' ').replace(/[_|]/g, ' ');
  if (!looksLikeScenery(text)) return null;
  // The built-in photos are shown again and again, so they're held to a stricter standard: pure scenery only.
  if (STRUCTURES.test(text)) return null;
  const artist = stripHtml(meta.Artist?.value ?? '') || 'Unknown photographer';
  return {
    id: `c${p.pageid}`, thumb: info.thumburl, w: info.thumbwidth ?? w, h: info.thumbheight ?? h,
    credit: artist.length > 60 ? `${artist.slice(0, 57)}…` : artist,
    license: stripHtml(meta.LicenseShortName?.value ?? '') || 'See source', page: info.descriptionurl,
  };
}

async function search(q) {
  const j = await get(`${API}?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=50&gsrsearch=${encodeURIComponent(q)}&${IMAGEINFO}`);
  return Object.values(j?.query?.pages ?? {}).map(pick).filter(Boolean);
}

const pools = {};
let total = 0;
for (const kw of KEYWORDS) {
  const slug = kw.replace(/\s+/g, '-');
  let found = await search(`${kw} filetype:bitmap incategory:Quality_images`).catch(() => []);
  if (found.length < PER_POOL) found = found.concat(await search(`${kw} filetype:bitmap`).catch(() => []));
  const unique = [...new Map(found.map((f) => [f.id, f])).values()].slice(0, PER_POOL);
  fs.mkdirSync(path.join(OUT, slug), { recursive: true });
  pools[kw] = [];
  for (const [i, f] of unique.entries()) {
    try {
      fs.writeFileSync(path.join(OUT, slug, `${i}.jpg`), await get(f.thumb, 'bytes'));
      pools[kw].push({ id: f.id, file: `${slug}/${i}.jpg`, w: f.w, h: f.h, credit: f.credit, license: f.license, page: f.page });
    } catch (e) {
      console.log(`skipped a photo: ${e.message}`);
    }
    await sleep(150);
  }
  total += pools[kw].length;
  console.log(`${kw}: ${pools[kw].length} photos`);
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ v: 1, built: new Date().toISOString().slice(0, 10), pools }));
if (total < 30) { console.error(`Only ${total} photos found; not publishing.`); process.exit(1); }
console.log(`${total} built-in nature photos`);
