import test from 'node:test';
import assert from 'node:assert/strict';
import { runRouteTask } from '../route-worker-client.js';

const payload = {
  records: [],
  stops: [],
  origin: 'Lyon Part Dieu',
  date: '2026-10-08',
  mode: 'oneway',
  changes: [0]
};

test('aborting a queued route task leaves worker capacity available', async () => {
  const first = runRouteTask('discovery', payload);
  const second = runRouteTask('discovery', payload);
  const controller = new AbortController();
  const queued = runRouteTask('discovery', payload, { signal: controller.signal });

  controller.abort();
  await assert.rejects(queued, { name: 'AbortError' });

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(firstResult.destinations, []);
  assert.deepEqual(secondResult.destinations, []);
  assert.ok(firstResult.workerMetrics.durationMs >= 0);
  assert.ok(firstResult.workerMetrics.processRssPeakMiB >= firstResult.workerMetrics.processRssBeforeMiB);
  assert.ok(secondResult.workerMetrics.processRssAfterMiB > 0);

  const followUp = await runRouteTask('discovery', payload);
  assert.deepEqual(followUp.destinations, []);
  assert.ok(followUp.workerMetrics.processRssPeakMiB >= followUp.workerMetrics.processRssBeforeMiB);
});
