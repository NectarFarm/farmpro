"use client";

import { useState, useMemo } from "react";
import { useFarmStore } from "@/lib/store";
import type { Sale, ProductType } from "@/lib/types";
import { formatDate, formatCurrency, generateId } from "@/lib/utils";
import { Plus, Trash2, Filter, ShoppingCart, Egg, Bird, AlertTriangle, CheckCircle, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";

// ─── Add Sale Form ──────────────────────────────────────────────────────────
interface AddSaleFormProps {
  onClose: () => void;
}
function AddSaleForm({ onClose }: AddSaleFormProps) {
  const { customers, flocks, eggCollections, sales: allSales, addSale } = useFarmStore();
  const [form, setForm] = useState({
    customerId: "",
    flockId: "",
    product: "eggs" as ProductType,
    quantity: "",
    pricePerUnit: "",
    date: new Date().toISOString().split("T")[0],
    notes: "",
  });

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  // Available stock
  const availableEggs = useMemo(() => {
    const totalSellable = eggCollections.reduce((s, e) => s + (e.sellable ?? e.count), 0);
    const totalSold = allSales.filter(s => s.product === "eggs").reduce((s, x) => s + x.quantity, 0);
    return Math.max(0, totalSellable - totalSold);
  }, [eggCollections, allSales]);

  const selectedFlock = useMemo(() => flocks.find(f => f.id === form.flockId) ?? null, [flocks, form.flockId]);
  const availableBirds = selectedFlock?.currentCount ?? 0;

  const qty = Number(form.quantity) || 0;

  const stockWarning = useMemo(() => {
    if (!qty) return null;
    if (form.product === "eggs" && qty > availableEggs) {
      return `Only ${availableEggs.toLocaleString()} sellable eggs in stock`;
    }
    if (form.product === "birds" && form.flockId && selectedFlock && qty > availableBirds) {
      return `Only ${availableBirds.toLocaleString()} birds available in ${selectedFlock.name}`;
    }
    return null;
  }, [qty, form.product, form.flockId, availableEggs, availableBirds, selectedFlock]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerId || !form.quantity || !form.pricePerUnit) {
      toast.error("Customer, quantity and price are required");
      return;
    }
    if (stockWarning) {
      toast.error(stockWarning);
      return;
    }
    const saleQty = Number(form.quantity);
    const price = Number(form.pricePerUnit);
    const sale: Sale = {
      id: generateId(),
      customerId: form.customerId,
      flockId: form.flockId || undefined,
      product: form.product,
      quantity: saleQty,
      pricePerUnit: price,
      totalAmount: saleQty * price,
      date: form.date,
      notes: form.notes || undefined,
      createdAt: new Date().toISOString(),
    };
    addSale(sale);
    toast.success("Sale recorded successfully");
    onClose();
  };

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="glass-card rounded-2xl p-5 w-full max-w-md shadow-2xl">
        <h3 className="font-bold text-base text-foreground mb-4">Record New Sale</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Customer */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Customer *</label>
            <select value={form.customerId} onChange={(e) => set("customerId", e.target.value)} className={inputCls}>
              <option value="">Select customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Product */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Product *</label>
            <div className="flex gap-3">
              {(["eggs", "birds"] as ProductType[]).map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="product" value={p} checked={form.product === p}
                    onChange={() => set("product", p)} className="accent-primary" />
                  <span className="capitalize">{p}</span>
                </label>
              ))}
            </div>
            {/* Live stock availability hint */}
            <div className="mt-1.5 text-xs">
              {form.product === "eggs" ? (
                <span className="text-muted-foreground">
                  Available: <span className={`font-semibold ${availableEggs === 0 ? "text-red-500" : "text-green-600"}`}>
                    {availableEggs.toLocaleString()} eggs
                  </span>
                </span>
              ) : form.flockId && selectedFlock ? (
                <span className="text-muted-foreground">
                  In flock: <span className={`font-semibold ${availableBirds === 0 ? "text-red-500" : "text-green-600"}`}>
                    {availableBirds.toLocaleString()} birds
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground italic">Select a flock to see available count</span>
              )}
            </div>
          </div>

          {/* Flock */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Flock {form.product === "birds" ? "(select to update stock)" : "(optional)"}
            </label>
            <select value={form.flockId} onChange={(e) => set("flockId", e.target.value)} className={inputCls}>
              <option value="">None</option>
              {flocks.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.currentCount.toLocaleString()} birds)</option>)}
            </select>
          </div>

          {/* Qty + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Quantity *</label>
              <input type="number" min="1" value={form.quantity} onChange={(e) => set("quantity", e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary ${stockWarning ? "border-red-400 bg-red-50 dark:bg-red-950/20" : "border-border bg-background"}`}
                placeholder="0" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Price / Unit *</label>
              <input type="number" min="0" step="0.01" value={form.pricePerUnit} onChange={(e) => set("pricePerUnit", e.target.value)}
                className={inputCls} placeholder="0.00" />
            </div>
          </div>

          {/* Over-stock warning */}
          {stockWarning && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {stockWarning}
            </div>
          )}

          {/* Total preview */}
          {form.quantity && form.pricePerUnit && (
            <div className="rounded-lg bg-primary/10 px-3 py-2 text-sm font-semibold text-primary text-center">
              Total: {formatCurrency(Number(form.quantity) * Number(form.pricePerUnit))}
            </div>
          )}

          {/* Date */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Date *</label>
            <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className={inputCls} />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-xl border border-border py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={!!stockWarning}
              className="flex-1 rounded-xl bg-primary py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">
              Save Sale
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete Reason Modal ────────────────────────────────────────────────────
interface DeleteModalProps {
  isOwner: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}
function DeleteReasonModal({ isOwner, onConfirm, onClose }: DeleteModalProps) {
  const [reason, setReason] = useState("");
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) { toast.error("A reason is required"); return; }
    onConfirm(reason.trim());
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="glass-card rounded-2xl p-5 w-full max-w-sm shadow-2xl">
        <h3 className="font-bold text-base mb-1">
          {isOwner ? "Delete Sale" : "Request Deletion"}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {isOwner
            ? "Provide a reason for this deletion (mandatory for audit trail)."
            : "Your request will be sent to the farm owner for approval before the record is removed."}
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
            placeholder="Reason for deletion *"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-xl border border-border py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors">
              Cancel
            </button>
            <button type="submit"
              className={`flex-1 rounded-xl py-2 text-sm font-semibold transition-opacity text-white hover:opacity-90 ${isOwner ? "bg-red-500" : "bg-amber-500"}`}>
              {isOwner ? "Delete" : "Submit Request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function SalesPage() {
  const { sales, birdStageSales, customers, session, deleteSale, requestSaleDeletion, approveSaleDeletion, rejectSaleDeletion } = useFarmStore();
  const [showAdd, setShowAdd] = useState(false);
  const [filterCustomer, setFilterCustomer] = useState("");
  const [filterProduct, setFilterProduct] = useState<"all" | ProductType>("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [deleteModal, setDeleteModal] = useState<{ saleId: string } | null>(null);

  const isOwner = session?.type === "owner";

  // Stats — include birdStageSales in totals
  const totalRevenue = useMemo(() => {
    const salesRev = sales.reduce((s, x) => s + x.totalAmount, 0);
    const birdStageRev = birdStageSales.reduce((s, x) => s + x.totalAmount, 0);
    return salesRev + birdStageRev;
  }, [sales, birdStageSales]);
  const eggRevenue = useMemo(() => sales.filter((x) => x.product === "eggs").reduce((s, x) => s + x.totalAmount, 0), [sales]);
  const birdRevenue = useMemo(() => {
    const fromSales = sales.filter((x) => x.product === "birds").reduce((s, x) => s + x.totalAmount, 0);
    const fromValuation = birdStageSales.reduce((s, x) => s + x.totalAmount, 0);
    return fromSales + fromValuation;
  }, [sales, birdStageSales]);

  // Filtered list
  const filtered = useMemo(() => {
    return sales.filter((s) => {
      if (filterCustomer && s.customerId !== filterCustomer) return false;
      if (filterProduct !== "all" && s.product !== filterProduct) return false;
      if (filterFrom && s.date < filterFrom) return false;
      if (filterTo && s.date > filterTo) return false;
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [sales, filterCustomer, filterProduct, filterFrom, filterTo]);

  // Sales pending deletion (owner sees these for approval)
  const pendingDeletions = useMemo(() => filtered.filter(s => s.deletionRequested), [filtered]);

  // Top 3 customers
  const topCustomers = useMemo(() => {
    const map: Record<string, number> = {};
    sales.forEach((s) => { map[s.customerId] = (map[s.customerId] ?? 0) + s.totalAmount; });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, rev]) => ({ id, rev, name: customers.find((c) => c.id === id)?.name ?? "Unknown" }));
  }, [sales, customers]);

  const getCustomerName = (id: string) => customers.find((c) => c.id === id)?.name ?? "—";

  const handleDeleteClick = (saleId: string) => setDeleteModal({ saleId });

  const handleDeleteConfirm = (reason: string) => {
    if (!deleteModal) return;
    const { saleId } = deleteModal;
    if (isOwner) {
      deleteSale(saleId);
      toast.success("Sale deleted");
    } else {
      requestSaleDeletion(saleId, reason, session?.employeeName ?? "Employee");
      toast.success("Deletion request submitted — awaiting owner approval");
    }
    setDeleteModal(null);
  };

  const handleApprove = (saleId: string) => {
    approveSaleDeletion(saleId);
    toast.success("Sale deletion approved");
  };

  const handleReject = (saleId: string) => {
    rejectSaleDeletion(saleId);
    toast.info("Deletion request rejected");
  };

  const stats = [
    { label: "Total Sales", value: sales.length.toString(), icon: ShoppingCart, color: "oklch(0.52 0.17 148)", bg: "oklch(0.52 0.17 148 / 0.12)" },
    { label: "Total Revenue", value: formatCurrency(totalRevenue), icon: ShoppingCart, color: "oklch(0.42 0.14 148)", bg: "oklch(0.42 0.14 148 / 0.12)" },
    { label: "Egg Revenue", value: formatCurrency(eggRevenue), icon: Egg, color: "oklch(0.65 0.14 85)", bg: "oklch(0.65 0.14 85 / 0.12)" },
    { label: "Bird Revenue", value: formatCurrency(birdRevenue), icon: Bird, color: "oklch(0.57 0.24 27)", bg: "oklch(0.57 0.24 27 / 0.12)" },
  ];

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-5">
      {showAdd && <AddSaleForm onClose={() => setShowAdd(false)} />}
      {deleteModal && (
        <DeleteReasonModal
          isOwner={isOwner}
          onConfirm={handleDeleteConfirm}
          onClose={() => setDeleteModal(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Sales Records</h1>
          <p className="text-sm text-muted-foreground">Record egg and bird sales, track revenue by customer and product type</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity shrink-0">
          <Plus className="w-4 h-4" /> Add Sale
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="glass-card rounded-2xl p-4">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3" style={{ background: s.bg }}>
                <Icon className="w-4 h-4" style={{ color: s.color }} />
              </div>
              <div className="text-xl font-bold text-foreground">{s.value}</div>
              <div className="text-xs font-medium text-muted-foreground mt-0.5">{s.label}</div>
            </div>
          );
        })}
      </div>

      {/* Pending Deletion Banner — owner only */}
      {isOwner && pendingDeletions.length > 0 && (
        <div className="glass-card rounded-2xl p-4 border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              {pendingDeletions.length} pending deletion request{pendingDeletions.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="space-y-2">
            {pendingDeletions.map(sale => (
              <div key={sale.id} className="flex items-center gap-3 text-xs bg-white/60 dark:bg-black/20 rounded-xl p-3">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{getCustomerName(sale.customerId)}</span>
                  <span className="text-muted-foreground mx-1">·</span>
                  <span className="capitalize">{sale.product}</span>
                  <span className="text-muted-foreground mx-1">·</span>
                  <span>{formatCurrency(sale.totalAmount)}</span>
                  <div className="text-muted-foreground mt-0.5 truncate">
                    By {sale.deletionRequestedBy}: &quot;{sale.deletionReason}&quot;
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => handleApprove(sale.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500 text-white text-[11px] font-semibold hover:opacity-90 transition-opacity">
                    <CheckCircle className="w-3 h-3" /> Approve
                  </button>
                  <button onClick={() => handleReject(sale.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-[11px] font-semibold hover:bg-muted/50 transition-colors">
                    <XCircle className="w-3 h-3" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Filters</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <select value={filterCustomer} onChange={(e) => setFilterCustomer(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="">All Customers</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={filterProduct} onChange={(e) => setFilterProduct(e.target.value as "all" | ProductType)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="all">All Products</option>
            <option value="eggs">Eggs</option>
            <option value="birds">Birds</option>
          </select>
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
      </div>

      {/* Sales Table + Top Customers */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Table */}
        <div className="lg:col-span-2 glass-card rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-border">
            <span className="font-semibold text-sm text-foreground">Sales ({filtered.length})</span>
          </div>
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No sales found. Add your first sale!</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Product</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Qty</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Price/Unit</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Total</th>
                    <th className="px-4 py-3 w-14"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((sale) => (
                    <tr key={sale.id}
                      className={`hover:bg-muted/20 transition-colors ${sale.deletionRequested ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}`}>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDate(sale.date)}</td>
                      <td className="px-4 py-3 font-medium text-foreground text-xs">{getCustomerName(sale.customerId)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          sale.product === "eggs"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        }`}>
                          {sale.product === "eggs" ? <Egg className="w-2.5 h-2.5" /> : <Bird className="w-2.5 h-2.5" />}
                          {sale.product}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-foreground">{sale.quantity.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">{formatCurrency(sale.pricePerUnit)}</td>
                      <td className="px-4 py-3 text-right text-xs font-semibold text-foreground">{formatCurrency(sale.totalAmount)}</td>
                      <td className="px-4 py-3 text-center">
                        {sale.deletionRequested ? (
                          isOwner ? (
                            <div className="flex gap-1 justify-center">
                              <button onClick={() => handleApprove(sale.id)} title="Approve deletion"
                                className="p-1 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-colors">
                                <CheckCircle className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => handleReject(sale.id)} title="Reject deletion"
                                className="p-1 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span title="Awaiting owner approval" className="inline-flex items-center justify-center">
                              <Clock className="w-3.5 h-3.5 text-amber-500" />
                            </span>
                          )
                        ) : (
                          <button onClick={() => handleDeleteClick(sale.id)}
                            title={isOwner ? "Delete sale" : "Request deletion"}
                            className="p-1 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Top Customers */}
        <div className="glass-card rounded-2xl p-4 space-y-3">
          <h3 className="font-semibold text-sm text-foreground">Top Customers</h3>
          <p className="text-xs text-muted-foreground">By total revenue</p>
          {topCustomers.length === 0 ? (
            <p className="text-sm text-muted-foreground pt-2">No sales yet</p>
          ) : (
            topCustomers.map((tc, idx) => (
              <div key={tc.id} className="flex items-center gap-3 rounded-xl bg-muted/30 p-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                  style={{ background: idx === 0 ? "oklch(0.65 0.14 85)" : idx === 1 ? "oklch(0.52 0.17 148)" : "oklch(0.55 0.10 260)" }}>
                  #{idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{tc.name}</div>
                  <div className="text-xs text-muted-foreground">{formatCurrency(tc.rev)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
