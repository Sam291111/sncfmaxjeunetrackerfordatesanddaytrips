import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { formatParisTime, parisDateKey, serviceTimeToDate } from '../time.js';

test('service-day times use Paris instants across the autumn clock change', () => {
  const departure = serviceTimeToDate('2026-10-24', '22:00');
  const arrival = serviceTimeToDate('2026-10-25', '06:00');
  assert.equal(departure.toISOString(), '2026-10-24T20:00:00.000Z');
  assert.equal(arrival.toISOString(), '2026-10-25T05:00:00.000Z');
  assert.equal((arrival - departure) / 3600000, 9);
  assert.equal(formatParisTime(arrival), '06:00');
});

test('ambiguous and skipped Paris wall times resolve deterministically', () => {
  const repeated = serviceTimeToDate('2026-10-25', '02:30');
  const skipped = serviceTimeToDate('2026-03-29', '02:30');
  assert.equal(repeated.toISOString(), '2026-10-25T00:30:00.000Z');
  assert.equal(formatParisTime(repeated), '02:30');
  assert.equal(formatParisTime(skipped), '03:30');
  assert.equal(parisDateKey(skipped), '2026-03-29');
});

test('Paris service times are unchanged when the host machine uses another timezone', () => {
  const script = `import {serviceTimeToDate,formatParisTime,parisDateKey} from './time.js'; const a=serviceTimeToDate('2026-10-24','22:00'); const b=serviceTimeToDate('2026-10-25','06:00'); process.stdout.write([a.toISOString(),b.toISOString(),formatParisTime(b),parisDateKey(b)].join('|'));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    env: { ...process.env, TZ: 'America/Los_Angeles' },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '2026-10-24T20:00:00.000Z|2026-10-25T05:00:00.000Z|06:00|2026-10-25');
});
