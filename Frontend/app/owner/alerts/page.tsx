'use client';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Alert } from '@/lib/types';
import { alertDestination } from '@/lib/alerts';
import { StatusChip } from '@/components/worker/StatusChip';

export default function AlertsPage() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [acked, setAcked] = useState<Set<string>>(new Set());

  const [rules, setRules] = useState<{ metric: string; label: string; threshold: number; unit: string; severity: string; enabled: boolean }[]>([]);
  const [rulesSaved, setRulesSaved] = useState(false);
  const [rulesErr, setRulesErr] = useState('');
  const [checking, setChecking] = useState(false);

  const load = async () => {
    try { await fetch('/api/alerts/evaluate', { method: 'POST', credentials: 'include' }); } catch { /* ignore (mock mode) */ }
    api.getAlerts().then(setAlerts);
  };
  const runChecks = async () => { setChecking(true); await load(); setChecking(false); };

  useEffect(() => {
    load();
    fetch('/api/alert-rules', { credentials: 'include' }).then(r => r.ok ? r.json() : []).then(setRules).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setRule = (i: number, patch: Partial<{ threshold: number; enabled: boolean }>) =>
    setRules(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  const saveRules = async () => {
    setRulesErr('');
    try {
      const res = await fetch('/api/alert-rules', {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules }),
      });
      if (!res.ok) throw new Error(res.status === 403 ? 'Owner only' : res.status === 401 ? 'Please sign in again' : 'Save failed');
      setRulesSaved(true); setTimeout(() => setRulesSaved(false), 2000);
    } catch (e) { setRulesErr((e as Error).message); }
  };

  const ackAlert = async (id: string) => {
    setAcked(s => new Set([...s, id])); // optimistic (also covers mock mode)
    try {
      await fetch(`/api/data/alerts?id=${id}`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acknowledged: true }),
      });
      api.getAlerts().then(setAlerts);
    } catch { /* optimistic state already applied */ }
  };

  const active = alerts.filter(a => !a.acknowledged && !acked.has(a.id));
  const resolved = alerts.filter(a => a.acknowledged || acked.has(a.id));

  return (
    <div className="p-6 flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">🔔 Alerts</h1>
        <button onClick={runChecks} disabled={checking}
          className="px-4 py-2 bg-gray-800 text-white rounded-lg font-semibold text-sm disabled:opacity-50">
          {checking ? 'Checking…' : '↻ Run checks now'}
        </button>
      </div>

      <section>
        <h2 className="font-semibold text-gray-700 mb-3">Active ({active.length})</h2>
        {active.length === 0
          ? <div className="text-center py-8 bg-white border border-dashed rounded-xl text-gray-400">No active alerts 🎉</div>
          : (
            <div className="flex flex-col gap-3">
              {active.map(a => (
                <div key={a.id} role="button" tabIndex={0}
                  onClick={() => router.push(alertDestination(a))}
                  onKeyDown={e => { if (e.key === 'Enter') router.push(alertDestination(a)); }}
                  className={`bg-white border rounded-xl px-5 py-4 flex gap-4 items-center cursor-pointer hover:shadow-md hover:bg-gray-50/60 transition-shadow ${a.severity === 'critical' ? 'border-red-300' : a.severity === 'warning' ? 'border-amber-300' : 'border-blue-200'}`}>
                  <StatusChip status={a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info'} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900">{a.title}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{a.message}</p>
                    <p className="text-xs text-gray-400 mt-1">{new Date(a.createdAt).toLocaleString('en-KE')}</p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">Open →</span>
                  <button onClick={e => { e.stopPropagation(); ackAlert(a.id); }} className="text-xs text-green-600 font-semibold shrink-0 hover:underline border border-green-200 rounded-lg px-3 py-1.5">Acknowledge</button>
                </div>
              ))}
            </div>
          )
        }
      </section>

      {resolved.length > 0 && (
        <section>
          <h2 className="font-semibold text-gray-400 mb-3">Acknowledged ({resolved.length})</h2>
          <div className="flex flex-col gap-2 opacity-50">
            {resolved.map(a => (
              <div key={a.id} className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-3 flex gap-3">
                <StatusChip status="ok" size="sm" label="ACK" />
                <p className="text-sm text-gray-500">{a.title}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Alert rules config */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-bold text-gray-800 mb-3">Alert Rules (FR-M14-3)</h2>
        <p className="text-gray-500 text-sm mb-3">Configure when alerts fire — no code changes needed.</p>
        {rulesErr && <p className="text-red-600 bg-red-50 rounded-lg px-3 py-2 text-sm font-semibold mb-2">{rulesErr}</p>}
        <div className="flex flex-col gap-3">
          {rules.length === 0 && <p className="text-gray-400 text-sm">No rules configured.</p>}
          {rules.map((r, i) => (
            <div key={r.metric} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
              <div>
                <p className="font-semibold text-gray-800 text-sm">{r.label}</p>
                <p className="text-xs text-gray-400">{r.metric} &gt; {r.threshold} {r.unit}</p>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" value={r.threshold} onChange={e => setRule(i, { threshold: Number(e.target.value) })}
                  className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-sm text-center" />
                <span className="text-xs text-gray-500 w-10">{r.unit}</span>
                <input type="checkbox" checked={r.enabled} onChange={e => setRule(i, { enabled: e.target.checked })} className="w-4 h-4 accent-green-600" />
              </div>
            </div>
          ))}
        </div>
        <button onClick={saveRules} disabled={rules.length === 0}
          className={`mt-3 px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-50 ${rulesSaved ? 'bg-green-100 text-green-700' : 'bg-green-600 text-white'}`}>
          {rulesSaved ? '✓ Rules Saved' : 'Save Rules'}
        </button>
      </section>
    </div>
  );
}
