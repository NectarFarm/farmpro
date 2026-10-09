'use client';
import React from 'react';
import { TopNav, useNav } from './navigation';
import { requestTour } from './tour';
import { PageHeader } from '@/components/ui-kit/page-header';
import { Badge } from '@/components/ui-kit/badge';
import { Button } from '@/components/ui-kit/button';
import { cn } from '@/lib/utils';

// ── About IFMS ──────────────────────────────────────────────────────────────
// A page to be read slowly by a farmer or a new manager, not a feature list.
// Reached from Settings → About.
//
// Every statement here is checked against what the app does today, and the
// "not yet" section is deliberately blunt. Where a claim leans on code, the
// source is named so the next person who changes the behaviour knows this
// page needs changing too:
//   - headcount moves only on approval ......... lib/governance.ts (mortality,
//                                                 physical_count)
//   - who approves by default .................. lib/permission-matrix.ts
//                                                 (DEFAULT_APPROVAL, DEFAULT_MATRIX)
//   - oldest stock is used first ............... lib/inventory-consume.ts
//   - a batch inherits its unit's products ..... lib/products.ts
//   - posting date / required dimensions ....... components/farm/finance.tsx,
//                                                 components/farm/dimensions.tsx
//   - SMS, offline ............................. settings.tsx / dashboard.tsx
//                                                 notification screen say "not built"
// No invented company name, address, rating or roadmap dates.

const SECTIONS = [
  { id: 'about-purpose', label: 'What it is for' },
  { id: 'about-model', label: 'How your farm is laid out' },
  { id: 'about-loop', label: 'The daily loop' },
  { id: 'about-roles', label: 'Who does what' },
  { id: 'about-money', label: 'Where the money lives' },
  { id: 'about-gaps', label: 'What it does not do yet' },
];

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function Section({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 mt-12 first:mt-0">
      <div className="flex items-baseline gap-3">
        <span className="text-sm font-medium text-primary tabular-nums" aria-hidden="true">{String(n).padStart(2, '0')}</span>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="mt-4 flex flex-col gap-4 text-sm leading-relaxed text-fg">{children}</div>
    </section>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-xl bg-surface p-4 shadow-(--shadow-border)', className)}>{children}</div>;
}

// One rung of the farm → unit → batch ladder. `depth` indents it; the rail on
// the left makes it read as a tree without drawing one.
function Rung({ depth, term, name, note }: { depth: 0 | 1 | 2; term: string; name: string; note: string }) {
  return (
    <div className={cn('border-l-2 pl-3', depth === 0 && 'border-primary', depth === 1 && 'ml-4 border-primary/60', depth === 2 && 'ml-8 border-primary/30')}>
      <div className="text-xs font-medium tracking-widest text-muted uppercase">{term}</div>
      <div className="mt-0.5 text-sm font-medium">{name}</div>
      <div className="mt-0.5 text-xs text-muted">{note}</div>
    </div>
  );
}

const ROLES: { who: string; signIn: string; does: string }[] = [
  { who: 'Owner', signIn: 'Email and password', does: 'Everything. Sets up farms, people and permissions, sees the money, approves anything waiting. Never has to wait for anyone else’s approval.' },
  { who: 'Manager', signIn: 'Email and password', does: 'Runs the day: records work, manages stock, batches and tasks, and signs off what workers submit. Can see finance and payroll but not change them, unless the owner allows it.' },
  { who: 'Worker', signIn: 'Phone number and 4-digit PIN', does: 'Records what happens at the house or field: feeding, deaths, counts, egg or milk collection, and their own tasks. Cannot see money. Deaths and counts wait for approval.' },
  { who: 'Vet', signIn: 'Email and password', does: 'Records health work and deaths, and sees the herd and the stock and batch context around them. Deaths and counts wait for approval. No access to money.' },
  { who: 'Auditor', signIn: 'Email and password', does: 'Reads, never writes. Can look at records, finance, payroll and approvals to check them.' },
];

const NOT_YET: { title: string; body: string }[] = [
  { title: 'No VAT handling', body: 'Sales and purchases are recorded at the amount you enter. IFMS does not work out, split out or report VAT.' },
  { title: 'Statutory pay needs a rate', body: 'PAYE, NSSF and SHIF appear on a payslip only when a platform admin has entered a rate that is effective on the period end. Otherwise the payslip says that scheme is not configured. Housing levy is not calculated.' },
  { title: 'A purchase and an expense are the same entry', body: 'Buying feed and paying a repair bill both go in as a purchase. There is no separate expense type with its own rules yet.' },
  { title: 'No offline recording', body: 'Recording needs a connection. There is no queue that saves entries on the phone and sends them later, so a house with no signal cannot record until you are back in range.' },
  { title: 'No SMS', body: 'Alerts and approval requests arrive inside the app (and some by email). Nothing is sent by text message, and quiet hours and per-alert switches do not exist yet.' },
];

export function AboutScreen() {
  const { navigate, role } = useNav();
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? '—';
  const canSetUp = role === 'owner' || role === 'manager';

  return (
    <div className="screen-content">
      <TopNav title="" showBack />
      <div className="px-screen" style={{ paddingTop: 16, paddingBottom: 48 }}>
        <PageHeader
          kicker="About"
          title="How IFMS works"
          lede="Read it top to bottom once, or jump to the part you need."
        />
        <p className="-mt-1 text-sm text-muted">
          Version <span className="font-medium text-fg tabular-nums">{version}</span>
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { navigate('dashboard'); requestTour(); }}>
            Show me around
          </Button>
          {canSetUp && (
            <Button variant="secondary" onClick={() => navigate('getting-started')}>
              Set up your farm
            </Button>
          )}
        </div>

        <nav aria-label="On this page" className="mt-8 flex flex-wrap gap-x-4 gap-y-1.5 border-y border-border/70 py-3">
          {SECTIONS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollToSection(s.id)}
              className="py-1 text-[0.8125rem] text-muted underline-offset-4 hover:text-fg hover:underline"
            >
              <span className="mr-1 tabular-nums text-subtle">{i + 1}</span>{s.label}
            </button>
          ))}
        </nav>

        <div className="mt-10">
          <Section id="about-purpose" n={1} title="What it is for">
            <p className="text-base leading-relaxed">
              IFMS keeps one honest record of your farm: what you keep, what it eats, what dies,
              what it produces, and what you spend and earn because of it.
            </p>
            <p className="text-muted">
              It is for farms that keep animals and grow crops side by side, with more than one
              place to look after and more than one person doing the work. The people in the field
              write things down on their phones, and the owner reads the result without having to
              chase anyone.
            </p>
          </Section>

          <Section id="about-model" n={2} title="How your farm is laid out">
            <p>
              Everything in the app hangs off three levels. Once you see them, every screen makes sense.
            </p>
            <Card className="flex flex-col gap-4">
              <Rung depth={0} term="Farm" name="Kamau Farm, Nakuru" note="A place you run. You can have several, and every screen can show one or all." />
              <Rung depth={1} term="Production unit" name="House 2" note="The physical place where animals or a crop live: a poultry house, a pen, a field." />
              <Rung depth={2} term="Batch" name="Broilers Oct Run, 5,000 birds" note="One group moving through the unit together, from the day it arrives to the day it is sold or closed out." />
            </Card>
            <p className="text-xs text-muted">The names above are an example. Yours are whatever you call them.</p>
            <p>
              <span className="font-medium">Why batches matter.</span> A house is permanent; the birds
              in it change. The batch is the thing that has a headcount, a feed bill, deaths and an
              eventual sale, so that is where profit and loss is worked out. Feed, deaths and counts are
              recorded against a batch, not just “the farm”, and sales and purchases can be tied to one too.
            </p>
            <p>
              <span className="font-medium">Products.</span> A product is something the farm sells: eggs,
              milk, a crop. You set up what a unit produces once, and every batch started in it offers
              those products without being set up again. If one batch is different, you change just that batch.
            </p>
            <p>
              <span className="font-medium">Stock and lots.</span> Things you buy and use up, mainly feed
              and medicine, are kept as stock. Each delivery you receive becomes a lot with its own quantity,
              price and expiry. When a worker records a feeding, the app takes the quantity from the oldest
              usable lot first, and remembers what that lot cost. If there is not enough stock, the feeding is
              refused rather than quietly recorded with the wrong amount.
            </p>
          </Section>

          <Section id="about-loop" n={3} title="The daily loop">
            <ol className="flex flex-col gap-3">
              <li className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-medium text-primary">1</span>
                <span><span className="font-medium">A worker records.</span> From the Record screen on their phone: feeding, a death, a count of the animals, eggs or milk collected.</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-medium text-primary">2</span>
                <span><span className="font-medium">Some records wait.</span> By default, feeding and collection count straight away. A death or a physical count from a worker or vet goes to Approvals first, because it changes how many animals the farm says it has.</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-medium text-primary">3</span>
                <span><span className="font-medium">Approval moves the real numbers.</span> When a manager or owner approves a mortality, the batch headcount goes down by that many. Reject it and the headcount stays exactly as it was.</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-medium text-primary">4</span>
                <span><span className="font-medium">The dashboard reads it back.</span> Totals, overdue tasks and low stock come from what was recorded, so an empty dashboard means nothing has been entered yet, not that something is broken.</span>
              </li>
            </ol>
            <p className="text-muted">
              Which records need approval is not fixed. The owner can change it per role in Governance.
            </p>
          </Section>

          <Section id="about-roles" n={4} title="Who does what">
            <div className="overflow-hidden rounded-xl bg-surface shadow-(--shadow-border)">
              {ROLES.map((r, i) => (
                <div key={r.who} className={cn('px-4 py-3.5', i < ROLES.length - 1 && 'border-b border-border/70')}>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="text-sm font-medium">{r.who}</span>
                    <Badge variant="default">{r.signIn}</Badge>
                  </div>
                  <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">{r.does}</p>
                </div>
              ))}
            </div>
            <p className="text-muted">
              Workers have no email or password to forget. The owner gives each one a phone number and a
              4-digit PIN from the person’s page, and that is their whole login. Everyone else signs in
              with an email and a password. The owner can change what each role may see and edit in Governance.
            </p>
          </Section>

          <Section id="about-money" n={5} title="Where the money lives">
            <p>
              <span className="font-medium">Sales and purchases</span> are entered in Finance. Each one
              also writes a proper double-entry ledger line behind the scenes, which is what the reports
              are built from. You do not need to know accounting to enter them.
            </p>
            <p>
              <span className="font-medium">The posting date</span> decides which month an entry counts in.
              It defaults to the date of the sale or purchase, but you can set it differently, for example to
              bring a sale entered after month end into the month it belongs to. It cannot be in the future.
            </p>
            <p>
              <span className="font-medium">Reporting dimensions</span> are the “by what?” of a number: by
              farm, by unit, by batch. They are how you can ask “what did Broilers Oct Run cost?” and get an
              answer. The owner can mark a ledger account as requiring one, and then the form will not let
              you post to it without naming a farm, unit or batch. That can feel strict while you enter a
              purchase. It is what keeps the by-farm and by-batch reports from filling with unassigned money.
            </p>
            <p>
              <span className="font-medium">Reports read real recorded data.</span> There are no sample
              figures and nothing is estimated. If a number looks wrong, the cause is an entry that is
              missing, or one recorded against the wrong farm or batch, not a report guessing.
            </p>
          </Section>

          <Section id="about-gaps" n={6} title="What it does not do yet">
            <p>
              Better you hear it here than find out at the worst moment. These are not built, and the app
              does not pretend otherwise.
            </p>
            <div className="overflow-hidden rounded-xl bg-surface shadow-(--shadow-border)">
              {NOT_YET.map((g, i) => (
                <div key={g.title} className={cn('px-4 py-3.5', i < NOT_YET.length - 1 && 'border-b border-border/70')}>
                  <div className="flex items-center gap-2">
                    <Badge variant="warning">Not yet</Badge>
                    <span className="text-sm font-medium">{g.title}</span>
                  </div>
                  <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">{g.body}</p>
                </div>
              ))}
            </div>
          </Section>
        </div>

        <p className="mt-14 text-center text-xs text-subtle">IFMS · Version {version}</p>
      </div>
    </div>
  );
}
