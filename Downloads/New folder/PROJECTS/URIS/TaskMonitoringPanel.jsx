// src/components/TaskMonitoringPanel.jsx
// Per-intern task list with stale highlighting, progress bars, and blocker flags.

import { useEffect, useState } from 'react';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:5000';

const statusStyles = {
  active:    'bg-blue-100   text-blue-700',
  stale:     'bg-orange-100 text-orange-700',
  blocked:   'bg-red-100    text-red-700',
  completed: 'bg-green-100  text-green-700',
};

function ProgressBar({ pct }) {
  const color = pct === 100 ? 'bg-green-500' : pct >= 50 ? 'bg-blue-500' : 'bg-yellow-400';
  return (
    <div className="w-full bg-gray-100 rounded-full h-2 mt-1">
      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function TaskMonitoringPanel() {
  const [overview, setOverview] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [expanded, setExpanded] = useState({}); // { internId: bool }

  useEffect(() => {
    const token = localStorage.getItem('token');
    axios.get(`${API}/tasks/overview`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setOverview(res.data.data ?? []))
      .catch(() => setError('Could not load task data.'))
      .finally(() => setLoading(false));
  }, []);

  function toggle(internId) {
    setExpanded(prev => ({ ...prev, [internId]: !prev[internId] }));
  }

  if (loading) return <div className="p-4 text-gray-500">Loading tasks...</div>;
  if (error)   return <div className="p-4 text-red-500">{error}</div>;

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Task Monitor</h2>
      <div className="flex flex-col gap-3">
        {overview.map(intern => (
          <div key={intern.internId} className="border rounded-lg overflow-hidden">

            {/* Intern header row */}
            <button
              onClick={() => toggle(intern.internId)}
              className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="font-medium text-gray-800">{intern.internId}</span>
                {intern.hasStale   && <span className="px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-700">⚠ Stale</span>}
                {intern.hasBlocker && <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700">🚧 Blocked</span>}
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-500">
                <span>Active: {intern.activeTasks}</span>
                <span>TLI: {intern.tli.toFixed(2)}</span>
                <span className="text-gray-400">{expanded[intern.internId] ? '▲' : '▼'}</span>
              </div>
            </button>

            {/* Expanded task list */}
            {expanded[intern.internId] && (
              <div className="divide-y">
                {intern.tasks.length === 0 && (
                  <p className="p-4 text-sm text-gray-400">No tasks assigned.</p>
                )}
                {intern.tasks.map(task => (
                  <div key={task.id} className={`p-4 ${task.status === 'stale' ? 'bg-orange-50' : 'bg-white'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800">{task.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusStyles[task.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {task.status}
                          </span>
                          {task.hasBlocker && (
                            <span className="text-xs text-red-600">🚧 Blocker active</span>
                          )}
                          {task.deadline && (
                            <span className="text-xs text-gray-400">
                              Due: {new Date(task.deadline).toLocaleDateString('en-IN')}
                            </span>
                          )}
                        </div>
                        <ProgressBar pct={task.progressPct} />
                        <p className="text-xs text-gray-400 mt-1">{task.progressPct}% complete · Complexity {task.complexity}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
