/**
 * Tổng hợp chỉ số theo dimension — đồng bộ logic với dashboard (Phân tích chi tiết bộ lọc).
 */

export type DimensionKind =
  | 'path'
  | 'title'
  | 'country'
  | 'city'
  | 'browser'
  | 'os'
  | 'device'
  | 'language'
  | 'entry'
  | 'exit'
  | 'referrer';

export interface DimensionStatRow {
  dimensionValue: string;
  visitorsCount: number;
  pageviews: number;
  sessionsCount: number;
  bounces: number;
  avgDurationSec: number;
}

export interface EventAgg {
  name: string;
  timestamp: Date;
  properties: Record<string, unknown> | null;
}

export interface SessionAgg {
  id: string;
  visitorId: string;
  startedAt: Date;
  updatedAt: Date;
  device: string | null;
  location: string | null;
  userAgent: string | null;
  events: EventAgg[];
}

const GENERIC_TITLE = 'BOOKMEDI - Sách Ngoại Văn Chính Hãng';

function propUrl(e: EventAgg): string | undefined {
  const u = e.properties?.url;
  return typeof u === 'string' ? u : undefined;
}

function propReferrer(e: EventAgg): string | undefined {
  const r = e.properties?.referrer;
  return typeof r === 'string' ? r : undefined;
}

function propLanguage(e: EventAgg): string | undefined {
  const l = e.properties?.language;
  return typeof l === 'string' ? l : undefined;
}

function pathnameFromPageview(e: EventAgg): string {
  const urlString = propUrl(e);
  if (!urlString) return '/';
  try {
    return new URL(urlString).pathname;
  } catch {
    return urlString || '/';
  }
}

function titleFromPageview(e: EventAgg): string {
  const titleRaw = e.properties?.title;
  let rawTitle: string | undefined = typeof titleRaw === 'string' ? titleRaw : undefined;
  const urlString = propUrl(e);
  if (urlString) {
    try {
      const parsedUrl = new URL(urlString);
      const pathName = parsedUrl.pathname;
      if (pathName && pathName !== '/') {
        if (!rawTitle || rawTitle.includes(GENERIC_TITLE)) {
          const segments = pathName.split('/').filter(Boolean);
          const lastSegment = segments[segments.length - 1];
          if (lastSegment) {
            let t = lastSegment.replace(/-/g, ' ');
            rawTitle = t.charAt(0).toUpperCase() + t.slice(1);
          }
        }
      } else {
        rawTitle = 'Trang chủ';
      }
    } catch {
      /* keep rawTitle */
    }
  }
  return rawTitle || 'Trang chủ';
}

function sessionDurationSec(s: SessionAgg): number {
  const start = s.startedAt.getTime();
  const end = s.updatedAt ? s.updatedAt.getTime() : start;
  return (end - start) / 1000;
}

function isBounceSession(s: SessionAgg): boolean {
  return s.events.filter((e) => e.name !== 'heartbeat').length <= 1;
}

function browserFromUa(ua: string): string {
  if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Edg')) return 'Edge';
  return 'Other';
}

function osFromUa(ua: string): string {
  if (ua.includes('Mac OS')) return 'macOS';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iOS') || ua.includes('iPhone')) return 'iOS';
  return '(Không xác định)';
}

function getPathFromPv(pv: EventAgg | null): string {
  if (!pv) return '/';
  return pathnameFromPageview(pv);
}

function dimCountry(s: SessionAgg): string {
  if (!s.location?.includes('{')) return '(Không xác định)';
  try {
    const geo = JSON.parse(s.location) as { country?: string };
    return geo.country || '(Không xác định)';
  } catch {
    return '(Không xác định)';
  }
}

function dimCity(s: SessionAgg): string {
  if (!s.location?.includes('{')) return '(Không xác định)';
  try {
    const geo = JSON.parse(s.location) as { city?: string };
    return geo.city || '(Không xác định)';
  } catch {
    return '(Không xác định)';
  }
}

type InternalStat = {
  name: string;
  visitors: Set<string>;
  sessionsData: Set<string>;
  pageviews: number;
  bounces: number;
  totalDurationSec: number;
};

export function aggregateDimensionStats(
  dimension: DimensionKind,
  sessions: SessionAgg[],
  search: string
): DimensionStatRow[] {
  const q = search.trim().toLowerCase();
  const map = new Map<string, InternalStat>();

  const eventLevel = dimension === 'path' || dimension === 'title';

  if (eventLevel) {
    for (const s of sessions) {
      const dimensionsInSession = new Set<string>();
      for (const e of s.events) {
        if (e.name !== 'pageview') continue;
        let dimValue = '/';
        if (dimension === 'path') {
          dimValue = pathnameFromPageview(e);
        } else {
          dimValue = titleFromPageview(e);
        }
        const isFirstTimeInSession = !dimensionsInSession.has(dimValue);
        dimensionsInSession.add(dimValue);

        if (!map.has(dimValue)) {
          map.set(dimValue, {
            name: dimValue,
            visitors: new Set([s.visitorId]),
            sessionsData: new Set([s.id]),
            pageviews: 1,
            bounces: isBounceSession(s) ? 1 : 0,
            totalDurationSec: sessionDurationSec(s),
          });
        } else {
          const existing = map.get(dimValue)!;
          existing.visitors.add(s.visitorId);
          existing.sessionsData.add(s.id);
          existing.pageviews += 1;
          if (isFirstTimeInSession) {
            if (isBounceSession(s)) existing.bounces += 1;
            existing.totalDurationSec += sessionDurationSec(s);
          }
        }
      }
    }
  } else {
    for (const s of sessions) {
      let dimValue = '(Không xác định)';
      const sortedEvents = [...s.events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const pageviewsEvents = sortedEvents.filter((e) => e.name === 'pageview');
      const firstPv = pageviewsEvents.length > 0 ? pageviewsEvents[0] : null;
      const lastPv = pageviewsEvents.length > 0 ? pageviewsEvents[pageviewsEvents.length - 1] : null;
      const ua = s.userAgent || '';

      switch (dimension) {
        case 'country':
          dimValue = dimCountry(s);
          break;
        case 'city':
          dimValue = dimCity(s);
          break;
        case 'browser':
          dimValue = browserFromUa(ua);
          break;
        case 'os':
          dimValue = osFromUa(ua);
          break;
        case 'entry':
          dimValue = getPathFromPv(firstPv);
          break;
        case 'exit':
          dimValue = getPathFromPv(lastPv);
          break;
        case 'referrer': {
          const ref = firstPv ? propReferrer(firstPv) : undefined;
          if (ref) {
            try {
              dimValue = new URL(ref).hostname;
            } catch {
              dimValue = ref;
            }
          } else {
            dimValue = 'Direct/Unknown';
          }
          break;
        }
        case 'device':
          dimValue = s.device?.includes('x') ? 'Desktop/Laptop' : 'Mobile';
          break;
        case 'language': {
          const lang = firstPv ? propLanguage(firstPv) : undefined;
          dimValue = lang || 'vi-VN';
          break;
        }
        default:
          dimValue = '-';
      }

      if (!map.has(dimValue)) {
        map.set(dimValue, {
          name: dimValue,
          visitors: new Set([s.visitorId]),
          sessionsData: new Set([s.id]),
          pageviews: s.events.filter((e) => e.name === 'pageview').length,
          bounces: isBounceSession(s) ? 1 : 0,
          totalDurationSec: sessionDurationSec(s),
        });
      } else {
        const existing = map.get(dimValue)!;
        existing.visitors.add(s.visitorId);
        existing.sessionsData.add(s.id);
        existing.pageviews += s.events.filter((e) => e.name === 'pageview').length;
        if (isBounceSession(s)) existing.bounces += 1;
        existing.totalDurationSec += sessionDurationSec(s);
      }
    }
  }

  const rows: DimensionStatRow[] = [];
  for (const stat of map.values()) {
    const sessionsCount = stat.sessionsData.size;
    if (q && !stat.name.toLowerCase().includes(q)) continue;
    rows.push({
      dimensionValue: stat.name,
      visitorsCount: stat.visitors.size,
      pageviews: stat.pageviews,
      sessionsCount,
      bounces: stat.bounces,
      avgDurationSec: sessionsCount > 0 ? stat.totalDurationSec / sessionsCount : 0,
    });
  }

  rows.sort((a, b) => b.visitorsCount - a.visitorsCount);
  return rows;
}

export function parseDimensionParam(raw: string | undefined): DimensionKind | null {
  const allowed: DimensionKind[] = [
    'path',
    'title',
    'country',
    'city',
    'browser',
    'os',
    'device',
    'language',
    'entry',
    'exit',
    'referrer',
  ];
  const v = (raw || '').trim().toLowerCase();
  return allowed.includes(v as DimensionKind) ? (v as DimensionKind) : null;
}
