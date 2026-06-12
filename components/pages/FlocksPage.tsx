"use client";
import { useState, useMemo } from "react";
import { useFarmStore } from "@/lib/store";
import type { Flock, FeedRecord, MortalityRecord, VaccinationRecord, EggCollection, FlockStage } from "@/lib/types";
import { formatDate, formatCurrency, generateId, calcMortalityRate, formatDateShort } from "@/lib/utils";
import { Plus, Bird, ChevronDown, Syringe, Skull, Egg, Wheat, Trash2, CheckCircle, Clock, AlertCircle, X, Edit2, ArrowRight, TrendingUp, DollarSign, ShoppingBag } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { toast } from "sonner";

// ── helpers ──────────────────────────────────────────────────────────────────
const STAGE_ORDER: FlockStage[] = ["brooder", "grower", "layer", "disposal", "sold"];
const STAGE_LABELS: Record<FlockStage, string> = { brooder: "Brooder", grower: "Grower", layer: "Layer", disposal: "Disposal / Sale Stock", sold: "Sold" };
const nextStage = (s: FlockStage): FlockStage => STAGE_ORDER[Math.min(STAGE_ORDER.indexOf(s) + 1, STAGE_ORDER.length - 1)];
const stageCls: Record<FlockStage, string> = {
  brooder: "stage-brooder",
  grower: "stage-grower",
  layer: "stage-layer",
  disposal: "stage-sold",
  sold: "stage-sold",
};

const INPUT = "w-full px-3 py-2 rounded-xl border border-border bg-input text-sm outline-none focus:ring-2 focus:ring-primary/30";
const BTN_PRIMARY = "bg-primary text-white rounded-xl px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity";
const BTN_GHOST = "rounded-xl px-3 py-1.5 text-sm font-medium border border-border hover:bg-muted/40 transition-colors";

type Tab = "vaccinations" | "mortality" | "feed" | "eggs" | "valuation";

// ── main component ────────────────────────────────────────────────────────────
export default function FlocksPage() {
  const {
    flocks, addFlock, updateFlock, deleteFlock,
    mortalityRecords, addMortalityRecord,
    feedRecords, addFeedRecord,
    vaccinationRecords, addVaccinationRecord, updateVaccinationRecord,
    eggCollections, addEggCollection,
    sales, customers,
    birdStagePricing, birdStageSales, addBirdStageSale, expenses, vaccinationRecords: allVaccRecords,
  } = useFarmStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("vaccinations");
  const [showAddFlock, setShowAddFlock] = useState(false);
  const [advanceModal, setAdvanceModal] = useState<Flock | null>(null);

  const selectedFlock = flocks.find(f => f.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Flock Manager</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage flocks from chick to sale – track costs and performance</p>
        </div>
        <button className={BTN_PRIMARY} onClick={() => setShowAddFlock(true)}>
          <span className="flex items-center gap-1.5"><Plus size={15} /> Add Flock</span>
        </button>
      </div>

      {/* Flock Cards */}
      <FlockList
        flocks={flocks}
        mortalityRecords={mortalityRecords}
        selectedId={selectedId}
        onSelect={(id) => { setSelectedId(id === selectedId ? null : id); setActiveTab("vaccinations"); }}
        onDelete={deleteFlock}
        onAdvanceStage={setAdvanceModal}
      />

      {/* Detail Panel */}
      {selectedFlock && (
        <DetailPanel
          flock={selectedFlock}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          mortalityRecords={mortalityRecords.filter(r => r.flockId === selectedFlock.id)}
          feedRecords={feedRecords.filter(r => r.flockId === selectedFlock.id)}
          vaccinationRecords={vaccinationRecords.filter(r => r.flockId === selectedFlock.id)}
          eggCollections={eggCollections.filter(r => r.flockId === selectedFlock.id)}
          sales={sales.filter(s => s.flockId === selectedFlock.id)}
          onAddMortality={(r) => { addMortalityRecord(r); toast.success("Mortality logged"); }}
          onAddFeed={(r) => { addFeedRecord(r); toast.success("Feed logged"); }}
          onAddVaccination={(r) => { addVaccinationRecord(r); toast.success("Vaccination added"); }}
          onCompleteVaccination={(id) => { updateVaccinationRecord(id, { completedDate: new Date().toISOString() }); toast.success("Marked complete"); }}
          onAddEgg={(e) => { addEggCollection(e); toast.success("Egg collection saved"); }}
          allFeedRecords={feedRecords}
          allExpenses={expenses}
          allVaccRecords={allVaccRecords}
          birdStagePricing={birdStagePricing}
          birdStageSales={birdStageSales.filter(s => s.flockId === selectedFlock.id)}
          onAddBirdStageSale={(s) => { addBirdStageSale(s); toast.success("Bird sale recorded"); }}
          allCustomers={customers}
        />
      )}

      {/* Add Flock Modal */}
      {showAddFlock && (
        <AddFlockModal
          onClose={() => setShowAddFlock(false)}
          onSave={(data) => {
            addFlock({ id: generateId(), currentCount: data.initialCount, createdAt: new Date().toISOString(), ...data });
            setShowAddFlock(false);
            toast.success("Flock added!");
          }}
        />
      )}

      {advanceModal && (
        <AdvanceStageModal
          flock={advanceModal}
          onClose={() => setAdvanceModal(null)}
          onSave={(ns) => {
            updateFlock(advanceModal.id, { stage: ns });
            setAdvanceModal(null);
            toast.success(`${advanceModal.name} advanced to ${STAGE_LABELS[ns]}`);
          }}
        />
      )}
    </div>
  );
}

// ── FlockList ─────────────────────────────────────────────────────────────────
function FlockList({ flocks, mortalityRecords, selectedId, onSelect, onDelete, onAdvanceStage }: {
  flocks: Flock[];
  mortalityRecords: MortalityRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onAdvanceStage: (f: Flock) => void;
}) {
  if (flocks.length === 0)
    return (
      <div className="glass-card rounded-2xl p-8 text-center text-muted-foreground">
        <Bird size={40} className="mx-auto mb-3 opacity-40" />
        <p className="font-medium">No flocks yet. Add your first flock to get started.</p>
      </div>
    );
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {flocks.map(flock => {
        const deaths = mortalityRecords.filter(r => r.flockId === flock.id).reduce((s, r) => s + r.count, 0);
        const rate = calcMortalityRate(flock.initialCount, deaths);
        const selected = flock.id === selectedId;
        return (
          <div key={flock.id}
            className={`glass-card rounded-2xl p-4 cursor-pointer transition-all border-2 ${selected ? "border-primary/60" : "border-transparent"}`}
            onClick={() => onSelect(flock.id)}
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="font-semibold text-base">{flock.name}</h3>
                <p className="text-xs text-muted-foreground">{flock.breed}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stageCls[flock.stage]}`}>{flock.stage}</span>
            </div>
            <div className="flex items-center gap-3 text-sm mb-2">
              <span><span className="font-semibold">{flock.currentCount}</span><span className="text-muted-foreground">/{flock.initialCount} birds</span></span>
              {rate > 5 && <span className="text-xs bg-red-500/15 text-red-600 rounded-full px-2 py-0.5">{rate.toFixed(1)}% mortality</span>}
            </div>
            <div className="text-xs text-muted-foreground mb-3">
              Acquired {formatDate(flock.dateAcquired)} · Cost {formatCurrency(flock.purchaseCostPerChick * flock.initialCount)}
            </div>
            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
              {flock.stage !== "sold" && (
                <button className={BTN_GHOST + " flex items-center gap-1 text-xs"} onClick={() => onAdvanceStage(flock)}>
                  <ArrowRight size={12} /> Advance Stage
                </button>
              )}
              <button className="ml-auto p-1.5 rounded-lg hover:bg-red-500/10 text-red-500 transition-colors" onClick={() => onDelete(flock.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── DetailPanel ───────────────────────────────────────────────────────────────
function DetailPanel({ flock, activeTab, setActiveTab, mortalityRecords, feedRecords, vaccinationRecords, eggCollections, sales, onAddMortality, onAddFeed, onAddVaccination, onCompleteVaccination, onAddEgg, allFeedRecords, allExpenses, allVaccRecords, birdStagePricing, birdStageSales, onAddBirdStageSale, allCustomers }: {
  flock: Flock; activeTab: Tab; setActiveTab: (t: Tab) => void;
  mortalityRecords: MortalityRecord[]; feedRecords: FeedRecord[];
  vaccinationRecords: VaccinationRecord[]; eggCollections: EggCollection[];
  sales: { product: string; totalAmount: number; quantity: number }[];
  onAddMortality: (r: MortalityRecord) => void; onAddFeed: (r: FeedRecord) => void;
  onAddVaccination: (r: VaccinationRecord) => void; onCompleteVaccination: (id: string) => void;
  onAddEgg: (e: EggCollection) => void;
  allFeedRecords: FeedRecord[]; allExpenses: import("@/lib/types").Expense[];
  allVaccRecords: VaccinationRecord[]; birdStagePricing: import("@/lib/types").BirdStagePricing;
  birdStageSales: import("@/lib/types").BirdStageSale[];
  onAddBirdStageSale: (s: import("@/lib/types").BirdStageSale) => void;
  allCustomers: import("@/lib/types").Customer[];
}) {
  const tabs: { id: Tab; label: string; Icon: any }[] = [
    { id: "vaccinations", label: "Vaccinations", Icon: Syringe },
    { id: "mortality", label: "Mortality", Icon: Skull },
    { id: "feed", label: "Feed", Icon: Wheat },
    { id: "eggs", label: "Eggs", Icon: Egg },
    { id: "valuation", label: "Valuation", Icon: TrendingUp },
  ];

  // Profit calc
  const purchaseCost = flock.purchaseCostPerChick * flock.initialCount;
  const feedCost = feedRecords.reduce((s, r) => s + r.totalCost, 0);
  const vaccineCost = vaccinationRecords.reduce((s, r) => s + r.cost, 0);
  const eggRevenue = sales.filter(s => s.product === "eggs").reduce((s, r) => s + r.totalAmount, 0);
  const birdRevenue = sales.filter(s => s.product === "birds").reduce((s, r) => s + r.totalAmount, 0);
  const net = eggRevenue + birdRevenue - purchaseCost - feedCost - vaccineCost;

  return (
    <div className="glass-card rounded-2xl p-4 space-y-4">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${activeTab === t.id ? "bg-primary text-white" : "hover:bg-muted/40"}`}>
            <t.Icon size={13} />{t.label}
          </button>
        ))}
      </div>

      {activeTab === "vaccinations" && <VaccinationsTab flock={flock} records={vaccinationRecords} onAdd={onAddVaccination} onComplete={onCompleteVaccination} />}
      {activeTab === "mortality" && <MortalityTab flock={flock} records={mortalityRecords} onAdd={onAddMortality} />}
      {activeTab === "feed" && <FeedTab flock={flock} records={feedRecords} onAdd={onAddFeed} />}
      {activeTab === "eggs" && <EggsTab flock={flock} records={eggCollections} onAdd={onAddEgg} />}
      {activeTab === "valuation" && (
        <ValuationTab flock={flock} feedRecords={allFeedRecords} vaccRecords={allVaccRecords}
          expenses={allExpenses} birdStagePricing={birdStagePricing}
          birdStageSales={birdStageSales} onAddSale={onAddBirdStageSale} customers={allCustomers} />
      )}

      {/* Profit Panel */}
      <div className="border-t border-border pt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
        {[
          ["Purchase Cost", formatCurrency(purchaseCost)],
          ["Feed Cost", formatCurrency(feedCost)],
          ["Vaccine Cost", formatCurrency(vaccineCost)],
          ["Egg Revenue", formatCurrency(eggRevenue)],
          ["Bird Revenue", formatCurrency(birdRevenue)],
        ].map(([label, val]) => (
          <div key={label} className="bg-muted/30 rounded-xl p-2">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="font-semibold">{val}</p>
          </div>
        ))}
        <div className={`rounded-xl p-2 ${net >= 0 ? "bg-green-500/10 text-green-700" : "bg-red-500/10 text-red-700"}`}>
          <p className="text-xs opacity-70">Net Profit</p>
          <p className="font-bold">{formatCurrency(net)}</p>
        </div>
      </div>
    </div>
  );
}

// ── Sub-tabs ──────────────────────────────────────────────────────────────────
function VaccinationsTab({ flock, records, onAdd, onComplete }: { flock: Flock; records: VaccinationRecord[]; onAdd: (r: VaccinationRecord) => void; onComplete: (id: string) => void }) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ vaccineName: "", scheduledDate: "", cost: "", notes: "" });
  const today = new Date().toISOString().slice(0, 10);
  const submit = () => {
    if (!form.vaccineName || !form.scheduledDate) return;
    onAdd({ id: generateId(), flockId: flock.id, vaccineName: form.vaccineName, scheduledDate: form.scheduledDate, cost: parseFloat(form.cost) || 0, notes: form.notes, createdAt: new Date().toISOString() });
    setForm({ vaccineName: "", scheduledDate: "", cost: "", notes: "" }); setShow(false);
  };
  return (
    <div className="space-y-2">
      {records.map(r => {
        const overdue = !r.completedDate && r.scheduledDate < today;
        return (
          <div key={r.id} className="flex items-center gap-3 bg-muted/20 rounded-xl px-3 py-2 text-sm">
            {r.completedDate ? <CheckCircle size={15} className="text-green-500 shrink-0" /> : overdue ? <AlertCircle size={15} className="text-red-500 shrink-0" /> : <Clock size={15} className="text-yellow-500 shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{r.vaccineName}</p>
              <p className="text-xs text-muted-foreground">{r.completedDate ? `Done ${formatDateShort(r.completedDate)}` : overdue ? `Overdue since ${formatDateShort(r.scheduledDate)}` : `Scheduled ${formatDateShort(r.scheduledDate)}`}</p>
            </div>
            {!r.completedDate && <button className="text-xs text-primary hover:underline shrink-0" onClick={() => onComplete(r.id)}>Mark done</button>}
          </div>
        );
      })}
      {show ? (
        <div className="bg-muted/20 rounded-xl p-3 space-y-2">
          <input className={INPUT} placeholder="Vaccine name" value={form.vaccineName} onChange={e => setForm(f => ({ ...f, vaccineName: e.target.value }))} />
          <div className="grid grid-cols-2 gap-2">
            <input className={INPUT} type="date" value={form.scheduledDate} onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))} />
            <input className={INPUT} type="number" placeholder="Cost (Ksh)" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} />
          </div>
          <input className={INPUT} placeholder="Notes (optional)" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          <div className="flex gap-2"><button className={BTN_PRIMARY} onClick={submit}>Save</button><button className={BTN_GHOST} onClick={() => setShow(false)}>Cancel</button></div>
        </div>
      ) : <button className={BTN_GHOST + " flex items-center gap-1.5 text-xs"} onClick={() => setShow(true)}><Plus size={12} />Add Vaccination</button>}
    </div>
  );
}

function MortalityTab({ flock, records, onAdd }: { flock: Flock; records: MortalityRecord[]; onAdd: (r: MortalityRecord) => void }) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), count: "", cause: "" });
  const totalDeaths = records.reduce((s, r) => s + r.count, 0);
  const rate = calcMortalityRate(flock.initialCount, totalDeaths);
  const submit = () => {
    if (!form.count) return;
    onAdd({ id: generateId(), flockId: flock.id, date: form.date, count: parseInt(form.count), cause: form.cause, createdAt: new Date().toISOString() });
    setForm({ date: new Date().toISOString().slice(0, 10), count: "", cause: "" }); setShow(false);
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-sm mb-1">
        <span>Total deaths: <b>{totalDeaths}</b></span>
        <span className={rate > 5 ? "text-red-600 font-semibold" : "text-muted-foreground"}>Rate: {rate.toFixed(1)}%</span>
      </div>
      {records.map(r => (
        <div key={r.id} className="flex items-center gap-3 bg-muted/20 rounded-xl px-3 py-2 text-sm">
          <Skull size={14} className="text-red-400 shrink-0" />
          <span className="flex-1">{formatDateShort(r.date)} — <b>{r.count}</b> bird{r.count !== 1 ? "s" : ""}{r.cause ? ` · ${r.cause}` : ""}</span>
        </div>
      ))}
      {show ? (
        <div className="bg-muted/20 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={INPUT} type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            <input className={INPUT} type="number" min="1" placeholder="Count" value={form.count} onChange={e => setForm(f => ({ ...f, count: e.target.value }))} />
          </div>
          <input className={INPUT} placeholder="Cause (optional)" value={form.cause} onChange={e => setForm(f => ({ ...f, cause: e.target.value }))} />
          <div className="flex gap-2"><button className={BTN_PRIMARY} onClick={submit}>Log</button><button className={BTN_GHOST} onClick={() => setShow(false)}>Cancel</button></div>
        </div>
      ) : <button className={BTN_GHOST + " flex items-center gap-1.5 text-xs"} onClick={() => setShow(true)}><Plus size={12} />Log Mortality</button>}
    </div>
  );
}

function FeedTab({ flock, records, onAdd }: { flock: Flock; records: FeedRecord[]; onAdd: (r: FeedRecord) => void }) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), quantityKg: "", feedType: "starter" as FeedRecord["feedType"], feedSource: "purchased" as FeedRecord["feedSource"], costPerKg: "" });
  const submit = () => {
    if (!form.quantityKg || !form.costPerKg) return;
    const qty = parseFloat(form.quantityKg), cpk = parseFloat(form.costPerKg);
    onAdd({ id: generateId(), flockId: flock.id, date: form.date, quantityKg: qty, feedType: form.feedType, feedSource: form.feedSource, costPerKg: cpk, totalCost: qty * cpk, createdAt: new Date().toISOString() });
    setForm({ date: new Date().toISOString().slice(0, 10), quantityKg: "", feedType: "starter", feedSource: "purchased", costPerKg: "" }); setShow(false);
  };
  const chartData = useMemo(() => {
    const now = Date.now(); const cutoff = now - 30 * 86400000;
    const byDate: Record<string, number> = {};
    records.filter(r => new Date(r.date).getTime() >= cutoff).forEach(r => { byDate[r.date] = (byDate[r.date] ?? 0) + r.totalCost; });
    return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, cost]) => ({ date: formatDateShort(date), cost: parseFloat(cost.toFixed(2)) }));
  }, [records]);
  return (
    <div className="space-y-3">
      {chartData.length > 1 && (
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} width={40} /><Tooltip formatter={(v: number) => formatCurrency(v)} /><Line type="monotone" dataKey="cost" stroke="oklch(0.55 0.16 145)" strokeWidth={2} dot={false} /></LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {records.slice(-5).reverse().map(r => (
        <div key={r.id} className="flex items-center gap-3 bg-muted/20 rounded-xl px-3 py-2 text-sm">
          <Wheat size={14} className="text-yellow-500 shrink-0" />
          <span className="flex-1">{formatDateShort(r.date)} · {r.quantityKg}kg {r.feedType}</span>
          <span className="font-medium">{formatCurrency(r.totalCost)}</span>
        </div>
      ))}
      {show ? (
        <div className="bg-muted/20 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={INPUT} type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            <select className={INPUT} value={form.feedType} onChange={e => setForm(f => ({ ...f, feedType: e.target.value as FeedRecord["feedType"] }))}>
              {(["starter","grower","layer","finisher"] as FeedRecord["feedType"][]).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <select className={INPUT} value={form.feedSource} onChange={e => setForm(f => ({ ...f, feedSource: e.target.value as FeedRecord["feedSource"] }))}>
            <option value="purchased">Purchased</option>
            <option value="produced">Produced on-farm</option>
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input className={INPUT} type="number" placeholder="Qty (kg)" value={form.quantityKg} onChange={e => setForm(f => ({ ...f, quantityKg: e.target.value }))} />
            <input className={INPUT} type="number" placeholder="Cost/kg (Ksh)" value={form.costPerKg} onChange={e => setForm(f => ({ ...f, costPerKg: e.target.value }))} />
          </div>
          <div className="flex gap-2"><button className={BTN_PRIMARY} onClick={submit}>Save</button><button className={BTN_GHOST} onClick={() => setShow(false)}>Cancel</button></div>
        </div>
      ) : <button className={BTN_GHOST + " flex items-center gap-1.5 text-xs"} onClick={() => setShow(true)}><Plus size={12} />Log Feed</button>}
    </div>
  );
}

function EggsTab({ flock, records, onAdd }: { flock: Flock; records: EggCollection[]; onAdd: (e: EggCollection) => void }) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), count: "", broken: "0", notes: "" });
  const totalCollected = records.reduce((s, r) => s + r.count, 0);
  const totalBroken = records.reduce((s, r) => s + (r.broken ?? 0), 0);
  const totalSellable = records.reduce((s, r) => s + (r.sellable ?? r.count), 0);
  const avg = records.length ? (totalCollected / records.length).toFixed(1) : "0";
  const previewSellable = Math.max(0, (parseInt(form.count) || 0) - (parseInt(form.broken) || 0));
  const submit = () => {
    if (!form.count) return;
    const count = parseInt(form.count) || 0;
    const broken = Math.min(parseInt(form.broken) || 0, count);
    onAdd({ id: generateId(), flockId: flock.id, date: form.date, count, broken, sellable: count - broken, notes: form.notes || undefined, createdAt: new Date().toISOString() });
    setForm({ date: new Date().toISOString().slice(0, 10), count: "", broken: "0", notes: "" }); setShow(false);
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-sm mb-1 flex-wrap">
        <span>Collected: <b>{totalCollected}</b></span>
        <span className="text-red-500">Broken: <b>{totalBroken}</b></span>
        <span className="text-green-600">Sellable: <b>{totalSellable}</b></span>
        <span className="text-muted-foreground">Avg: {avg}/session</span>
      </div>
      {records.slice(-6).reverse().map(r => (
        <div key={r.id} className="flex items-center gap-3 bg-muted/20 rounded-xl px-3 py-2 text-sm">
          <Egg size={14} className="text-amber-400 shrink-0" />
          <span className="flex-1">{formatDateShort(r.date)}</span>
          <span className="font-medium">{r.count} collected</span>
          {(r.broken ?? 0) > 0 && <span className="text-red-500 text-xs">{r.broken} broken</span>}
          <span className="text-green-600 text-xs font-medium">{r.sellable ?? r.count} sellable</span>
        </div>
      ))}
      {show ? (
        <div className="bg-muted/20 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={INPUT} type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            <input className={INPUT} type="number" min="0" placeholder="Total collected" value={form.count} onChange={e => setForm(f => ({ ...f, count: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Broken / damaged</label>
              <input className={INPUT} type="number" min="0" placeholder="0" value={form.broken} onChange={e => setForm(f => ({ ...f, broken: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Sellable (auto)</label>
              <div className={INPUT + " bg-muted/30 text-muted-foreground cursor-default"}>{previewSellable}</div>
            </div>
          </div>
          <input className={INPUT} placeholder="Notes (optional)" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          <div className="flex gap-2"><button className={BTN_PRIMARY} onClick={submit}>Save</button><button className={BTN_GHOST} onClick={() => setShow(false)}>Cancel</button></div>
        </div>
      ) : <button className={BTN_GHOST + " flex items-center gap-1.5 text-xs"} onClick={() => setShow(true)}><Plus size={12} />Log Collection</button>}
    </div>
  );
}

// ── AddFlockModal ─────────────────────────────────────────────────────────────
function AddFlockModal({ onClose, onSave }: {
  onClose: () => void;
  onSave: (data: Omit<Flock, "id" | "currentCount" | "createdAt">) => void;
}) {
  const [form, setForm] = useState({
    name: "", dateAcquired: new Date().toISOString().slice(0, 10),
    source: "", initialCount: "", purchaseCostPerChick: "",
    initialWeight: "", breed: "", stage: "brooder" as FlockStage, notes: "",
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const submit = () => {
    if (!form.name || !form.initialCount) { toast.error("Name and count required"); return; }
    onSave({
      name: form.name, dateAcquired: form.dateAcquired, source: form.source,
      initialCount: parseInt(form.initialCount) || 0,
      purchaseCostPerChick: parseFloat(form.purchaseCostPerChick) || 0,
      initialWeight: parseFloat(form.initialWeight) || 0,
      breed: form.breed, stage: form.stage, notes: form.notes,
    });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="glass-card rounded-2xl p-5 w-full max-w-md space-y-3 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-bold text-lg">Add New Flock</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/40"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input className={INPUT + " col-span-2"} placeholder="Flock name *" value={form.name} onChange={e => set("name", e.target.value)} />
          <input className={INPUT} placeholder="Breed" value={form.breed} onChange={e => set("breed", e.target.value)} />
          <input className={INPUT} placeholder="Source / Supplier" value={form.source} onChange={e => set("source", e.target.value)} />
          <input className={INPUT} type="date" value={form.dateAcquired} onChange={e => set("dateAcquired", e.target.value)} />
          <input className={INPUT} type="number" min="1" placeholder="Initial count *" value={form.initialCount} onChange={e => set("initialCount", e.target.value)} />
          <input className={INPUT} type="number" placeholder="Cost/Bird (Ksh)" value={form.purchaseCostPerChick} onChange={e => set("purchaseCostPerChick", e.target.value)} />
          <input className={INPUT} type="number" placeholder="Initial weight (g)" value={form.initialWeight} onChange={e => set("initialWeight", e.target.value)} />
          <select className={INPUT + " col-span-2"} value={form.stage} onChange={e => set("stage", e.target.value)}>
            {(["brooder","grower","layer"] as FlockStage[]).map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          <textarea className={INPUT + " col-span-2 resize-none"} rows={2} placeholder="Notes (optional)" value={form.notes} onChange={e => set("notes", e.target.value)} />
        </div>
        <div className="flex gap-2 pt-1">
          <button className={BTN_PRIMARY + " flex-1"} onClick={submit}>Add Flock</button>
          <button className={BTN_GHOST} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── ValuationTab ───────────────────────────────────────────────────────────────
function ValuationTab({ flock, feedRecords, vaccRecords, expenses, birdStagePricing, birdStageSales, onAddSale, customers }: {
  flock: Flock;
  feedRecords: import("@/lib/types").FeedRecord[];
  vaccRecords: VaccinationRecord[];
  expenses: import("@/lib/types").Expense[];
  birdStagePricing: import("@/lib/types").BirdStagePricing;
  birdStageSales: import("@/lib/types").BirdStageSale[];
  onAddSale: (s: import("@/lib/types").BirdStageSale) => void;
  customers: import("@/lib/types").Customer[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ qty: "", price: "", customerId: "", date: new Date().toISOString().split("T")[0], notes: "" });
  const sf = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // ── Break-even calculation ─────────────────────────────────────────────────
  const flockFeed = feedRecords.filter(r => r.flockId === flock.id);
  const flockVacc = vaccRecords.filter(r => r.flockId === flock.id);
  const flockExp  = expenses.filter(e => e.flockId === flock.id);

  const totalFeedCost = flockFeed.reduce((s, r) => s + r.totalCost, 0);
  const totalVaccCost = flockVacc.reduce((s, r) => s + r.cost, 0);
  const totalOtherExp = flockExp.reduce((s, e) => s + e.amount, 0);
  const purchaseCost  = flock.purchaseCostPerChick * flock.initialCount;
  const totalCostToDate = purchaseCost + totalFeedCost + totalVaccCost + totalOtherExp;

  // Cost per surviving bird right now
  const surviving = Math.max(1, flock.currentCount);
  const costPerBirdNow = totalCostToDate / surviving;

  // Break-even at each stage = cost per bird at that point
  const stageBreakEven: Record<string, number> = {
    brooder: costPerBirdNow, // currently at this stage
    grower:  costPerBirdNow * 1.35,  // estimated 35% more feed ahead
    layer:   costPerBirdNow * 1.80,  // estimated 80% more by layer
  };
  const configuredPrice = birdStagePricing[flock.stage as keyof typeof birdStagePricing] ?? 0;
  const marginAtConfigured = configuredPrice - costPerBirdNow;

  function submitSale() {
    const qty = parseInt(form.qty);
    const price = parseFloat(form.price);
    if (!qty || qty <= 0 || qty > flock.currentCount) { toast.error(`Qty must be 1–${flock.currentCount}`); return; }
    if (!price || price <= 0) { toast.error("Enter valid price per bird"); return; }
    onAddSale({
      id: generateId(), flockId: flock.id, stage: flock.stage,
      quantity: qty, pricePerBird: price,
      breakEvenPrice: costPerBirdNow,
      totalAmount: qty * price,
      customerId: form.customerId || undefined,
      date: form.date, notes: form.notes,
      createdAt: new Date().toISOString(),
    });
    setShowForm(false);
    setForm({ qty: "", price: "", customerId: "", date: new Date().toISOString().split("T")[0], notes: "" });
  }

  const totalBirdRevenue = birdStageSales.reduce((s, r) => s + r.totalAmount, 0);
  const totalBirdsSold   = birdStageSales.reduce((s, r) => s + r.quantity, 0);

  return (
    <div className="space-y-4">
      {/* Cost summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Total Cost to Date", value: formatCurrency(totalCostToDate), sub: "All costs incurred", color: "oklch(0.57 0.24 27)" },
          { label: "Cost per Bird Now", value: formatCurrency(costPerBirdNow), sub: `${flock.currentCount} birds alive`, color: "oklch(0.55 0.18 40)" },
          { label: "Configured Price", value: formatCurrency(configuredPrice), sub: `${flock.stage} stage`, color: "oklch(0.42 0.14 148)" },
          { label: "Margin per Bird", value: formatCurrency(marginAtConfigured), sub: marginAtConfigured >= 0 ? "Profit if sold now" : "Loss if sold now", color: marginAtConfigured >= 0 ? "oklch(0.42 0.14 148)" : "oklch(0.57 0.24 27)" },
        ].map(c => (
          <div key={c.label} className="rounded-xl p-3 border border-border">
            <div className="text-lg font-bold" style={{ color: c.color }}>{c.value}</div>
            <div className="text-[10px] font-medium text-muted-foreground">{c.label}</div>
            <div className="text-[10px] text-muted-foreground/70">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Break-even per stage */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Estimated Break-Even Price by Stage</p>
        <div className="grid grid-cols-3 gap-2">
          {(["brooder","grower","layer"] as const).map(stage => {
            const be = stageBreakEven[stage];
            const sp = birdStagePricing[stage];
            const profit = sp - be;
            return (
              <div key={stage} className={`rounded-xl p-3 border ${flock.stage === stage ? "border-primary" : "border-border"}`}
                style={{ background: flock.stage === stage ? "oklch(0.42 0.14 148 / 0.06)" : "" }}>
                <div className="flex items-center gap-1 mb-1">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded stage-${stage}`}>{stage.toUpperCase()}</span>
                  {flock.stage === stage && <span className="text-[9px] text-primary font-semibold">NOW</span>}
                </div>
                <div className="text-sm font-bold text-foreground">Break-even: {formatCurrency(be)}</div>
                <div className="text-xs text-muted-foreground">Your price: {formatCurrency(sp)}</div>
                <div className={`text-xs font-semibold mt-0.5 ${profit >= 0 ? "text-primary" : "text-destructive"}`}>
                  {profit >= 0 ? `+${formatCurrency(profit)}` : formatCurrency(profit)} margin
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Record a bird sale */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bird Sales at This Stage</p>
          <button onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
            style={{ background: "oklch(0.42 0.14 148)" }}>
            <Plus size={12} /> Record Sale
          </button>
        </div>

        {showForm && (
          <div className="rounded-xl border border-border p-3 space-y-2 mb-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Qty to sell (max {flock.currentCount})</label>
                <input type="number" min="1" max={flock.currentCount} value={form.qty} onChange={e => sf("qty", e.target.value)} className={INPUT} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Price per bird (Ksh)</label>
                <input type="number" min="1" value={form.price} onChange={e => sf("price", e.target.value)} className={INPUT}
                  placeholder={`≥ ${Math.ceil(costPerBirdNow)} to break even`} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Date</label>
                <input type="date" value={form.date} onChange={e => sf("date", e.target.value)} className={INPUT} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Customer (optional)</label>
                <select value={form.customerId} onChange={e => sf("customerId", e.target.value)} className={INPUT}>
                  <option value="">Walk-in / unknown</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <input value={form.notes} onChange={e => sf("notes", e.target.value)} className={INPUT} placeholder="Notes (optional)" />
            {form.qty && form.price && (
              <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "oklch(0.42 0.14 148 / 0.08)" }}>
                Total: <strong>{formatCurrency(Number(form.qty) * Number(form.price))}</strong>
                {" · "}
                {Number(form.price) >= costPerBirdNow
                  ? <span className="text-primary font-semibold">Profit: {formatCurrency((Number(form.price) - costPerBirdNow) * Number(form.qty))}</span>
                  : <span className="text-destructive font-semibold">Loss: {formatCurrency((costPerBirdNow - Number(form.price)) * Number(form.qty))}</span>}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={submitSale} className={BTN_PRIMARY + " text-xs py-1.5"}>Save Sale</button>
              <button onClick={() => setShowForm(false)} className={BTN_GHOST + " text-xs py-1.5"}>Cancel</button>
            </div>
          </div>
        )}

        {birdStageSales.length === 0 && <p className="text-xs text-muted-foreground">No bird sales recorded yet for this flock.</p>}
        {birdStageSales.map(sale => {
          const cust = customers.find(c => c.id === sale.customerId);
          const profit = (sale.pricePerBird - sale.breakEvenPrice) * sale.quantity;
          return (
            <div key={sale.id} className="flex items-center justify-between py-2 border-t border-border/50 text-xs">
              <div>
                <span className="font-medium text-foreground">{sale.quantity} birds @ {formatCurrency(sale.pricePerBird)}</span>
                <span className="text-muted-foreground ml-1.5">· {cust?.name ?? "Walk-in"} · {formatDate(sale.date)}</span>
                <span className={`ml-1.5 font-semibold ${profit >= 0 ? "text-primary" : "text-destructive"}`}>
                  ({profit >= 0 ? "+" : ""}{formatCurrency(profit)})
                </span>
              </div>
              <span className="font-bold text-foreground">{formatCurrency(sale.totalAmount)}</span>
            </div>
          );
        })}

        {birdStageSales.length > 0 && (
          <div className="pt-2 border-t border-border text-xs flex justify-between font-semibold">
            <span>{birdStageSales.reduce((s, r) => s + r.quantity, 0)} birds sold</span>
            <span className="text-primary">{formatCurrency(birdStageSales.reduce((s, r) => s + r.totalAmount, 0))}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function AdvanceStageModal({ flock, onClose, onSave }: { flock: Flock; onClose: () => void; onSave: (ns: FlockStage) => void }) {
  const [stage, setStage] = useState<FlockStage>(nextStage(flock.stage));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="glass-card rounded-2xl p-5 w-full max-w-sm space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div>
          <h2 className="font-bold text-lg">Advance Stage</h2>
          <p className="text-xs text-muted-foreground">Moving <b>{flock.name}</b> from {STAGE_LABELS[flock.stage]}</p>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase mb-1.5 block">Select New Stage</label>
          <div className="grid grid-cols-1 gap-2">
            {STAGE_ORDER.slice(STAGE_ORDER.indexOf(flock.stage) + 1).map(s => (
              <button key={s} onClick={() => setStage(s)}
                className={`flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all ${stage === s ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                <span className="text-sm font-medium">{STAGE_LABELS[s]}</span>
                {stage === s && <CheckCircle className="w-4 h-4 text-primary" />}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button className={BTN_PRIMARY + " flex-1"} onClick={() => onSave(stage)}>Confirm Advancement</button>
          <button className={BTN_GHOST} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
