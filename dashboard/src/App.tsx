import { useEffect, useState } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Users, MousePointer2, Clock, ShieldCheck, Search, ArrowRight, LayoutDashboard, Database, Activity, UserCheck } from 'lucide-react';
import { format } from 'date-fns';

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
  events: Event[];
  visitor: {
    identityMapping?: {
      user: {
        id: string;
        email: string;
      }
    }
  }
}

const App = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  useEffect(() => {
    fetch('http://localhost:3001/api/v1/analytics/sessions')
      .then(res => res.json())
      .then(data => {
        setSessions(data);
      })
      .catch(err => console.error(err));
  }, []);

  const totalEvents = sessions.reduce((acc, s) => acc + s.events.length, 0);
  const identifiedUsers = Array.from(new Set(sessions.map(s => s.visitor.identityMapping?.user?.id).filter(Boolean))).length;
  
  const chartData = sessions.slice(0, 10).map(s => ({
    name: format(new Date(s.startedAt), 'HH:mm'),
    events: s.events.length
  })).reverse();

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 bg-[#1e293b] border-r border-[#334155] p-6 hidden lg:block">
        <div className="flex items-center gap-2 mb-10">
          <Activity className="text-blue-500 w-8 h-8" />
          <h1 className="text-xl font-bold tracking-tight text-white">TrackFlow</h1>
        </div>
        
        <nav className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-blue-600/10 text-blue-400 rounded-lg cursor-pointer">
            <LayoutDashboard size={20} />
            <span className="font-semibold">Dashboard</span>
          </div>
          <div className="flex items-center gap-3 p-3 text-slate-400 hover:bg-[#334155] rounded-lg cursor-pointer transition-all">
            <Users size={20} />
            <span>Users</span>
          </div>
          <div className="flex items-center gap-3 p-3 text-slate-400 hover:bg-[#334155] rounded-lg cursor-pointer transition-all">
            <Database size={20} />
            <span>Raw Events</span>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="lg:ml-64 p-8">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white">Analytics Overview</h2>
            <p className="text-slate-400">Real-time behavior tracking data</p>
          </div>
          <div className="flex gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
              <input type="text" placeholder="Search sessions..." className="bg-[#1e293b] border border-[#334155] rounded-lg pl-10 pr-4 py-2 outline-none focus:border-blue-500 transition-all text-sm w-64" />
            </div>
          </div>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {[
            { label: 'Total Sessions', value: sessions.length, icon: Clock, color: 'text-blue-500' },
            { label: 'Total Events', value: totalEvents, icon: MousePointer2, color: 'text-purple-500' },
            { label: 'Identified Users', value: identifiedUsers, icon: UserCheck, color: 'text-green-500' },
            { label: 'Visitor ID Link', value: '100%', icon: ShieldCheck, color: 'text-orange-500' },
          ].map((stat) => (
            <div key={stat.label} className="bg-[#1e293b] p-6 rounded-2xl border border-[#334155] hover:border-[#475569] transition-all">
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
                  <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
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
              {['Chrome', 'Safari', 'Firefox', 'Mobile Safari'].map((browser, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className="text-slate-400 text-sm">{browser}</span>
                  <div className="flex-1 mx-4 h-1.5 bg-[#0f172a] rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500" style={{ width: `${80 - (idx * 15)}%` }}></div>
                  </div>
                  <span className="text-white text-sm font-bold">{80 - (idx * 15)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Session Table */}
        <div className="mt-8 bg-[#1e293b] rounded-2xl border border-[#334155] overflow-hidden">
          <div className="p-6 border-b border-[#334155]">
            <h3 className="text-lg font-bold text-white">Recent Sessions</h3>
          </div>
          <table className="w-full text-left">
            <thead className="bg-[#0f172a] text-slate-400 text-xs uppercase font-bold tracking-wider">
              <tr>
                <th className="px-6 py-4">Visitor/User</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Events</th>
                <th className="px-6 py-4">Time</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#334155]">
              {sessions.map((session) => (
                <tr key={session.id} className="hover:bg-[#334155]/50 transition-all cursor-pointer" onClick={() => setSelectedSession(session)}>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="text-white font-medium text-sm">
                        {session.visitor.identityMapping?.user?.email || 'Anonymous'}
                      </span>
                      <span className="text-slate-500 text-[10px] uppercase tracking-tighter">
                        ID: {session.visitorId.slice(0, 8)}...
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {session.visitor.identityMapping?.user ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10 text-green-500 text-[10px] font-bold uppercase">
                        <ShieldCheck size={10} /> Identified
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded-full bg-slate-500/10 text-slate-500 text-[10px] font-bold uppercase">
                        Anonymous
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-white font-bold">{session.events.length}</span>
                  </td>
                  <td className="px-6 py-4 text-slate-400 text-sm">
                    {format(new Date(session.startedAt), 'MMM dd, HH:mm')}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="text-blue-500 hover:text-blue-400">
                      <ArrowRight size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
      
      {/* Session Modal / Detail (Simplified) */}
      {selectedSession && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1e293b] w-full max-w-2xl rounded-3xl border border-[#334155] shadow-2xl overflow-hidden">
            <div className="p-8">
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h3 className="text-2xl font-bold text-white mb-2">Session Details</h3>
                  <p className="text-slate-400 text-sm">Full timeline of user interactions</p>
                </div>
                <button 
                  onClick={() => setSelectedSession(null)}
                  className="p-2 hover:bg-[#334155] rounded-full text-slate-400"
                >
                  &times;
                </button>
              </div>

              <div className="space-y-6">
                {selectedSession.events.map((event) => (
                  <div key={event.id} className="relative pl-8 border-l-2 border-slate-700 pb-6 last:pb-0">
                    <div className="absolute left-[-9px] top-0 w-4 h-4 rounded-full bg-blue-500 border-4 border-[#1e293b]"></div>
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-white font-bold">{event.name}</span>
                      <span className="text-slate-500 text-xs">
                        {format(new Date(event.timestamp), 'HH:mm:ss')}
                      </span>
                    </div>
                    <pre className="text-[10px] bg-[#0f172a] p-3 rounded-lg text-slate-400 overflow-x-auto">
                      {JSON.stringify(event.properties, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
