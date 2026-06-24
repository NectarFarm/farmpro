'use client';
// Floating onboarding guide for a logged-in farmer. Walks through keying all farm
// data from scratch (no seed), in the correct order, with progress + page links.
import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Step {
  id: string;
  icon: string;
  title: string;
  href?: string;
  how: string[];
}

const PHASES: { phase: string; subtitle: string; steps: Step[] }[] = [
  {
    phase: '1 · Set up your farm',
    subtitle: 'Do this once, in order. ~20 minutes.',
    steps: [
      {
        id: 'units', icon: '🏠', title: 'Add your production units', href: '/owner/farm',
        how: [
          'A unit is any place that holds animals or crops: a chicken cage, a pig pen, a fish pond, a crop plot.',
          'Add every one. Give each a clear name like "Cage A1", "Pen 2", "Pond 3", "Plot 4".',
          'Set each unit\'s capacity (how many it can hold).',
        ],
      },
      {
        id: 'batches', icon: '🐔', title: 'Add your animals & crops as batches', href: '/owner/farm',
        how: [
          'A "batch" is a group of the same age — e.g. "100 layer chicks bought 1 Feb".',
          'For each batch enter: the unit it lives in, species/breed, quantity, the date you got them, their age, and what they cost you to buy.',
          'Keep different ages as separate batches — that\'s how you compare performance and cost.',
        ],
      },
      {
        id: 'products', icon: '🥚', title: 'Check what each batch produces & set prices', href: '/owner/farm',
        how: [
          'When you add a batch, IFMS auto-creates the products it gives — layers get Eggs + Manure, pigs get Pork + Manure + piglets, maize gets grain. (No more "eggs everywhere".)',
          'Open a batch and review its products. Each has sale units with prices — e.g. Eggs sold as a Tray (30) or a single Piece. Set your price once, and recording a sale just prefills it.',
          'Set how often each is collected — eggs daily, manure weekly. Workers are automatically given permission to record them; you just get a reminder to assign who collects each one.',
        ],
      },
      {
        id: 'inventory', icon: '📦', title: 'Stock your store — feed, medicine, seed', href: '/owner/inventory',
        how: [
          'Click "+ Record Purchase" for what you already have and for every new delivery: item, supplier, quantity, unit cost.',
          'This sets your live stock levels and the real cost of feed (used in your profit numbers).',
          'Mix your own feed? Use "Feed Formulation" — pick ingredients + kg and it produces a finished feed with rolled-up cost.',
        ],
      },
      {
        id: 'people', icon: '👥', title: 'Add your workers', href: '/owner/people',
        how: [
          'Click "+ Add Employee" — name, phone, role (worker / manager / vet).',
          'Workers log in on their phone with their phone number + a PIN.',
        ],
      },
      {
        id: 'config', icon: '⚙️', title: 'Choose what each worker can see', href: '/owner/config',
        how: [
          'Open a worker profile and set each field to Editable, Read-only, or Hidden.',
          'Hide costs, prices and profit — these are stripped on the server, so money never reaches a worker\'s phone.',
          'Press "Save Profile" to apply. Create different profiles with "+ New Profile".',
        ],
      },
      {
        id: 'rules', icon: '🔔', title: 'Set your alert rules', href: '/owner/alerts',
        how: [
          'Choose when you want to be warned: mortality %, low feed (kg), overdue tasks, water quality.',
          'Edit the numbers and press "Save Rules", then "Run checks now" to see alerts from your data.',
        ],
      },
    ],
  },
  {
    phase: '2 · Run it every day',
    subtitle: 'The daily rhythm once you\'re set up.',
    steps: [
      {
        id: 'tasks', icon: '📋', title: 'Assign daily tasks', href: '/owner/dashboard',
        how: [
          'A manager (or you) assigns tasks to workers — morning round, vaccination, stock count.',
          'Workers see their tasks on their phone when they log in.',
        ],
      },
      {
        id: 'field', icon: '📲', title: 'Workers record in the field', href: '/worker/login',
        how: [
          'Each morning the worker does the Morning Round: water level, feed left, eggs collected, anything abnormal.',
          'They also record deaths (with a photo), feeding, vaccines/medicine, and weighing as they happen.',
          'It works offline — entries save on the phone and sync when there\'s network.',
        ],
      },
      {
        id: 'money', icon: '💰', title: 'Record sales & purchases', href: '/owner/finance',
        how: [
          'Record every sale — eggs, meat, fish, crops: batch, quantity, price, buyer.',
          'Record every purchase under Inventory. Together these drive your profit and per-batch margins.',
        ],
      },
    ],
  },
  {
    phase: '3 · See your results',
    subtitle: 'The payoff — your numbers, live.',
    steps: [
      {
        id: 'dashboard', icon: '📊', title: 'Watch your dashboard', href: '/owner/dashboard',
        how: ['Feed conversion, mortality, margins and revenue update live as data comes in.'],
      },
      {
        id: 'pl', icon: '🐄', title: 'Open any batch\'s profit & loss', href: '/owner/farm',
        how: ['See cost vs revenue, cost breakdown (feed/health/labour/overhead), per-unit cost and break-even.'],
      },
      {
        id: 'reports', icon: '📈', title: 'Export reports', href: '/owner/reports',
        how: [
          'Download any report as PDF, Excel or CSV — for your records, a lender, or an investor.',
          'Generate an expiring read-only link to share with an auditor or investor.',
        ],
      },
    ],
  },
];

const ALL = PHASES.flatMap((p) => p.steps);

export function SetupGuide() {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try { setDone(JSON.parse(localStorage.getItem('ifms_setup_progress') || '{}')); } catch { /* noop */ }
  }, []);

  const toggle = (id: string) => setDone((d) => {
    const next = { ...d, [id]: !d[id] };
    try { localStorage.setItem('ifms_setup_progress', JSON.stringify(next)); } catch { /* noop */ }
    return next;
  });

  const completed = ALL.filter((s) => done[s.id]).length;
  const pct = Math.round((completed / ALL.length) * 100);

  return (
    <>
      {/* Floating button */}
      <button onClick={() => setOpen(true)} aria-label="Open setup guide"
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 bg-green-700 hover:bg-green-800 text-white rounded-full shadow-lg px-4 py-3 font-semibold text-sm">
        <span className="text-lg">📖</span>
        <span className="hidden sm:inline">Setup Guide</span>
        {completed < ALL.length && (
          <span className="bg-white/20 rounded-full px-2 py-0.5 text-xs">{completed}/{ALL.length}</span>
        )}
      </button>

      {/* Drawer */}
      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-gray-50 shadow-2xl overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-green-700 text-white px-5 py-4 z-10">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">📖 Farm Setup Guide</h2>
                <button onClick={() => setOpen(false)} aria-label="Close" className="text-white/80 hover:text-white text-2xl leading-none">×</button>
              </div>
              <p className="text-green-100 text-xs mt-1">Key in your farm step by step. Tick each off as you go.</p>
              <div className="mt-3 bg-green-900/40 rounded-full h-2 overflow-hidden">
                <div className="bg-white h-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-green-100 text-xs mt-1">{completed} of {ALL.length} done · {pct}%</p>
            </div>

            <div className="p-4 flex flex-col gap-5">
              {completed === ALL.length && (
                <div className="bg-green-100 border border-green-300 rounded-xl p-4 text-green-800 text-sm font-semibold text-center">
                  🎉 You&apos;re all set up. Your farm is now running on data.
                </div>
              )}
              {PHASES.map((ph) => (
                <div key={ph.phase}>
                  <h3 className="font-bold text-gray-900">{ph.phase}</h3>
                  <p className="text-xs text-gray-400 mb-2">{ph.subtitle}</p>
                  <div className="flex flex-col gap-3">
                    {ph.steps.map((s) => {
                      const isDone = !!done[s.id];
                      const n = ALL.findIndex((x) => x.id === s.id) + 1;
                      return (
                        <div key={s.id} className={`bg-white border rounded-xl p-4 ${isDone ? 'border-green-300 opacity-70' : 'border-gray-200'}`}>
                          <div className="flex items-start gap-3">
                            <button onClick={() => toggle(s.id)} aria-label="Mark done"
                              className={`mt-0.5 w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center text-sm font-bold ${isDone ? 'bg-green-600 border-green-600 text-white' : 'border-gray-300 text-transparent'}`}>
                              ✓
                            </button>
                            <div className="flex-1 min-w-0">
                              <p className={`font-semibold text-gray-900 ${isDone ? 'line-through text-gray-400' : ''}`}>
                                <span className="text-gray-400 mr-1">{n}.</span>{s.icon} {s.title}
                              </p>
                              <ul className="mt-1.5 flex flex-col gap-1">
                                {s.how.map((h, i) => (
                                  <li key={i} className="text-xs text-gray-600 flex gap-1.5"><span className="text-green-500">•</span><span>{h}</span></li>
                                ))}
                              </ul>
                              {s.href && (
                                <Link href={s.href} onClick={() => setOpen(false)}
                                  className="inline-block mt-2 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 hover:bg-green-100">
                                  Open this page →
                                </Link>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              <p className="text-center text-xs text-gray-400 pb-4">
                Tip: start at step 1 and work down. Each step unlocks the next — you can&apos;t feed a batch before you&apos;ve added it.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
