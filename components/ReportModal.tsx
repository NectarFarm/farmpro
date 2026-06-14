'use client';
import { useState } from 'react';
import { useFarmStore } from '@/lib/store';
import { generateFarmReport } from '@/lib/pdfReport';
import { X, FileText, Download, Loader2, CalendarRange, CheckCircle, MessageCircle, Mail } from 'lucide-react';
import { toast } from 'sonner';

interface Props { onClose: () => void; }

type PeriodPreset = 'this_month' | 'last_month' | 'last_3_months' | 'this_year' | 'custom';

const PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'last_3_months', label: 'Last 3 Months' },
  { id: 'this_year', label: 'This Year' },
  { id: 'custom', label: 'Custom Range' },
];

function presetToRange(p: PeriodPreset): { start: string; end: string; label: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().split('T')[0];
  if (p === 'this_month') { const s = new Date(now.getFullYear(), now.getMonth(), 1); return { start: iso(s), end: iso(now), label: s.toLocaleString('en-US', { month: 'long', year: 'numeric' }) }; }
  if (p === 'last_month') { const s = new Date(now.getFullYear(), now.getMonth() - 1, 1); const e = new Date(now.getFullYear(), now.getMonth(), 0); return { start: iso(s), end: iso(e), label: s.toLocaleString('en-US', { month: 'long', year: 'numeric' }) }; }
  if (p === 'last_3_months') { const s = new Date(now.getFullYear(), now.getMonth() - 2, 1); return { start: iso(s), end: iso(now), label: `${s.toLocaleString('en-US', { month: 'short' })} – ${now.toLocaleString('en-US', { month: 'short', year: 'numeric' })}` }; }
  if (p === 'this_year') { const s = new Date(now.getFullYear(), 0, 1); return { start: iso(s), end: iso(now), label: `${now.getFullYear()}` }; }
  return { start: iso(now), end: iso(now), label: 'Custom Range' };
}

export const ALL_SECTIONS = [
  { id: 'pnl',         label: 'Profit & Loss',       workerSafe: false },
  { id: 'opsCost',     label: 'Cost of Operations',  workerSafe: false },
  { id: 'salaries',    label: 'Salary Expenses',     workerSafe: false },
  { id: 'flocks',      label: 'Flock Performance',   workerSafe: true  },
  { id: 'eggs',        label: 'Egg Production',      workerSafe: true  },
  { id: 'vaccination', label: 'Vaccination Schedule',workerSafe: true  },
  { id: 'customers',   label: 'Top Customers',       workerSafe: false },
  { id: 'expenses',    label: 'Expense Breakdown',   workerSafe: false },
  { id: 'sales',       label: 'Sales Records',       workerSafe: false },
];

export default function ReportModal({ onClose }: Props) {
  const store = useFarmStore();
  const [preset, setPreset] = useState<PeriodPreset>('this_month');
  const [customStart, setCustomStart] = useState(new Date().toISOString().split('T')[0]);
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().split('T')[0]);
  const [farmName, setFarmName] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('farmName') ?? 'My Poultry Farm' : 'My Poultry Farm');
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);
  const [workerMode, setWorkerMode] = useState(false);
  const [enabledSections, setEnabledSections] = useState<Set<string>>(new Set(ALL_SECTIONS.map(s => s.id)));
  const [sharePhone, setSharePhone] = useState('');
  const [shareEmail, setShareEmail] = useState('');

  const visibleSections = workerMode ? ALL_SECTIONS.filter(s => s.workerSafe) : ALL_SECTIONS;

  function toggleSection(id: string) {
    setEnabledSections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const range = preset === 'custom'
    ? { start: customStart, end: customEnd, label: `${customStart} to ${customEnd}` }
    : presetToRange(preset);

  async function handleGenerate(shareMode?: 'whatsapp' | 'email') {
    setGenerating(true); setDone(false);
    try {
      await generateFarmReport({
        flocks: store.flocks, sales: store.sales, expenses: store.expenses,
        feedRecords: store.feedRecords, vaccinationRecords: store.vaccinationRecords,
        eggCollections: store.eggCollections, mortalityRecords: store.mortalityRecords,
        customers: store.customers, employeeSalaries: store.employeeSalaries,
        periodLabel: range.label, startDate: range.start, endDate: range.end,
        farmName, enabledSections: Array.from(enabledSections),
      });
      setDone(true);
      if (shareMode === 'whatsapp' && sharePhone) {
        const msg = encodeURIComponent(`Hi! Here is the FarmPro report for ${range.label} from ${farmName}. I've just generated the PDF — please check your downloads.`);
        const phone = sharePhone.replace(/\D/g, '').replace(/^0/, '254');
        window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
      }
      if (shareMode === 'email' && shareEmail) {
        const subject = encodeURIComponent(`FarmPro Report – ${range.label}`);
        const body = encodeURIComponent(`Please find the FarmPro report for ${range.label} from ${farmName} in the attached PDF.`);
        window.open(`mailto:${shareEmail}?subject=${subject}&body=${body}`, '_blank');
      }
      toast.success('PDF report downloaded!');
      setTimeout(() => setDone(false), 3000);
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate PDF. Please try again.');
    } finally { setGenerating(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'oklch(0.42 0.14 148 / 0.12)' }}>
              <FileText className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-sm">Generate PDF Report</h2>
              <p className="text-xs text-muted-foreground">Choose sections, period and share options</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors"><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Farm name */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block mb-1.5">Farm Name</label>
            <input value={farmName} onChange={e => setFarmName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-border bg-input text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          </div>

          {/* Period */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block mb-2">Report Period</label>
            <div className="grid grid-cols-3 gap-1.5">
              {PRESETS.map(p => (
                <button key={p.id} onClick={() => setPreset(p.id)}
                  className="px-2 py-2 rounded-xl text-xs font-medium transition-all"
                  style={preset === p.id ? { background: 'oklch(0.42 0.14 148)', color: 'white' } : { background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                  {p.label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div><label className="text-xs text-muted-foreground mb-1 block">From</label><input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-border bg-input text-sm outline-none" /></div>
                <div><label className="text-xs text-muted-foreground mb-1 block">To</label><input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-border bg-input text-sm outline-none" /></div>
              </div>
            )}
            <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-xl" style={{ background: 'var(--muted)' }}>
              <CalendarRange className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-xs text-muted-foreground">Period: </span>
              <span className="text-xs font-semibold text-foreground">{range.label}</span>
            </div>
          </div>

          {/* Section toggles */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Report Sections</label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={workerMode} onChange={e => { setWorkerMode(e.target.checked); if (e.target.checked) setEnabledSections(new Set(ALL_SECTIONS.filter(s => s.workerSafe).map(s => s.id))); else setEnabledSections(new Set(ALL_SECTIONS.map(s => s.id))); }}
                  className="rounded" />
                <span className="text-xs text-muted-foreground">Worker-safe only</span>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {visibleSections.map(s => {
                const on = enabledSections.has(s.id);
                return (
                  <button key={s.id} onClick={() => toggleSection(s.id)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all text-left"
                    style={on ? { background: 'oklch(0.42 0.14 148 / 0.12)', border: '1px solid oklch(0.42 0.14 148 / 0.3)', color: 'var(--foreground)' }
                            : { background: 'var(--muted)', border: '1px solid transparent', color: 'var(--muted-foreground)' }}>
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${on ? 'border-primary bg-primary' : 'border-muted-foreground'}`}>
                      {on && <CheckCircle className="w-2.5 h-2.5 text-white" />}
                    </div>
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Share options */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block mb-2">Share After Download (Optional)</label>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 shrink-0" style={{ color: '#25D366' }} />
                <input value={sharePhone} onChange={e => setSharePhone(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl border border-border bg-input text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="WhatsApp number (e.g. 0712345678)" />
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 shrink-0 text-muted-foreground" />
                <input type="email" value={shareEmail} onChange={e => setShareEmail(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl border border-border bg-input text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="Email address" />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 border-t border-border flex items-center gap-2 flex-wrap shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
          <div className="flex-1" />
          {sharePhone && (
            <button onClick={() => handleGenerate('whatsapp')} disabled={generating}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-60"
              style={{ background: '#25D366' }}>
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
            </button>
          )}
          {shareEmail && (
            <button onClick={() => handleGenerate('email')} disabled={generating}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-60"
              style={{ background: 'oklch(0.5 0.15 250)' }}>
              <Mail className="w-3.5 h-3.5" /> Email
            </button>
          )}
          <button onClick={() => handleGenerate()} disabled={generating}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.97] disabled:opacity-70"
            style={{ background: 'oklch(0.42 0.14 148)', boxShadow: '0 4px 14px oklch(0.42 0.14 148 / 0.4)' }}>
            {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : done ? <><CheckCircle className="w-4 h-4" /> Downloaded!</> : <><Download className="w-4 h-4" /> Download PDF</>}
          </button>
        </div>
      </div>
    </div>
  );
}
