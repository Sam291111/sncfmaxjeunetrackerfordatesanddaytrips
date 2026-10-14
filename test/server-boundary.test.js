import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PORT = '0';
process.env.SAMPLE_DATA = '1';

const { handleRequest } = await import('../server.js');

async function request(url, { method = 'GET', host = '127.0.0.1', fetchSite } = {}) {
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))); },
    end(body = '') { this.body = body; }
  };
  await handleRequest({ headers: { host, 'sec-fetch-site': fetchSite }, method, url }, response);
  return { ...response, json: () => JSON.parse(response.body || 'null') };
}

test('local server rejects a foreign Host header', async () => {
  const response = await request('/api/health', { host: 'planner.example:3000' });
  assert.equal(response.status, 403);
});

test('local API rejects unsupported methods', async () => {
  const response = await request('/api/health', { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, 'GET, HEAD');
});

test('local API rejects browser cross-site fetches', async () => {
  const response = await request('/api/health', { fetchSite: 'cross-site' });
  assert.equal(response.status, 403);
});

test('route search returns a client error for invalid dates', async () => {
  const response = await request('/api/search?origin=Lyon%20Part%20Dieu&destination=Paris&outbound=2026-02-30&return=2026-03-01');
  assert.equal(response.status, 400);
  assert.match(response.json().error, /valid travel dates/i);
});

test('route search validates connection options before loading timetable data', async () => {
  const response = await request('/api/search?origin=Lyon%20Part%20Dieu&destination=Paris&outbound=2026-10-12&return=2026-10-12&minConnectionMode=manual&minConnectionMinutes=999');
  assert.equal(response.status, 400);
  assert.match(response.json().error, /0 to 240 minutes/i);
});

test('sample route search still responds successfully through the request handler', async () => {
  const response = await request('/api/search?origin=Lyon%20Part%20Dieu&destination=Paris%20Gare%20de%20Lyon&outbound=2026-10-08&return=2026-10-08');
  assert.equal(response.status, 200);
  const result = response.json();
  assert.ok(result.outbound);
  assert.ok(result.returning);
  assert.ok(result.routeSearchDiagnostics?.outbound);
  assert.equal(result.settings.searchEffort, 'thorough');
  assert.equal(result.routeSearchDiagnostics.outbound.limits.expanded, 240000);
  assert.equal(result.routeSearchDiagnostics.outbound.limits.frontier, 48000);
});

test('quick route search effort can be selected through the planner API', async () => {
  const response = await request('/api/search?origin=Lyon%20Part%20Dieu&destination=Paris%20Gare%20de%20Lyon&outbound=2026-10-08&mode=oneway&searchEffort=quick');
  assert.equal(response.status, 200);
  const result = response.json();
  assert.equal(result.settings.searchEffort, 'quick');
  assert.equal(result.routeSearchDiagnostics.outbound.limits.expanded, 60000);
  assert.equal(result.routeSearchDiagnostics.outbound.limits.frontier, 12000);
});

test('uncapped route search can be selected through the planner API', async () => {
  const response = await request('/api/search?origin=Lyon%20Part%20Dieu&destination=Paris%20Gare%20de%20Lyon&outbound=2026-10-08&mode=oneway&searchEffort=uncapped');
  assert.equal(response.status, 200);
  const result = response.json();
  assert.equal(result.settings.searchEffort, 'uncapped');
  assert.equal(result.routeSearchDiagnostics.outbound.limits.expanded, null);
  assert.equal(result.routeSearchDiagnostics.outbound.limits.frontier, null);
});

test('planner API rejects unsupported route search effort values', async () => {
  const response = await request('/api/search?origin=Lyon%20Part%20Dieu&destination=Paris&outbound=2026-10-08&mode=oneway&searchEffort=unlimited');
  assert.equal(response.status, 400);
  assert.match(response.json().error, /quick, thorough or uncapped/i);
});

test('main planner supports one-way searches without requiring a return date', async () => {
  const response = await request('/api/search?origin=Lyon%20Part%20Dieu&destination=Paris%20Gare%20de%20Lyon&outbound=2026-10-08&mode=oneway');
  assert.equal(response.status, 200);
  const result = response.json();
  assert.equal(result.mode, 'oneway');
  assert.ok(result.outbound);
  assert.equal(result.returning, null);
  assert.equal(result.routeSearchDiagnostics?.returning, undefined);
});

test('main planner rejects unsupported trip types', async () => {
  const response = await request('/api/search?origin=Lyon&destination=Paris&outbound=2026-10-12&mode=multiway');
  assert.equal(response.status, 400);
  assert.match(response.json().error, /one-way or return/i);
});

test('Explore API includes search coverage diagnostics', async () => {
  const response = await request('/api/discovery?origin=Lyon%20Part%20Dieu&date=2026-10-08&changes=0,1');
  assert.equal(response.status, 200);
  const result = response.json();
  assert.ok(Array.isArray(result.destinations));
  assert.ok(result.routeSearchDiagnostics?.search);
});

test('Thorough day-trip Explore gets its larger bounded search budget and reports worker memory', async () => {
  const response = await request('/api/discovery?origin=Lyon%20Part%20Dieu&date=2026-10-08&mode=daytrip&changes=0,1&searchEffort=thorough');
  assert.equal(response.status, 200);
  const result = response.json();
  assert.equal(result.routeSearchDiagnostics.search.limits.expanded, 480000);
  assert.equal(result.routeSearchDiagnostics.search.limits.frontier, 72000);
  assert.equal(result.routeSearchDiagnostics.search.limits.returnExpanded, 96000);
  assert.equal(result.routeSearchDiagnostics.search.limits.returnFrontier, 30000);
  assert.ok(result.routeSearchDiagnostics.worker.processRssPeakMiB >= result.routeSearchDiagnostics.worker.processRssBeforeMiB);
});

test('additional-times API includes search coverage diagnostics', async () => {
  const response = await request('/api/discovery/times?origin=Lyon%20Part%20Dieu&destination=Avignon%20TGV&date=2026-10-08&changes=0,1');
  assert.equal(response.status, 200);
  const result = response.json();
  assert.ok(Array.isArray(result.options));
  assert.ok(result.routeSearchDiagnostics?.search);
});

test('uncapped effort reaches both Explore search endpoints', async () => {
  const discovery = await request('/api/discovery?origin=Lyon%20Part%20Dieu&date=2026-10-08&changes=0,1&searchEffort=uncapped');
  const times = await request('/api/discovery/times?origin=Lyon%20Part%20Dieu&destination=Avignon%20TGV&date=2026-10-08&changes=0,1&searchEffort=uncapped');
  assert.equal(discovery.status, 200);
  assert.equal(times.status, 200);
  assert.equal(discovery.json().routeSearchDiagnostics.search.limits.expanded, null);
  assert.equal(discovery.json().routeSearchDiagnostics.search.limits.frontier, null);
  assert.equal(times.json().routeSearchDiagnostics.search.limits.expanded, null);
  assert.equal(times.json().routeSearchDiagnostics.search.limits.frontier, null);
});

test('discovery rejects an invalid mode and malformed change list', async () => {
  const invalidMode = await request('/api/discovery?origin=Lyon&date=2026-10-12&mode=overnight');
  const invalidChanges = await request('/api/discovery?origin=Lyon&date=2026-10-12&changes=0,9');
  assert.equal(invalidMode.status, 400);
  assert.equal(invalidChanges.status, 400);
});

test('explore rejects return dates outside the MAX availability window', async () => {
  const response = await request('/api/discovery?origin=Lyon&date=2026-10-12&mode=return&returnDate=2026-11-10');
  assert.equal(response.status, 400);
  assert.match(response.json().error, /28 days/i);
});

test('API responses carry no-store and content-type safety headers', async () => {
  const response = await request('/api/health');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
});
