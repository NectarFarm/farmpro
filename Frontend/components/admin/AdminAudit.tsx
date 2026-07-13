'use client';
// System audit trail for the super-admin: who did what to which farm, filterable
// by farm. Entries survive a farm's deletion, so there's always a forensic record.
import { useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';

interface Entry {
  id: string; tenantId: string; farm: string; actor: string; action: string;
  entity: string | null; meta: unknown; at: string;
}

const ACTION_TINT: Record<string, string> = {
  'tenant.create': 'text-green-700 bg-green-50', 'tenant.delete': 'text-red-700 bg-red-50',
  'tenant.suspend': 'text-amber-700 bg-amber-50', 'tenant.reactivate': 'text-green-700 bg-green-50',
};

export function AdminAudit() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [farms, setFarms] = useState<{ id: string; name: string }[]>([]);
  const [farm, setFarm] = useState(''); // '' = all
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = (tenantId: string) => {
    setLoading(true);
    fetch(`/api/admin/audit${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { farms: [], entries: [] })
      .then(d => { setEntries(d.entries ?? []); if (d.farms) setFarms(d.farms); })
      .catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { if (open) load(farm); }, [open, farm]);  

  const detail = (e: Entry) => {
    const m = e.meta as Record<string, unknown> | null;
    if (!m) return e.entity ?? '';
    const parts = Object.entries(m).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
    return [e.entity, ...parts].filter(Boolean).join(' · ');
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3">
      <button onClick={() => setOpen(v => !v)} className="flex items-center justify-between text-left">
        <div className="flex items-center gap-2.5">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
            <ScrollText className="w-4 h-4 text-indigo-700" />
          </div>
          <div>
            <h2 className="font-bold text-gray-800">Audit log</h2>
            <p className="text-xs text-gray-400">Who did what to each farm. Survives farm deletion.</p>
          </div>
        </div>
        <span className="text-xs font-semibold text-gray-400">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-gray-500">Farm</label>
            <select value={farm} onChange={e => setFarm(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-xs">
              <option value="">All farms</option>
              {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <button onClick={() => load(farm)} className="px-2 py-1 bg-gray-100 rounded-lg text-xs font-semibold text-gray-600">Refresh</button>
            {loading && <span className="text-xs text-gray-400">loading…</span>}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-400 font-semibold border-b">
                <tr>
                  <th className="text-left py-2 pr-3 whitespace-nowrap">When</th>
                  <th className="text-left py-2 pr-3">Farm</th>
                  <th className="text-left py-2 pr-3">Action</th>
                  <th className="text-left py-2 pr-3">By</th>
                  <th className="text-left py-2">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {entries.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50 align-top">
                    <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">{new Date(e.at).toLocaleString('en-KE')}</td>
                    <td className="py-2 pr-3 font-medium text-gray-700">{e.farm}</td>
                    <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded font-mono text-[11px] ${ACTION_TINT[e.action] ?? 'text-gray-600 bg-gray-100'}`}>{e.action}</span></td>
                    <td className="py-2 pr-3 text-gray-600">{e.actor}</td>
                    <td className="py-2 text-gray-500">{detail(e)}</td>
                  </tr>
                ))}
                {entries.length === 0 && !loading && (
                  <tr><td colSpan={5} className="py-4 text-center text-gray-400">No audit entries{farm ? ' for this farm' : ''} yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
