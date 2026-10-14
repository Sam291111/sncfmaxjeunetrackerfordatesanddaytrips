import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { normalizeMax, coordinatesForStation } from './planner.js';

const cachePath = new URL('./.cache/max.json', import.meta.url);
const stopPath = new URL('./.cache/gtfs/stops.txt', import.meta.url);
if (!existsSync(cachePath) || !existsSync(stopPath)) {
  console.error('Run the planner once to load .cache/max.json and .cache/gtfs/stops.txt, then retry.');
  process.exit(1);
}

function parseCsvLine(line) {
  const values = [];
  let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"' && quoted) { value += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { values.push(value); value = ''; }
    else value += char;
  }
  values.push(value);
  return values;
}

async function readStops() {
  const rows = [], reader = createInterface({ input: createReadStream(stopPath), crlfDelay: Infinity });
  let fields;
  for await (const line of reader) {
    if (!fields) { fields = parseCsvLine(line).map((x, i) => i === 0 ? x.replace(/^\uFEFF/, '') : x); continue; }
    const values = parseCsvLine(line), row = Object.fromEntries(fields.map((field, i) => [field, values[i] || '']));
    if (!row.parent_station && ['1', ''].includes(row.location_type) && row.stop_name) rows.push(row);
  }
  return rows;
}

const cache = JSON.parse(await readFile(cachePath, 'utf8'));
const stopNames = await readStops();
const byCode = new Map();
for (const record of cache.records || []) {
  for (const side of ['origine', 'destination']) {
    const code = record[`${side}_iata`], raw = record[side];
    if (!code || !raw) continue;
    if (!byCode.has(code)) byCode.set(code, { record, side, raw, labels: new Set() });
    byCode.get(code).labels.add(raw);
  }
}

const stationLabelKey = value => {
  const key = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  return key.replace(/\bst\b/g, 'saint').replace(/\bste\b/g, 'sainte');
};
const report = [...byCode.entries()].map(([code, value]) => {
  const normalized = normalizeMax(value.record);
  const name = value.side === 'origine' ? normalized?.origin : normalized?.destination;
  const key = stationLabelKey(name);
  // stationKey() intentionally folds all terminals in Paris and Lyon together
  // for city-wide searches. That is useful to routing, but too broad for an
  // audit: validate the feed IATA code's canonical station name against GTFS.
  const exact = [...new Set(stopNames.filter(stop => stationLabelKey(stop.stop_name) === key).map(stop => stop.stop_name))];
  const variants = exact.length ? exact : [...new Set(stopNames.filter(stop => stationLabelKey(stop.stop_name).startsWith(`${key} `)).map(stop => stop.stop_name))];
  const candidates = variants;
  const coordinateOnly = !candidates.length && Boolean(coordinatesForStation(name));
  const status = exact.length ? 'exact GTFS name' : candidates.length === 1 ? 'GTFS name variant' : candidates.length > 1 ? 'ambiguous name variant' : coordinateOnly ? 'mapped coordinate; no GTFS stop' : 'unmatched';
  return { code, feedName: [...value.labels].join(' / '), plannerName: name, status, gtfsNames: candidates };
}).sort((a, b) => a.status.localeCompare(b.status) || a.code.localeCompare(b.code));

const counts = report.reduce((acc, row) => (acc[row.status] = (acc[row.status] || 0) + 1, acc), {});
console.log(`MAX records: ${cache.records?.length || 0} (${cache.start} to ${cache.end})`);
console.log(`Distinct origin/destination station codes: ${report.length}`);
console.log('Coverage:', counts);
const rowsToShow = process.argv.includes('--all') ? report : report.filter(row => row.status !== 'exact GTFS name');
for (const row of rowsToShow) console.log(`${row.status}\t${row.code}\t${row.feedName} -> ${row.plannerName}${row.gtfsNames.length ? ` [${row.gtfsNames.join(' | ')}]` : ''}`);
