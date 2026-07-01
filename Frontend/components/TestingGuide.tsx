'use client';
// Guided acceptance-test panel for a farmer, shown only when the admin has enabled
// testing for their farm. One step at a time; a failure must be explained before
// moving on; submitting sends a report to the admin. State machine lives in
// lib/testing.ts (pure + unit-tested); this is just the UI around it.
import { useEffect, useState } from 'react';
import { progress, canSubmit, summarize, type TestStep, type StepStatus } from '@/lib/testing';

interface Run { status: 'in_progress' | 'submitted'; steps: TestStep[] }

export function TestingGuide() {
  const [enabled, setEnabled] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [failFor, setFailFor] = useState<string | null>(null); // step id whose failure note is being entered
  const [note, setNote] = useState('');
  const [ticked, setTicked] = useState<Set<number>>(new Set()); // sub-checks ticked for the current step
  const [maxShots, setMaxShots] = useState(0);
  const [attachingFor, setAttachingFor] = useState<string | null>(null); // step id pausing to attach screenshots
  const [previews, setPreviews] = useState<Record<string, string[]>>({}); // local thumbnails by step id
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    try {
      const res = await fetch('/api/testing', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setEnabled(!!data.enabled);
      setMaxShots(data.maxScreenshots ?? 0);
      setRun(data.run ?? null);
    } catch { /* ignore */ }
  };
  useEffect(() => { load(); }, []);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/testing', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      if (data.run) setRun(data.run);
      return true;
    } catch (e) { setErr((e as Error).message); return false; }
    finally { setBusy(false); }
  };

  const start = async () => { if (await post({ action: 'start' })) { setFailFor(null); setNote(''); setAttachingFor(null); setPreviews({}); } };
  const pass = (id: string) => post({ action: 'step', id, status: 'pass' as StepStatus });
  const openFail = (id: string) => { setFailFor(id); setNote(''); setErr(''); };
  const submitFail = async (id: string) => {
    if (await post({ action: 'step', id, status: 'fail' as StepStatus, note })) {
      setFailFor(null); setNote('');
      // If screenshots are allowed, pause on this step so the tester can attach one.
      if (maxShots > 0) setAttachingFor(id);
    }
  };
  const submit = () => post({ action: 'submit' });

  // Shrink an image to a small JPEG data URL before upload (saves storage/compute).
  const compress = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1000 / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d'); if (!ctx) return reject(new Error('no canvas'));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => reject(new Error('bad image'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('cannot read file'));
    reader.readAsDataURL(file);
  });

  const onPickPhoto = async (stepId: string, file: File | undefined) => {
    if (!file) return;
    setUploading(true); setErr('');
    try {
      const data = await compress(file);
      if (await post({ action: 'photo', stepId, data })) {
        setPreviews(p => ({ ...p, [stepId]: [...(p[stepId] ?? []), data] }));
      }
    } catch { setErr('Could not read that image.'); }
    finally { setUploading(false); }
  };

  if (!enabled) return null;

  const steps = run?.steps ?? [];
  const p = steps.length ? progress(steps) : null;
  const attachStep = attachingFor ? steps.find(s => s.id === attachingFor) ?? null : null;
  // While attaching screenshots to a just-failed step, pause the step-by-step flow.
  const current = !attachStep && run?.status === 'in_progress' ? p?.nextPending ?? null : null;
  const pct = p ? Math.round((p.done / p.total) * 100) : 0;
  const checks = current?.checks ?? [];
  const allTicked = checks.length === 0 || checks.every((_, i) => ticked.has(i));
  useEffect(() => { setTicked(new Set()); }, [current?.id]); // reset ticks on each new step
  const report = steps.length ? summarize(steps) : null;

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Open acceptance testing"
        className="fixed bottom-5 left-5 z-40 flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white rounded-full shadow-lg px-4 py-3 font-semibold text-sm">
        <span className="text-lg">🧪</span>
        <span className="hidden sm:inline">Testing</span>
        {p && run?.status === 'in_progress' && <span className="bg-white/25 rounded-full px-2 py-0.5 text-xs">{p.done}/{p.total}</span>}
        {run?.status === 'submitted' && <span className="bg-white/25 rounded-full px-2 py-0.5 text-xs">✓ sent</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-full max-w-md bg-gray-50 shadow-2xl overflow-y-auto">
            <div className="sticky top-0 bg-amber-500 text-white px-5 py-4 z-10">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">🧪 App testing</h2>
                <button onClick={() => setOpen(false)} aria-label="Close" className="text-white/80 hover:text-white text-2xl leading-none">×</button>
              </div>
              <p className="text-amber-100 text-xs mt-1">Your admin asked you to check the app. Go one step at a time.</p>
              {p && (
                <>
                  <div className="mt-3 bg-amber-700/40 rounded-full h-2 overflow-hidden"><div className="bg-white h-full transition-all" style={{ width: `${pct}%` }} /></div>
                  <p className="text-amber-100 text-xs mt-1">{p.done} of {p.total} done · {p.passed} ✓ · {p.failed} ✗</p>
                </>
              )}
            </div>

            <div className="p-4 flex flex-col gap-4">
              {err && <p className="text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm font-semibold">{err}</p>}

              {/* No run yet */}
              {!run && (
                <div className="bg-white border border-gray-200 rounded-xl p-5 text-center">
                  <p className="font-semibold text-gray-800">Ready to test?</p>
                  <p className="text-gray-500 text-sm mt-1 mb-3">You&apos;ll be asked to try each part of the app and tick whether it works.</p>
                  <button onClick={start} disabled={busy} className="px-5 py-2.5 bg-amber-500 text-white rounded-xl font-bold text-sm disabled:opacity-50">{busy ? 'Starting…' : 'Start testing'}</button>
                </div>
              )}

              {/* Attach screenshots to a just-failed step */}
              {attachStep && (
                <div className="bg-white border-2 border-red-200 rounded-xl p-5 flex flex-col gap-3">
                  <span className="text-xs font-bold uppercase tracking-wide text-red-600">{attachStep.area} · marked failed</span>
                  <h3 className="font-bold text-gray-900">{attachStep.title}</h3>
                  <p className="text-gray-500 text-sm">Add a screenshot of the problem (optional) — up to {maxShots}.</p>
                  {(previews[attachStep.id]?.length ?? 0) > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {(previews[attachStep.id] ?? []).map((src, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={src} alt={`screenshot ${i + 1}`} className="w-16 h-16 object-cover rounded border border-gray-200" />
                      ))}
                    </div>
                  )}
                  {(attachStep.photoIds?.length ?? 0) < maxShots ? (
                    <label className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg text-sm font-semibold text-gray-700 cursor-pointer w-fit">
                      {uploading ? 'Uploading…' : `📷 Add screenshot (${attachStep.photoIds?.length ?? 0}/${maxShots})`}
                      <input type="file" accept="image/*" className="hidden" disabled={uploading}
                        onChange={e => { onPickPhoto(attachStep.id, e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                  ) : <p className="text-xs text-gray-400">Maximum {maxShots} screenshot{maxShots === 1 ? '' : 's'} added.</p>}
                  <button onClick={() => setAttachingFor(null)} disabled={uploading} className="px-4 py-2 bg-amber-500 text-white rounded-lg font-semibold text-sm disabled:opacity-50 w-fit">Continue →</button>
                </div>
              )}

              {/* Current step (in progress) */}
              {run?.status === 'in_progress' && current && (
                <div className="bg-white border-2 border-amber-300 rounded-xl p-5 flex flex-col gap-3">
                  <span className="text-xs font-bold uppercase tracking-wide text-amber-600">{current.area} · step {p!.done + 1} of {p!.total}</span>
                  <h3 className="font-bold text-gray-900 text-lg">{current.title}</h3>
                  <p className="text-gray-600 text-sm">{current.instruction}</p>
                  {checks.length > 0 && failFor !== current.id && (
                    <div className="flex flex-col gap-1.5 bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Check each ({ticked.size}/{checks.length})</p>
                      {checks.map((c, i) => (
                        <label key={i} className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                          <input type="checkbox" checked={ticked.has(i)} onChange={() => setTicked(t => { const n = new Set(t); n.has(i) ? n.delete(i) : n.add(i); return n; })} className="mt-0.5 w-4 h-4 accent-green-600 shrink-0" />
                          <span className={ticked.has(i) ? 'line-through text-gray-400' : ''}>{c}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {failFor === current.id ? (
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold text-gray-500">What went wrong? (required)</label>
                      <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} autoFocus
                        placeholder="Describe what you saw — what you expected vs what happened."
                        className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
                      <div className="flex gap-2">
                        <button onClick={() => submitFail(current.id)} disabled={busy || !note.trim()} className="px-4 py-2 bg-red-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Report problem & continue'}</button>
                        <button onClick={() => setFailFor(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm">Back</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <div className="flex gap-2">
                        <button onClick={() => pass(current.id)} disabled={busy || !allTicked} className="flex-1 py-2.5 bg-green-600 text-white rounded-lg font-bold text-sm disabled:opacity-50">✓ It works</button>
                        <button onClick={() => openFail(current.id)} disabled={busy} className="flex-1 py-2.5 bg-red-50 text-red-700 border-2 border-red-200 rounded-lg font-bold text-sm disabled:opacity-50">✗ It failed</button>
                      </div>
                      {!allTicked && <p className="text-[11px] text-gray-400 text-center">Tick every check above to confirm it works — or tap "It failed" if any part is broken.</p>}
                    </div>
                  )}
                </div>
              )}

              {/* All steps answered → submit */}
              {run?.status === 'in_progress' && p?.complete && (
                <div className="bg-white border border-gray-200 rounded-xl p-5 text-center">
                  <p className="font-semibold text-gray-800">All {p.total} steps answered 🎉</p>
                  <p className="text-gray-500 text-sm mt-1 mb-3">{p.passed} worked · {p.failed} had problems. Submit to send the report to your admin.</p>
                  <button onClick={submit} disabled={busy || !canSubmit(steps)} className="px-5 py-2.5 bg-amber-500 text-white rounded-xl font-bold text-sm disabled:opacity-50">{busy ? 'Submitting…' : 'Submit report to admin'}</button>
                </div>
              )}

              {/* Submitted */}
              {run?.status === 'submitted' && report && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
                  <p className="font-bold text-green-800">✓ Report sent to your admin</p>
                  <p className="text-green-700 text-sm mt-1">{report.passed} worked · {report.failed} had problems, out of {report.total}.</p>
                  <button onClick={start} disabled={busy} className="mt-3 px-4 py-2 bg-white border border-green-300 text-green-700 rounded-lg font-semibold text-sm">Test again</button>
                </div>
              )}

              {/* Full checklist + where each test is */}
              {steps.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-gray-800 text-sm">Checklist</h3>
                    {run?.status === 'in_progress' && <button onClick={start} disabled={busy} className="text-xs font-semibold text-gray-400 hover:text-gray-700">Restart</button>}
                  </div>
                  <ul className="flex flex-col divide-y divide-gray-50">
                    {steps.map(s => (
                      <li key={s.id} className="py-2 flex items-start gap-2 text-sm">
                        <span className={`mt-0.5 ${s.status === 'pass' ? 'text-green-600' : s.status === 'fail' ? 'text-red-600' : 'text-gray-300'}`}>
                          {s.status === 'pass' ? '✓' : s.status === 'fail' ? '✗' : '○'}
                        </span>
                        <span className="flex-1">
                          <span className={`font-medium ${s.status === 'pending' ? 'text-gray-700' : 'text-gray-500'}`}>{s.title}</span>
                          <span className="text-xs text-gray-400"> · {s.area}</span>
                          {s.status === 'fail' && (s.photoIds?.length ?? 0) > 0 && <span className="text-xs text-gray-400"> · 📎 {s.photoIds!.length}</span>}
                          {s.status === 'fail' && s.note && <span className="block text-xs text-red-500">“{s.note}”</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
