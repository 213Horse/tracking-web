import { useEffect, useState } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Users, MousePointer2, Clock, Search, ArrowRight, LayoutDashboard, Database, Activity, MapPin, Eye, Copy, User, Globe, Monitor, Timer, ShoppingCart, Package, ListOrdered } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps";

// World map geojson URL
const geoUrl = "https://unpkg.com/world-atlas@2.0.2/countries-110m.json";

// Mapping ISO-2 to world-atlas numeric IDs
const isoToId: { [key: string]: string } = {
  "VN": "704", "US": "840", "GB": "826", "CN": "156", "JP": "392", "KR": "410", "FR": "250", "DE": "276", "IN": "356", "RU": "643"
};

const idToIso: { [key: string]: string } = Object.fromEntries(Object.entries(isoToId).map(([k, v]) => [v, k]));

interface Event {
  id: string;
  name: string;
  sessionId: string;
  timestamp: string;
  properties: any;
  context?: any;
  userName?: string;
  userEmail?: string;
  erpId?: string;
}

interface Session {
  id: string;
  visitorId: string;
  startedAt: string;
  device: string;
  ip: string;
  location: string;
  userAgent: string;
  updatedAt: string;
  endedAt?: string;
  events: Event[];
  visitor: {
    identityMapping?: {
      userId: string;
      user: {
        id: string;
        email: string;
        name?: string;
        erpId?: string;
      }
    }
  }
}

function commerceCustomerFromSession(s: Session): { label: string; title: string } {
  const user = s.visitor.identityMapping?.user;
  const label =
    (user?.name && String(user.name).trim()) || user?.email || 'Chưa định danh';
  const title = [
    user?.name,
    user?.email,
    user?.erpId ? `Mã KH: ${user.erpId}` : null,
    `Visitor: ${s.visitorId}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return { label, title };
}

/** Đếm mỗi lần tên SP xuất hiện trong một event (mảng productNames). */
function tallyProductNamesFromEvents(
  events: { properties?: Record<string, unknown> | null }[],
  propKey: string
): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const e of events) {
    const arr = e.properties?.[propKey];
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      if (typeof raw !== 'string') continue;
      const name = raw.trim();
      if (!name) continue;
      map.set(name, (map.get(name) || 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

const App = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [activeUsers, setActiveUsers] = useState<number>(0);
  const [prevActiveUsers, setPrevActiveUsers] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users' | 'events'>('dashboard');
  const [selectedVisitorId, setSelectedVisitorId] = useState<string | null>(null);
  
  // Interactive Analysis Block State
  const [activeAnalysisTab, setActiveAnalysisTab] = useState<string>('Đường dẫn');
  const [analysisSearch, setAnalysisSearch] = useState<string>('');
  const [mapTooltip, setMapTooltip] = useState<string | null>(null);

  const formatDate = (date: string | Date) => {
    try {
      const d = new Date(date);
      return new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(d);
    } catch (e) {
      return 'Invalid Date';
    }
  };

  const formatFullDate = (date: string | Date) => {
    try {
      const d = new Date(date);
      return new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(d);
    } catch (e) {
      return 'Invalid Date';
    }
  };

  useEffect(() => {
    const fetchData = () => {
      fetch('http://localhost:3001/api/v1/analytics/sessions')
        .then(res => res.json())
        .then(data => setSessions(data))
        .catch(err => console.error(err));

      fetch('http://localhost:3001/api/v1/active-users')
        .then(res => res.json())
        .then(data => {
          setActiveUsers(prev => {
            setPrevActiveUsers(prev);
            return data.count;
          });
        })
        .catch(err => console.error(err));
    };

    fetchData();
    const interval = setInterval(fetchData, 10000); // Polling every 10s
    return () => clearInterval(interval);
  }, []);

  const activeUsersTrend = prevActiveUsers === 0 ? (activeUsers > 0 ? 100 : 0) : ((activeUsers - prevActiveUsers) / prevActiveUsers) * 100;

  // Heatmap Aggregation (7 days x 24 hours)
  const heatmapData = Array.from({ length: 7 }, () => Array(24).fill(0));
  const countryStats = new Map();

  sessions.forEach(s => {
    const d = new Date(s.startedAt);
    // Convert to GMT+7 manually for matrix indexing if needed, but JS Date uses local by default for getHours
    // To be precise for Vietnam time:
    const vnTime = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
    
    // JS getDay(): 0 is Sunday, 1 is Monday.
    // Map to Thứ 2 (0) -> CN (6)
    let dayIdx = vnTime.getDay(); 
    dayIdx = dayIdx === 0 ? 6 : dayIdx - 1; 
    
    const hourIdx = vnTime.getHours();
    heatmapData[dayIdx][hourIdx] += 1;

    // Geo aggregation
    if (s.location) {
      try {
        const geo = JSON.parse(s.location);
        if (geo.country) {
          countryStats.set(geo.country, (countryStats.get(geo.country) || 0) + 1);
        }
      } catch(e) {}
    }
  });

  // Advanced Top Level Metrics
  const pageviewsCount = sessions.flatMap(s => s.events).filter(e => e.name === 'pageview').length;
  const uniqueVisitorsCount = new Set(sessions.map(s => s.visitorId)).size;
  const sessionsCount = sessions.length;
  
  const totalDurationSec = sessions.reduce((acc, s) => {
    const start = new Date(s.startedAt).getTime();
    const end = s.updatedAt ? new Date(s.updatedAt).getTime() : start;
    return acc + (end - start);
  }, 0) / 1000;
  const avgDurationSec = sessionsCount > 0 ? totalDurationSec / sessionsCount : 0;
  
  // A bounce is typically a session with only 1 active interaction (e.g., just the landing pageview).
  // We ignore passive 'heartbeat' events so they don't artificially lower the bounce rate to 0%.
  const bounces = sessions.filter(s => s.events.filter(e => e.name !== 'heartbeat').length <= 1).length;
  const bounceRate = sessionsCount > 0 ? (bounces / sessionsCount) * 100 : 0;

  // Calculate Time-based Trends
  let pageviewsTrend = 0, visitorsTrend = 0, sessionsTrend = 0, durationTrend = 0, bounceTrend = 0;
  if (sessions.length > 0) {
    const sorted = [...sessions].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    const minTime = new Date(sorted[0].startedAt).getTime();
    const maxTime = new Date(sorted[sorted.length - 1].startedAt).getTime();
    
    if (maxTime > minTime) {
      const midTime = minTime + (maxTime - minTime) / 2;
      const prevSessions = sorted.filter(s => new Date(s.startedAt).getTime() < midTime);
      const currSessions = sorted.filter(s => new Date(s.startedAt).getTime() >= midTime);
      
      const getMetrics = (sessList: typeof sessions) => {
        const count = sessList.length;
        const pvs = sessList.flatMap(s => s.events).filter(e => e.name === 'pageview').length;
        const uvs = new Set(sessList.map(s => s.visitorId)).size;
        const dur = sessList.reduce((acc, s) => acc + (new Date(s.updatedAt || s.startedAt).getTime() - new Date(s.startedAt).getTime()), 0) / 1000;
        const avgDur = count > 0 ? dur / count : 0;
        const bnc = sessList.filter(s => s.events.filter(e => e.name !== 'heartbeat').length <= 1).length;
        const bncRate = count > 0 ? (bnc / count) * 100 : 0;
        return { count, pvs, uvs, avgDur, bncRate };
      };
      
      const prev = getMetrics(prevSessions);
      const curr = getMetrics(currSessions);
      
      const calcPct = (c: number, p: number) => p === 0 ? (c > 0 ? 100 : 0) : ((c - p) / p) * 100;
      
      sessionsTrend = calcPct(curr.count, prev.count);
      pageviewsTrend = calcPct(curr.pvs, prev.pvs);
      visitorsTrend = calcPct(curr.uvs, prev.uvs);
      durationTrend = calcPct(curr.avgDur, prev.avgDur);
      bounceTrend = calcPct(curr.bncRate, prev.bncRate);
    } else {
      // If there's only one timestamp (e.g. just started), assume 100% growth from 0.
      sessionsTrend = 100; pageviewsTrend = 100; visitorsTrend = 100; durationTrend = 100; bounceTrend = 0;
    }
  }

  const formatTrend = (val: number) => {
    const sign = val < 0 ? '-' : '';
    return `${sign}${Math.abs(val).toFixed(1)}%`;
  };

  // Dynamic Aggregation for Interactive Filters
  const analysisStatsMap = new Map();
  
  if (activeAnalysisTab === 'Đường dẫn' || activeAnalysisTab === 'Tiêu đề') {
    // Event-Level Grouping
    sessions.forEach(s => {
      // Create a set of distinct dimensions tracked during this session
      // to avoid double-counting bounces per session-path.
      const dimensionsInSession = new Set();
      
      s.events.forEach(e => {
        if (e.name !== 'pageview') return;
        
        let dimValue = '/';
        if (activeAnalysisTab === 'Đường dẫn') {
          if (e.context?.url) {
            try { dimValue = new URL(e.context.url).pathname; } catch(err) {}
          } else if (e.properties?.url) {
            try { dimValue = new URL(e.properties.url).pathname; } catch(err) { dimValue = e.properties.url || '/'; }
          }
        } else if (activeAnalysisTab === 'Tiêu đề') {
          let rawTitle = e.properties?.title;
          const urlString = e.context?.url || e.properties?.url;
          
          if (urlString) {
            try {
              const parsedUrl = new URL(urlString);
              const pathName = parsedUrl.pathname;
              
              if (pathName && pathName !== '/') {
                // If it's a generic title or Title is requested but actual tag is generic
                if (!rawTitle || rawTitle.includes('BOOKMEDI - Sách Ngoại Văn Chính Hãng')) {
                  const segments = pathName.split('/').filter(Boolean);
                  const lastSegment = segments[segments.length - 1];
                  if (lastSegment) {
                    // Convert slug to Readably Capitalized Title
                    rawTitle = lastSegment.replace(/-/g, ' ');
                    rawTitle = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
                  }
                }
              } else {
                rawTitle = 'Trang chủ';
              }
            } catch(err) {}
          }
          dimValue = rawTitle || 'Trang chủ';
        }
        
        const isFirstTimeInSession = !dimensionsInSession.has(dimValue);
        dimensionsInSession.add(dimValue);

        if (!analysisStatsMap.has(dimValue)) {
          analysisStatsMap.set(dimValue, {
            name: dimValue,
            visitors: new Set([s.visitorId]),
            sessionsData: new Set([s.id]),
            pageviews: 1,
            bounces: s.events.filter(e => e.name !== 'heartbeat').length <= 1 ? 1 : 0,
            totalDurationSec: (new Date(s.updatedAt || s.startedAt).getTime() - new Date(s.startedAt).getTime()) / 1000
          });
        } else {
          const existing = analysisStatsMap.get(dimValue);
          existing.visitors.add(s.visitorId);
          existing.sessionsData.add(s.id);
          existing.pageviews += 1;
          
          if (isFirstTimeInSession) {
            if (s.events.filter(e => e.name !== 'heartbeat').length <= 1) existing.bounces += 1;
            existing.totalDurationSec += (new Date(s.updatedAt || s.startedAt).getTime() - new Date(s.startedAt).getTime()) / 1000;
          }
        }
      });
    });
  } else {
    // Session-Level Grouping
    sessions.forEach(s => {
      let dimValue = '(Không xác định)';
      
      const sortedEvents = s.events.sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const pageviewsEvents = sortedEvents.filter(e => e.name === 'pageview');
      const firstPv = pageviewsEvents.length > 0 ? pageviewsEvents[0] : null;
      const lastPv = pageviewsEvents.length > 0 ? pageviewsEvents[pageviewsEvents.length - 1] : null;

      const getPath = (pvTarget: any) => {
        if (!pvTarget) return '/';
        if (pvTarget.context?.url) {
          try { return new URL(pvTarget.context.url).pathname; } catch(e) {}
        } else if (pvTarget.properties?.url) {
          try { return new URL(pvTarget.properties.url).pathname; } catch(e) { return pvTarget.properties?.url || '/'; }
        }
        return '/';
      };
      
      switch (activeAnalysisTab) {
        case 'Quốc gia':
          if (s.location && s.location.includes('{')) {
            try { const geo = JSON.parse(s.location); if (geo.country) dimValue = geo.country; } catch(e) {}
          }
          break;
        case 'Thành phố':
          if (s.location && s.location.includes('{')) {
            try { const geo = JSON.parse(s.location); if (geo.city) dimValue = geo.city; } catch(e) {}
          }
          break;
        case 'Trình duyệt':
          const ua = s.userAgent || '';
          if (ua.includes('Chrome') && !ua.includes('Edg')) dimValue = 'Chrome';
          else if (ua.includes('Safari') && !ua.includes('Chrome')) dimValue = 'Safari';
          else if (ua.includes('Firefox')) dimValue = 'Firefox';
          else if (ua.includes('Edg')) dimValue = 'Edge';
          else dimValue = 'Other';
          break;
        case 'Hệ điều hành':
          const uaOS = s.userAgent || '';
          if(uaOS.includes('Mac OS')) dimValue = 'macOS';
          else if(uaOS.includes('Windows')) dimValue = 'Windows';
          else if(uaOS.includes('Linux')) dimValue = 'Linux';
          else if(uaOS.includes('Android')) dimValue = 'Android';
          else if(uaOS.includes('iOS') || uaOS.includes('iPhone')) dimValue = 'iOS';
          break;
        case 'Trang vào':
          dimValue = getPath(firstPv);
          break;
        case 'Trang thoát':
          dimValue = getPath(lastPv);
          break;
        case 'Nguồn giới thiệu':
          if (firstPv && firstPv.context?.referrer) {
             try { dimValue = new URL(firstPv.context.referrer).hostname; } catch(e) { dimValue = firstPv.context.referrer || 'Direct/Unknown'; }
          } else dimValue = 'Direct/Unknown';
          break;
        case 'Thiết bị':
          dimValue = s.device?.includes('x') ? 'Desktop/Laptop' : 'Mobile';
          break;
        case 'Ngôn ngữ':
          if (firstPv && firstPv.context?.language) dimValue = firstPv.context.language;
          else dimValue = 'vi-VN';
          break;
        default:
          dimValue = '-';
      }

      if (!analysisStatsMap.has(dimValue)) {
        analysisStatsMap.set(dimValue, {
          name: dimValue,
          visitors: new Set([s.visitorId]),
          sessionsData: new Set([s.id]),
          pageviews: s.events.filter(e => e.name === 'pageview').length,
          bounces: s.events.filter(e => e.name !== 'heartbeat').length <= 1 ? 1 : 0,
          totalDurationSec: (new Date(s.updatedAt || s.startedAt).getTime() - new Date(s.startedAt).getTime()) / 1000
        });
      } else {
        const existing = analysisStatsMap.get(dimValue);
        existing.visitors.add(s.visitorId);
        existing.sessionsData.add(s.id);
        existing.pageviews += s.events.filter(e => e.name === 'pageview').length;
        if (s.events.filter(e => e.name !== 'heartbeat').length <= 1) existing.bounces += 1;
        existing.totalDurationSec += (new Date(s.updatedAt || s.startedAt).getTime() - new Date(s.startedAt).getTime()) / 1000;
      }
    });
  }

  const analysisStats = Array.from(analysisStatsMap.values())
    .map(stat => {
      const sessionsCount = stat.sessionsData ? stat.sessionsData.size : stat.sessionsCount;
      return {
        ...stat,
        sessionsCount,
        visitorsCount: stat.visitors.size,
        avgDurationSec: sessionsCount > 0 ? stat.totalDurationSec / sessionsCount : 0
      };
    })
    .filter(stat => stat.name.toLowerCase().includes(analysisSearch.toLowerCase()))
    .sort((a, b) => b.visitorsCount - a.visitorsCount);
  
  const chartData = sessions.slice(0, 10).map(s => ({
    name: formatDate(s.startedAt),
    events: s.events.length
  })).reverse();

  const commercePreviewRows = sessions
    .flatMap((s) =>
      s.events
        .filter((e) => e.name === 'checkout_preview')
        .map((e) => {
          const { label, title } = commerceCustomerFromSession(s);
          return {
            id: e.id,
            visitorId: s.visitorId,
            customerLabel: label,
            customerTitle: title,
            at: e.timestamp,
            products: Array.isArray(e.properties?.productNames) ? e.properties.productNames as string[] : [],
          };
        })
    )
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 25);

  const commerceOrderRows = sessions
    .flatMap((s) =>
      s.events
        .filter((e) => e.name === 'checkout_success')
        .map((e) => {
          const { label, title } = commerceCustomerFromSession(s);
          return {
            id: e.id,
            visitorId: s.visitorId,
            customerLabel: label,
            customerTitle: title,
            at: e.timestamp,
            orderNo: String(e.properties?.orderNo ?? ''),
          };
        })
    )
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 25);

  const checkoutPreviewVisitorCount = new Set(
    sessions.filter((s) => s.events.some((e) => e.name === 'checkout_preview')).map((s) => s.visitorId)
  ).size;
  const checkoutSuccessCount = sessions.flatMap((s) => s.events).filter((e) => e.name === 'checkout_success').length;

  const previewEventsForReport = sessions.flatMap((s) => s.events.filter((e) => e.name === 'checkout_preview'));
  const productWantRank = tallyProductNamesFromEvents(previewEventsForReport, 'productNames');

  const successEventsForReport = sessions.flatMap((s) => s.events.filter((e) => e.name === 'checkout_success'));
  const productPurchasedRank = tallyProductNamesFromEvents(successEventsForReport, 'productNames');

  const allEvents = sessions.flatMap(s => s.events.map(e => ({ 
    ...e, 
    visitorId: s.visitorId, 
    userEmail: s.visitor.identityMapping?.user?.email, 
    userName: s.visitor.identityMapping?.user?.name,
    erpId: s.visitor.identityMapping?.user?.erpId
  })));

  const getVisitorProfile = (vId: string) => {
    const visitorSession = sessions.find(s => s.visitorId === vId);
    if(!visitorSession) return null;
    
    // Check if this visitor is mapped to a user (erpId)
    const userId = visitorSession.visitor.identityMapping?.userId;
    
    // Get all sessions: If user is identified, get all sessions for that user. Else just for that visitor.
    const vSessions = sessions.filter(s => {
      if (userId) return s.visitor.identityMapping?.userId === userId;
      return s.visitorId === vId;
    }).sort((a,b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    
    if(!vSessions.length) return null;
    
    const vEvents = vSessions.flatMap(s => s.events.map(e => ({...e, sessionId: s.id, startedAt: s.startedAt}))).sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    const views = vEvents.filter(e => e.name === 'pageview').length;
    
    const durationSec = Math.round(vSessions.reduce((acc, s) => {
      const start = new Date(s.startedAt).getTime();
      const end = s.updatedAt ? new Date(s.updatedAt).getTime() : start;
      return acc + (end - start);
    }, 0) / 1000);

    const firstSeen = new Date(vSessions[vSessions.length-1].startedAt);
    const lastSeen = vEvents.length > 0 ? new Date(vEvents[0].timestamp) : new Date(vSessions[0].startedAt);
    
    let geo = { country: '-', city: '-', region: '-' };
    const locSession = vSessions.find(s => s.location && s.location.includes('{'));
    if(locSession) {
      try { geo = JSON.parse(locSession.location as string); } catch(e) {}
    }

    const latest = vSessions[0];
    let browser = 'Unknown';
    const ua = latest.userAgent || '';
    if(ua.includes('Chrome')) browser = 'Chrome';
    else if(ua.includes('Safari')) browser = 'Safari';
    else if(ua.includes('Firefox')) browser = 'Firefox';
    else if(ua.includes('Edg')) browser = 'Edge';

    let os = 'Unknown';
    if(ua.includes('Mac OS')) os = 'macOS';
    else if(ua.includes('Windows')) os = 'Windows';
    else if(ua.includes('Linux')) os = 'Linux';
    else if(ua.includes('Android')) os = 'Android';
    else if(ua.includes('iOS') || ua.includes('iPhone')) os = 'iOS';

    const previewEvents = vEvents.filter((e) => e.name === 'checkout_preview');
    const successOrderEvents = vEvents.filter((e) => e.name === 'checkout_success');
    const latestPreviewProducts =
      previewEvents.length > 0 && Array.isArray(previewEvents[0].properties?.productNames)
        ? (previewEvents[0].properties.productNames as string[])
        : [];
    const orderNos = [
      ...new Set(successOrderEvents.map((e) => e.properties?.orderNo).filter(Boolean) as string[]),
    ];

    return {
      email: latest.visitor?.identityMapping?.user?.email,
      name: latest.visitor?.identityMapping?.user?.name,
      erpId: latest.visitor?.identityMapping?.user?.erpId,
      vSessions, vEvents, visits: vSessions.length, views, events: vEvents.length - views, durationSec, firstSeen, lastSeen, geo, browser, os,
      device: latest.device?.includes('x') ? 'Desktop/Laptop' : 'Mobile',
      latestPreviewProducts,
      orderNos,
    };
  };

  const vp = selectedVisitorId ? getVisitorProfile(selectedVisitorId) : null;

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 bg-[#1e293b] border-r border-[#334155] p-6 hidden lg:block">
        <div className="flex items-center gap-2 mb-10">
          <Activity className="text-blue-500 w-8 h-8" />
          <h1 className="text-xl font-bold tracking-tight text-white">TrackFlow</h1>
        </div>
        
        <nav className="space-y-4">
          <div 
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${activeTab === 'dashboard' ? 'bg-blue-600/10 text-blue-400' : 'text-slate-400 hover:bg-[#334155]'}`}
          >
            <LayoutDashboard size={20} />
            <span className={activeTab === 'dashboard' ? 'font-semibold' : ''}>Dashboard</span>
          </div>
          <div 
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${activeTab === 'users' ? 'bg-blue-600/10 text-blue-400' : 'text-slate-400 hover:bg-[#334155]'}`}
          >
            <Users size={20} />
            <span className={activeTab === 'users' ? 'font-semibold' : ''}>Users</span>
          </div>
          <div 
            onClick={() => setActiveTab('events')}
            className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${activeTab === 'events' ? 'bg-blue-600/10 text-blue-400' : 'text-slate-400 hover:bg-[#334155]'}`}
          >
            <Database size={20} />
            <span className={activeTab === 'events' ? 'font-semibold' : ''}>Raw Events</span>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="lg:ml-64 p-8">
        <header className="flex justify-between items-center mb-8">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-white capitalize">{activeTab} Overview</h2>
              <span className="px-2 py-0.5 bg-slate-800 text-slate-400 text-[10px] rounded border border-slate-700">GMT+7</span>
            </div>
            <p className="text-slate-400">Real-time behavior tracking data</p>
          </div>
          <div className="flex gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
              <input type="text" placeholder="Search..." className="bg-[#1e293b] border border-[#334155] rounded-lg pl-10 pr-4 py-2 outline-none focus:border-blue-500 transition-all text-sm w-64" />
            </div>
          </div>
        </header>

        {activeTab === 'dashboard' && (
          <>
            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 mb-8">
              {[
                { label: 'ĐANG TRUY CẬP', value: activeUsers, icon: Activity, color: 'text-emerald-500', pulse: true, trend: formatTrend(activeUsersTrend) },
                { label: 'LƯỢT XEM', value: pageviewsCount.toLocaleString(), icon: Eye, color: 'text-blue-500', trend: formatTrend(pageviewsTrend) },
                { label: 'KHÁCH TRUY CẬP', value: uniqueVisitorsCount.toLocaleString(), icon: Users, color: 'text-purple-500', trend: formatTrend(visitorsTrend) },
                { label: 'PHIÊN', value: sessionsCount.toLocaleString(), icon: MousePointer2, color: 'text-indigo-500', trend: formatTrend(sessionsTrend) },
                { label: 'THỜI GIAN TB', value: `${Math.floor(avgDurationSec / 60)}m ${Math.floor(avgDurationSec % 60)}s`, icon: Clock, color: 'text-orange-500', trend: formatTrend(durationTrend) },
                { label: 'TỶ LỆ THOÁT', value: `${bounceRate.toFixed(1)}%`, icon: Activity, color: 'text-slate-400', trend: formatTrend(bounceTrend) },
              ].map((stat) => (
                <div key={stat.label} className="bg-[#1e293b] p-5 rounded-2xl border border-[#334155] flex flex-col items-center justify-center text-center relative overflow-hidden">
                  {stat.pulse && (
                    <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
                  )}
                  <div className={`mb-3 ${stat.color}`}>
                    <stat.icon size={28} />
                  </div>
                  <h3 className="text-slate-400 text-[11px] font-bold uppercase tracking-wider mb-2">{stat.label}</h3>
                  <p className="text-3xl font-black text-white tracking-tight">{stat.value}</p>
                  <span className={`text-[10px] font-bold mt-2 hover:opacity-80 cursor-default ${stat.label === 'ĐANG TRUY CẬP' ? 'text-emerald-400' : (stat.trend?.startsWith('-') ? 'text-rose-400' : 'text-emerald-400')}`}>
                    {stat.trend?.startsWith('-') ? '↓' : '↑'}{stat.trend?.replace('-', '')}
                    {stat.label === 'ĐANG TRUY CẬP' && <span className="ml-1 opacity-50 font-normal">(Live)</span>}
                  </span>
                </div>
              ))}
            </div>

            {/* Thương mại: preview giỏ (/thanh-toan) & đặt hàng thành công */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
              <div className="bg-[#1e293b] p-6 rounded-2xl border border-[#334155]">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="text-amber-400 w-5 h-5" />
                    <h3 className="text-lg font-bold text-white">Đang mua (preview /thanh-toan)</h3>
                  </div>
                  <span className="text-[10px] font-bold text-amber-400/90 bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20">
                    {checkoutPreviewVisitorCount} KH · {commercePreviewRows.length} lần gọi
                  </span>
                </div>
                <p className="text-slate-500 text-xs mb-4">
                  Sản phẩm lấy từ <code className="text-slate-400">cartItems[].name</code> khi API preview-orders trả về thành công.
                </p>
                <div className="overflow-auto max-h-[280px] border border-[#334155] rounded-xl">
                  <table className="w-full text-left text-sm">
                    <thead className="text-[10px] uppercase text-slate-500 border-b border-[#334155] sticky top-0 bg-[#1e293b]">
                      <tr>
                        <th className="px-3 py-2">Thời điểm</th>
                        <th className="px-3 py-2">Khách</th>
                        <th className="px-3 py-2">Sản phẩm trong giỏ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#334155]">
                      {commercePreviewRows.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-3 py-8 text-center text-slate-500 text-xs italic">
                            Chưa có sự kiện checkout_preview. Đảm bảo site đã gắn snippet và gọi preview-orders trên /thanh-toan.
                          </td>
                        </tr>
                      ) : (
                        commercePreviewRows.map((row) => (
                          <tr key={row.id} className="hover:bg-[#0f172a]/80">
                            <td className="px-3 py-2 text-slate-400 whitespace-nowrap text-[11px] font-mono">
                              {formatFullDate(row.at)}
                            </td>
                            <td className="px-3 py-2 text-slate-200 text-xs font-medium truncate max-w-[200px]" title={row.customerTitle}>
                              {row.customerLabel}
                            </td>
                            <td className="px-3 py-2 text-slate-200 text-xs">
                              <div className="flex flex-wrap gap-1">
                                {row.products.map((name, idx) => (
                                  <span
                                    key={`${row.id}-${idx}`}
                                    className="inline-block bg-amber-500/15 text-amber-200/90 border border-amber-500/25 rounded px-1.5 py-0.5 text-[10px] max-w-full truncate"
                                    title={name}
                                  >
                                    {name}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-6 pt-6 border-t border-[#334155]">
                  <div className="flex items-center gap-2 mb-2">
                    <ListOrdered className="text-amber-400 w-4 h-4 shrink-0" />
                    <h4 className="text-sm font-bold text-white">Báo cáo: Sản phẩm khách muốn mua</h4>
                  </div>
                  <p className="text-slate-500 text-[11px] mb-3">
                    Danh sách xếp hạng theo số lần sản phẩm xuất hiện trong các lần preview giỏ (mỗi dòng trong giỏ tính một lượt).
                  </p>
                  <div className="max-h-[240px] overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                    {productWantRank.length === 0 ? (
                      <p className="text-slate-500 text-xs italic py-2">Chưa có dữ liệu từ preview.</p>
                    ) : (
                      productWantRank.slice(0, 50).map((row, idx) => (
                        <div
                          key={row.name}
                          className="flex justify-between items-center gap-2 text-xs bg-[#0f172a]/80 border border-[#334155] rounded-lg px-2.5 py-1.5"
                        >
                          <span className="text-slate-500 font-mono w-6 shrink-0 tabular-nums">{idx + 1}</span>
                          <span className="text-slate-200 flex-1 min-w-0 truncate" title={row.name}>
                            {row.name}
                          </span>
                          <span className="text-amber-400 font-bold shrink-0 tabular-nums">{row.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-[#1e293b] p-6 rounded-2xl border border-[#334155]">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Package className="text-emerald-400 w-5 h-5" />
                    <h3 className="text-lg font-bold text-white">Đơn hàng thành công</h3>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-400/90 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">
                    {checkoutSuccessCount} đơn
                  </span>
                </div>
                <p className="text-slate-500 text-xs mb-4">
                  Mỗi lần API checkout thành công ghi <code className="text-slate-400">orderNo</code> và{' '}
                  <code className="text-slate-400">productNames</code> (nếu response có danh sách dòng hàng).
                </p>
                <div className="overflow-auto max-h-[280px] border border-[#334155] rounded-xl">
                  <table className="w-full text-left text-sm">
                    <thead className="text-[10px] uppercase text-slate-500 border-b border-[#334155] sticky top-0 bg-[#1e293b]">
                      <tr>
                        <th className="px-3 py-2">Thời điểm</th>
                        <th className="px-3 py-2">Khách</th>
                        <th className="px-3 py-2">Mã đơn</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#334155]">
                      {commerceOrderRows.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-3 py-8 text-center text-slate-500 text-xs italic">
                            Chưa có sự kiện checkout_success.
                          </td>
                        </tr>
                      ) : (
                        commerceOrderRows.map((row) => (
                          <tr key={row.id} className="hover:bg-[#0f172a]/80">
                            <td className="px-3 py-2 text-slate-400 whitespace-nowrap text-[11px] font-mono">
                              {formatFullDate(row.at)}
                            </td>
                            <td className="px-3 py-2 text-slate-200 text-xs font-medium truncate max-w-[200px]" title={row.customerTitle}>
                              {row.customerLabel}
                            </td>
                            <td className="px-3 py-2 text-emerald-300 font-mono text-xs font-bold">{row.orderNo}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-6 pt-6 border-t border-[#334155]">
                  <div className="flex items-center gap-2 mb-2">
                    <ListOrdered className="text-emerald-400 w-4 h-4 shrink-0" />
                    <h4 className="text-sm font-bold text-white">Báo cáo: Sản phẩm mua nhiều</h4>
                  </div>
                  <p className="text-slate-500 text-[11px] mb-3">
                    Xếp hạng theo số lần sản phẩm xuất hiện trong các đơn hoàn tất (mỗi dòng trong đơn tính một lượt).
                  </p>
                  <div className="max-h-[240px] overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                    {productPurchasedRank.length === 0 ? (
                      <p className="text-slate-500 text-xs italic py-2">
                        Chưa có tên sản phẩm trong sự kiện đặt hàng. Cập nhật snippet mới: tracker sẽ đọc tên từ response checkout
                        (cartItems, items, orderItems, …). Đơn cũ chỉ có <code className="text-slate-400">orderNo</code> sẽ không
                        vào thống kê này.
                      </p>
                    ) : (
                      productPurchasedRank.slice(0, 50).map((row, idx) => (
                        <div
                          key={row.name}
                          className="flex justify-between items-center gap-2 text-xs bg-[#0f172a]/80 border border-[#334155] rounded-lg px-2.5 py-1.5"
                        >
                          <span className="text-slate-500 font-mono w-6 shrink-0 tabular-nums">{idx + 1}</span>
                          <span className="text-slate-200 flex-1 min-w-0 truncate" title={row.name}>
                            {row.name}
                          </span>
                          <span className="text-emerald-400 font-bold shrink-0 tabular-nums">{row.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Geo & Heatmap Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
              {/* World Map */}
              <div className="lg:col-span-2 bg-[#1e293b] p-6 rounded-2xl border border-[#334155]">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-bold text-white">Geographical Distribution</h3>
                  <div className="flex gap-2">
                     <span className="text-[10px] text-slate-500 bg-slate-800 px-2 py-1 rounded">Global Coverage</span>
                  </div>
                </div>
                <div className="h-[350px] w-full overflow-hidden cursor-move relative">
                  <ComposableMap projectionConfig={{ scale: 150 }} style={{ width: "100%", height: "100%" }}>
                    <ZoomableGroup center={[105, 15]} zoom={1}>
                      <Geographies geography={geoUrl}>
                        {({ geographies }: { geographies: any[] }) =>
                          geographies.map((geo: any) => {
                            // Map ID (like 704) back to ISO (VN) for matching with countryStats
                            const isoCode = idToIso[geo.id] || geo.id;
                            const sessions = countryStats.get(isoCode) || 0;
                            const hasTraffic = sessions > 0 || countryStats.has(geo.properties.name);
                            
                            return (
                              <Geography
                                key={geo.rsmKey}
                                geography={geo}
                                onMouseEnter={() => {
                                  setMapTooltip(`${geo.properties.name}: ${sessions} sessions`);
                                }}
                                onMouseLeave={() => {
                                  setMapTooltip(null);
                                }}
                                fill={hasTraffic ? "#3b82f6" : "#2d3748"}
                                stroke={hasTraffic ? "#60a5fa" : "#1e293b"}
                                strokeWidth={hasTraffic ? 1 : 0.5}
                                style={{
                                  default: { outline: "none" },
                                  hover: { fill: "#60a5fa", outline: "none" },
                                  pressed: { fill: "#2563eb", outline: "none" },
                                }}
                              />
                            );
                          })
                        }
                      </Geographies>
                    </ZoomableGroup>
                  </ComposableMap>
                  {mapTooltip && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#0f172a]/90 text-white px-3 py-1.5 rounded-full text-xs font-bold border border-[#334155] shadow-xl pointer-events-none backdrop-blur-sm">
                       {mapTooltip}
                    </div>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-4">
                   {Array.from(countryStats.entries()).sort((a,b) => b[1] - a[1]).slice(0, 5).map(([code, count]) => (
                      <div key={code} className="flex items-center gap-2 bg-[#0f172a] px-3 py-1.5 rounded-lg border border-[#334155]">
                         <span className="text-white font-bold text-xs">{code}</span>
                         <span className="text-slate-500 text-xs">{count} sessions</span>
                      </div>
                   ))}
                </div>
              </div>

              {/* Traffic Heatmap */}
              <div className="bg-[#1e293b] p-6 rounded-2xl border border-[#334155]">
                <h3 className="text-lg font-bold text-white mb-6">Traffic Peak Hours</h3>
                <div className="flex">
                  <div className="flex flex-col justify-between text-[9px] text-slate-500 pr-2 pb-6">
                     {['12am', '4am', '8am', '12pm', '4pm', '8pm'].map(h => <span key={h}>{h}</span>)}
                  </div>
                  <div className="flex-1">
                    <div className="grid grid-cols-7 gap-2 mb-2">
                      {['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'].map(d => (
                        <span key={d} className="text-[9px] font-bold text-slate-500 text-center">{d}</span>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-2 h-[300px]">
                      {Array.from({ length: 7 }).map((_, dIdx) => (
                         <div key={dIdx} className="flex flex-col justify-between gap-1">
                            {Array.from({ length: 24 }).map((_, hIdx) => {
                               const count = heatmapData[dIdx][hIdx];
                               const maxCount = Math.max(...heatmapData.flat(), 1);
                               const opacity = count > 0 ? 0.3 + (count / maxCount) * 0.7 : 0.05;
                               const size = count > 0 ? 6 + (count / maxCount) * 8 : 4;
                               
                               return (
                                  <div 
                                    key={hIdx} 
                                    className="flex items-center justify-center h-full"
                                    title={`${count} sessions at ${hIdx}:00`}
                                  >
                                     <div 
                                        className={`rounded-full transition-all duration-500 ${count > 0 ? 'bg-blue-500' : 'bg-slate-700'}`}
                                        style={{ 
                                          width: `${size}px`, 
                                          height: `${size}px`,
                                          opacity
                                        }}
                                     ></div>
                                  </div>
                               );
                            })}
                         </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Main Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
              <div className="lg:col-span-2 bg-[#1e293b] p-6 rounded-2xl border border-[#334155]">
                <h3 className="text-lg font-bold text-white mb-6">Activity (Last 10 Sessions)</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <defs>
                        <linearGradient id="colorEvents" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                        itemStyle={{ color: '#3b82f6' }}
                      />
                      <Line type="monotone" dataKey="events" stroke="#3b82f6" strokeWidth={3} dot={{ fill: '#3b82f6', r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

            <div className="bg-[#1e293b] p-6 rounded-2xl border border-[#334155]">
                <h3 className="text-lg font-bold text-white mb-6">Device Distribution</h3>
                <div className="space-y-4">
                  {Object.keys(sessions.reduce((acc: any, s) => {
                    const ua = s.userAgent || '';
                    let browser = 'Other';
                    if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
                    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
                    else if (ua.includes('Firefox')) browser = 'Firefox';
                    else if (ua.includes('Edg')) browser = 'Edge';
                    acc[browser] = (acc[browser] || 0) + 1;
                    return acc;
                  }, {})).map((browser, idx) => {
                    const counts: any = sessions.reduce((acc: any, s) => {
                      const ua = s.userAgent || '';
                      let b = 'Other';
                      if (ua.includes('Chrome') && !ua.includes('Edg')) b = 'Chrome';
                      else if (ua.includes('Safari') && !ua.includes('Chrome')) b = 'Safari';
                      else if (ua.includes('Firefox')) b = 'Firefox';
                      else if (ua.includes('Edg')) b = 'Edge';
                      acc[b] = (acc[b] || 0) + 1;
                      return acc;
                    }, {});
                    const count = counts[browser] || 0;
                    const total = sessions.length || 1;
                    const percentage = Math.round((count / total) * 100);
                    return (
                      <div key={idx} className="flex items-center justify-between">
                        <span className="text-slate-400 text-sm">{browser}</span>
                        <div className="flex-1 mx-4 h-1.5 bg-[#0f172a] rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500" style={{ width: `${percentage}%` }}></div>
                        </div>
                        <span className="text-white text-sm font-bold">{percentage}%</span>
                      </div>
                    );
                  })}
                  {sessions.length === 0 && (
                    <div className="text-slate-500 italic text-center py-4">No data</div>
                  )}
                </div>
              </div>
            </div>

            {/* Phân tích chi tiết bộ lọc */}
            <div className="mt-8 bg-[#1e293b] rounded-2xl border border-[#334155] overflow-hidden">
              <div className="p-6 border-b border-[#334155] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                <h3 className="text-lg font-bold text-white">Phân tích chi tiết bộ lọc</h3>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
                  <input 
                    type="text" 
                    placeholder="Tìm kiếm..." 
                    value={analysisSearch}
                    onChange={(e) => setAnalysisSearch(e.target.value)}
                    className="bg-[#0f172a] border border-[#334155] rounded-xl pl-10 pr-4 py-2 outline-none focus:border-blue-500 transition-all text-sm w-full xl:w-64" 
                  />
                </div>
              </div>
              
              <div className="p-4 border-b border-[#334155] bg-[#1e293b]/50">
                <div className="flex flex-wrap gap-2">
                  {['Quốc gia', 'Thành phố', 'Trình duyệt', 'Hệ điều hành', 'Thiết bị', 'Ngôn ngữ', 'Đường dẫn', 'Tiêu đề', 'Trang vào', 'Trang thoát', 'Nguồn giới thiệu'].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveAnalysisTab(tab)}
                      className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${
                        activeAnalysisTab === tab 
                          ? 'bg-blue-500 text-white shadow-md' 
                          : 'bg-[#334155]/50 text-slate-300 hover:bg-[#334155]'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-6 grid grid-cols-1 xl:grid-cols-2 gap-8">
                {/* Chart Side */}
                <div className="space-y-5 align-middle py-4">
                  <div className="flex justify-end gap-4 mb-2">
                    <div className="flex items-center gap-2"><div className="w-3 h-3 bg-orange-500 rounded-sm"></div><span className="text-slate-400 text-xs">Khách</span></div>
                    <div className="flex items-center gap-2"><div className="w-3 h-3 bg-teal-500 rounded-sm"></div><span className="text-slate-400 text-xs">Lượt xem</span></div>
                  </div>
                  {analysisStats.slice(0, 10).map((stat, idx) => {
                    const maxVal = Math.max(...analysisStats.map(s => Math.max(s.visitorsCount, s.pageviews)), 1);
                    const vPct = (stat.visitorsCount / maxVal) * 100;
                    const pPct = (stat.pageviews / maxVal) * 100;
                    return (
                      <div key={idx} className="flex relative w-full pr-[30px] lg:pr-[100px]">
                        <span className="text-slate-300 text-xs w-[120px] text-right truncate mr-4" title={stat.name}>{stat.name}</span>
                        <div className="w-full flex flex-col gap-1.5 justify-center">
                          <div className="h-2 bg-orange-500/20 rounded-r-full relative border border-orange-500/50" style={{ width: `${Math.max(vPct, 1)}%` }}></div>
                          <div className="h-2 bg-teal-500/20 rounded-r-full relative border border-teal-500/50" style={{ width: `${Math.max(pPct, 1)}%` }}></div>
                        </div>
                      </div>
                    );
                  })}
                  {analysisStats.length === 0 && (
                    <div className="text-slate-500 text-sm italic text-center w-full mt-10">Không tìm thấy dữ liệu</div>
                  )}
                </div>
                {/* Table Side */}
                <div className="overflow-auto border border-[#334155] rounded-xl self-start max-h-[450px]">
                  <table className="w-full text-left bg-[#0f172a]">
                    <thead className="bg-[#1e293b] text-slate-400 text-[10px] uppercase font-bold tracking-wider sticky top-0 z-10">
                      <tr>
                        <th className="px-4 py-3 border-b border-[#334155]">{activeAnalysisTab}</th>
                        <th className="px-4 py-3 border-b border-[#334155] text-right">Khách</th>
                        <th className="px-4 py-3 border-b border-[#334155] text-right">Lượt xem</th>
                        <th className="px-4 py-3 border-b border-[#334155] text-right">Phiên</th>
                        <th className="px-4 py-3 border-b border-[#334155] text-right">Thoát</th>
                        <th className="px-4 py-3 border-b border-[#334155] text-right">Thời gian TB</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#334155] text-sm">
                      {analysisStats.map((stat, idx) => (
                        <tr key={idx} className="hover:bg-[#1e293b]/50">
                          <td className="px-4 py-3 text-slate-200 font-medium truncate max-w-[200px]" title={stat.name}>{stat.name}</td>
                          <td className="px-4 py-3 text-slate-300 font-bold text-right">{stat.visitorsCount}</td>
                          <td className="px-4 py-3 text-slate-400 text-right">{stat.pageviews}</td>
                          <td className="px-4 py-3 text-slate-400 text-right">{stat.sessionsCount}</td>
                          <td className="px-4 py-3 text-slate-400 text-right">{stat.bounces}</td>
                          <td className="px-4 py-3 text-slate-400 text-right">{Math.floor(stat.avgDurationSec / 60)}m {Math.floor(stat.avgDurationSec % 60)}s</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Session Table */}
            <div className="mt-8 bg-[#1e293b] rounded-2xl border border-[#334155] overflow-hidden">
              <div className="p-6 border-b border-[#334155]">
                <h3 className="text-lg font-bold text-white">Recent Sessions</h3>
              </div>
              <table className="w-full text-left">
                <thead className="bg-[#0f172a] text-slate-400 text-[10px] uppercase font-bold tracking-wider">
                  <tr>
                    <th className="px-6 py-4">Visitor/User</th>
                    <th className="px-6 py-4">Network Info</th>
                    <th className="px-6 py-4">Device</th>
                    <th className="px-6 py-4">Events</th>
                    <th className="px-6 py-4">Time (GMT+7)</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#334155]">
                  {(() => {
                    const groupedSessionsMap = new Map();
                    sessions.forEach(session => {
                      const erpId = session.visitor.identityMapping?.user?.erpId;
                      
                      // Grouping key: ERP ID takes priority, otherwise use fingerprint
                      let key;
                      if (erpId) {
                        key = `erp-${erpId}`;
                      } else {
                        const uaSplit = session.userAgent?.split(')')[0] || '';
                        const os = uaSplit.split('(')[1] || 'Unknown OS';
                        const browser = session.userAgent?.includes('Chrome') ? 'Chrome' : session.userAgent?.includes('Safari') ? 'Safari' : 'Other';
                        key = `anon-${session.ip}-${os}-${browser}`;
                      }

                      if (!groupedSessionsMap.has(key)) {
                        groupedSessionsMap.set(key, {
                          ...session,
                          groupedCount: 1,
                          allVisitorIds: [session.visitorId],
                          totalEvents: session.events.length,
                          startedAt: session.startedAt,
                          latestAction: session.updatedAt
                        });
                      } else {
                        const existing = groupedSessionsMap.get(key);
                        existing.groupedCount++;
                        if (!existing.allVisitorIds.includes(session.visitorId)) existing.allVisitorIds.push(session.visitorId);
                        existing.totalEvents += session.events.length;
                        if (new Date(session.startedAt) < new Date(existing.startedAt)) existing.startedAt = session.startedAt;
                        if (new Date(session.updatedAt) > new Date(existing.latestAction)) existing.updatedAt = session.updatedAt;
                        
                        // If current session has more info (identity), update the display session
                        if (!existing.visitor?.identityMapping && session.visitor?.identityMapping) {
                          existing.visitor = session.visitor;
                        }
                      }
                    });

                    const displaySessions = Array.from(groupedSessionsMap.values());
                    
                    return displaySessions.length > 0 ? displaySessions.map((session) => (
                      <tr key={session.id} className="hover:bg-[#334155]/50 transition-all cursor-pointer" onClick={() => setSelectedVisitorId(session.visitorId)}>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-white font-medium text-sm">
                              {session.visitor.identityMapping?.user?.name || session.visitor.identityMapping?.user?.email || 'Anonymous'}
                            </span>
                            <span className="text-slate-500 text-[10px] uppercase tracking-tighter">
                              {session.visitor.identityMapping?.user?.erpId ? `MÃ KH: ${session.visitor.identityMapping.user.erpId}` : `ID: ${session.visitorId.slice(0, 8)}...`}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-slate-300 text-xs font-mono">{session.ip || 'Unknown'}</span>
                            <span className="text-slate-500 text-[10px]">
                              {(() => {
                                 try { const g = JSON.parse(session.location || '{}'); return g.city ? `${g.city}, ${g.country}` : 'Localhost'; } 
                                 catch(e) { return session.location || 'Localhost'; }
                              })()}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col max-w-[150px]">
                            <span className="text-white text-[10px] truncate">{session.userAgent?.split(')')[0].replace('Mozilla/5.0 (', '')}</span>
                            <span className="text-slate-500 text-[10px]">{session.device || 'N/A'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-white font-bold">{session.totalEvents}</span>
                          {session.groupedCount > 1 && <span className="ml-2 text-[9px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded">Merged</span>}
                        </td>
                        <td className="px-6 py-4 text-slate-400 text-sm">
                          {formatFullDate(session.startedAt)}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button className="text-blue-500 hover:text-blue-400">
                            <ArrowRight size={18} />
                          </button>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={6} className="px-6 py-10 text-center text-slate-500">
                          No tracking data available yet. Start your local website to collect data!
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeTab === 'users' && (
          <div className="bg-[#1e293b] rounded-2xl border border-[#334155] overflow-hidden">
            <div className="p-6 border-b border-[#334155]">
              <h3 className="text-lg font-bold text-white">Identified Users</h3>
            </div>
            <table className="w-full text-left">
              <thead className="bg-[#0f172a] text-slate-400 text-xs uppercase font-bold tracking-wider">
                <tr>
                  <th className="px-6 py-4">Name / Email</th>
                  <th className="px-6 py-4">Mã KH (ERP ID)</th>
                  <th className="px-6 py-4">Linked Devices</th>
                  <th className="px-6 py-4">Date First Linked (GMT+7)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#334155]">
                {(() => {
                  const uniqueUsersMap = new Map();
                  sessions.filter(s => s.visitor.identityMapping?.user).forEach(s => {
                    const user = s.visitor.identityMapping!.user!;
                    if (!uniqueUsersMap.has(user.id)) {
                      uniqueUsersMap.set(user.id, {
                        user,
                        firstLinked: s.startedAt,
                        visitorIds: [s.visitorId]
                      });
                    } else {
                      const entry = uniqueUsersMap.get(user.id);
                      if (!entry.visitorIds.includes(s.visitorId)) entry.visitorIds.push(s.visitorId);
                      if (new Date(s.startedAt) < new Date(entry.firstLinked)) entry.firstLinked = s.startedAt;
                    }
                  });
                  
                  const uniqueUsers = Array.from(uniqueUsersMap.values());
                  
                  if (uniqueUsers.length === 0) {
                    return (
                      <tr>
                        <td colSpan={4} className="px-6 py-10 text-center text-slate-500 italic">No identified users found.</td>
                      </tr>
                    );
                  }

                  return uniqueUsers.map((u, idx) => (
                    <tr key={idx} className="hover:bg-[#334155]/50 transition-all border-b border-[#334155]">
                      <td className="px-6 py-4 text-white font-medium">{u.user.name || u.user.email}</td>
                      <td className="px-6 py-4 text-slate-400 font-mono text-xs font-bold text-indigo-400">{u.user.erpId || '-'}</td>
                      <td className="px-6 py-4 text-slate-500 font-mono text-xs uppercase">
                        {u.visitorIds.length} Device{u.visitorIds.length > 1 ? 's' : ''}
                      </td>
                      <td className="px-6 py-4 text-slate-400">{formatFullDate(u.firstLinked)}</td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'events' && (
          <div className="bg-[#1e293b] rounded-2xl border border-[#334155] overflow-hidden">
            <div className="p-6 border-b border-[#334155]">
              <h3 className="text-lg font-bold text-white">All Events</h3>
            </div>
            <table className="w-full text-left">
              <thead className="bg-[#0f172a] text-slate-400 text-[10px] uppercase font-bold tracking-wider">
                <tr>
                  <th className="px-6 py-4">Event Name</th>
                  <th className="px-6 py-4">UTM Source</th>
                  <th className="px-6 py-4">Visitor/User</th>
                  <th className="px-6 py-4">Time (GMT+7)</th>
                  <th className="px-6 py-4">Properties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#334155]">
                {allEvents.length > 0 ? allEvents.slice(0, 50).map((event, idx) => (
                  <tr key={idx} className="hover:bg-[#334155]/50 transition-all border-b border-[#334155]">
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-blue-500/10 text-blue-400 rounded text-[10px] font-bold uppercase">{event.name}</span>
                    </td>
                    <td className="px-6 py-4">
                      {event.properties?.utm_source ? (
                        <div className="flex flex-col">
                          <span className="text-green-500 font-bold text-[10px] uppercase">{event.properties.utm_source}</span>
                          <span className="text-slate-500 text-[10px]">{event.properties.utm_medium || 'no-medium'}</span>
                        </div>
                      ) : (
                        <span className="text-slate-600 text-[10px italic]">direct</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-[10px]">
                      <div className="flex flex-col cursor-pointer" onClick={() => setSelectedVisitorId(event.visitorId)}>
                        <span className="text-white font-medium hover:text-blue-400">{event.userName || event.erpId || event.userEmail || 'Anonymous'}</span>
                        <span className="text-slate-500 hover:text-blue-400">{event.erpId ? `Mã KH: ${event.erpId}` : `${event.visitorId.slice(0, 12)}...`}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-400 text-sm">
                      {formatDate(event.timestamp)}
                    </td>
                    <td className="px-6 py-4">
                      <pre className="text-[10px] text-slate-500 bg-[#0f172a] p-1 rounded max-w-xs truncate">
                        {JSON.stringify(event.properties)}
                      </pre>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-slate-500 italic">No events recorded.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
      
      {/* Session Modal / Detail (Simplified) */}
      {selectedSession && !selectedVisitorId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelectedSession(null)}>
          <div className="bg-[#1e293b] w-full max-w-3xl rounded-3xl border border-[#334155] shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-8">
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h3 className="text-2xl font-bold text-white mb-2">Session Details</h3>
                  <div className="flex gap-4 mt-2">
                    <span className="text-[10px] px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded border border-blue-500/20">IP: {selectedSession.ip || 'Local'}</span>
                    <span className="text-[10px] px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded border border-purple-500/20">{selectedSession.device || 'Unknown Screen'}</span>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedSession(null)}
                  className="p-2 hover:bg-[#334155] rounded-full text-slate-400 text-2xl"
                >
                  &times;
                </button>
              </div>

              <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                {selectedSession.events.map((event) => (
                  <div key={event.id} className="relative pl-8 border-l-2 border-slate-700 pb-6 last:pb-0">
                    <div className="absolute left-[-9px] top-0 w-4 h-4 rounded-full bg-blue-500 border-4 border-[#1e293b]"></div>
                    <div className="flex justify-between items-start mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-bold">{event.name}</span>
                        {event.properties?.utm_source && (
                          <span className="text-[9px] bg-green-500/10 text-green-500 px-1.5 rounded">Source: {event.properties.utm_source}</span>
                        )}
                      </div>
                      <span className="text-slate-500 text-[10px]">
                        {formatDate(event.timestamp)}
                      </span>
                    </div>
                    <pre className="text-[9px] bg-[#0f172a] p-3 rounded-lg text-slate-400 overflow-x-auto">
                      {JSON.stringify(event.properties, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* User Profile Modal */}
      {selectedVisitorId && vp && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 fade-in" onClick={() => setSelectedVisitorId(null)}>
          <div className="bg-white text-slate-800 w-full max-w-4xl max-h-[90vh] rounded-[24px] shadow-2xl overflow-hidden flex flex-col relative font-sans" onClick={e => e.stopPropagation()}>
            <button 
              onClick={() => setSelectedVisitorId(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors z-10"
            >
              &times;
            </button>
            <div className="p-10 flex-1 overflow-y-auto">
              
              {/* Header */}
              <div className="flex flex-col items-center mb-10">
                <div className="w-24 h-24 rounded-full bg-emerald-50 border-[6px] border-white shadow-sm flex items-center justify-center text-emerald-600 font-bold text-xl relative mb-4">
                  {vp.name ? vp.name[0].toUpperCase() : (vp.email ? vp.email[0].toUpperCase() : <User size={32} />)}
                  <div className="absolute bottom-1 right-1 w-5 h-5 bg-emerald-500 border-4 border-white rounded-full"></div>
                </div>
                <h3 className="text-2xl font-black text-slate-900 tracking-tight">{vp.name || vp.email || 'THÔNG TIN PHIÊN'}</h3>
                {vp.email && <p className="text-slate-500 text-sm mb-4">{vp.email}</p>}
                {!vp.email && <p className="text-slate-500 text-sm mb-4">Khám phá hành trình và thuộc tính của người dùng</p>}
                
                <div className="flex gap-3">
                  {vp.erpId ? (
                    <div className="flex items-center gap-2 bg-indigo-50 px-5 py-2.5 rounded-full border border-indigo-200 text-indigo-700 text-sm font-black shadow-sm ring-4 ring-indigo-50/50">
                      MÃ KH: {vp.erpId}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-full border border-slate-200 text-slate-500 text-xs shadow-sm">
                      <User size={14} />
                      <span className="font-mono">{selectedVisitorId.slice(0, 15)}...</span>
                      <Copy size={14} className="cursor-pointer hover:text-slate-800" />
                    </div>
                  )}
                </div>
              </div>

              {(vp.latestPreviewProducts.length > 0 || vp.orderNos.length > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                  {vp.latestPreviewProducts.length > 0 && (
                    <div className="rounded-2xl p-5 border border-amber-100 bg-amber-50/40 shadow-sm">
                      <div className="flex items-center gap-2 text-amber-800 font-bold text-xs uppercase tracking-wider mb-3">
                        <ShoppingCart size={16} />
                        Sản phẩm đang mua (mới nhất)
                      </div>
                      <ul className="space-y-1.5 text-sm text-slate-800">
                        {vp.latestPreviewProducts.map((n, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-amber-600 font-bold">·</span>
                            <span>{n}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {vp.orderNos.length > 0 && (
                    <div className="rounded-2xl p-5 border border-emerald-100 bg-emerald-50/40 shadow-sm">
                      <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs uppercase tracking-wider mb-3">
                        <Package size={16} />
                        Mã đơn hàng
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {vp.orderNos.map((no) => (
                          <span
                            key={no}
                            className="font-mono text-xs font-bold bg-white border border-emerald-200 text-emerald-800 px-2.5 py-1 rounded-lg"
                          >
                            {no}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-4 mb-8">
                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] flex flex-col items-center text-center">
                  <div className="p-3 bg-blue-50 text-blue-500 rounded-full mb-3 shadow-sm"><MapPin size={20} /></div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mb-1">Visits</span>
                  <span className="text-3xl font-black text-slate-800">{vp.visits}</span>
                </div>
                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] flex flex-col items-center text-center">
                  <div className="p-3 bg-emerald-50 text-emerald-500 rounded-full mb-3 shadow-sm"><Eye size={20} /></div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mb-1">Views</span>
                  <span className="text-3xl font-black text-slate-800">{vp.views}</span>
                </div>
                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] flex flex-col items-center text-center">
                  <div className="p-3 bg-orange-50 text-orange-500 rounded-full mb-3 shadow-sm"><Activity size={20} /></div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mb-1">Events</span>
                  <span className="text-3xl font-black text-slate-800">{vp.events}</span>
                </div>
                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] flex flex-col items-center text-center">
                  <div className="p-3 bg-indigo-50 text-indigo-500 rounded-full mb-3 shadow-sm"><Timer size={20} /></div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mb-1">Visit Duration</span>
                  <span className="text-3xl font-black text-slate-800">{vp.durationSec}s</span>
                </div>
              </div>

              {/* Attributes Card */}
              <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] mb-8">
                <div className="grid grid-cols-4 gap-y-6 gap-x-4">
                  <div>
                    <div className="flex items-center gap-1.5 text-slate-400 mb-1"><Globe size={12} className="uppercase font-bold text-[9px] tracking-wider" /> <span className="uppercase font-bold text-[9px] tracking-wider">{vp.erpId ? 'Mã KH' : 'Distinct ID'}</span></div>
                    <div className="text-slate-800 font-bold text-sm">{vp.erpId || '-'}</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-slate-400 mb-1"><Clock size={12} className="uppercase font-bold text-[9px] tracking-wider" /> <span className="uppercase font-bold text-[9px] tracking-wider">Last Seen</span></div>
                    <div className="text-slate-800 font-medium text-sm capitalize">{formatDistanceToNow(vp.lastSeen, { locale: vi, addSuffix: true })}</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-slate-400 mb-1"><Clock size={12} className="uppercase font-bold text-[9px] tracking-wider" /> <span className="uppercase font-bold text-[9px] tracking-wider">First Seen</span></div>
                    <div className="text-slate-800 font-medium text-sm capitalize">{formatDistanceToNow(vp.firstSeen, { locale: vi, addSuffix: true })}</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-slate-400 mb-1"><MapPin size={12} className="uppercase font-bold text-[9px] tracking-wider" /> <span className="uppercase font-bold text-[9px] tracking-wider">Country</span></div>
                    <div className="text-slate-800 font-medium text-sm">{vp.geo.country}</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-slate-400 mb-1"><MapPin size={12} className="uppercase font-bold text-[9px] tracking-wider" /> <span className="uppercase font-bold text-[9px] tracking-wider">City</span></div>
                    <div className="text-slate-800 font-medium text-sm">{vp.geo.city}</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-slate-400 mb-1"><Globe size={12} className="uppercase font-bold text-[9px] tracking-wider" /> <span className="uppercase font-bold text-[9px] tracking-wider">Browser</span></div>
                    <div className="text-slate-800 font-medium text-sm">{vp.browser}</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-slate-400 mb-1"><Activity size={12} className="uppercase font-bold text-[9px] tracking-wider" /> <span className="uppercase font-bold text-[9px] tracking-wider">OS</span></div>
                    <div className="text-slate-800 font-medium text-sm">{vp.os}</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-slate-400 mb-1"><Monitor size={12} className="uppercase font-bold text-[9px] tracking-wider" /> <span className="uppercase font-bold text-[9px] tracking-wider">Device</span></div>
                    <div className="text-slate-800 font-medium text-sm">{vp.device}</div>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="border-b border-slate-100 flex gap-6 mb-8">
                <div className="pb-3 border-b-2 border-emerald-500 text-emerald-600 font-bold text-sm tracking-wide">Activity</div>
                <div className="pb-3 text-slate-400 font-medium text-sm hover:text-slate-600 cursor-pointer transition-colors tracking-wide">Properties</div>
              </div>

              {/* Timeline */}
              <div className="relative pl-6">
                <div className="absolute left-[30px] top-6 bottom-0 w-0.5 bg-slate-100"></div>
                {/* Group events by day implicitly by just listing them, we will show date header if it's new, but simple map works for now */}
                {vp.vEvents.map((evt: any, i: number, arr: any[]) => {
                  const currDate = format(new Date(evt.timestamp), 'EEEE, MMMM d, yyyy');
                  const prevDate = i > 0 ? format(new Date(arr[i-1].timestamp), 'EEEE, MMMM d, yyyy') : null;
                  const showHeader = currDate !== prevDate;
                  
                  return (
                    <div key={evt.id} className="mb-6 relative">
                      {showHeader && (
                        <div className="mb-4 -ml-6 border-l-[3px] border-emerald-500 pl-4 py-0.5 mt-8 first:mt-0">
                          <h4 className="text-[11px] font-black uppercase text-slate-800 tracking-widest">{currDate}</h4>
                        </div>
                      )}
                      <div className="flex items-start gap-8 z-10 relative">
                        <div className="absolute -left-1.5 top-1.5 w-3 h-3 bg-emerald-500 rounded-full border-[3px] border-white shadow-sm z-20"></div>
                        <div className="w-24 mt-1 text-slate-400 text-[10px] font-bold text-right shrink-0 font-mono tracking-tighter">
                          {format(new Date(evt.timestamp), 'hh:mm:ss a')}
                        </div>
                        <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 w-full flex flex-col gap-2 group hover:border-slate-300 transition-colors">
                          <div className="flex justify-between items-center w-full">
                            <div className="flex items-center gap-3 w-full min-w-0">
                              <Eye size={16} className="text-slate-400 shrink-0" />
                              <span className="text-slate-500 text-xs font-semibold shrink-0">
                                {evt.name === 'pageview'
                                  ? 'Viewed page'
                                  : evt.name === 'checkout_preview'
                                    ? 'Giỏ thanh toán'
                                    : evt.name === 'checkout_success'
                                      ? 'Đặt hàng'
                                      : 'Triggered'}
                              </span>
                              <span className="text-slate-900 text-xs font-bold font-mono bg-white px-2 py-0.5 rounded border border-slate-200 truncate">
                                {evt.name === 'checkout_success' && evt.properties?.orderNo
                                  ? `orderNo: ${evt.properties.orderNo}`
                                  : evt.properties?.title || evt.name}
                              </span>
                              {evt.properties?.url && (
                                <span className="text-slate-400 text-[10px] font-mono border-l border-slate-200 pl-3 ml-1 truncate max-w-[200px]" title={evt.properties.url}>
                                  {(() => {
                                    try { return new URL(evt.properties.url).pathname + new URL(evt.properties.url).search } 
                                    catch(e) { return evt.properties.url }
                                  })()}
                                </span>
                              )}
                            </div>
                            {evt.properties?.utm_source && (
                              <span className="text-[9px] bg-indigo-50 border border-indigo-100 text-indigo-500 font-bold px-2 py-1 rounded-full uppercase shrink-0">
                                src: {evt.properties.utm_source}
                              </span>
                            )}
                          </div>
                          {evt.name === 'checkout_preview' && Array.isArray(evt.properties?.productNames) && evt.properties.productNames.length > 0 && (
                            <div className="flex flex-wrap gap-1 pl-7">
                              {(evt.properties.productNames as string[]).map((n: string, pi: number) => (
                                <span
                                  key={pi}
                                  className="text-[9px] bg-amber-100 text-amber-900 border border-amber-200 px-1.5 py-0.5 rounded max-w-full truncate"
                                  title={n}
                                >
                                  {n}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
