// src/components/AlertsPanel.jsx
// Displays all active system alerts. Lead can resolve them individually.

import { useEffect, useState } from 'react';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:5000';

const typeStyles = {
  stale_task:          { bg: 'bg-orange-50 border-orange-300', badge: 'bg-orange-100 text-orange-700', label: 'Stale Task'        },
  blocker_escalation:  { bg: 'bg-red-50    border-red-300',    badge: 'bg-red-100    text-red-700',    label: 'Blocker Escalation' },
  compliance_failure:  { bg: 'bg-yellow-50 border-yellow-300', badge: 'bg-yellow-100 text-yellow-700', label: 'Compliance Failure' },
  reassignment:        { bg: 'bg-blue-50   border-blue-300',   badge: 'bg-blue-100   text-blue-700',   label: 'Reassignment'       },
};

function formatDate(iso) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AlertsPanel() {
  const [alerts,   setAlerts]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [resolving, setResolving] = useState(null); // alertId being resolved

  const token = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => { fetchAlerts(); }, []);

  function fetchAlerts() {
    setLoading(true);
    axios.get(`${API}/alerts`, { headers })
      .then(res => setAlerts(res.data.data ?? []))
      .catch(() => setError('Could not load alerts.'))
      .finally(() => setLoading(false));
  }

  async function handleResolve(alertId) {
    setResolving(alertId);
    try {
      await axios.patch(`${API}/alerts/${alertId}/resolve`, {}, { headers });
      setAlerts(prev => prev.filter(a => a.id !== alertId));
    } catch {
      alert('Failed to resolve alert.');
    } finally {
      setResolving(null);
    }
  }

  if (loading) return <div className="p-4 text-gray-500">Loading alerts...</div>;
  if (error)   return <div className="p-4 text-red-500">{error}</div>;

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">
          Active Alerts
          {alerts.length > 0 && (
            <span className="ml-2 px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">{alerts.length}</span>
          )}
        </h2>
        <button onClick={fetchAlerts} className="text-sm text-blue-600 hover:underline">Refresh</button>
      </div>

      {alerts.length === 0 && (
        <p className="text-gray-400 text-sm">No active alerts. All systems clear.</p>
      )}

      <div className="flex flex-col gap-3">
        {alerts.map(alert => {
          const style = typeStyles[alert.type] ?? typeStyles.stale_task;
          return (
            <div key={alert.id} className={`border rounded-lg p-4 ${style.bg}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${style.badge}`}>
                      {style.label}
                    </span>
                    <span className="text-xs text-gray-400">{formatDate(alert.createdAt)}</span>
                  </div>
                  <p className="text-sm text-gray-700">{alert.message}</p>
                  <p className="text-xs text-gray-400 mt-1">Intern: {alert.internId}</p>
                </div>
                <button
                  onClick={() => handleResolve(alert.id)}
                  disabled={resolving === alert.id}
                  className="shrink-0 text-xs px-3 py-1.5 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  {resolving === alert.id ? 'Resolving...' : 'Resolve'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
