import { parentPort } from 'node:worker_threads';
import {
  alignSameDay,
  findClosestJourneys,
  findJourneys,
  findReachableDestinationOptions,
  findReachableDestinations
} from './planner.js';

function execute(task, payload) {
  if (task === 'journey-search') {
    const {
      legs, origin, destination, outboundDate, outboundEndDate, returnDate, returnEnd,
      transferSettings, includePaid, includeClosest, stops, searchLimits
    } = payload;
    const searchLegs = legs.filter(leg => (includePaid || !leg.paid) && (payload.includeOuigo || !leg.maxEligibilityUnknown));
    const planResultLimit = 25;
    const outbound = findJourneys(searchLegs, origin, destination, outboundDate, outboundEndDate, planResultLimit, outboundDate, transferSettings, searchLimits);
    const returning = returnDate ? findJourneys(searchLegs, destination, origin, returnDate, returnEnd, planResultLimit, returnDate, transferSettings, searchLimits) : null;
    const closestDiagnostics = {};
    if (!includePaid && includeClosest) {
      if (!outbound.maxFirst.some(journey => journey.maxLegs === journey.legs.length) && !outbound.ouigoCandidates.length) {
        const closest = findClosestJourneys(searchLegs, origin, destination, outboundDate, returnDate, stops, 5, outboundDate, transferSettings, { includeDiagnostics: true, searchLimits });
        outbound.closest = closest.journeys;
        closestDiagnostics.outbound = closest.searchDiagnostics;
      }
      if (returning && !returning.maxFirst.some(journey => journey.maxLegs === journey.legs.length) && !returning.ouigoCandidates.length) {
        const closest = findClosestJourneys(searchLegs, destination, origin, returnDate, returnEnd, stops, 5, returnDate, transferSettings, { includeDiagnostics: true, searchLimits });
        returning.closest = closest.journeys;
        closestDiagnostics.returning = closest.searchDiagnostics;
      }
    }
    const dayTripWarning = returning ? alignSameDay(outbound, returning, outboundDate === returnDate) : null;
    return {
      outbound,
      returning,
      dayTripWarning,
      routeSearchDiagnostics: {
        outbound: outbound.searchDiagnostics,
        ...(returning ? { returning: returning.searchDiagnostics } : {}),
        ...(Object.keys(closestDiagnostics).length ? { closest: closestDiagnostics } : {})
      }
    };
  }

  if (task === 'discovery') {
    return findReachableDestinations(payload.records, payload.stops, payload.origin, payload.date, {
      mode: payload.mode,
      returnDate: payload.returnDate,
      changes: payload.changes,
      departureCutoff: payload.departureCutoff,
      connectionSettings: payload.connectionSettings,
      minimumStayMinutes: payload.minimumStayMinutes,
      searchLimits: payload.searchLimits,
      router: payload.mode === 'oneway' ? 'csa' : 'legacy',
      includeDiagnostics: true
    });
  }

  if (task === 'discovery-times') {
    return findReachableDestinationOptions(payload.records, payload.origin, payload.destination, payload.date, {
      mode: payload.mode,
      returnDate: payload.returnDate,
      changes: payload.changes,
      limit: 12,
      departureCutoff: payload.departureCutoff,
      connectionSettings: payload.connectionSettings,
      minimumStayMinutes: payload.minimumStayMinutes,
      searchLimits: payload.searchLimits,
      includeDiagnostics: true
    });
  }

  throw new Error(`Unknown route search task: ${task}`);
}

parentPort.on('message', ({ id, task, payload }) => {
  try {
    parentPort.postMessage({ id, result: execute(task, payload) });
  } catch (error) {
    parentPort.postMessage({ id, error: { message: error.message, stack: error.stack } });
  }
});
