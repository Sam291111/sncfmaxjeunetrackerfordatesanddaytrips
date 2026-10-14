import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ROUTE_SEARCH_EFFORT, routeSearchSettings } from '../route-search-settings.js';

test('route search defaults to a higher thorough budget', () => {
  const settings = routeSearchSettings();

  assert.equal(DEFAULT_ROUTE_SEARCH_EFFORT, 'thorough');
  assert.equal(settings.effort, 'thorough');
  assert.equal(settings.limits.frontier, 48000);
  assert.equal(settings.limits.expanded, 240000);
  assert.equal(settings.limits.maxFrontier, settings.limits.frontier);
  assert.equal(settings.limits.maxExpanded, settings.limits.expanded);
});

test('quick and thorough route search profiles keep consistent planner limits', () => {
  const quick = routeSearchSettings('quick').limits;
  const thorough = routeSearchSettings('thorough').limits;
  const daytripThorough = routeSearchSettings('thorough', { mode: 'daytrip' }).limits;
  const uncapped = routeSearchSettings('uncapped').limits;

  assert.deepEqual([quick.frontier, quick.expanded], [12000, 60000]);
  assert.deepEqual([thorough.frontier, thorough.expanded], [48000, 240000]);
  assert.deepEqual([routeSearchSettings('balanced').effort, routeSearchSettings('extensive').effort], ['quick', 'thorough']);
  assert.equal(thorough.returnFrontier, 20000);
  assert.deepEqual(
    [daytripThorough.expanded, daytripThorough.frontier, daytripThorough.returnExpanded, daytripThorough.returnFrontier],
    [480000, 72000, 96000, 30000]
  );
  assert.equal(routeSearchSettings('quick', { mode: 'daytrip' }).limits.expanded, quick.expanded);
  assert.equal(routeSearchSettings('thorough', { mode: 'return' }).limits.expanded, thorough.expanded);
  assert.equal(uncapped.expanded, null);
  assert.equal(uncapped.frontier, null);
  assert.equal(uncapped.returnExpanded, null);
  assert.equal(uncapped.returnFrontier, null);
  assert.equal(uncapped.segments, 30);
});

test('route search rejects unsupported effort values', () => {
  assert.throws(() => routeSearchSettings('unlimited'), /quick, thorough or uncapped/);
});
