// src/pages/LeadDashboard.jsx
// Main lead-facing page. Assembles all four panels + OpenProject Gantt embed.
// Protected — only accessible after login with ADMIN role.

import { useEffect, useState } from 'react';
import axios from 'axios';
import WhoIsFreePanel      from '../components/WhoIsFreePanel';
import TaskMonitoringPanel from '../components/TaskMonitoringPanel';
import AlertsPanel         from '../components/AlertsPanel';

const API              = import.meta.env.VITE_API_URL         ?? 'http://localhost:5000';
const OPENPROJECT_URL  = import.meta.env.VITE_OPENPROJECT_URL ?? 'https://openproject.yourcompany.com';

// Capacity label → colour
const capacityColor = {
  'High availability and low workload': 'text-green-600',
  'Moderate availability':              'text-yellow-600',
  'High workload or low availability':  'text-red-600',
};

// ─── Capacity Score Table ────────────────────────────────────────────────────
function CapacityTable() {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    // Fetch final capacity for all interns by calling the tasks overview
    // then enriching with credibility — in a real system this would be a
    // single /capacity/overview endpoint; for now we compose from existing APIs.
    axios.get(`${API}/tasks/overview`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setRows(res.data.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-4 text-gray-400 text-sm">Loading capacity data...</div>;

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Capacity Overview</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2 pr-4">Intern</th>
              <th className="pb-2 pr-4">TLI</th>
              <th className="pb-2 pr-4">Load Band</th>
              <th className="pb-2 pr-4">Active</th>
              <th className="pb-2 pr-4">Stale</th>
              <th className="pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.internId} className="border-b last:border-0 hover:bg-gray-50">
                <td className="py-3 pr-4 font-medium">{r.internId}</td>
                <td className="py-3 pr-4">{r.tli.toFixed(2)}</td>
                <td className="py-3 pr-4">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                    r.tliBand === 'Low' ? 'bg-green-100 text-green-700' :
                    r.tliBand === 'Moderate' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>{r.tliBand}</span>
                </td>
                <td className="py-3 pr-4">{r.activeTasks}</td>
                <td className="py-3 pr-4">{r.staleTasks > 0 ? <span className="text-orange-600 font-semibold">{r.staleTasks}</span> : <span className="text-gray-400">0</span>}</td>
                <td className="py-3">
                  {r.hasBlocker ? <span className="text-xs text-red-600 font-medium">🚧 Blocked</span> :
                   r.hasStale   ? <span className="text-xs text-orange-500 font-medium">⚠ Stale</span> :
                                  <span className="text-xs text-green-600">✓ Clear</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── OpenProject Gantt Embed ─────────────────────────────────────────────────
function GanttEmbed() {
  return (
    <div className="bg-white rounded-xl shadow p-5">
      <h2 className="text-lg font-semibold text-gray-800 mb-3">Timeline (OpenProject)</h2>
      <iframe
        src={`${OPENPROJECT_URL}/projects/uris/work_packages?query_props=%7B%22t%22%3A%22startDate%3Aasc%22%7D`}
        className="w-full rounded-lg border border-gray-200"
        style={{ height: '400px' }}
        title="OpenProject Gantt Timeline"
        sandbox="allow-same-origin allow-scripts allow-forms"
      />
    </div>
  );
}

// ─── Main Dashboard Page ─────────────────────────────────────────────────────
export default function LeadDashboard() {
  const [activeTab, setActiveTab] = useState('overview');

  const tabs = [
    { id: 'overview',  label: 'Overview'      },
    { id: 'tasks',     label: 'Task Monitor'  },
    { id: 'alerts',    label: 'Alerts'        },
    { id: 'timeline',  label: 'Timeline'      },
  ];

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Top bar */}
      <header className="bg-white border-b shadow-sm px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">URIS — Lead Dashboard</h1>
          <p className="text-xs text-gray-400">Unified Resource Intelligence System V3</p>
        </div>
        <button
          onClick={() => { localStorage.removeItem('token'); window.location.href = '/login'; }}
          className="text-sm text-gray-500 hover:text-red-600"
        >
          Sign out
        </button>
      </header>

      {/* Tab nav */}
      <nav className="bg-white border-b px-6">
        <div className="flex gap-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Page content */}
      <main className="max-w-7xl mx-auto px-4 py-6 flex flex-col gap-6">
        {activeTab === 'overview' && (
          <>
            <WhoIsFreePanel />
            <CapacityTable />
          </>
        )}
        {activeTab === 'tasks'    && <TaskMonitoringPanel />}
        {activeTab === 'alerts'   && <AlertsPanel />}
        {activeTab === 'timeline' && <GanttEmbed />}
      </main>
    </div>
  );
}
