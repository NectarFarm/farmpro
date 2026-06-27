'use client';
// Admin panel: enable/disable acceptance testing per farm (and how many screenshots
// a tester may attach), request a (re)test, read the submitted report, view & delete
// the tester's screenshots, and download the report as PDF.
import { useEffect, useState } from 'react';

interface Failure { id: string; area: string; title: string; note: string; photoIds: string[] }
interface ResultRow { area: string; title: string; status: string; note: string; photos: number }
interface RunView {
  status: 'in_progress' | 'submitted';
  startedAt: string; submittedAt: string | null;
  progress: { total: number; done: number; passed: number; failed: number; pendingCount: number; complete: boolean };
  report: { total: number; passed: number; failed: number; complete: boolean; failures: Failure[] };
  results: ResultRow[];
}
interface FarmTesting { tenantId: string; name: string; testingEnabled: boolean; maxScreenshots: number; run: RunView | null }

export function AdminTesting() {
  const [farms, setFarms] = useState<FarmTesting[]>([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [openReport, setOpenReport] = useState<string | null>(null);
  const [shotPref, setShotPref] = useState<Record<string, number>>({}); // per-farm screenshot allowance
  const [photoData, setPhotoData] = useState<Record<string, string>>({}); // photoId → data URL

  // Editable checklist (the steps new runs are built from).
  type StepDraft = { area: string; title: string; instruction: string };
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [savingSteps, setSavingSteps] = useState(false);
  const [stepsMsg, setStepsMsg] = useState('');

  const load = () => fetch('/api/admin/testing', { credentials: 'include' })
    .then(r => r.ok ? r.json() : { tenants: [], steps: [] })
    .then(d => {
      const ts: FarmTesting[] = d.tenants ?? [];
      setFarms(ts);
      setShotPref(p => { const next = { ...p }; for (const f of ts) if (next[f.tenantId] === undefined) next[f.tenantId] = f.maxScreenshots; return next; });
      setSteps((d.steps ?? []).map((s: StepDraft) => ({ area: s.area, title: s.title, instruction: s.instruction })));
    }).catch(() => {});
  useEffect(() => { load(); }, []);

  const act = async (tenantId: string, action: 'enable' | 'disable' | 'request') => {
    setBusy(`${tenantId}:${action}`); setErr('');
    try {
      const res = await fetch('/api/admin/testing', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, action, maxScreenshots: shotPref[tenantId] ?? 0 }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Action failed');
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };

  const fetchPhoto = async (id: string) => {
    if (photoData[id]) return;
    const r = await fetch(`/api/admin/testing/photo?id=${id}`, { credentials: 'include' });
    if (r.ok) { const d = await r.json(); setPhotoData(p => ({ ...p, [id]: d.data })); }
  };
  const deletePhoto = async (id: string) => {
    setBusy(`photo:${id}`);
    try {
      await fetch(`/api/admin/testing/photo?id=${id}`, { method: 'DELETE', credentials: 'include' });
      setPhotoData(p => { const n = { ...p }; delete n[id]; return n; });
      await load();
    } finally { setBusy(''); }
  };

  // Load thumbnails for a report when it's opened.
  useEffect(() => {
    const f = farms.find(x => x.tenantId === openReport);
    f?.run?.report.failures.forEach(x => x.photoIds.forEach(fetchPhoto));
  }, [openReport, farms]); // eslint-disable-line react-hooks/exhaustive-deps

  const downloadPdf = async (f: FarmTesting) => {
    if (!f.run) return;
    const { exportReport } = await import('@/lib/export');
    exportReport({
      title: `Acceptance test — ${f.name}`,
      columns: ['Step', 'Area', 'Result', 'Note', 'Shots'],
      rows: f.run.results.map(r => [r.title, r.area, r.status.toUpperCase(), r.note, r.photos]),
      meta: {
        Farm: f.name,
        Submitted: f.run.submittedAt ? new Date(f.run.submittedAt).toLocaleString('en-KE') : '—',
        Result: `${f.run.report.passed} passed · ${f.run.report.failed} failed of ${f.run.report.total}`,
      },
    }, 'PDF');
  };

  const setStep = (i: number, k: keyof StepDraft, v: string) => setSteps(ss => ss.map((s, j) => j === i ? { ...s, [k]: v } : s));
  const addStep = () => setSteps(ss => [...ss, { area: 'General', title: '', instruction: '' }]);
  const removeStep = (i: number) => setSteps(ss => ss.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => setSteps(ss => { const j = i + dir; if (j < 0 || j >= ss.length) return ss; const c = ss.slice(); [c[i], c[j]] = [c[j], c[i]]; return c; });
  const saveSteps = async () => {
    setSavingSteps(true); setStepsMsg('');
    try {
      const res = await fetch('/api/admin/testing', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-steps', steps }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      setStepsMsg('✓ Checklist saved'); setTimeout(() => setStepsMsg(''), 2000);
    } catch (e) { setStepsMsg((e as Error).message); } finally { setSavingSteps(false); }
  };

  const statusChip = (f: FarmTesting) => {
    if (!f.testingEnabled) return <span className="text-xs font-semibold text-gray-400">Off</span>;
    if (!f.run) return <span className="text-xs font-semibold text-amber-600">Enabled · not started</span>;
    if (f.run.status === 'submitted') {
      const fail = f.run.report.failed;
      return <span className={`text-xs font-semibold ${fail > 0 ? 'text-red-600' : 'text-green-600'}`}>Submitted · {f.run.report.passed}✓ {fail}✗</span>;
    }
    return <span className="text-xs font-semibold text-amber-600">In progress · {f.run.progress.done}/{f.run.progress.total}</span>;
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3">
      <div>
        <h2 className="font-bold text-gray-800">🧪 Acceptance testing</h2>
        <p className="text-xs text-gray-400">Enable a guided test for a farm, allow screenshots, request a re-test, and read their report.</p>
      </div>
      {err && <p className="text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs font-semibold">{err}</p>}

      {/* Editable checklist */}
      <div className="border border-gray-200 rounded-lg">
        <button onClick={() => setEditOpen(v => !v)} className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-gray-700">
          <span>Checklist · {steps.length} steps</span>
          <span className="text-gray-400 text-xs">{editOpen ? 'Hide' : 'Edit'}</span>
        </button>
        {editOpen && (
          <div className="px-3 pb-3 flex flex-col gap-2">
            {steps.map((s, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-2 flex flex-col gap-1.5 bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-5">{i + 1}.</span>
                  <input value={s.area} onChange={e => setStep(i, 'area', e.target.value)} placeholder="Area" className="w-28 border border-gray-300 rounded px-2 py-1 text-xs" />
                  <input value={s.title} onChange={e => setStep(i, 'title', e.target.value)} placeholder="Short title" className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs" />
                  <button onClick={() => move(i, -1)} className="text-gray-400 hover:text-gray-700 px-1" title="Move up">↑</button>
                  <button onClick={() => move(i, 1)} className="text-gray-400 hover:text-gray-700 px-1" title="Move down">↓</button>
                  <button onClick={() => removeStep(i)} className="text-red-400 hover:text-red-600 px-1" title="Remove">✕</button>
                </div>
                <textarea value={s.instruction} onChange={e => setStep(i, 'instruction', e.target.value)} rows={2} placeholder="What should the farmer do and check?" className="border border-gray-300 rounded px-2 py-1 text-xs" />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <button onClick={addStep} className="text-xs font-semibold text-green-600">+ Add step</button>
              <button onClick={saveSteps} disabled={savingSteps} className="ml-auto px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-semibold disabled:opacity-50">{savingSteps ? 'Saving…' : 'Save checklist'}</button>
            </div>
            {stepsMsg && <p className="text-xs text-gray-600">{stepsMsg}</p>}
            <p className="text-[11px] text-gray-400">Applies to new tests and re-tests. A farmer&apos;s in-progress run keeps the steps it started with.</p>
          </div>
        )}
      </div>

      <div className="divide-y divide-gray-100">
        {farms.map(f => (
          <div key={f.tenantId} className="py-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 text-sm">{f.name}</p>
                {statusChip(f)}
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                <label className="text-xs text-gray-500 flex items-center gap-1">📷
                  <select value={shotPref[f.tenantId] ?? 0} onChange={e => setShotPref(p => ({ ...p, [f.tenantId]: Number(e.target.value) }))}
                    className="border border-gray-300 rounded-lg px-2 py-1 text-xs" title="Screenshots a tester may attach per step">
                    {[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n === 0 ? 'no shots' : `${n}/step`}</option>)}
                  </select>
                </label>
                {f.testingEnabled
                  ? <button onClick={() => act(f.tenantId, 'disable')} disabled={busy !== ''} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold disabled:opacity-50">Disable</button>
                  : <button onClick={() => act(f.tenantId, 'enable')} disabled={busy !== ''} className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-semibold disabled:opacity-50">Enable</button>}
                <button onClick={() => act(f.tenantId, 'request')} disabled={busy !== ''} className="px-3 py-1.5 bg-white border border-amber-300 text-amber-700 rounded-lg text-xs font-semibold disabled:opacity-50">
                  {busy === `${f.tenantId}:request` ? '…' : 'Request test'}
                </button>
                {f.run?.status === 'submitted' && (
                  <>
                    <button onClick={() => setOpenReport(openReport === f.tenantId ? null : f.tenantId)} className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-semibold">
                      {openReport === f.tenantId ? 'Hide report' : 'View report'}
                    </button>
                    <button onClick={() => downloadPdf(f)} className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-xs font-semibold">PDF</button>
                  </>
                )}
              </div>
            </div>

            {openReport === f.tenantId && f.run?.status === 'submitted' && (
              <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs">
                <p className="text-gray-600 mb-1">
                  Submitted {f.run.submittedAt ? new Date(f.run.submittedAt).toLocaleString('en-KE') : ''} · {f.run.report.passed} passed · {f.run.report.failed} failed.
                </p>
                {f.run.report.failures.length === 0
                  ? <p className="text-green-700 font-semibold">No problems reported 🎉</p>
                  : (
                    <ul className="flex flex-col gap-2">
                      {f.run.report.failures.map(x => (
                        <li key={x.id} className="border-l-2 border-red-300 pl-2">
                          <span className="font-semibold text-gray-800">{x.title}</span> <span className="text-gray-400">· {x.area}</span>
                          <span className="block text-red-600">“{x.note}”</span>
                          {x.photoIds.length > 0 && (
                            <div className="flex gap-2 flex-wrap mt-1">
                              {x.photoIds.map(pid => (
                                <div key={pid} className="relative">
                                  {photoData[pid]
                                    // eslint-disable-next-line @next/next/no-img-element
                                    ? <a href={photoData[pid]} target="_blank" rel="noreferrer"><img src={photoData[pid]} alt="screenshot" className="w-20 h-20 object-cover rounded border border-gray-200" /></a>
                                    : <div className="w-20 h-20 rounded bg-gray-100 animate-pulse" />}
                                  <button onClick={() => deletePhoto(pid)} disabled={busy === `photo:${pid}`}
                                    className="absolute -top-2 -right-2 w-5 h-5 bg-red-600 text-white rounded-full text-[10px] font-bold disabled:opacity-50" title="Delete screenshot">✕</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            )}
          </div>
        ))}
        {farms.length === 0 && <p className="py-3 text-sm text-gray-400">No farms yet.</p>}
      </div>
    </div>
  );
}
