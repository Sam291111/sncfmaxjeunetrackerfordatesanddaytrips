export const DEFAULT_ROUTE_SEARCH_EFFORT = 'thorough';

const SEARCH_EFFORTS = Object.freeze({
  quick: Object.freeze({
    expanded: 60000,
    frontier: 12000,
    returnExpanded: 12000,
    returnFrontier: 5000,
    segments: 30
  }),
  thorough: Object.freeze({
    expanded: 240000,
    frontier: 48000,
    returnExpanded: 48000,
    returnFrontier: 20000,
    segments: 30
  }),
  uncapped: Object.freeze({
    expanded: null,
    frontier: null,
    returnExpanded: null,
    returnFrontier: null,
    segments: 30
  })
});

const DAYTRIP_THOROUGH_LIMITS = Object.freeze({
  expanded: 480000,
  frontier: 72000,
  returnExpanded: 96000,
  returnFrontier: 30000,
  segments: 30
});

export function routeSearchSettings(value = DEFAULT_ROUTE_SEARCH_EFFORT, { mode = null } = {}) {
  const requestedEffort = value || DEFAULT_ROUTE_SEARCH_EFFORT;
  const effort = requestedEffort === 'balanced' ? 'quick' : requestedEffort === 'extensive' ? 'thorough' : requestedEffort;
  const profile = Object.hasOwn(SEARCH_EFFORTS, effort) ? SEARCH_EFFORTS[effort] : null;
  if (!profile) throw Error('Route search effort must be quick, thorough or uncapped.');
  const limitsProfile = effort === 'thorough' && mode === 'daytrip' ? DAYTRIP_THOROUGH_LIMITS : profile;

  return {
    effort,
    limits: {
      ...limitsProfile,
      // The main journey planner uses max-prefixed names; Explore uses the
      // shorter names. Keep both forms in one validated profile.
      maxExpanded: limitsProfile.expanded,
      maxFrontier: limitsProfile.frontier,
      maxSegments: limitsProfile.segments
    }
  };
}
