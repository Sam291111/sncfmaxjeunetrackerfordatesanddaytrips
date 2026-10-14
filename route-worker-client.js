import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';

const MAX_CONCURRENT_ROUTE_WORKERS = 2;
let activeWorkers = 0;
const waitingTasks = [];

function abortError() {
  return Object.assign(new Error('Route search was cancelled.'), { name: 'AbortError' });
}

function acquireWorkerSlot(signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (activeWorkers < MAX_CONCURRENT_ROUTE_WORKERS && waitingTasks.length === 0) {
    activeWorkers++;
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const task = { resolve, reject, signal, onAbort: null };
    task.onAbort = () => {
      const index = waitingTasks.indexOf(task);
      if (index >= 0) waitingTasks.splice(index, 1);
      reject(abortError());
    };
    signal?.addEventListener('abort', task.onAbort, { once: true });
    waitingTasks.push(task);
  });
}

function releaseWorkerSlot() {
  activeWorkers = Math.max(0, activeWorkers - 1);
  while (waitingTasks.length) {
    const task = waitingTasks.shift();
    task.signal?.removeEventListener('abort', task.onAbort);
    if (task.signal?.aborted) {
      task.reject(abortError());
      continue;
    }
    activeWorkers++;
    task.resolve();
    return;
  }
}

export async function runRouteTask(task, payload, { signal } = {}) {
  await acquireWorkerSlot(signal);
  if (signal?.aborted) {
    releaseWorkerSlot();
    throw abortError();
  }

  let worker;
  try {
    worker = new Worker(new URL('./route-worker.js', import.meta.url), { type: 'module' });
  } catch (error) {
    releaseWorkerSlot();
    throw error;
  }
  const id = randomUUID();

  return new Promise((resolve, reject) => {
    let settled = false;
    const startedAt = performance.now();
    const memoryBefore = process.memoryUsage();
    let peakRss = memoryBefore.rss;
    const memorySampler = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 100);
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      worker.removeAllListeners();
      void (async () => {
        let finalError = error;
        try {
          await worker.terminate();
        } catch (terminationError) {
          finalError ||= terminationError;
        } finally {
          peakRss = Math.max(peakRss, process.memoryUsage().rss);
          clearInterval(memorySampler);
          releaseWorkerSlot();
        }
        const memoryAfter = process.memoryUsage();
        const workerMetrics = {
          durationMs: Math.round(performance.now() - startedAt),
          processRssBeforeMiB: Math.round(memoryBefore.rss / 1024 / 1024),
          processRssPeakMiB: Math.round(peakRss / 1024 / 1024),
          processRssAfterMiB: Math.round(memoryAfter.rss / 1024 / 1024),
          processHeapAfterMiB: Math.round(memoryAfter.heapUsed / 1024 / 1024),
          processRssSampleIntervalMs: 100
        };
        if (finalError) reject(finalError);
        else {
          if (result && typeof result === 'object') result.workerMetrics = workerMetrics;
          resolve(result);
        }
      })();
    };
    const onAbort = () => finish(abortError());

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.once('message', message => {
      if (message?.id !== id) return finish(new Error('Route worker returned an unexpected response.'));
      if (message.error) {
        const error = new Error(message.error.message || 'Route worker failed.');
        if (message.error.stack) error.stack = message.error.stack;
        finish(error);
      } else finish(null, message.result);
    });
    worker.once('error', error => finish(error));
    worker.once('exit', code => {
      if (!settled) finish(new Error(`Route worker exited before returning results (code ${code}).`));
    });
    try {
      worker.postMessage({ id, task, payload });
    } catch (error) {
      finish(error);
    }
  });
}
