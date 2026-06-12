"use client";
import { useState, useMemo } from "react";
import { useFarmStore } from "@/lib/store";
import { formatCurrency, generateId, formatDate } from "@/lib/utils";
import { Egg, Package, Bird, ShoppingCart, MapPin, Phone, LogOut, Clock, CheckCircle, XCircle, Truck } from "lucide-react";
import { toast } from "sonner";
import type { OrderRequest, OrderRequestProduct } from "@/lib/types";

const inputCls = "w-full px-3 py-2 rounded-xl border border-border bg-input text-sm outline-none focus:ring-2 focus:ring-primary/30";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending:   { bg: "oklch(0.95 0.08 85 / 0.2)",  text: "oklch(0.45 0.12 85)",  label: "Pending" },
  confirmed: { bg: "oklch(0.95 0.08 220 / 0.2)", text: "oklch(0.35 0.12 220)", label: "Confirmed" },
  delivered: { bg: "oklch(0.95 0.08 148 / 0.2)", text: "oklch(0.35 0.14 148)", label: "Delivered" },
  paid:      { bg: "oklch(0.95 0.08 148 / 0.35)",text: "oklch(0.25 0.14 148)", label: "Paid ✓" },
  cancelled: { bg: "oklch(0.93 0 0 / 0.3)",      text: "oklch(0.45 0 0)",      label: "Cancelled" },
};

export default function CustomerPortalPage() {
  const { session, setSession, orderRequests, addOrderRequest, updateOrderRequest,
          eggCollections, sales, pricePerEgg, pricePerTray, pricePerChick, customers } = useFarmStore();

  const customerId = session?.customerId ?? "";
  const customerName = session?.customerName ?? "";

  // ── Today's egg availability ──────────────────────────────────────────────
  const today = new Date().toISOString().split("T")[0];
  const todayEggs = eggCollections.filter(e => e.date === today).reduce((s, e) => s + e.count, 0);
  const soldToday = sales.filter(s => s.date === today && s.product === "eggs").reduce((s, sale) => s + sale.quantity, 0);
  const pendingOrderEggs = orderRequests.filter(r =>
    r.requestedDate === today && (r.status === "pending" || r.status === "confirmed") && r.product !== "chicks"
  ).reduce((s, r) => s + (r.product === "tray" ? r.quantity * 30 : r.quantity), 0);
  const availableEggs = Math.max(0, todayEggs - soldToday - pendingOrderEggs);
  const availableTrays = Math.floor(availableEggs / 30);

  // ── My orders ─────────────────────────────────────────────────────────────
  const myOrders = useMemo(() =>
    orderRequests.filter(r => r.customerId === customerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [orderRequests, customerId]
  );

  // ── New order form ─────────────────────────────────────────────────────────
  const [product, setProduct] = useState<OrderRequestProduct>("eggs");
  const [qty, setQty] = useState("1");
  const [location, setLocation] = useState(() => customers.find(c => c.id === customerId)?.address ?? "");
  const [phone, setPhone] = useState(() => customers.find(c => c.id === customerId)?.phone ?? "");
  const [notes, setNotes] = useState("");
  const [reqDate, setReqDate] = useState(today);

  const unitPrice = product === "eggs" ? pricePerEgg : product === "tray" ? pricePerTray : pricePerChick;
  const estimatedTotal = Number(qty) * unitPrice;

  function submitOrder(e: React.FormEvent) {
    e.preventDefault();
    const q = parseInt(qty);
    if (!q || q <= 0) { toast.error("Enter a valid quantity"); return; }
    if (!location.trim()) { toast.error("Enter delivery location"); return; }
    if (!phone.trim()) { toast.error("Enter contact phone"); return; }
    const order: OrderRequest = {
      id: generateId(), customerId, customerName,
      product, quantity: q, pricePerUnit: unitPrice,
      totalAmount: estimatedTotal, status: "pending",
      deliveryLocation: location, contactPhone: phone,
      notes, requestedDate: reqDate,
      paidByCustomer: false, deliveryConfirmed: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    addOrderRequest(order);
    toast.success("Order submitted! Farm will confirm shortly.");
    setQty("1"); setNotes("");
  }

  const PRODUCT_ICONS: Record<OrderRequestProduct, React.ElementType> = { eggs: Egg, tray: Package, chicks: Bird };

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, oklch(0.22 0.08 148), oklch(0.30 0.10 148))" }}>
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: "1px solid oklch(1 0 0 / 0.1)" }}>
        <div>
          <div className="text-white font-bold text-lg">FarmPro</div>
          <div className="text-xs" style={{ color: "oklch(0.8 0.06 148)" }}>Welcome, {customerName}</div>
        </div>
        <button onClick={() => setSession(null)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
          style={{ background: "oklch(1 0 0 / 0.1)", color: "white" }}>
          <LogOut className="w-3.5 h-3.5" /> Logout
        </button>
      </header>

      <div className="p-4 max-w-2xl mx-auto space-y-4 pb-10">
        {/* Availability card */}
        <div className="rounded-2xl p-4" style={{ background: "oklch(1 0 0 / 0.1)", backdropFilter: "blur(12px)", border: "1px solid oklch(1 0 0 / 0.15)" }}>
          <div className="flex items-center gap-2 mb-3">
            <Egg className="w-4 h-4 text-white" />
            <span className="text-white font-semibold text-sm">Today's Availability – {today}</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Eggs Available", value: availableEggs.toLocaleString(), sub: `Ksh ${pricePerEgg}/egg` },
              { label: "Trays Available", value: availableTrays.toLocaleString(), sub: `Ksh ${pricePerTray}/tray (30 eggs)` },
              { label: "Price per Chick", value: `Ksh ${pricePerChick}`, sub: "Order in advance" },
            ].map(item => (
              <div key={item.label} className="rounded-xl p-3 text-center" style={{ background: "oklch(0 0 0 / 0.2)" }}>
                <div className="text-xl font-bold text-white">{item.value}</div>
                <div className="text-[10px] mt-0.5" style={{ color: "oklch(0.8 0.06 148)" }}>{item.label}</div>
                <div className="text-[10px]" style={{ color: "oklch(0.7 0.08 148)" }}>{item.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* New order form */}
        <div className="rounded-2xl p-5 space-y-4" style={{ background: "oklch(1 0 0 / 0.08)", backdropFilter: "blur(16px)", border: "1px solid oklch(1 0 0 / 0.15)" }}>
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-white" />
            <span className="text-white font-semibold text-sm">Place New Order</span>
          </div>
          <form onSubmit={submitOrder} className="space-y-3">
            {/* Product picker */}
            <div className="grid grid-cols-3 gap-2">
              {(["eggs", "tray", "chicks"] as OrderRequestProduct[]).map(p => {
                const Icon = PRODUCT_ICONS[p];
                const label = p === "eggs" ? "Eggs" : p === "tray" ? "Tray (30)" : "Chicks";
                return (
                  <button key={p} type="button" onClick={() => setProduct(p)}
                    className="flex flex-col items-center gap-1 py-3 rounded-xl text-xs font-medium transition-all"
                    style={product === p ? { background: "oklch(0.42 0.14 148)", color: "white" } : { background: "oklch(0 0 0 / 0.2)", color: "oklch(0.85 0.04 148)" }}>
                    <Icon className="w-5 h-5" />
                    {label}
                    <span className="text-[10px] opacity-70">Ksh {p === "eggs" ? pricePerEgg : p === "tray" ? pricePerTray : pricePerChick}</span>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs mb-1 block" style={{ color: "oklch(0.8 0.06 148)" }}>Quantity</label>
                <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ background: "oklch(0 0 0 / 0.2)", color: "white", border: "1px solid oklch(1 0 0 / 0.15)" }} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "oklch(0.8 0.06 148)" }}>Delivery Date</label>
                <input type="date" value={reqDate} min={today} onChange={e => setReqDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ background: "oklch(0 0 0 / 0.2)", color: "white", border: "1px solid oklch(1 0 0 / 0.15)" }} />
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "oklch(0 0 0 / 0.15)" }}>
              <MapPin className="w-3.5 h-3.5 shrink-0" style={{ color: "oklch(0.8 0.06 148)" }} />
              <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Delivery location / area"
                className="flex-1 bg-transparent text-sm outline-none" style={{ color: "white" }} />
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "oklch(0 0 0 / 0.15)" }}>
              <Phone className="w-3.5 h-3.5 shrink-0" style={{ color: "oklch(0.8 0.06 148)" }} />
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Contact phone number"
                className="flex-1 bg-transparent text-sm outline-none" style={{ color: "white" }} />
            </div>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Special notes (optional)"
              className="w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: "oklch(0 0 0 / 0.15)", color: "white", border: "1px solid oklch(1 0 0 / 0.1)" }} />
            <div className="flex items-center justify-between">
              <div style={{ color: "oklch(0.85 0.06 148)" }}>
                <span className="text-xs">Estimated total: </span>
                <span className="font-bold text-white">{formatCurrency(estimatedTotal)}</span>
              </div>
              <button type="submit"
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: "oklch(0.42 0.14 148)", boxShadow: "0 4px 14px oklch(0.42 0.14 148 / 0.5)" }}>
                <ShoppingCart className="w-4 h-4" /> Submit Order
              </button>
            </div>
          </form>
        </div>

        {/* My Orders */}
        <div className="rounded-2xl p-5 space-y-3" style={{ background: "oklch(1 0 0 / 0.08)", backdropFilter: "blur(16px)", border: "1px solid oklch(1 0 0 / 0.15)" }}>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-white" />
            <span className="text-white font-semibold text-sm">My Orders ({myOrders.length})</span>
          </div>
          {myOrders.length === 0 && <p className="text-sm text-center py-4" style={{ color: "oklch(0.7 0.06 148)" }}>No orders yet.</p>}
          {myOrders.map(order => {
            const ss = STATUS_STYLES[order.status];
            const Icon = PRODUCT_ICONS[order.product];
            return (
              <div key={order.id} className="rounded-xl p-3" style={{ background: "oklch(0 0 0 / 0.2)" }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-white" />
                    <div>
                      <div className="text-sm font-medium text-white capitalize">
                        {order.product === "tray" ? "Tray" : order.product} × {order.quantity}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: "oklch(0.7 0.06 148)" }}>
                        {formatDate(order.requestedDate)} · {order.deliveryLocation}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: ss.bg, color: ss.text }}>{ss.label}</span>
                    <span className="text-xs font-bold text-white">{formatCurrency(order.totalAmount)}</span>
                  </div>
                </div>
                {order.status === "delivered" && !order.paidByCustomer && (
                  <button onClick={() => { updateOrderRequest(order.id, { paidByCustomer: true }); toast.success("Payment marked. Awaiting confirmation."); }}
                    className="mt-2 w-full py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"
                    style={{ background: "oklch(0.42 0.14 148)", color: "white" }}>
                    <CheckCircle className="w-3.5 h-3.5" /> Mark as Paid
                  </button>
                )}
                {order.paidByCustomer && !order.deliveryConfirmed && (
                  <div className="mt-2 text-xs text-center" style={{ color: "oklch(0.7 0.08 148)" }}>Payment submitted — awaiting farm confirmation</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
