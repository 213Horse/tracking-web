import { useEffect, useState } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Users, MousePointer2, Clock, Search, ArrowRight, LayoutDashboard, Database, Activity, UserCheck, MapPin, Eye, Copy, User, Globe, Monitor, Timer } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { vi } from 'date-fns/locale';

interface Event {
  id: string;
  name: string;
  timestamp: string;
  properties: any;
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

const App = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [activeUsers, setActiveUsers] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users' | 'events'>('dashboard');
  const [selectedVisitorId, setSelectedVisitorId] = useState<string | null>(null);

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
        .then(data => setActiveUsers(data.count))
        .catch(err => console.error(err));
    };

    fetchData();
    const interval = setInterval(fetchData, 10000); // Polling every 10s
    return () => clearInterval(interval);
  }, []);

  const totalEvents = sessions.reduce((acc, s) => acc + s.events.length, 0);
  const identifiedUsers = Array.from(new Set(sessions.map(s => s.visitor.identityMapping?.user?.id).filter(Boolean))).length;
  
  const chartData = sessions.slice(0, 10).map(s => ({
    name: formatDate(s.startedAt),
    events: s.events.length
  })).reverse();

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

    return {
      email: latest.visitor?.identityMapping?.user?.email,
      name: latest.visitor?.identityMapping?.user?.name,
      erpId: latest.visitor?.identityMapping?.user?.erpId,
      vSessions, vEvents, visits: vSessions.length, views, events: vEvents.length - views, durationSec, firstSeen, lastSeen, geo, browser, os,
      device: latest.device?.includes('x') ? 'Desktop/Laptop' : 'Mobile'
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {[
                { label: 'Live Users', value: activeUsers, icon: Activity, color: 'text-red-500', pulse: true },
                { label: 'Total Sessions', value: sessions.length, icon: Clock, color: 'text-blue-500' },
                { label: 'Total Events', value: totalEvents, icon: MousePointer2, color: 'text-purple-500' },
                { label: 'Identified Users', value: identifiedUsers, icon: UserCheck, color: 'text-green-500' },
              ].map((stat) => (
                <div key={stat.label} className="bg-[#1e293b] p-6 rounded-2xl border border-[#334155] hover:border-[#475569] transition-all relative overflow-hidden group">
                  {stat.pulse && (
                    <div className="absolute top-0 right-0 p-2">
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-start mb-4">
                    <div className={`p-3 rounded-xl bg-[#0f172a] ${stat.color}`}>
                      <stat.icon size={24} />
                    </div>
                  </div>
                  <h3 className="text-slate-400 text-sm font-medium">{stat.label}</h3>
                  <p className="text-3xl font-bold text-white mt-1">{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Charts & Tables */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
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
                        <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 w-full flex justify-between items-center group hover:border-slate-300 transition-colors">
                          <div className="flex items-center gap-3 w-full">
                            <Eye size={16} className="text-slate-400 shrink-0" />
                            <span className="text-slate-500 text-xs font-semibold shrink-0">{evt.name === 'pageview' ? 'Viewed page' : 'Triggered'}</span>
                            <span className="text-slate-900 text-xs font-bold font-mono bg-white px-2 py-0.5 rounded border border-slate-200 truncate">
                              {evt.properties?.title || evt.name}
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
                            <span className="text-[9px] bg-indigo-50 border border-indigo-100 text-indigo-500 font-bold px-2 py-1 rounded-full uppercase">
                              src: {evt.properties.utm_source}
                            </span>
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
