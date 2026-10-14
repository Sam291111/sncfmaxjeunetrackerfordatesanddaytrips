import test from 'node:test';
import assert from 'node:assert/strict';
import { formatParisTime, parisDateKey, serviceTimeToDate } from '../time.js';
import { classifyOuigo, isMaxTgvOrIntercites, isRail, isTimetableConnection } from '../products.js';
import {
  alignSameDay,
  buildConnectionTimeRules,
  findJourneys,
  findClosestJourneys,
  findReachableDestinations,
  findReachableDestinationOptions,
  makeJourneyLegs,
  normalizeMax,
  stationIataCode
} from '../planner.js';

const day = '2026-10-08';

function at(date, time) {
  return serviceTimeToDate(date, time);
}

function leg({
  id,
  tripId,
  train = id,
  origin,
  destination,
  date = day,
  dep,
  arr,
  max = true,
  paid = false,
  unknown = false
}) {
  return {
    id,
    tripId: tripId || `${id}-${date}`,
    train,
    origin,
    destination,
    dep,
    arr,
    from: at(date, dep),
    to: at(date, arr),
    type: max ? 'MAX TGV / Intercités' : 'Paid rail',
    maxAvailable: max,
    paid,
    maxEligibilityUnknown: unknown
  };
}

test('station aliases resolve known Paris and Lyon terminals exactly', () => {
  assert.equal(stationIataCode('Lyon Part Dieu'), 'FRLPD');
  assert.equal(stationIataCode('Paris Gare de Lyon'), 'FRPLY');
  assert.notEqual(stationIataCode('Lyon Perrache'), stationIataCode('Lyon Part Dieu'));
});

test('MAX normalization carries an overnight arrival into the next date', () => {
  const normalized = normalizeMax({
    date: day,
    train_no: 'ICN-1',
    origine: 'Paris Est',
    destination: 'Nice Ville',
    heure_depart: '22:00',
    heure_arrivee: '06:00',
    od_happy_card: 'OUI'
  });
  assert.ok(normalized);
  assert.equal(normalized.available, true);
  assert.equal(parisDateKey(normalized.to), '2026-10-09');
});

test('overnight MAX times keep the local clock across the autumn daylight-saving change', () => {
  const normalized = normalizeMax({
    date: '2026-10-24',
    train_no: 'ICN-DST',
    origine: 'Paris Austerlitz',
    destination: 'Nice Ville',
    heure_depart: '23:00',
    heure_arrivee: '04:00',
    od_happy_card: 'OUI'
  });

  assert.ok(normalized);
  assert.equal(parisDateKey(normalized.to), '2026-10-25');
  assert.equal(formatParisTime(normalized.to), '04:00');
  assert.equal((normalized.to - normalized.from) / 3600000, 6);
});

test('exact-station search does not substitute a different terminal in the same city', () => {
  const legs = [
    leg({ id: 'perrache', origin: 'Lyon Perrache', destination: 'Paris Gare de Lyon', dep: '05:50', arr: '08:14' }),
    leg({ id: 'part-dieu', origin: 'Lyon Part Dieu', destination: 'Paris Gare de Lyon', dep: '06:04', arr: '08:14' })
  ];
  const result = findJourneys(legs, 'Lyon Part Dieu', 'Paris Gare de Lyon', day, day, 1, day);
  assert.deepEqual(result.maxFirst.flatMap(journey => journey.legs.map(item => item.id)), ['part-dieu']);
});

test('all direct MAX departures survive the connection-result limit', () => {
  const legs = ['06:00', '09:00', '12:00'].map((dep, index) => leg({
    id: `direct-${index}`,
    origin: 'Lyon Part Dieu',
    destination: 'Paris Gare de Lyon',
    dep,
    arr: `${String(Number(dep.slice(0, 2)) + 2).padStart(2, '0')}:00`
  }));
  const result = findJourneys(legs, 'Lyon Part Dieu', 'Paris Gare de Lyon', day, day, 1, day);
  assert.equal(result.maxFirst.length, 3);
  assert.ok(result.maxFirst.every(journey => journey.changes === 0 && journey.maxLegs === 1));
});

test('fastest paid option is separate while MAX-first keeps an available direct train', () => {
  const legs = [
    leg({ id: 'max', origin: 'Lyon Part Dieu', destination: 'Paris Gare de Lyon', dep: '06:00', arr: '08:00' }),
    leg({ id: 'paid', origin: 'Lyon Part Dieu', destination: 'Paris Gare de Lyon', dep: '07:00', arr: '08:30', max: false, paid: true })
  ];
  const result = findJourneys(legs, 'Lyon Part Dieu', 'Paris Gare de Lyon', day, day, 8, day);
  assert.equal(result.maxFirst.length, 1);
  assert.equal(result.maxFirst[0].legs[0].id, 'max');
  assert.equal(result.fastest.legs[0].id, 'paid');
});

test('MAX feed direct service is not duplicated as a paid GTFS timetable leg', () => {
  const records = [{
    date: day,
    train_no: '6602',
    origine: 'LYON PART DIEU',
    origine_iata: 'FRLPD',
    destination: 'PARIS (intramuros)',
    destination_iata: 'FRPLY',
    heure_depart: '06:04',
    heure_arrivee: '08:14',
    od_happy_card: 'OUI'
  }];
  const tables = {
    stops: [
      { stop_id: 'lyon', stop_name: 'Lyon Part Dieu' },
      { stop_id: 'paris', stop_name: 'Paris Gare de Lyon' }
    ],
    routes: [{ route_id: 'tgv', route_type: '2', route_short_name: 'TGV INOUI' }],
    trips: [{ trip_id: 'trip-6602', route_id: 'tgv', service_id: 'daily', trip_short_name: '6602' }],
    stopTimes: [
      { trip_id: 'trip-6602', stop_id: 'lyon', stop_sequence: '1', departure_time: '06:04:00', arrival_time: '06:04:00' },
      { trip_id: 'trip-6602', stop_id: 'paris', stop_sequence: '2', departure_time: '08:14:00', arrival_time: '08:14:00' }
    ],
    calendar: [{ service_id: 'daily', start_date: '20260101', end_date: '20261231', thursday: '1' }],
    calendarDates: []
  };
  const legs = makeJourneyLegs(tables, day, day, records, ['Lyon Part Dieu', 'Paris Gare de Lyon']);
  assert.equal(legs.length, 1);
  assert.equal(legs[0].maxAvailable, true);
  assert.equal(legs[0].paid, false);
});

test('MAX feed does not treat a Lyon terminal hop as an intercity train journey', () => {
  const records = [{
    date: day,
    train_no: 'city-hop',
    origine: 'LYON PERRACHE',
    origine_iata: 'FRLPE',
    destination: 'LYON PART DIEU',
    destination_iata: 'FRLPD',
    heure_depart: '08:00',
    heure_arrivee: '08:15',
    od_happy_card: 'OUI'
  }];
  const legs = makeJourneyLegs({ stops: [], routes: [], trips: [], stopTimes: [], calendar: [], calendarDates: [] }, day, day, records, ['Lyon Perrache', 'Lyon Part Dieu']);
  assert.equal(legs.length, 0);
});

test('timetable segment generation skips irrelevant intermediate stations but preserves journey times', () => {
  const records = [
    { date: day, train_no: 'ab', origine: 'Station A', destination: 'Station B', heure_depart: '05:00', heure_arrivee: '05:30', od_happy_card: 'OUI' },
    { date: day, train_no: 'bc', origine: 'Station B', destination: 'Station C', heure_depart: '05:40', heure_arrivee: '06:30', od_happy_card: 'OUI' },
    { date: day, train_no: 'cd', origine: 'Station C', destination: 'Station D', heure_depart: '06:40', heure_arrivee: '07:30', od_happy_card: 'OUI' }
  ];
  const tables = {
    stops: ['Station A', 'Irrelevant stop', 'Station C'].map((stop_name, index) => ({ stop_id: `s${index}`, stop_name })),
    routes: [{ route_id: 'tgv', route_type: '2', route_short_name: 'TGV INOUI' }],
    trips: [{ trip_id: 'scheduled-ac', route_id: 'tgv', service_id: 'daily', trip_short_name: '7777' }],
    stopTimes: [
      { trip_id: 'scheduled-ac', stop_id: 's0', stop_sequence: '1', departure_time: '08:00:00', arrival_time: '08:00:00' },
      { trip_id: 'scheduled-ac', stop_id: 's1', stop_sequence: '2', departure_time: '08:30:00', arrival_time: '08:30:00' },
      { trip_id: 'scheduled-ac', stop_id: 's2', stop_sequence: '3', departure_time: '10:00:00', arrival_time: '10:00:00' }
    ],
    calendar: [{ service_id: 'daily', start_date: '20260101', end_date: '20261231', thursday: '1' }],
    calendarDates: []
  };
  const legs = makeJourneyLegs(tables, day, day, records, ['Station A', 'Station D']);
  const segment = legs.find(item => item.origin === 'Station A' && item.destination === 'Station C' && item.train === '7777');
  assert.ok(segment, 'a valid route-graph endpoint pair should remain after pre-filtering');
  assert.equal(segment.dep, '08:00');
  assert.equal(segment.arr, '10:00');
  assert.equal(legs.some(item => item.origin === 'Station A' && item.destination === 'Irrelevant stop'), false);
});

test('GTFS route type 3 is presented as a paid bus or coach connection', () => {
  const tables = {
    stops: [
      { stop_id: 'from', stop_name: 'Lyon Part Dieu' },
      { stop_id: 'to', stop_name: 'Paris Gare de Lyon' }
    ],
    routes: [{ route_id: 'coach', route_type: '3', route_short_name: 'K7', route_long_name: 'Lyon - Paris' }],
    trips: [{ trip_id: 'coach-trip', route_id: 'coach', service_id: 'daily', trip_short_name: 'K7' }],
    stopTimes: [
      { trip_id: 'coach-trip', stop_id: 'from', stop_sequence: '1', departure_time: '08:00:00', arrival_time: '08:00:00' },
      { trip_id: 'coach-trip', stop_id: 'to', stop_sequence: '2', departure_time: '14:00:00', arrival_time: '14:00:00' }
    ],
    calendar: [{ service_id: 'daily', start_date: '20260101', end_date: '20261231', thursday: '1' }],
    calendarDates: []
  };
  const legs = makeJourneyLegs(tables, day, day, [], ['Lyon Part Dieu', 'Paris Gare de Lyon']);

  assert.equal(legs.length, 1);
  assert.equal(legs[0].paid, true);
  assert.equal(legs[0].type, 'Bus / coach connection (paid)');
});

test('central product rules keep rail modes and MAX-eligible OUIGO separate', () => {
  assert.equal(isRail({ route_type: '2' }), true);
  assert.equal(isTimetableConnection({ route_type: '3' }), true);
  assert.equal(isRail({ route_type: '3' }), false);
  assert.equal(isMaxTgvOrIntercites({ route_long_name: 'TGV INOUI' }), true);
  assert.equal(classifyOuigo({ trip_id: 'x_F:OGO:y' }, '7350').maxStatus, 'candidate');
  assert.equal(classifyOuigo({ trip_id: 'x_F:OGO:y' }, '4500').maxStatus, 'ineligible');
  assert.equal(classifyOuigo({ trip_id: 'x_F:OGO:y' }, '8500').maxStatus, 'unknown');
});

test('timetable legs cannot board or alight where GTFS explicitly forbids it', () => {
  const records = [
    { date: day, train_no: 'ab', origine: 'Station A', destination: 'Station B', heure_depart: '05:00', heure_arrivee: '05:30', od_happy_card: 'OUI' },
    { date: day, train_no: 'bc', origine: 'Station B', destination: 'Station C', heure_depart: '05:40', heure_arrivee: '06:30', od_happy_card: 'OUI' },
    { date: day, train_no: 'cd', origine: 'Station C', destination: 'Station D', heure_depart: '06:40', heure_arrivee: '07:30', od_happy_card: 'OUI' }
  ];
  const tables = {
    stops: ['Station A', 'Station B', 'Station C', 'Station D'].map((stop_name, index) => ({ stop_id: `s${index}`, stop_name })),
    routes: [{ route_id: 'tgv', route_type: '2', route_short_name: 'TGV INOUI' }],
    trips: [{ trip_id: 'restricted-trip', route_id: 'tgv', service_id: 'daily', trip_short_name: '7788' }],
    stopTimes: [
      { trip_id: 'restricted-trip', stop_id: 's0', stop_sequence: '1', departure_time: '08:00:00', arrival_time: '08:00:00' },
      { trip_id: 'restricted-trip', stop_id: 's1', stop_sequence: '2', departure_time: '08:30:00', arrival_time: '08:30:00', pickup_type: '1' },
      { trip_id: 'restricted-trip', stop_id: 's2', stop_sequence: '3', departure_time: '09:00:00', arrival_time: '09:00:00', drop_off_type: '1' },
      { trip_id: 'restricted-trip', stop_id: 's3', stop_sequence: '4', departure_time: '10:00:00', arrival_time: '10:00:00' }
    ],
    calendar: [{ service_id: 'daily', start_date: '20260101', end_date: '20261231', thursday: '1' }],
    calendarDates: []
  };
  const legs = makeJourneyLegs(tables, day, day, records, ['Station A', 'Station D']);
  assert.equal(legs.some(item => item.train === '7788' && item.origin === 'Station B'), false);
  assert.equal(legs.some(item => item.train === '7788' && item.destination === 'Station C'), false);
  assert.ok(legs.some(item => item.train === '7788' && item.origin === 'Station A' && item.destination === 'Station D'));
});

test('overnight connection can continue the following morning', () => {
  const next = '2026-10-09';
  const legs = [
    leg({ id: 'night', origin: 'Lyon Part Dieu', destination: 'Paris Gare de Lyon', dep: '22:00', arr: '23:50' }),
    leg({ id: 'morning', origin: 'Paris Gare de Lyon', destination: 'Lille Europe', date: next, dep: '06:00', arr: '07:00' })
  ];
  const dayOnly = findJourneys(legs, 'Lyon Part Dieu', 'Lille Europe', day, day, 8, day);
  assert.ok(!dayOnly.maxFirst.some(journey => journey.legs.length === 2));
  const result = findJourneys(legs, 'Lyon Part Dieu', 'Lille Europe', day, next, 8, day);
  const overnight = result.maxFirst.find(journey => journey.legs.length === 2);
  assert.ok(overnight, 'expected a next-day connection route');
  assert.equal(overnight.overnight, true);
});

test('Explore can build an overnight route when the first leg leaves on the chosen date', () => {
  const next = '2026-10-09';
  const records = [
    { date: day, train_no: 'night', origine: 'Lyon Part Dieu', origine_iata: 'FRLPD', destination: 'Paris Gare de Lyon', destination_iata: 'FRPLY', heure_depart: '22:00', heure_arrivee: '23:50', od_happy_card: 'OUI' },
    { date: next, train_no: 'morning', origine: 'Paris Gare de Lyon', origine_iata: 'FRPLY', destination: 'Lille Europe', destination_iata: 'FRLLE', heure_depart: '06:00', heure_arrivee: '07:00', od_happy_card: 'OUI' }
  ];
  const result = findReachableDestinationOptions(records, 'Lyon Part Dieu', 'Lille Europe', day, {
    mode: 'oneway',
    changes: [1]
  });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].outbound.legs.map(item => item.train), ['night', 'morning']);
});

test('same-station transfer enforces the minimum connection time', () => {
  const legs = [
    leg({ id: 'first', origin: 'Lyon Part Dieu', destination: 'Paris Gare de Lyon', dep: '06:00', arr: '08:00' }),
    leg({ id: 'too-short', origin: 'Paris Gare de Lyon', destination: 'Lille Europe', dep: '08:11', arr: '09:00' }),
    leg({ id: 'valid', origin: 'Paris Gare de Lyon', destination: 'Lille Europe', dep: '08:12', arr: '09:00' })
  ];
  const result = findJourneys(legs, 'Lyon Part Dieu', 'Lille Europe', day, day, 8, day);
  const scanned = findJourneys(legs, 'Lyon Part Dieu', 'Lille Europe', day, day, 8, day, null, { router: 'csa' });
  assert.ok(result.maxFirst.some(journey => journey.legs.map(item => item.id).join(',') === 'first,valid'));
  assert.ok(!result.maxFirst.some(journey => journey.legs.some(item => item.id === 'too-short')));
  assert.ok(scanned.maxFirst.some(journey => journey.legs.map(item => item.id).join(',') === 'first,valid'));
  assert.ok(!scanned.maxFirst.some(journey => journey.legs.some(item => item.id === 'too-short')));
});

test('Paris terminal change requires a 90-minute transfer and remains routable', () => {
  const legs = [
    leg({ id: 'to-lyon-station', origin: 'Lyon Part Dieu', destination: 'Paris Gare de Lyon', dep: '06:00', arr: '08:00' }),
    leg({ id: 'too-short-paris-change', origin: 'Paris Gare du Nord', destination: 'Lille Europe', dep: '09:29', arr: '10:00' }),
    leg({ id: 'valid-paris-change', origin: 'Paris Gare du Nord', destination: 'Lille Europe', dep: '09:30', arr: '10:00' })
  ];
  const result = findJourneys(legs, 'Lyon Part Dieu', 'Lille Europe', day, day, 8, day);
  const scanned = findJourneys(legs, 'Lyon Part Dieu', 'Lille Europe', day, day, 8, day, null, { router: 'csa' });
  assert.ok(result.maxFirst.some(journey => journey.legs.map(item => item.id).join(',') === 'to-lyon-station,valid-paris-change'));
  assert.ok(!result.maxFirst.some(journey => journey.legs.some(item => item.id === 'too-short-paris-change')));
  assert.ok(scanned.maxFirst.some(journey => journey.legs.map(item => item.id).join(',') === 'to-lyon-station,valid-paris-change'));
  assert.ok(!scanned.maxFirst.some(journey => journey.legs.some(item => item.id === 'too-short-paris-change')));
});

test('production SNCF settings keep the conservative station floor when no pair rule matches', () => {
  const legs = [
    leg({ id: 'to-paris', origin: 'Lyon Part Dieu', destination: 'Paris Gare de Lyon', dep: '06:00', arr: '08:00' }),
    leg({ id: '89-minute-paris-change', origin: 'Paris Gare du Nord', destination: 'Lille Europe', dep: '09:29', arr: '10:00' }),
    leg({ id: '90-minute-paris-change', origin: 'Paris Gare du Nord', destination: 'Lille Europe', dep: '09:30', arr: '10:00' })
  ];
  const settings = { mode: 'sncf', rules: null, maximumMinutes: null };
  const result = findJourneys(legs, 'Lyon Part Dieu', 'Lille Europe', day, day, 8, day, settings);

  assert.ok(result.maxFirst.some(journey => journey.legs.map(item => item.id).join(',') === 'to-paris,90-minute-paris-change'));
  assert.ok(!result.maxFirst.some(journey => journey.legs.some(item => item.id === '89-minute-paris-change')));
});

test('disabled minimum rules allow tight transfers but retain the maximum-wait limit', () => {
  const legs = [
    leg({ id: 'to-paris', origin: 'Lyon Part Dieu', destination: 'Paris Gare de Lyon', dep: '06:00', arr: '08:00' }),
    leg({ id: 'tight', origin: 'Paris Gare de Lyon', destination: 'Lille Europe', dep: '08:01', arr: '09:00' }),
    leg({ id: 'long-wait', origin: 'Paris Gare de Lyon', destination: 'Lille Europe', dep: '10:30', arr: '11:30' })
  ];
  const settings = { mode: 'none', rules: null, minimumMinutes: null, maximumMinutes: 60 };
  const result = findJourneys(legs, 'Lyon Part Dieu', 'Lille Europe', day, day, 8, day, settings);

  assert.ok(result.maxFirst.some(journey => journey.legs.map(item => item.id).join(',') === 'to-paris,tight'));
  assert.ok(!result.maxFirst.some(journey => journey.legs.some(item => item.id === 'long-wait')));
});

test('a day trip requires time at the destination before its return', () => {
  const records = [
    { date: day, train_no: 'out', origine: 'Lyon Part Dieu', origine_iata: 'FRLPD', destination: 'Paris Gare de Lyon', destination_iata: 'FRPLY', heure_depart: '06:00', heure_arrivee: '08:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'too-soon', origine: 'Paris Gare de Lyon', origine_iata: 'FRPLY', destination: 'Lyon Part Dieu', destination_iata: 'FRLPD', heure_depart: '08:20', heure_arrivee: '10:20', od_happy_card: 'OUI' },
    { date: day, train_no: 'return', origine: 'Paris Gare de Lyon', origine_iata: 'FRPLY', destination: 'Lyon Part Dieu', destination_iata: 'FRLPD', heure_depart: '08:30', heure_arrivee: '10:30', od_happy_card: 'OUI' }
  ];
  const result = findReachableDestinationOptions(records, 'Lyon Part Dieu', 'Paris Gare de Lyon', day, {
    mode: 'daytrip',
    changes: [0],
    minimumStayMinutes: 30
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].returning.legs[0].train, 'return');
});

test('day trips retain a later outbound service when its return transfer is feasible', () => {
  const records = [
    { date: day, train_no: 'early', origine: 'Origin', destination: 'Town', heure_depart: '06:00', heure_arrivee: '08:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'late', origine: 'Origin', destination: 'Town', heure_depart: '07:00', heure_arrivee: '09:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'return', origine: 'Town', destination: 'Origin', heure_depart: '10:00', heure_arrivee: '11:00', od_happy_card: 'OUI' }
  ];
  const stops = [
    { stop_name: 'Origin', stop_lat: '45.0', stop_lon: '4.0' },
    { stop_name: 'Town', stop_lat: '45.5', stop_lon: '4.5' }
  ];
  const connectionSettings = {
    mode: 'sncf',
    rules: buildConnectionTimeRules({
      stationRows: [
        { CODE_UIC: '0000001', DESCRIPTION: 'Town' },
        { CODE_UIC: '0000002', DESCRIPTION: 'Origin' }
      ],
      trainRows: [{ ARRIVAL_STATION_UIC: '0000001', DEPARTURE_STATION_UIC: '0000001', ARRIVAL_TRAIN: 'early', DEPARTURE_TRAIN: 'return', MIN_DELAY: '-1' }]
    })
  };
  const result = findReachableDestinations(records, stops, 'Origin', day, {
    mode: 'daytrip', changes: [0], minimumStayMinutes: 0, connectionSettings, includeDiagnostics: true
  });

  assert.equal(result.destinations.length, 1);
  assert.equal(result.destinations[0].name, 'Town');
  assert.equal(result.destinations[0].outbound.legs[0].train, 'late');
  assert.equal(result.destinations[0].returning.legs[0].train, 'return');

  const scanned = findReachableDestinations(records, stops, 'Origin', day, {
    mode: 'daytrip', changes: [0], minimumStayMinutes: 0, connectionSettings, includeDiagnostics: true, router: 'csa'
  });
  assert.equal(scanned.destinations.length, 1);
  assert.equal(scanned.destinations[0].outbound.legs[0].train, 'late');
  assert.equal(scanned.destinations[0].returning.legs[0].train, 'return');
  assert.equal(scanned.searchDiagnostics.truncated, false);
  assert.equal(scanned.searchDiagnostics.limits.expanded, null);
  assert.equal(scanned.searchDiagnostics.limits.frontier, null);
});

test('day trips use the default three-hour destination stay unless changed', () => {
  const records = [
    { date: day, train_no: 'out', origine: 'Lyon Part Dieu', origine_iata: 'FRLPD', destination: 'Paris Gare de Lyon', destination_iata: 'FRPLY', heure_depart: '06:00', heure_arrivee: '08:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'before-default', origine: 'Paris Gare de Lyon', origine_iata: 'FRPLY', destination: 'Lyon Part Dieu', destination_iata: 'FRLPD', heure_depart: '10:59', heure_arrivee: '12:59', od_happy_card: 'OUI' },
    { date: day, train_no: 'at-default', origine: 'Paris Gare de Lyon', origine_iata: 'FRPLY', destination: 'Lyon Part Dieu', destination_iata: 'FRLPD', heure_depart: '11:00', heure_arrivee: '13:00', od_happy_card: 'OUI' }
  ];
  const result = findReachableDestinationOptions(records, 'Lyon Part Dieu', 'Paris Gare de Lyon', day, {
    mode: 'daytrip',
    changes: [0]
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].returning.legs[0].train, 'at-default');
});

test('day-trip return expansion budget is shared across reachable destinations', () => {
  const records = [
    { date: day, train_no: 'out-x', origine: 'Origin', destination: 'Destination X', heure_depart: '06:00', heure_arrivee: '07:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'out-y', origine: 'Origin', destination: 'Destination Y', heure_depart: '06:30', heure_arrivee: '07:30', od_happy_card: 'OUI' },
    { date: day, train_no: 'x-hub', origine: 'Destination X', destination: 'Return Hub', heure_depart: '08:00', heure_arrivee: '09:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'y-hub', origine: 'Destination Y', destination: 'Return Hub', heure_depart: '08:30', heure_arrivee: '09:30', od_happy_card: 'OUI' },
    { date: day, train_no: 'hub-origin', origine: 'Return Hub', destination: 'Origin', heure_depart: '10:30', heure_arrivee: '11:30', od_happy_card: 'OUI' }
  ];
  const stops = ['Destination X', 'Destination Y'].map((stop_name, index) => ({
    stop_name,
    stop_lat: String(45 + index / 10),
    stop_lon: String(4 + index / 10)
  }));

  const result = findReachableDestinations(records, stops, 'Origin', day, {
    mode: 'daytrip',
    changes: [0, 1, 2],
    minimumStayMinutes: 0,
    includeDiagnostics: true,
    searchLimits: { expanded: null, frontier: null, returnExpanded: 2, returnFrontier: 20, maxSegments: 5 }
  });

  assert.deepEqual(result.destinations.map(destination => destination.name).sort(), ['Destination X', 'Destination Y']);
  assert.equal(result.searchDiagnostics.returnSearches, 2);
  assert.equal(result.searchDiagnostics.returnExpanded, 2);
  assert.equal(result.searchDiagnostics.truncated, false);

  const constrained = findReachableDestinations(records, stops, 'Origin', day, {
    mode: 'daytrip',
    changes: [0, 1, 2],
    minimumStayMinutes: 0,
    includeDiagnostics: true,
    searchLimits: { expanded: null, frontier: null, returnExpanded: 1, returnFrontier: 20, maxSegments: 5 }
  });
  assert.equal(constrained.destinations.length, 1);
  assert.equal(constrained.searchDiagnostics.returnExpanded, 1);
  assert.equal(constrained.searchDiagnostics.truncated, true);
  assert.ok(constrained.searchDiagnostics.truncationReasons.includes('return expansion limit'));
  assert.equal(constrained.searchDiagnostics.returnExpansionLimitedSearches, 0);
  assert.equal(constrained.searchDiagnostics.returnBudgetExhaustedDestinations, 1);
  assert.ok(constrained.searchDiagnostics.returnLimitEvents.some(event => event.reasons.includes('shared return budget exhausted')));
});

test('day-trip diagnostics preserve return segment limits and identify the destination', () => {
  const records = [
    { date: day, train_no: 'out', origine: 'Origin', destination: 'Town', heure_depart: '06:00', heure_arrivee: '07:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'return-a', origine: 'Town', destination: 'Return Hub', heure_depart: '08:00', heure_arrivee: '09:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'return-b', origine: 'Return Hub', destination: 'Origin', heure_depart: '10:00', heure_arrivee: '11:00', od_happy_card: 'OUI' }
  ];
  const stops = [{ stop_name: 'Town', stop_lat: '45.5', stop_lon: '4.5' }];
  const result = findReachableDestinations(records, stops, 'Origin', day, {
    mode: 'daytrip',
    changes: [0, 1],
    minimumStayMinutes: 0,
    includeDiagnostics: true,
    searchLimits: { expanded: null, frontier: null, returnExpanded: null, returnFrontier: null, maxSegments: 1 }
  });

  assert.equal(result.searchDiagnostics.returnSegmentLimitedSearches, 1);
  assert.ok(result.searchDiagnostics.truncationReasons.includes('return segment count limit'));
  assert.ok(result.searchDiagnostics.returnLimitEvents.some(event => event.destination === 'Town' && event.reasons.includes('return segment count limit')));
});

test('day trips reallocate unused return budget to destinations limited in the first pass', () => {
  const records = [
    { date: day, train_no: 'out-a', origine: 'Origin', destination: 'Town A', heure_depart: '06:00', heure_arrivee: '07:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'a-1', origine: 'Town A', destination: 'A1', heure_depart: '10:30', heure_arrivee: '11:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'a-2', origine: 'A1', destination: 'A2', heure_depart: '11:45', heure_arrivee: '12:15', od_happy_card: 'OUI' },
    { date: day, train_no: 'a-3', origine: 'A2', destination: 'A3', heure_depart: '13:00', heure_arrivee: '13:30', od_happy_card: 'OUI' },
    { date: day, train_no: 'a-4', origine: 'A3', destination: 'Origin', heure_depart: '14:15', heure_arrivee: '15:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'out-b', origine: 'Origin', destination: 'Town B', heure_depart: '06:30', heure_arrivee: '07:30', od_happy_card: 'OUI' },
    { date: day, train_no: 'back-b', origine: 'Town B', destination: 'Origin', heure_depart: '10:30', heure_arrivee: '11:30', od_happy_card: 'OUI' },
    { date: day, train_no: 'out-c', origine: 'Origin', destination: 'Town C', heure_depart: '07:00', heure_arrivee: '08:00', od_happy_card: 'OUI' }
  ];
  const stops = ['Town A', 'Town B', 'Town C'].map((stop_name, index) => ({ stop_name, stop_lat: String(45 + index / 10), stop_lon: String(4 + index / 10) }));
  const result = findReachableDestinations(records, stops, 'Origin', day, {
    mode: 'daytrip',
    changes: [0, 1, 2, 3],
    minimumStayMinutes: 180,
    includeDiagnostics: true,
    searchLimits: { expanded: null, frontier: null, returnExpanded: 6, returnFrontier: 20, maxSegments: 6 }
  });

  assert.deepEqual(result.destinations.map(destination => destination.name).sort(), ['Town A', 'Town B']);
  assert.equal(result.searchDiagnostics.returnExpansionLimitedSearches, 1);
  assert.equal(result.searchDiagnostics.returnExpansionIncompleteDestinations, 0);
  assert.equal(result.searchDiagnostics.truncationReasons.includes('return expansion limit'), false);
  assert.equal(result.searchDiagnostics.returnExpanded, 5);
  assert.equal(result.searchDiagnostics.returnBudgetRemaining, 1);
  assert.ok(result.searchDiagnostics.returnLimitEvents.some(event => event.destination === 'Town A' && event.phase === 'initial' && !event.foundJourney));
  assert.ok(result.searchDiagnostics.returnLimitEvents.some(event => event.destination === 'Town A' && event.phase === 'redistributed' && event.foundJourney));

  const noReturnRecords = records.map(record => record.train_no === 'a-4' ? { ...record, destination: 'A4' } : record);
  const exhaustiveRetry = findReachableDestinations(noReturnRecords, stops, 'Origin', day, {
    mode: 'daytrip',
    changes: [0, 1, 2, 3],
    minimumStayMinutes: 180,
    includeDiagnostics: true,
    searchLimits: { expanded: null, frontier: null, returnExpanded: 6, returnFrontier: 20, maxSegments: 6 }
  });
  assert.deepEqual(exhaustiveRetry.destinations.map(destination => destination.name).sort(), ['Town B']);
  assert.equal(exhaustiveRetry.searchDiagnostics.returnExpansionIncompleteDestinations, 0);
  assert.equal(exhaustiveRetry.searchDiagnostics.truncationReasons.includes('return expansion limit'), false);
});

test('day trips try earlier-arriving outbound options before using return budget', () => {
  const records = [
    { date: day, train_no: 'late-direct', origine: 'Origin', destination: 'Town', heure_depart: '06:00', heure_arrivee: '12:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'early-first', origine: 'Origin', destination: 'Transfer', heure_depart: '06:00', heure_arrivee: '07:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'early-second', origine: 'Transfer', destination: 'Town', heure_depart: '08:00', heure_arrivee: '09:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'town-origin', origine: 'Town', destination: 'Origin', heure_depart: '11:00', heure_arrivee: '12:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'dead-end-a', origine: 'Town', destination: 'Dead End A', heure_depart: '13:00', heure_arrivee: '14:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'dead-end-b', origine: 'Dead End A', destination: 'Dead End B', heure_depart: '14:45', heure_arrivee: '15:00', od_happy_card: 'OUI' }
  ];
  const stops = [{ stop_name: 'Town', stop_lat: '45.5', stop_lon: '4.5' }];
  const result = findReachableDestinations(records, stops, 'Origin', day, {
    mode: 'daytrip',
    changes: [0, 1],
    minimumStayMinutes: 0,
    includeDiagnostics: true,
    searchLimits: { expanded: null, frontier: null, returnExpanded: 1, returnFrontier: 20, maxSegments: 5 }
  });

  assert.equal(result.destinations.length, 1);
  assert.deepEqual(result.destinations[0].outbound.legs.map(item => item.train), ['early-first', 'early-second']);
  assert.deepEqual(result.destinations[0].returning.legs.map(item => item.train), ['town-origin']);
  assert.equal(result.searchDiagnostics.returnExpanded, 0);
  assert.equal(result.searchDiagnostics.truncated, false);
});

test('Explore recognizes a valid transfer between Paris terminals', () => {
  const records = [
    { date: day, train_no: 'to-paris', origine: 'Lyon Part Dieu', origine_iata: 'FRLPD', destination: 'Paris Gare de Lyon', destination_iata: 'FRPLY', heure_depart: '06:00', heure_arrivee: '08:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'from-nord', origine: 'Paris Gare du Nord', origine_iata: 'FRPNO', destination: 'Lille Europe', destination_iata: 'FRLLE', heure_depart: '09:30', heure_arrivee: '10:00', od_happy_card: 'OUI' }
  ];
  const result = findReachableDestinationOptions(records, 'Lyon Part Dieu', 'Lille Europe', day, {
    mode: 'oneway',
    changes: [1]
  });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].outbound.legs.map(item => item.train), ['to-paris', 'from-nord']);
});

test('Explore returns destinations reached with five changes', () => {
  const names = ['Station A', 'Station B', 'Station C', 'Station D', 'Station E', 'Station F', 'Station G'];
  const records = names.slice(0, -1).map((name, index) => ({
    date: day,
    train_no: `chain-${index}`,
    origine: name,
    destination: names[index + 1],
    heure_depart: `${String(6 + index * 2).padStart(2, '0')}:00`,
    heure_arrivee: `${String(7 + index * 2).padStart(2, '0')}:00`,
    od_happy_card: 'OUI'
  }));
  const stops = names.map((stop_name, index) => ({
    stop_name,
    stop_lat: String(45 + index * 0.1),
    stop_lon: String(4 + index * 0.1)
  }));
  const destinations = findReachableDestinations(records, stops, names[0], day, { changes: [5] });
  assert.ok(destinations.some(destination => destination.name === names[6] && destination.changes === 5));
});

test('Explore scan matches exhaustive reachability on deterministic small rail graphs', () => {
  const clock = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  for (let seed = 1; seed <= 16; seed++) {
    let state = seed;
    const random = max => { state = (state * 48271) % 2147483647; return state % max; };
    const stations = Array.from({ length: 7 }, (_, index) => `Oracle ${seed} Station ${index}`);
    const records = Array.from({ length: 22 }, (_, index) => {
      let from = random(stations.length), to = random(stations.length - 1);
      if (to >= from) to++;
      const departure = 6 * 60 + random(9 * 60);
      const duration = 30 + random(46);
      return {
        date: day,
        train_no: `${seed}-${index}`,
        origine: stations[from],
        destination: stations[to],
        heure_depart: clock(departure),
        heure_arrivee: clock(departure + duration),
        od_happy_card: 'OUI'
      };
    });
    const stops = stations.map((stop_name, index) => ({ stop_name, stop_lat: String(45 + index), stop_lon: String(2 + index) }));
    const expected = new Set();
    const legs = records.map(normalizeMax).filter(Boolean);
    const walk = (station, path) => {
      if (path.length && station !== stations[0]) expected.add(station);
      if (path.length >= 4) return;
      const last = path.at(-1);
      for (const next of legs.filter(leg => leg.origin === station)) {
        if (last && (next.from - last.to) / 60000 < 12) continue;
        walk(next.destination, [...path, next]);
      }
    };
    walk(stations[0], []);
    const result = findReachableDestinations(records, stops, stations[0], day, {
      mode: 'oneway', changes: [0, 1, 2, 3], includeDiagnostics: true
    });
    const scanned = findReachableDestinations(records, stops, stations[0], day, {
      mode: 'oneway', changes: [0, 1, 2, 3], router: 'csa', includeDiagnostics: true
    });
    const actual = new Set(result.destinations.map(destination => destination.name));
    const scannedNames = new Set(scanned.destinations.map(destination => destination.name));
    assert.deepEqual([...actual].sort(), [...expected].sort(), `reachability mismatch for generated graph ${seed}`);
    assert.deepEqual([...scannedNames].sort(), [...expected].sort(), `CSA reachability mismatch for generated graph ${seed}`);
    assert.equal(result.searchDiagnostics.truncated, false, `unexpected truncation for generated graph ${seed}`);
    assert.equal(scanned.searchDiagnostics.truncated, false, `CSA unexpectedly truncated graph ${seed}`);
  }
});

test('Explore keeps same-train MAX sections visible and does not count a through service as a change', () => {
  const records = [
    { date: day, train_no: 'through-1', origine: 'Oracle Origin', destination: 'Oracle Hub', heure_depart: '06:00', heure_arrivee: '07:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'through-1', origine: 'Oracle Hub', destination: 'Oracle Midpoint', heure_depart: '07:15', heure_arrivee: '07:30', od_happy_card: 'OUI' },
    { date: day, train_no: 'through-1', origine: 'Oracle Midpoint', destination: 'Oracle End', heure_depart: '07:45', heure_arrivee: '08:00', od_happy_card: 'OUI' }
  ];
  const stops = ['Oracle Origin', 'Oracle Hub', 'Oracle Midpoint', 'Oracle End'].map((stop_name, index) => ({ stop_name, stop_lat: String(45 + index), stop_lon: String(2 + index) }));
  const result = findReachableDestinations(records, stops, 'Oracle Origin', day, { changes: [0], includeDiagnostics: true });
  const scanned = findReachableDestinations(records, stops, 'Oracle Origin', day, { changes: [0], router: 'csa', includeDiagnostics: true });
  const destination = result.destinations.find(item => item.name === 'Oracle End');
  const scannedDestination = scanned.destinations.find(item => item.name === 'Oracle End');
  assert.ok(destination);
  assert.ok(scannedDestination);
  assert.equal(destination.changes, 0);
  assert.equal(destination.outbound.sameTrainReboard, true);
  assert.equal(destination.outbound.legs.length, 3);
  assert.equal(scannedDestination.changes, 0);
  assert.equal(scannedDestination.outbound.sameTrainReboard, true);
  assert.equal(scannedDestination.outbound.legs.length, 3);
  const additionalTimes = findReachableDestinationOptions(records, 'Oracle Origin', 'Oracle End', day, { changes: [0], includeDiagnostics: true });
  assert.ok(additionalTimes.options.some(option => option.outbound.changes === 0 && option.outbound.legs.length === 3));
});

test('Explore destination searches report safety-cap truncation', () => {
  const names = ['Station A', 'Station B', 'Station C', 'Station D'];
  const records = names.slice(0, -1).map((name, index) => ({
    date: day,
    train_no: `explore-${index}`,
    origine: name,
    destination: names[index + 1],
    heure_depart: `${String(6 + index * 2).padStart(2, '0')}:00`,
    heure_arrivee: `${String(7 + index * 2).padStart(2, '0')}:00`,
    od_happy_card: 'OUI'
  }));
  const stops = names.map((stop_name, index) => ({ stop_name, stop_lat: String(45 + index / 10), stop_lon: String(4 + index / 10) }));
  const result = findReachableDestinations(records, stops, names[0], day, {
    changes: [2],
    includeDiagnostics: true,
    searchLimits: { expanded: 1, frontier: 10 }
  });

  assert.ok(Array.isArray(result.destinations));
  assert.equal(result.searchDiagnostics.expanded, 1);
  assert.equal(result.searchDiagnostics.truncated, true);
  assert.ok(result.searchDiagnostics.truncationReasons.includes('expansion limit'));
});

test('additional-time search reports outbound and return expansion caps', () => {
  const records = [
    { date: day, train_no: 'out', origine: 'Lyon Part Dieu', origine_iata: 'FRLPD', destination: 'Paris Gare de Lyon', destination_iata: 'FRPLY', heure_depart: '06:00', heure_arrivee: '08:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'via-a', origine: 'Paris Gare de Lyon', origine_iata: 'FRPLY', destination: 'Station A', heure_depart: '10:00', heure_arrivee: '11:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'via-b', origine: 'Paris Gare de Lyon', origine_iata: 'FRPLY', destination: 'Station B', heure_depart: '10:30', heure_arrivee: '11:30', od_happy_card: 'OUI' },
    { date: day, train_no: 'back-a', origine: 'Station A', destination: 'Lyon Part Dieu', destination_iata: 'FRLPD', heure_depart: '12:00', heure_arrivee: '14:00', od_happy_card: 'OUI' },
    { date: day, train_no: 'back-b', origine: 'Station B', destination: 'Lyon Part Dieu', destination_iata: 'FRLPD', heure_depart: '12:30', heure_arrivee: '14:30', od_happy_card: 'OUI' }
  ];
  const result = findReachableDestinationOptions(records, 'Lyon Part Dieu', 'Paris Gare de Lyon', day, {
    mode: 'daytrip',
    changes: [0, 1],
    minimumStayMinutes: 0,
    includeDiagnostics: true,
    searchLimits: { returnExpanded: 1 }
  });

  assert.ok(Array.isArray(result.options));
  assert.equal(result.searchDiagnostics.returnExpanded, 1);
  assert.equal(result.searchDiagnostics.truncated, true);
  assert.ok(result.searchDiagnostics.truncationReasons.includes('return expansion limit'));
});

test('closest-destination search reports safety-cap truncation', () => {
  const names = ['Lyon Part Dieu', 'Station A', 'Station B', 'Calais'];
  const legs = names.slice(0, -1).map((name, index) => leg({
    id: `closest-${index}`,
    origin: name,
    destination: names[index + 1],
    dep: `${String(6 + index * 2).padStart(2, '0')}:00`,
    arr: `${String(7 + index * 2).padStart(2, '0')}:00`
  }));
  const stops = names.map((stop_name, index) => ({ stop_name, stop_lat: String(45 + index / 10), stop_lon: String(4 + index / 10) }));
  const result = findClosestJourneys(legs, names[0], names.at(-1), day, day, stops, 5, day, null, {
    includeDiagnostics: true,
    searchLimits: { expanded: 1, frontier: 10 }
  });

  assert.ok(Array.isArray(result.journeys));
  assert.equal(result.searchDiagnostics.expanded, 1);
  assert.equal(result.searchDiagnostics.truncated, true);
});

test('main route search supports four changes and caps at four', () => {
  const names = ['Station A', 'Station B', 'Station C', 'Station D', 'Station E', 'Station F', 'Station G'];
  const legs = names.slice(0, -1).map((name, index) => leg({
    id: `chain-${index}`,
    origin: name,
    destination: names[index + 1],
    dep: `${String(6 + index * 2).padStart(2, '0')}:00`,
    arr: `${String(7 + index * 2).padStart(2, '0')}:00`
  }));
  const fourChanges = findJourneys(legs.slice(0, 5), names[0], names[5], day, day, 8, day);
  const fiveChanges = findJourneys(legs, names[0], names[6], day, day, 8, day);
  assert.ok(fourChanges.maxFirst.some(journey => journey.changes === 4));
  assert.equal(fiveChanges.maxFirst.length, 0);
});

test('main route search treats adjacent sections of the same train as a through service', () => {
  const legs = [
    leg({ id: 'max-section-a', tripId: 'max-5380', train: '5380', origin: 'Lyon Part Dieu', destination: 'Dijon', dep: '06:00', arr: '07:30' }),
    leg({ id: 'max-section-b', tripId: 'max-5380', train: '5380', origin: 'Dijon', destination: 'Auxonne', dep: '07:45', arr: '08:00' }),
    leg({ id: 'max-section-c', tripId: 'max-5380', train: '5380', origin: 'Auxonne', destination: 'Paris Gare de Lyon', dep: '08:15', arr: '09:00' })
  ];

  const result = findJourneys(legs, 'Lyon Part Dieu', 'Paris Gare de Lyon', day, day, 8, day);
  const scanned = findJourneys(legs, 'Lyon Part Dieu', 'Paris Gare de Lyon', day, day, 8, day, null, { router: 'csa' });

  assert.ok(result.maxFirst.some(journey => journey.legs.length === 3 && journey.changes === 0));
  assert.ok(scanned.maxFirst.some(journey => journey.legs.length === 3 && journey.changes === 0));
  assert.equal(result.searchDiagnostics.truncated, false);
});

test('main route search preserves the minimum change count across exhaustive small directed graphs', () => {
  const names = ['Origin', 'A', 'B', 'C', 'D', 'E', 'Destination'];
  for (let seed = 0; seed < 12; seed++) {
    const legs = [];
    for (let from = 0; from < names.length - 1; from++) {
      for (let to = from + 1; to < names.length; to++) {
        if (to !== from + 1 && (from * 3 + to * 5 + seed) % 4 === 0) continue;
        const hour = 6 + from * 2;
        legs.push(leg({
          id: `s${seed}-${from}-${to}`,
          origin: names[from],
          destination: names[to],
          dep: `${String(hour).padStart(2, '0')}:00`,
          arr: `${String(hour + 1).padStart(2, '0')}:00`
        }));
      }
    }

    let exhaustiveMinimum = Infinity;
    const walk = (station, path) => {
      if (station === 'Destination') {
        exhaustiveMinimum = Math.min(exhaustiveMinimum, path.length - 1);
        return;
      }
      if (path.length === 5) return;
      for (const next of legs.filter(item => item.origin === station)) {
        if (path.length && next.from - path.at(-1).to < 45 * 60000) continue;
        walk(next.destination, [...path, next]);
      }
    };
    walk('Origin', []);

    const result = findJourneys(legs, 'Origin', 'Destination', day, day, 100, day);
    const scanned = findJourneys(legs, 'Origin', 'Destination', day, day, 100, day, null, { router: 'csa', maxExpanded: null, maxFrontier: null });
    assert.equal(Math.min(...result.maxFirst.map(journey => journey.changes), Infinity), exhaustiveMinimum, `seed ${seed}`);
    assert.equal(Math.min(...scanned.maxFirst.map(journey => journey.changes), Infinity), exhaustiveMinimum, `CSA seed ${seed}`);
    assert.equal(scanned.searchDiagnostics.truncated, false, `CSA should not hit the legacy expansion cap for seed ${seed}`);
    assert.ok(scanned.searchDiagnostics.expanded > 1 || exhaustiveMinimum === Infinity, `CSA did not scan enough connections for seed ${seed}`);
    assert.equal(result.searchDiagnostics.truncated, false, `seed ${seed} should fit within the search budget`);
  }
});

test('route search reports when a configurable expansion safety limit truncates exploration', () => {
  const legs = [
    leg({ id: 'to-hub', origin: 'Lyon Part Dieu', destination: 'Paris Gare de Lyon', dep: '06:00', arr: '08:00' }),
    leg({ id: 'hub-a', origin: 'Paris Gare de Lyon', destination: 'Lille Europe', dep: '09:00', arr: '10:00' }),
    leg({ id: 'hub-b', origin: 'Paris Gare de Lyon', destination: 'Rennes', dep: '09:30', arr: '11:00' }),
    leg({ id: 'a-target', origin: 'Lille Europe', destination: 'Bordeaux', dep: '11:00', arr: '13:00' }),
    leg({ id: 'b-target', origin: 'Rennes', destination: 'Bordeaux', dep: '12:00', arr: '14:00' })
  ];
  const result = findJourneys(legs, 'Lyon Part Dieu', 'Bordeaux', day, day, 8, day, null, { maxExpanded: 1 });
  assert.equal(result.searchDiagnostics.truncated, true);
  assert.equal(result.searchDiagnostics.expanded, 1);
  assert.equal(result.searchDiagnostics.limits.expanded, 1);
});

test('explicit null search limits disable expansion and frontier caps', () => {
  const legs = [
    leg({ id: 'approach', origin: 'Origin', destination: 'Hub', dep: '06:00', arr: '07:00' }),
    leg({ id: 'branch-a', origin: 'Hub', destination: 'A', dep: '08:00', arr: '09:00' }),
    leg({ id: 'branch-b', origin: 'Hub', destination: 'B', dep: '08:30', arr: '09:30' }),
    leg({ id: 'target', origin: 'A', destination: 'Destination', dep: '10:00', arr: '11:00' }),
    leg({ id: 'target-b', origin: 'B', destination: 'Destination', dep: '10:30', arr: '11:30' })
  ];

  const result = findJourneys(legs, 'Origin', 'Destination', day, day, 8, day, null, {
    maxExpanded: null,
    maxFrontier: null,
    maxSegments: 30
  });

  assert.equal(result.searchDiagnostics.truncated, false);
  assert.equal(result.searchDiagnostics.limits.expanded, null);
  assert.equal(result.searchDiagnostics.limits.frontier, null);
  assert.equal(result.maxFirst.length, 2);
});

test('connection-scan Plan router honors configured expansion and frontier caps', () => {
  const legs = [
    leg({ id: 'approach', origin: 'Origin', destination: 'Hub', dep: '06:00', arr: '07:00' }),
    leg({ id: 'branch-a', origin: 'Hub', destination: 'A', dep: '08:00', arr: '09:00' }),
    leg({ id: 'branch-b', origin: 'Hub', destination: 'B', dep: '08:30', arr: '09:30' }),
    leg({ id: 'target-a', origin: 'A', destination: 'Destination', dep: '10:00', arr: '11:00' }),
    leg({ id: 'target-b', origin: 'B', destination: 'Destination', dep: '10:30', arr: '11:30' })
  ];

  const expansionLimited = findJourneys(legs, 'Origin', 'Destination', day, day, 8, day, null, {
    router: 'csa', maxExpanded: 1, maxFrontier: null, maxSegments: 3
  });
  assert.equal(expansionLimited.searchDiagnostics.expanded, 1);
  assert.ok(expansionLimited.searchDiagnostics.truncationReasons.includes('expansion limit'));

  const frontierLimited = findJourneys(legs, 'Origin', 'Destination', day, day, 8, day, null, {
    router: 'csa', maxExpanded: null, maxFrontier: 1, maxSegments: 3
  });
  assert.equal(frontierLimited.searchDiagnostics.frontierPeak, 1);
  assert.ok(frontierLimited.searchDiagnostics.frontierCandidatesPeak > 1);
  assert.ok(frontierLimited.searchDiagnostics.truncationReasons.includes('frontier limit'));
});

test('frontier cap is applied during generation while later target routes are still collected', () => {
  const legs = [
    leg({ id: 'approach', origin: 'Origin', destination: 'Hub', dep: '06:00', arr: '07:00' }),
    leg({ id: 'branch-a', origin: 'Hub', destination: 'A', dep: '08:00', arr: '09:00' }),
    leg({ id: 'branch-b', origin: 'Hub', destination: 'B', dep: '08:30', arr: '09:30' }),
    leg({ id: 'target', origin: 'Hub', destination: 'Destination', dep: '09:00', arr: '10:00' })
  ];

  const result = findJourneys(legs, 'Origin', 'Destination', day, day, 8, day, null, {
    maxExpanded: 100,
    maxFrontier: 1,
    maxSegments: 3
  });

  assert.equal(result.searchDiagnostics.frontierPeak, 1);
  assert.equal(result.searchDiagnostics.frontierCandidatesPeak, 2);
  assert.ok(result.searchDiagnostics.truncationReasons.includes('frontier limit'));
  assert.ok(result.maxFirst.some(journey => journey.legs.at(-1).id === 'target'));
});

test('main route search does not stop early on raw journey count', () => {
  const legs = Array.from({ length: 5 }, (_, index) => leg({
    id: `approach-${index}`,
    tripId: `approach-${index}`,
    origin: 'Origin',
    destination: 'Hub',
    dep: '06:00',
    arr: '06:10'
  }));
  for (let index = 0; index <= 1000; index++) {
    const minutes = 7 * 60 + index;
    const dep = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const arrival = minutes + 1;
    const arr = `${String(Math.floor(arrival / 60)).padStart(2, '0')}:${String(arrival % 60).padStart(2, '0')}`;
    legs.push(leg({ id: `target-${index}`, tripId: `target-${index}`, origin: 'Hub', destination: 'Destination', dep, arr }));
  }

  const result = findJourneys(legs, 'Origin', 'Destination', day, day, 8, day, null, {
    maxExpanded: 5000,
    maxFrontier: 10000,
    maxSegments: 2
  });

  assert.equal(result.searchDiagnostics.expanded, 5000);
  assert.deepEqual(result.searchDiagnostics.truncationReasons, ['expansion limit']);
  assert.ok(result.maxFirst.length > 0);
});

test('route search prunes a dominated reconverging label without losing the journey', () => {
  const legs = [
    leg({ id: 'approach-x', tripId: 'approach', origin: 'Origin', destination: 'X', dep: '06:00', arr: '07:00' }),
    leg({ id: 'approach-y', tripId: 'approach', origin: 'Origin', destination: 'Y', dep: '06:00', arr: '07:30' }),
    leg({ id: 'connection-x', tripId: 'connection', train: 'shared-connection', origin: 'X', destination: 'Hub', dep: '07:30', arr: '08:30' }),
    leg({ id: 'connection-y', tripId: 'connection', train: 'shared-connection', origin: 'Y', destination: 'Hub', dep: '08:00', arr: '08:30' }),
    leg({ id: 'final', tripId: 'final', origin: 'Hub', destination: 'Destination', dep: '09:00', arr: '10:00' })
  ];

  const result = findJourneys(legs, 'Origin', 'Destination', day, day, 8, day);
  const scanned = findJourneys(legs, 'Origin', 'Destination', day, day, 8, day, null, { router: 'csa' });

  assert.equal(result.maxFirst.length, 1);
  assert.deepEqual(result.maxFirst[0].legs.map(item => item.id), ['approach-x', 'connection-x', 'final']);
  assert.ok(result.searchDiagnostics.labelsPruned > 0);
  assert.equal(scanned.maxFirst.length, 1);
  assert.deepEqual(scanned.maxFirst[0].legs.map(item => item.id), ['approach-x', 'connection-x', 'final']);
  assert.ok(scanned.searchDiagnostics.labelsPruned > 0);
});

test('finite maximum connection waits disable route-label pruning', () => {
  const legs = [
    leg({ id: 'approach-x', tripId: 'approach', origin: 'Origin', destination: 'X', dep: '06:00', arr: '07:00' }),
    leg({ id: 'approach-y', tripId: 'approach', origin: 'Origin', destination: 'Y', dep: '06:00', arr: '07:30' }),
    leg({ id: 'connection-x', tripId: 'connection', train: 'shared-connection', origin: 'X', destination: 'Hub', dep: '07:30', arr: '08:30' }),
    leg({ id: 'connection-y', tripId: 'connection', train: 'shared-connection', origin: 'Y', destination: 'Hub', dep: '08:00', arr: '08:30' }),
    leg({ id: 'final', tripId: 'final', origin: 'Hub', destination: 'Destination', dep: '09:00', arr: '10:00' })
  ];
  const connectionSettings = { mode: 'none', rules: null, minimumMinutes: null, maximumMinutes: 300 };

  const result = findJourneys(legs, 'Origin', 'Destination', day, day, 8, day, connectionSettings);
  const scanned = findJourneys(legs, 'Origin', 'Destination', day, day, 8, day, connectionSettings, { router: 'csa' });

  assert.equal(result.maxFirst.length, 2);
  assert.equal(result.searchDiagnostics.labelsPruned, 0);
  assert.equal(scanned.maxFirst.length, 2);
  assert.equal(scanned.searchDiagnostics.truncated, false);
});

test('route expansion skips departures that have already left before scanning connections', () => {
  const staleConnections = Array.from({ length: 30 }, (_, index) => {
    const hour = String(Math.floor(index / 6) + 4).padStart(2, '0');
    const minute = String((index % 6) * 10).padStart(2, '0');
    const dep = `${hour}:${minute}`;
    const arrHour = String(Number(hour) + 1).padStart(2, '0');
    return leg({ id: `stale-${index}`, origin: 'Hub', destination: `Elsewhere ${index}`, dep, arr: `${arrHour}:${minute}` });
  });
  const legs = [
    leg({ id: 'approach', origin: 'Origin', destination: 'Hub', dep: '09:00', arr: '10:00' }),
    ...staleConnections,
    leg({ id: 'valid', origin: 'Hub', destination: 'Destination', dep: '11:00', arr: '12:00' })
  ];

  const result = findJourneys(legs, 'Origin', 'Destination', day, day, 8, day);

  assert.equal(result.maxFirst.length, 1);
  assert.deepEqual(result.maxFirst[0].legs.map(item => item.id), ['approach', 'valid']);
  assert.equal(result.searchDiagnostics.expanded, 1, 'only the chronologically usable departure should count as an expansion');
});

test('same-day route pairing removes returns with less than 30 minutes at destination', () => {
  const outbound = { legs: [{ id: 'out' }], arrival: at(day, '08:00') };
  const tooSoon = { legs: [{ id: 'back-early' }], departure: at(day, '08:29'), arrival: at(day, '10:00') };
  const valid = { legs: [{ id: 'back-valid' }], departure: at(day, '08:30'), arrival: at(day, '10:00') };
  const result = { maxFirst: [outbound], nightTrains: [], ouigoCandidates: [], fastest: outbound };
  const back = { maxFirst: [tooSoon, valid], nightTrains: [], ouigoCandidates: [], fastest: valid };
  assert.equal(alignSameDay(result, back, true), null);
  assert.deepEqual(back.maxFirst, [valid]);
});

test('same-day route pairing excludes a return arriving the following day', () => {
  const outbound = { legs: [{ id: 'out' }], arrival: at(day, '08:00') };
  const overnightReturn = {
    legs: [{ id: 'back-overnight' }],
    departure: at(day, '23:00'),
    arrival: at('2026-10-09', '01:00')
  };
  const out = { maxFirst: [outbound], nightTrains: [], ouigoCandidates: [], fastest: outbound };
  const back = { maxFirst: [overnightReturn], nightTrains: [], ouigoCandidates: [], fastest: overnightReturn };

  assert.match(alignSameDay(out, back, true), /No same-day pair/);
  assert.deepEqual(out.maxFirst, [outbound]);
  assert.deepEqual(back.maxFirst, [overnightReturn]);
});

test('same-day route pairing warns and preserves directions if no pair is feasible', () => {
  const outbound = { legs: [{ id: 'out' }], arrival: at(day, '08:00') };
  const returning = { legs: [{ id: 'back' }], departure: at(day, '08:29') };
  const out = { maxFirst: [outbound], nightTrains: [], ouigoCandidates: [], fastest: outbound };
  const back = { maxFirst: [returning], nightTrains: [], ouigoCandidates: [], fastest: returning };
  assert.match(alignSameDay(out, back, true), /No same-day pair/);
  assert.deepEqual(out.maxFirst, [outbound]);
  assert.deepEqual(back.maxFirst, [returning]);
});
