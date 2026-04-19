// src/components/WhoIsFreePanel.jsx
// Shows current TLI band + capacity label per intern — simplest panel, build first.

import { useEffect, useState } from 'react';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:5000';

const bandColor = {
  Low:      'bg-green-100  text-green-800',
  Moderate: 'bg-yellow-100 text-yellow-800',
  High:     'bg-red-100    text-red-800',
};

export default function WhoIsFreePanel() {
  const [interns, setInterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    axios.get(`${API}/tasks/overview`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setInterns(res.data.data ?? []))
      .catch(() => setError('Could not load availability data.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-4 text-gray-500">Loading availability...</div>;
  if (error)   return <div className="p-4 text-red-500">{error}</div>;

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Who Is Free</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2 pr-4">Intern</th>
              <th className="pb-2 pr-4">TLI</th>
              <th className="pb-2 pr-4">Load Band</th>
              <th className="pb-2 pr-4">Active Tasks</th>
              <th className="pb-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {interns.map(intern => (
              <tr key={intern.internId} className="border-b last:border-0 hover:bg-gray-50">
                <td className="py-3 pr-4 font-medium text-gray-800">{intern.internId}</td>
                <td className="py-3 pr-4 text-gray-600">{intern.tli.toFixed(2)}</td>
                <td className="py-3 pr-4">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${bandColor[intern.tliBand]}`}>
                    {intern.tliBand}
                  </span>
                </td>
                <td className="py-3 pr-4 text-gray-600">{intern.activeTasks}</td>
                <td className="py-3 flex gap-1 flex-wrap">
                  {intern.hasStale   && <span className="px-2 py-0.5 rounded-full text-xs bg-orange-100 text-orange-700">Stale</span>}
                  {intern.hasBlocker && <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">Blocked</span>}
                  {!intern.hasStale && !intern.hasBlocker && <span className="text-gray-400 text-xs">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
