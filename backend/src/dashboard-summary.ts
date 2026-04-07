/**
 * KPI hàng đầu dashboard — cùng công thức với dashboard/src/App.tsx
 * (pageview, visitor, phiên, thời lượng TB, bounce, trend % chia đôi theo startedAt).
 */

export type SlimSessionForSummary = {
  visitorId: string;
  startedAt: Date;
  updatedAt: Date;
  events: { name: string }[];
};

export function computeDashboardSummaryFromSessions(sessions: SlimSessionForSummary[]) {
  const pageviewsCount = sessions.flatMap((s) => s.events).filter((e) => e.name === 'pageview').length;
  const uniqueVisitorsCount = new Set(sessions.map((s) => s.visitorId)).size;
  const sessionsCount = sessions.length;

  const totalDurationSec =
    sessions.reduce((acc, s) => {
      const start = new Date(s.startedAt).getTime();
      const end = s.updatedAt ? new Date(s.updatedAt).getTime() : start;
      return acc + (end - start);
    }, 0) / 1000;
  const avgDurationSec = sessionsCount > 0 ? totalDurationSec / sessionsCount : 0;

  const bounces = sessions.filter(
    (s) => s.events.filter((e) => e.name !== 'heartbeat').length <= 1
  ).length;
  const bounceRate = sessionsCount > 0 ? (bounces / sessionsCount) * 100 : 0;

  let pageviewsTrend = 0;
  let visitorsTrend = 0;
  let sessionsTrend = 0;
  let durationTrend = 0;
  let bounceTrend = 0;

  if (sessions.length > 0) {
    const sorted = [...sessions].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    );
    const minTime = new Date(sorted[0].startedAt).getTime();
    const maxTime = new Date(sorted[sorted.length - 1].startedAt).getTime();

    if (maxTime > minTime) {
      const midTime = minTime + (maxTime - minTime) / 2;
      const prevSessions = sorted.filter((s) => new Date(s.startedAt).getTime() < midTime);
      const currSessions = sorted.filter((s) => new Date(s.startedAt).getTime() >= midTime);

      const getMetrics = (sessList: SlimSessionForSummary[]) => {
        const count = sessList.length;
        const pvs = sessList.flatMap((s) => s.events).filter((e) => e.name === 'pageview').length;
        const uvs = new Set(sessList.map((s) => s.visitorId)).size;
        const dur =
          sessList.reduce(
            (acc, s) =>
              acc +
              (new Date(s.updatedAt || s.startedAt).getTime() - new Date(s.startedAt).getTime()),
            0
          ) / 1000;
        const avgDur = count > 0 ? dur / count : 0;
        const bnc = sessList.filter(
          (s) => s.events.filter((e) => e.name !== 'heartbeat').length <= 1
        ).length;
        const bncRate = count > 0 ? (bnc / count) * 100 : 0;
        return { count, pvs, uvs, avgDur, bncRate };
      };

      const prev = getMetrics(prevSessions);
      const curr = getMetrics(currSessions);
      const calcPct = (c: number, p: number) => (p === 0 ? (c > 0 ? 100 : 0) : ((c - p) / p) * 100);

      sessionsTrend = calcPct(curr.count, prev.count);
      pageviewsTrend = calcPct(curr.pvs, prev.pvs);
      visitorsTrend = calcPct(curr.uvs, prev.uvs);
      durationTrend = calcPct(curr.avgDur, prev.avgDur);
      bounceTrend = calcPct(curr.bncRate, prev.bncRate);
    } else {
      sessionsTrend = 100;
      pageviewsTrend = 100;
      visitorsTrend = 100;
      durationTrend = 100;
      bounceTrend = 0;
    }
  }

  const avgMinutes = Math.floor(avgDurationSec / 60);
  const avgSecondsRemainder = Math.floor(avgDurationSec % 60);

  return {
    pageviewsCount,
    uniqueVisitorsCount,
    sessionsCount,
    avgDurationSec,
    avgDurationFormatted: `${avgMinutes}m ${avgSecondsRemainder}s`,
    bounces,
    bounceRatePct: Number(bounceRate.toFixed(1)),
    trendsPct: {
      pageviews: Number(pageviewsTrend.toFixed(1)),
      uniqueVisitors: Number(visitorsTrend.toFixed(1)),
      sessions: Number(sessionsTrend.toFixed(1)),
      avgDurationSec: Number(durationTrend.toFixed(1)),
      bounceRate: Number(bounceTrend.toFixed(1)),
    },
  };
}
