import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import {
  alignSameDay,
  findJourneys,
  makeJourneyLegs,
  matchesAvailabilityStation,
  minimumConnectionMinutes,
  normalizeMax,
  stationIataCode,
  stationKey,
  stationMatchesSelection
} from './planner.js';
import { parisDateKey, parisEndOfDay } from './time.js';

const root = new URL('./.cache/gtfs/', import.meta.url);
const maxCacheUrl = new URL('./.cache/max.json', import.meta.url);
const args = process.argv.slice(2);
const valueAfter = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const outboundDate = valueAfter('--date');
const returnDate = valueAfter('--return-date');
const origin = valueAfter('--origin');
const destination = valueAfter('--destination');

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npm run audit:search -- --date YYYY-MM-DD --return-date YYYY-MM-DD --origin "Station" --destination "Station"');
  console.log('Runs the cached MAX feed and active SNCF GTFS timetable through the same route builder used by the app.');
  process.exit(0);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(outboundDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(returnDate || '') || returnDate < outboundDate || !origin || !destination) {
  console.error('Provide a valid --date, --return-date on or after it, --origin and --destination.');
  process.exit(2);
}

const cache = JSON.parse(await readFile(maxCacheUrl, 'utf8'));
const requiredFiles = ['stops.txt', 'routes.txt', 'trips.txt', 'calendar_dates.txt', 'stop_times.txt'];
if (requiredFiles.some(file => !existsSync(new URL(file, root)))) {
  console.error('Cached GTFS files are missing. Run the planner once to load timetable data, then retry.');
  process.exit(2);
}

const nextDate = value => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const addDays = (value, count) => {
  let result = value;
  for (let i = 0; i < count; i++) result = nextDate(result);
  return result;
};
const endDate = addDays(returnDate, 2);
if (outboundDate < cache.start || returnDate > cache.end) {
  console.error(`Outbound/return dates ${outboundDate} and ${returnDate} are outside loaded MAX feed ${cache.start} to ${cache.end}. The timetable look-ahead can extend past the MAX snapshot window.`);
  process.exit(2);
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

async function readCsv(file) {
  const rows = [], input = createInterface({ input: createReadStream(new URL(file, root)), crlfDelay: Infinity });
  let fields;
  for await (const line of input) {
    if (!fields) { fields = parseCsvLine(line).map((value, index) => index === 0 ? value.replace(/^\uFEFF/, '') : value); continue; }
    const cells = parseCsvLine(line);
    rows.push(Object.fromEntries(fields.map((field, index) => [field, cells[index] || ''])));
  }
  return rows;
}

const dateList = (start, end) => {
  const dates = [];
  for (let date = new Date(`${start}T12:00:00`), last = new Date(`${end}T12:00:00`); date <= last; date.setDate(date.getDate() + 1)) {
    dates.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
  }
  return dates;
};
const activeServicesForDate = (tables, date) => {
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const weekday = weekdays[new Date(`${date}T12:00:00`).getDay()], ymd = date.replaceAll('-', ''), active = new Set();
  for (const service of tables.calendar) if (ymd >= service.start_date && ymd <= service.end_date && service[weekday] === '1') active.add(service.service_id);
  for (const exception of tables.calendarDates) if (exception.date === ymd) {
    if (exception.exception_type === '1') active.add(exception.service_id);
    else active.delete(exception.service_id);
  }
  return active;
};

const [stops, routes, trips, calendarDates] = await Promise.all(['stops.txt', 'routes.txt', 'trips.txt', 'calendar_dates.txt'].map(readCsv));
const calendar = existsSync(new URL('calendar.txt', root)) ? await readCsv('calendar.txt') : [];
const tables = { stops, routes, trips, calendar, calendarDates };
const activeServices = new Set(dateList(outboundDate, endDate).flatMap(date => [...activeServicesForDate(tables, date)]));
const routeById = new Map(routes.map(route => [route.route_id, route]));
const wantedTrips = new Set(trips.filter(trip => {
  if (!activeServices.has(trip.service_id)) return false;
  const type = Number(routeById.get(trip.route_id)?.route_type);
  return type === 2 || type === 3 || type >= 100 && type < 200;
}).map(trip => trip.trip_id));

const stopTimeReader = createInterface({ input: createReadStream(new URL('stop_times.txt', root)), crlfDelay: Infinity });
const stopTimesByTrip = new Map();
let stopTimeFields;
for await (const line of stopTimeReader) {
  if (!stopTimeFields) { stopTimeFields = parseCsvLine(line); continue; }
  const cells = parseCsvLine(line), row = Object.fromEntries(stopTimeFields.map((field, index) => [field, cells[index] || '']));
  if (!wantedTrips.has(row.trip_id)) continue;
  if (!stopTimesByTrip.has(row.trip_id)) stopTimesByTrip.set(row.trip_id, []);
  stopTimesByTrip.get(row.trip_id).push(row);
}
const stopTimes = [...stopTimesByTrip.values()].flat();

const maxRecords = cache.records.filter(record => {
  const date = record.date || record.DATE;
  return date >= outboundDate && date <= endDate;
});
const legs = makeJourneyLegs({ ...tables, stopTimes }, outboundDate, endDate, maxRecords, [origin, destination]);
const returnEnd = nextDate(returnDate);
const outbound = findJourneys(legs, origin, destination, outboundDate, returnDate, 8, outboundDate);
const returning = findJourneys(legs, destination, origin, returnDate, returnEnd, 8, returnDate);

const fmtDate = value => parisDateKey(value);
const checks = [];
function validateJourney(journey, direction, latestArrival) {
  const fail = message => checks.push(`${direction}: ${message}`);
  if (!journey?.legs?.length) { fail('journey has no legs'); return; }
  const actualChanges = journey.legs.slice(1).reduce((count, leg, index) => count + (leg.tripId === journey.legs[index].tripId ? 0 : 1), 0);
  if (journey.changes !== actualChanges) fail('change count does not match train-service changes');
  if (journey.maxLegs !== journey.legs.filter(leg => leg.maxAvailable).length) fail('MAX-leg count is inconsistent');
  if (journey.paidLegs !== journey.legs.filter(leg => leg.paid).length) fail('paid-leg count is inconsistent');
  if (!stationMatchesSelection(direction === 'outbound' ? origin : destination, journey.legs[0].origin)) fail('first leg does not start at the selected station');
  if (!stationMatchesSelection(direction === 'outbound' ? destination : origin, journey.legs.at(-1).destination)) fail('last leg does not reach the selected station');
  if (fmtDate(journey.legs[0].from) !== (direction === 'outbound' ? outboundDate : returnDate)) fail('first leg departs on the wrong date');
  if (journey.arrival > latestArrival) fail('arrival exceeds the allowed date window');
  const seenTrips = new Set();
  for (let index = 0; index < journey.legs.length; index++) {
    const tripId = journey.legs[index].tripId;
    if (index && tripId === journey.legs[index - 1].tripId) continue;
    if (seenTrips.has(tripId)) fail(`same timetable trip ${tripId} is reused non-consecutively`);
    seenTrips.add(tripId);
  }
  for (let i = 0; i < journey.legs.length; i++) {
    const leg = journey.legs[i];
    if (!(leg.from instanceof Date) || !(leg.to instanceof Date) || leg.to <= leg.from) fail(`invalid times on train ${leg.train}`);
    if (leg.maxAvailable && leg.paid) fail(`MAX-available train ${leg.train} is also marked paid`);
    const fromCode = stationIataCode(leg.origin), toCode = stationIataCode(leg.destination);
    if (fromCode && toCode && fromCode !== toCode && stationKey(leg.origin) === stationKey(leg.destination)) fail(`same-city terminal hop shown as a train leg: ${leg.origin} → ${leg.destination}`);
    if (i === 0) continue;
    const previous = journey.legs[i - 1], gap = (leg.from - previous.to) / 60000;
    if (leg.tripId === previous.tripId) continue;
    const required = minimumConnectionMinutes(previous.destination, leg.origin);
    if (gap < required) fail(`transfer ${previous.destination} → ${leg.origin} is ${gap} min, below ${required} min`);
  }
}

function printRoutes(label, result) {
  const options = result.maxFirst.slice(0, 3);
  console.log(`${label} representative MAX-first paths:`);
  if (!options.length) console.log('  (none)');
  for (const journey of options) {
    console.log(`  ${journey.changes} change(s), ${Math.round(journey.duration)} min, ${journey.paidLegs} paid leg(s)`);
    for (let index = 0; index < journey.legs.length; index++) {
      const leg = journey.legs[index];
      const kind = leg.maxAvailable ? 'MAX' : leg.maxEligibilityUnknown ? 'MAX? (OUIGO)' : 'paid';
      console.log(`    ${fmtDate(leg.from)} ${leg.dep} ${leg.origin} → ${fmtDate(leg.to)} ${leg.arr} ${leg.destination} · ${leg.train} · ${kind}`);
      if (index > 0) {
        const previous = journey.legs[index - 1], wait = (leg.from - previous.to) / 60000;
        console.log(`      transfer wait ${wait} min (minimum ${minimumConnectionMinutes(previous.destination, leg.origin)} min)`);
      }
    }
  }
  if (result.fastest) {
    const fastest = result.fastest;
    console.log(`  Fastest: ${fastest.changes} change(s), ${Math.round(fastest.duration)} min, ${fastest.paidLegs} paid leg(s)`);
    for (const leg of fastest.legs) {
      const kind = leg.maxAvailable ? 'MAX' : leg.maxEligibilityUnknown ? 'MAX? (OUIGO)' : 'paid';
      console.log(`    ${fmtDate(leg.from)} ${leg.dep} ${leg.origin} → ${fmtDate(leg.to)} ${leg.arr} ${leg.destination} · ${leg.train} · ${kind}`);
    }
  }
}

function directCoverage(date, from, to, routes) {
  const expected = maxRecords.filter(record => (record.date || record.DATE) === date &&
    String(record.od_happy_card || record.OD_HAPPY_CARD || '').toUpperCase() === 'OUI' &&
    matchesAvailabilityStation(record, from, 'origin') && matchesAvailabilityStation(record, to, 'destination'))
    .map(normalizeMax).filter(Boolean);
  const actual = new Set();
  for (const journey of [...routes.maxFirst, ...routes.nightTrains].filter(option => option.legs.length === 1)) {
    const leg = journey.legs[0];
    for (const train of leg.trainAlternates || [leg.train]) actual.add([train, leg.originIata || leg.origin, leg.destinationIata || leg.destination, leg.dep, leg.arr].join('|'));
  }
  return { expected, missing: expected.filter(leg => !actual.has([leg.train, leg.originIata || leg.origin, leg.destinationIata || leg.destination, leg.dep, leg.arr].join('|'))) };
}
const outboundDirect = directCoverage(outboundDate, origin, destination, outbound);
const returnDirect = directCoverage(returnDate, destination, origin, returning);
const dayTripWarning = alignSameDay(outbound, returning, outboundDate === returnDate);
const outboundLatest = parisEndOfDay(returnDate);
const returnLatest = parisEndOfDay(returnEnd);
const journeys = [
  ...outbound.maxFirst.map(journey => [journey, 'outbound', outboundLatest]),
  ...(outbound.fastest ? [[outbound.fastest, 'outbound', outboundLatest]] : []),
  ...outbound.nightTrains.map(journey => [journey, 'outbound', outboundLatest]),
  ...outbound.ouigoCandidates.map(journey => [journey, 'outbound', outboundLatest]),
  ...returning.maxFirst.map(journey => [journey, 'return', returnLatest]),
  ...(returning.fastest ? [[returning.fastest, 'return', returnLatest]] : []),
  ...returning.nightTrains.map(journey => [journey, 'return', returnLatest]),
  ...returning.ouigoCandidates.map(journey => [journey, 'return', returnLatest])
];
for (const [journey, direction, latest] of journeys) validateJourney(journey, direction, latest);

console.log(`Integrated route audit: ${origin} → ${destination}`);
console.log(`Dates: outbound ${outboundDate}; return ${returnDate}`);
console.log(`Active GTFS timetable rows loaded: ${stopTimes.length} (${wantedTrips.size} trips)`);
console.log(`MAX snapshot rows loaded: ${maxRecords.length} (${cache.start} to ${cache.end})`);
console.log(`Constructed search legs: ${legs.length}; paid timetable legs: ${legs.filter(leg => leg.paid).length}`);
console.log(`Direct MAX outbound services: ${outboundDirect.expected.length}; missing after integration: ${outboundDirect.missing.length}`);
console.log(`Direct MAX return services: ${returnDirect.expected.length}; missing after integration: ${returnDirect.missing.length}`);
if (outboundDate === returnDate) console.log(`Same-day pairing: ${dayTripWarning || 'at least one valid pair; all displayed routes are pairable'}`);
console.log(`Outbound results: ${outbound.maxFirst.length} MAX-first, ${outbound.nightTrains.length} night, ${outbound.ouigoCandidates.length} OUIGO candidate${outbound.fastest ? ', fastest found' : ', no fastest route'}`);
console.log(`Return results: ${returning.maxFirst.length} MAX-first, ${returning.nightTrains.length} night, ${returning.ouigoCandidates.length} OUIGO candidate${returning.fastest ? ', fastest found' : ', no fastest route'}`);
for (const [label, result] of [['outbound', outbound], ['return', returning]]) {
  const diagnostics = result.searchDiagnostics;
  console.log(`${label} search coverage: ${diagnostics.expanded}/${diagnostics.limits.expanded} expansions, peak frontier ${diagnostics.frontierPeak}/${diagnostics.limits.frontier}${diagnostics.truncated ? ` · truncated (${diagnostics.truncationReasons.join(', ')})` : ' · complete within safety limits'}`);
}
for (const [label, coverage] of [['outbound', outboundDirect], ['return', returnDirect]]) for (const leg of coverage.missing) console.log(`MISSING DIRECT (${label})\t${leg.dep}–${leg.arr}\t${leg.train}\t${leg.origin} → ${leg.destination}`);
printRoutes('Outbound', outbound);
printRoutes('Return', returning);
for (const issue of checks) console.log(`INVALID\t${issue}`);
if (!outbound.maxFirst.length && !outbound.fastest) console.log('No outbound route found for this pair in the loaded data.');
if (!returning.maxFirst.length && !returning.fastest) console.log('No return route found for this pair in the loaded data.');
console.log(`Invariant failures: ${checks.length}`);

if (checks.length || outboundDirect.missing.length || returnDirect.missing.length) process.exitCode = 1;
