"use client";
import { useState, useMemo } from "react";
import { useFarmStore } from "@/lib/store";
import { formatCurrency, formatDate, generateId } from "@/lib/utils";
import { sendSms, smsOrderConfirmed, smsOrderDelivered, smsOrderPaid } from "@/lib/sms";
import { ShoppingCart, CheckCircle, Truck, DollarSign, X, Filter, Download, MessageCircle, Loader2, Eye } from "lucide-react";
import { toast } from "sonner";
import type { OrderRequest, OrderRequestStatus } from "@/lib/types";

type FilterStatus = "all" | OrderRequestStatus;

const STATUS_META: Record<OrderRequestStatus, { label: string; color: string; bg: string }> = {
  pending:   { label: "Pending",   color: "oklch(0.45 0.12 85)",  bg: "oklch(0.95 0.08 85 / 0.2)"  },
  confirmed: { label: "Confirmed", color: "oklch(0.35 0.12 220)", bg: "oklch(0.95 0.08 220 / 0.2)" },
  delivered: { label: "Delivered", color: "oklch(0.35 0.14 148)", bg: "oklch(0.95 0.08 148 / 0.2)" },
  paid:      { label: "Paid ✓",    color: "oklch(0.25 0.14 148)", bg: "oklch(0.88 0.08 148 / 0.35)"},
  cancelled: { label: "Cancelled", color: "oklch(0.45 0 0)",      bg: "oklch(0.93 0 0 / 0.3)"      },
};

export default function OrderManagementPage() {
  const { orderRequests, updateOrderRequest, deleteOrderRequest, customers, pricePerEgg, pricePerTray, pricePerChick } = useFarmStore();
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [smsLoading, setSmsLoading] = useState<string | null>(null);
  const farmName = typeof window !== "undefined" ? localStorage.getItem("farmName") ?? "FarmPro" : "FarmPro";

  const filtered = useMemo(() => {
    const list = filterStatus === "all" ? orderRequests : orderRequests.filter(r => r.status === filterStatus);
    return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [orderRequests, filterStatus]);

  const counts = useMemo(() => ({
    pending:   orderRequests.filter(r => r.status === "pending").length,
    confirmed: orderRequests.filter(r => r.status === "confirmed").length,
    delivered: orderRequests.filter(r => r.status === "delivered").length,
    paid:      orderRequests.filter(r => r.status === "paid").length,
    cancelled: orderRequests.filter(r => r.status === "cancelled").length,
  }), [orderRequests]);

  const selected = selectedId ? orderRequests.find(r => r.id === selectedId) : null;
  const customer = selected ? customers.find(c => c.id === selected.customerId) ?? undefined : undefined;

  function unitLabel(r: OrderRequest) {
    return r.product === "tray" ? "trays" : r.product === "chicks" ? "chicks" : "eggs";
  }
  function defaultPrice(r: OrderRequest) {
    return r.product === "tray" ? pricePerTray : r.product === "chicks" ? pricePerChick : pricePerEgg;
  }

  async function doAction(r: OrderRequest, action: "confirm" | "deliver" | "markPaid" | "cancel") {
    const nextStatus: Record<string, OrderRequestStatus> = {
      confirm: "confirmed", deliver: "delivered", markPaid: "paid", cancel: "cancelled",
    };
    const price = r.pricePerUnit > 0 ? r.pricePerUnit : defaultPrice(r);
    const total = price * r.quantity;
    updateOrderRequest(r.id, { status: nextStatus[action], pricePerUnit: price, totalAmount: total, deliveryConfirmed: action === "markPaid" });
    toast.success(`Order ${nextStatus[action]}`);

    // Send SMS
    setSmsLoading(r.id);
    try {
      const phone = customer?.phone ?? r.contactPhone;
      let msg = "";
      const totalFmt = formatCurrency(total);
      if (action === "confirm") msg = smsOrderConfirmed(r.customerName, unitLabel(r), r.quantity, totalFmt, farmName);
      if (action === "deliver") msg = smsOrderDelivered(r.customerName, totalFmt, farmName);
      if (action === "markPaid") msg = smsOrderPaid(r.customerName, totalFmt, farmName);
      if (msg) {
        const result = await sendSms(phone, msg);
        toast.info(result.message, { duration: 4000 });
      }
    } finally { setSmsLoading(null); }
  }

  async function exportOrdersPdf(orders: OrderRequest[], custs: typeof customers) {
    const { generateOrderPdf } = await import("@/lib/orderPdf");
    await generateOrderPdf(orders, custs, farmName);
  }

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-foreground">Order Management</h1>
        <p className="text-sm text-muted-foreground">Confirm, dispatch and mark customer orders as paid — SMS sent automatically</p>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {(["all","pending","confirmed","delivered","paid","cancelled"] as FilterStatus[]).map(s => {
          const count = s === "all" ? orderRequests.length : counts[s as OrderRequestStatus] ?? 0;
          const meta = s !== "all" ? STATUS_META[s as OrderRequestStatus] : null;
          return (
            <button key={s} onClick={() => setFilterStatus(s)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all capitalize"
              style={filterStatus === s
                ? { background: meta?.bg ?? "oklch(0.42 0.14 148 / 0.15)", color: meta?.color ?? "var(--primary)", border: `1px solid ${meta?.color ?? "var(--primary)"}` }
                : { background: "var(--muted)", color: "var(--muted-foreground)", border: "1px solid transparent" }}>
              {s === "all" ? "All" : STATUS_META[s as OrderRequestStatus].label}
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                style={{ background: "oklch(0 0 0 / 0.1)" }}>{count}</span>
            </button>
          );
        })}
        <button onClick={() => exportOrdersPdf(orderRequests, customers)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
          style={{ background: "oklch(0.42 0.14 148)" }}>
          <Download className="w-3.5 h-3.5" /> Export PDF
        </button>
      </div>

      {/* Two-panel layout */}
      <div className="grid lg:grid-cols-5 gap-4">
        {/* Orders list */}
        <div className="lg:col-span-2 space-y-2">
          {filtered.length === 0 && (
            <div className="glass-card rounded-2xl p-6 text-center text-muted-foreground text-sm">No orders in this category</div>
          )}
          {filtered.map(r => (
            <OrderCard key={r.id} order={r} selected={selectedId === r.id}
              onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
              smsLoading={smsLoading === r.id}
              onAction={(a) => doAction(r, a)} />
          ))}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-3">
          {selected ? (
            <OrderDetail order={selected} customer={customer} farmName={farmName}
              onAction={(a) => doAction(selected, a)}
              smsLoading={smsLoading === selected.id}
              onClose={() => setSelectedId(null)} />
          ) : (
            <div className="glass-card rounded-2xl p-8 text-center h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Eye className="w-8 h-8 opacity-30" />
              <p className="text-sm">Select an order to view details and take action</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── OrderCard ──────────────────────────────────────────────────────────────────
function OrderCard({ order, selected, onClick, smsLoading, onAction }: {
  order: OrderRequest; selected: boolean; onClick: () => void;
  smsLoading: boolean; onAction: (a: "confirm"|"deliver"|"markPaid"|"cancel") => void;
}) {
  const meta = STATUS_META[order.status];
  return (
    <div onClick={onClick}
      className="glass-card rounded-2xl p-3.5 cursor-pointer transition-all hover:shadow-md"
      style={selected ? { border: "1.5px solid var(--primary)" } : {}}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground truncate">{order.customerName}</div>
          <div className="text-xs text-muted-foreground truncate">{order.deliveryLocation}</div>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground capitalize">{order.quantity} {order.product === "tray" ? "trays" : order.product}</span>
        <span className="font-semibold text-foreground">{formatCurrency(order.totalAmount > 0 ? order.totalAmount : order.quantity * order.pricePerUnit)}</span>
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">{formatDate(order.requestedDate)}</div>
      {/* Quick actions */}
      <div className="flex gap-1.5 mt-2.5 flex-wrap">
        {order.status === "pending" && (
          <button onClick={e => { e.stopPropagation(); onAction("confirm"); }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white"
            style={{ background: "oklch(0.42 0.14 148)" }}>
            {smsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />} Confirm
          </button>
        )}
        {order.status === "confirmed" && (
          <button onClick={e => { e.stopPropagation(); onAction("deliver"); }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white"
            style={{ background: "oklch(0.5 0.15 250)" }}>
            {smsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Truck className="w-3 h-3" />} Dispatch
          </button>
        )}
        {(order.status === "delivered" || order.paidByCustomer) && order.status !== "paid" && (
          <button onClick={e => { e.stopPropagation(); onAction("markPaid"); }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white"
            style={{ background: "oklch(0.52 0.17 148)" }}>
            {smsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <DollarSign className="w-3 h-3" />} Mark Paid
          </button>
        )}
        {(order.status === "pending" || order.status === "confirmed") && (
          <button onClick={e => { e.stopPropagation(); onAction("cancel"); }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-destructive hover:bg-destructive/10">
            <X className="w-3 h-3" /> Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ── OrderDetail ────────────────────────────────────────────────────────────────
function OrderDetail({ order, customer, farmName, onAction, smsLoading, onClose }: {
  order: OrderRequest; customer: ReturnType<typeof useFarmStore.getState>["customers"][0] | undefined;
  farmName: string; onAction: (a: "confirm"|"deliver"|"markPaid"|"cancel") => void;
  smsLoading: boolean; onClose: () => void;
}) {
  const meta = STATUS_META[order.status];
  const rows = [
    ["Customer", order.customerName],
    ["Phone", order.contactPhone],
    ["Product", `${order.quantity} ${order.product === "tray" ? "trays (×30 eggs)" : order.product}`],
    ["Delivery Date", formatDate(order.requestedDate)],
    ["Location", order.deliveryLocation],
    ["Price/Unit", formatCurrency(order.pricePerUnit)],
    ["Total", formatCurrency(order.totalAmount)],
    ["Paid by customer", order.paidByCustomer ? "Yes — awaiting confirmation" : "No"],
    ["Notes", order.notes || "—"],
  ];
  return (
    <div className="glass-card rounded-2xl p-5 h-full flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Order #{order.id.slice(-6).toUpperCase()}</h3>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted"><X className="w-4 h-4 text-muted-foreground" /></button>
      </div>
      <div className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-start justify-between gap-2 text-xs">
            <span className="text-muted-foreground shrink-0 w-28">{k}</span>
            <span className="font-medium text-foreground text-right">{v}</span>
          </div>
        ))}
      </div>
      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap mt-auto pt-2 border-t border-border">
        {order.status === "pending" && (
          <button onClick={() => onAction("confirm")} disabled={smsLoading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: "oklch(0.42 0.14 148)" }}>
            {smsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Confirm + SMS
          </button>
        )}
        {order.status === "confirmed" && (
          <button onClick={() => onAction("deliver")} disabled={smsLoading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: "oklch(0.5 0.15 250)" }}>
            {smsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />} Mark Dispatched + SMS
          </button>
        )}
        {(order.status === "delivered" || order.paidByCustomer) && order.status !== "paid" && (
          <button onClick={() => onAction("markPaid")} disabled={smsLoading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: "oklch(0.52 0.17 148)" }}>
            {smsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />} Mark Paid + SMS
          </button>
        )}
        {(order.status === "pending" || order.status === "confirmed") && (
          <button onClick={() => onAction("cancel")} className="px-4 py-2.5 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/10">Cancel</button>
        )}
        <button onClick={() => { const p = customer?.phone ?? order.contactPhone; const msg = `Hi ${order.customerName}, regarding your order from ${farmName}. Please call us for any queries.`; const phone = p.replace(/\D/g,"").replace(/^0/,"254"); window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank"); }}
          className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm text-white" style={{ background: "#25D366" }}>
          <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
        </button>
      </div>
    </div>
  );
}
