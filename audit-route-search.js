import { readFile } from 'node:fs/promises';
import {
  findJourneys,
  matchesAvailabilityStation,
  normalizeMax
} from './planner.js';

const cachePath = new URL('./.cache/max.json', import.meta.url);
const args = process.argv.slice(2);
const valueAfter = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const date = valueAfter('--date');
const origin = valueAfter('--origin');
const destination = valueAfter('--destination');

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npm run audit:routes -- --date YYYY-MM-DD --origin "Station" --destination "Station"');
  console.log('Checks that every direct train marked OUI in the loaded MAX feed appears in the route engine output.');
  process.exit(0);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !origin || !destination) {
  console.error('Provide --date YYYY-MM-DD, --origin and --destination.');
  process.exit(2);
}

let cache;
try {
  cache = JSON.parse(await readFile(cachePath, 'utf8'));
} catch {
  console.error('No MAX cache found. Run the planner once to load .cache/max.json, then retry.');
  process.exit(2);
}

if (date < cache.start || date > cache.end) {
  console.error(`Date ${date} is outside the loaded feed window ${cache.start} to ${cache.end}. Reload the planner data first.`);
  process.exit(2);
}

const isOui = record => String(record.od_happy_card || record.OD_HAPPY_CARD || '').toUpperCase() === 'OUI';
const records = (cache.records || []).filter(record =>
  (record.date || record.DATE) === date &&
  isOui(record) &&
  matchesAvailabilityStation(record, origin, 'origin') &&
  matchesAvailabilityStation(record, destination, 'destination')
);
const normalized = records.map(normalizeMax).filter(Boolean);
const result = findJourneys(normalized, origin, destination, date, date, 8, date);
const surfaced = [...result.maxFirst, ...result.nightTrains].filter(journey => journey.legs.length === 1);
const actual = new Set();
for (const journey of surfaced) {
  const leg = journey.legs[0];
  for (const train of leg.trainAlternates || [leg.train]) {
    actual.add([train, leg.originIata || leg.origin, leg.destinationIata || leg.destination, leg.dep, leg.arr].join('|'));
  }
}
const expected = new Map();
for (const leg of normalized) {
  const key = [leg.train, leg.originIata || leg.origin, leg.destinationIata || leg.destination, leg.dep, leg.arr].join('|');
  expected.set(key, leg);
}
const missing = [...expected].filter(([key]) => !actual.has(key)).map(([, leg]) => leg);
console.log(`Route audit: ${origin} → ${destination} on ${date}`);
console.log(`Loaded feed window: ${cache.start} to ${cache.end} (${cache.records?.length || 0} records)`);
console.log(`Direct OUI feed services: ${expected.size}`);
console.log(`Surfaced feed services: ${expected.size - missing.length}`);
console.log(`Direct MAX result cards after duplicate-time consolidation: ${surfaced.length}`);
console.log(`Missing from route results: ${missing.length}`);
for (const journey of surfaced) {
  const leg = journey.legs[0];
  console.log(`RESULT\t${leg.dep}–${leg.arr}\t${leg.trainAlternates?.join(' / ') || leg.train}\t${leg.origin} → ${leg.destination}`);
}
for (const leg of expected.values()) {
  const status = actual.has([leg.train, leg.originIata || leg.origin, leg.destinationIata || leg.destination, leg.dep, leg.arr].join('|')) ? 'OK' : 'MISSING';
  console.log(`${status}\t${leg.dep}–${leg.arr}\t${leg.train}\t${leg.origin} → ${leg.destination}`);
}
if (!expected.size) console.log('No direct OUI feed records matched this exact station pair and date.');

if (missing.length) process.exitCode = 1;
