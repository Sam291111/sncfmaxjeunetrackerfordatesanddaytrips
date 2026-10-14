const PARIS_TIME_ZONE = 'Europe/Paris';

const parisFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: PARIS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});
const displayTimeFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: PARIS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});
const SERVICE_TIME_CACHE_LIMIT = 100_000;
const serviceTimeCache = new Map();

function validDateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  const check = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (check.getUTCFullYear() !== parts[0] || check.getUTCMonth() + 1 !== parts[1] || check.getUTCDate() !== parts[2]) return null;
  return parts;
}

function dateTimeParts(timestamp) {
  const values = Object.fromEntries(parisFormatter.formatToParts(timestamp).map(part => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second };
}

function parisOffsetAt(timestamp) {
  const parts = dateTimeParts(timestamp);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - timestamp;
}

/** Parse a timetable clock as a Europe/Paris service time, independent of host TZ. */
export function serviceTimeToDate(serviceDate, clock) {
  const cacheKey = `${serviceDate}|${clock}`;
  if (serviceTimeCache.has(cacheKey)) {
    const cached = serviceTimeCache.get(cacheKey);
    return cached === null ? null : new Date(cached);
  }
  const result = serviceTimeToDateUncached(serviceDate, clock);
  if (serviceTimeCache.size >= SERVICE_TIME_CACHE_LIMIT) serviceTimeCache.clear();
  serviceTimeCache.set(cacheKey, result?.getTime() ?? null);
  return result;
}

function serviceTimeToDateUncached(serviceDate, clock) {
  const dateParts = validDateParts(serviceDate);
  const match = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(String(clock || ''));
  if (!dateParts || !match) return null;
  const hours = Number(match[1]), minutes = Number(match[2]), seconds = Number(match[3] || 0);
  if (minutes > 59 || seconds > 59) return null;

  const [year, month, day] = dateParts;
  const dayOffset = Math.floor(hours / 24);
  const serviceDay = new Date(Date.UTC(year, month - 1, day + dayOffset));
  const wall = Date.UTC(serviceDay.getUTCFullYear(), serviceDay.getUTCMonth(), serviceDay.getUTCDate(), hours % 24, minutes, seconds);
  const offsets = new Set();
  for (let delta = -36; delta <= 36; delta += 3) offsets.add(parisOffsetAt(wall + delta * 3600000));

  const candidates = [...offsets].map(offset => wall - offset);
  const exact = candidates.filter(timestamp => {
    const parts = dateTimeParts(timestamp);
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) === wall;
  });
  if (exact.length) return new Date(Math.min(...exact));

  // A timetable can contain a local time inside the spring DST gap. Move it
  // forward by the size of the gap (02:30 becomes 03:30), matching clock-time
  // semantics while still producing a real instant.
  const afterGap = candidates.map(timestamp => {
    const parts = dateTimeParts(timestamp);
    return { timestamp, wall: Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) };
  }).filter(item => item.wall > wall).sort((a, b) => a.wall - b.wall || a.timestamp - b.timestamp);
  return afterGap.length ? new Date(afterGap[0].timestamp) : null;
}

export function addServiceDays(value, amount) {
  const parts = validDateParts(value);
  if (!parts || !Number.isInteger(amount)) return null;
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + amount));
  return date.toISOString().slice(0, 10);
}

export function parisDateKey(value = new Date()) {
  const parts = dateTimeParts(value instanceof Date ? value : new Date(value));
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function parisStartOfDay(value) {
  return serviceTimeToDate(value, '00:00:00');
}

export function parisEndOfDay(value) {
  const next = addServiceDays(value, 1);
  const start = next && parisStartOfDay(next);
  return start ? new Date(start.getTime() - 1) : null;
}

export function formatParisTime(value) {
  return displayTimeFormatter.format(value);
}

export function formatParisDate(value, options = {}) {
  return new Intl.DateTimeFormat(undefined, { timeZone: PARIS_TIME_ZONE, ...options }).format(value);
}

export const PARIS_TIME_ZONE_ID = PARIS_TIME_ZONE;
