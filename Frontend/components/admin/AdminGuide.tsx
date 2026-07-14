'use client';
// Static onboarding aid for a first-time platform admin — owner/layout.tsx
// wires SetupGuide/TestingGuide/AIAdvisor into floatingContent; admin had no
// equivalent, so a new super_admin got zero in-app orientation. Deliberately
// simple (a fixed tip list, no state/API calls) since there's no per-admin
// wizard state worth persisting here, unlike the owner-facing guides.
import { useState } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { useDraggableFab } from '../useDraggableFab';

const TIPS = [
  { title: 'Click a farm name to manage it', body: 'From Farms, click the farm’s name (not the "Manage" button) to open its detail page — rename, reset the owner’s password, toggle features, suspend, or delete a farm from there.' },
  { title: 'Errors and Status = platform health', body: 'Status shows database/storage/environment health. Errors lists crashes reported by any farm’s app, across every tenant.' },
  { title: 'Audit is the paper trail', body: 'Every farm-affecting action (created, suspended, deleted, plan changed) is logged in Audit — filterable by farm.' },
  { title: 'Settings has three sections', body: 'Branding, Packages (plan definitions), and Acceptance Testing are stacked on one page — use the jump links at the top to skip to one.' },
];

export function AdminGuide() {
  const fab = useDraggableFab('ifms_fab_pos_admin_guide');
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        ref={fab.ref}
        style={fab.style}
        onPointerDown={fab.onPointerDown}
        onPointerMove={fab.onPointerMove}
        onPointerUp={fab.onPointerUp}
        onClick={() => { if (!fab.wasDragged()) setOpen(true); }}
        aria-label="Admin quick guide"
        className="fixed bottom-5 left-5 z-40 flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white rounded-full shadow-lg px-4 py-3 font-semibold text-sm cursor-grab active:cursor-grabbing">
        <HelpCircle className="w-5 h-5" />
        <span className="hidden sm:inline">Guide</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-full max-w-sm bg-gray-50 shadow-2xl overflow-y-auto">
            <div className="sticky top-0 bg-gray-800 text-white px-5 py-4 z-10 flex items-center justify-between">
              <h2 className="text-lg font-bold flex items-center gap-2"><HelpCircle className="w-5 h-5" /> Admin quick guide</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-white/80 hover:text-white"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              {TIPS.map((tip) => (
                <div key={tip.title} className="bg-white border border-gray-200 rounded-xl p-4">
                  <p className="font-semibold text-gray-900 text-sm">{tip.title}</p>
                  <p className="text-gray-500 text-sm mt-1">{tip.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
