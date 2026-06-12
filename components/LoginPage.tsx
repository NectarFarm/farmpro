"use client";
import { useState } from "react";
import { useFarmStore } from "@/lib/store";
import { Egg, Lock, User, Eye, EyeOff, ChevronRight, Phone, Search } from "lucide-react";
import { toast } from "sonner";

type Portal = "owner" | "employee" | "customer";

export default function LoginPage() {
  const { employees, customers, login, loading } = useFarmStore();
  const [portal, setPortal] = useState<Portal>("owner");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Customer search
  const [custSearch, setCustSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [custPin, setCustPin] = useState("");
  const [showCustPin, setShowCustPin] = useState(false);

  const filteredCustomers = custSearch.trim().length >= 2
    ? customers.filter(c =>
        c.name.toLowerCase().includes(custSearch.toLowerCase()) ||
        c.phone.includes(custSearch)
      )
    : [];

  async function handleOwnerLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const ok = await login(pin, "owner");
    if (ok) { toast.success("Welcome back, Owner!"); }
    else { toast.error("Incorrect PIN. Default PIN: 1234"); }
    setPin(""); setSubmitting(false);
  }

  async function handleEmployeeLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEmployee) { toast.error("Select an employee"); return; }
    setSubmitting(true);
    const ok = await login(pin, "employee", selectedEmployee);
    if (ok) { toast.success("Welcome!"); }
    else { toast.error("Incorrect PIN"); }
    setPin(""); setSubmitting(false);
  }

  async function handleCustomerLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCustomer) { toast.error("Select a customer profile"); return; }
    setSubmitting(true);
    const ok = await login(custPin, "customer", selectedCustomer);
    if (ok) { toast.success("Welcome!"); }
    else { toast.error("Incorrect PIN. Contact the farm owner to get access."); }
    setCustPin(""); setSubmitting(false);
  }

  const portalConfig = [
    { id: "owner" as Portal, label: "Owner / Admin", sub: "Full access" },
    { id: "employee" as Portal, label: "Employee", sub: "Data entry" },
    { id: "customer" as Portal, label: "Customer", sub: "Order portal" },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden p-4"
      style={{ background: "linear-gradient(135deg, oklch(0.22 0.08 148) 0%, oklch(0.30 0.10 148) 50%, oklch(0.20 0.06 170) 100%)" }}>
      <div className="absolute top-[-100px] right-[-100px] w-96 h-96 rounded-full opacity-10"
        style={{ background: "radial-gradient(circle, oklch(0.6 0.2 148), transparent)" }} />
      <div className="absolute bottom-[-80px] left-[-80px] w-72 h-72 rounded-full opacity-10"
        style={{ background: "radial-gradient(circle, oklch(0.7 0.15 100), transparent)" }} />

      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-3"
            style={{ background: "oklch(0.55 0.16 148 / 0.3)", border: "1px solid oklch(0.65 0.12 148 / 0.5)" }}>
            <Egg className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">FarmPro</h1>
          <p className="text-sm mt-1" style={{ color: "oklch(0.8 0.06 148)" }}>Poultry Farm Management · Kenya</p>
        </div>

        <div className="rounded-2xl p-6" style={{ background: "oklch(1 0 0 / 0.08)", backdropFilter: "blur(20px)", border: "1px solid oklch(1 0 0 / 0.15)", boxShadow: "0 8px 40px oklch(0 0 0 / 0.3)" }}>
          {/* 3-way portal tabs */}
          <div className="flex gap-1 mb-5 p-1 rounded-xl" style={{ background: "oklch(0 0 0 / 0.2)" }}>
            {portalConfig.map(p => (
              <button key={p.id} onClick={() => { setPortal(p.id); setPin(""); setCustPin(""); setSelectedEmployee(""); setSelectedCustomer(""); setCustSearch(""); }}
                className="flex-1 py-2 px-1 rounded-lg text-xs font-medium transition-all"
                style={portal === p.id ? { background: "oklch(0.55 0.16 148)", color: "white", boxShadow: "0 2px 8px oklch(0.42 0.14 148 / 0.4)" } : { color: "oklch(0.75 0.04 148)" }}>
                <div>{p.label}</div>
                <div className="text-[10px] opacity-70">{p.sub}</div>
              </button>
            ))}
          </div>

          {/* Owner */}
          {portal === "owner" && (
            <form onSubmit={handleOwnerLogin} className="space-y-4">
              <PinField label="Owner PIN" value={pin} onChange={setPin} show={showPin} toggle={() => setShowPin(!showPin)} hint="Default PIN: 1234" />
              <SubmitBtn label={submitting ? "Logging in…" : "Login as Owner"} disabled={submitting || loading} />
            </form>
          )}

          {/* Employee */}
          {portal === "employee" && (
            <form onSubmit={handleEmployeeLogin} className="space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: "oklch(0.8 0.06 148)" }}>Select Employee</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "oklch(0.7 0.1 148)" }} />
                  <select value={selectedEmployee} onChange={e => setSelectedEmployee(e.target.value)}
                    className="w-full pl-9 pr-4 py-3 rounded-xl text-sm outline-none appearance-none"
                    style={{ background: "oklch(0 0 0 / 0.25)", color: "white", border: "1px solid oklch(1 0 0 / 0.15)" }} required>
                    <option value="" style={{ background: "#1a2a1a" }}>Select your name…</option>
                    {employees.map(emp => <option key={emp.id} value={emp.id} style={{ background: "#1a2a1a" }}>{emp.name}</option>)}
                  </select>
                </div>
                {employees.length === 0 && <p className="text-[11px] mt-1.5" style={{ color: "oklch(0.7 0.15 40)" }}>No employees yet. Login as Owner → Settings to add.</p>}
              </div>
              <PinField label="Employee PIN" value={pin} onChange={setPin} show={showPin} toggle={() => setShowPin(!showPin)} />
              <SubmitBtn label={submitting ? "Logging in…" : "Login as Employee"} disabled={submitting || loading} />
            </form>
          )}

          {/* Customer */}
          {portal === "customer" && (
            <form onSubmit={handleCustomerLogin} className="space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: "oklch(0.8 0.06 148)" }}>Find Your Account</label>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "oklch(0.7 0.1 148)" }} />
                  <input value={custSearch} onChange={e => { setCustSearch(e.target.value); setSelectedCustomer(""); }}
                    placeholder="Search by name or phone…"
                    className="w-full pl-9 pr-4 py-3 rounded-xl text-sm outline-none"
                    style={{ background: "oklch(0 0 0 / 0.25)", color: "white", border: "1px solid oklch(1 0 0 / 0.15)" }} />
                </div>
                {filteredCustomers.length > 0 && (
                  <div className="rounded-xl overflow-hidden" style={{ border: "1px solid oklch(1 0 0 / 0.15)" }}>
                    {filteredCustomers.map((c, i) => (
                      <button key={c.id} type="button" onClick={() => { setSelectedCustomer(c.id); setCustSearch(c.name); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all"
                        style={{ background: selectedCustomer === c.id ? "oklch(0.42 0.14 148 / 0.3)" : (i % 2 === 0 ? "oklch(0 0 0 / 0.2)" : "oklch(0 0 0 / 0.3)"), borderTop: i > 0 ? "1px solid oklch(1 0 0 / 0.1)" : "none" }}>
                        <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-white" style={{ background: "oklch(0.42 0.14 148)" }}>{c.name[0]}</div>
                        <div>
                          <div className="text-sm font-medium text-white">{c.name}</div>
                          <div className="text-[11px] flex items-center gap-1" style={{ color: "oklch(0.75 0.06 148)" }}>
                            <Phone className="w-3 h-3" /> {c.phone}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {custSearch.length >= 2 && filteredCustomers.length === 0 && (
                  <p className="text-xs text-center py-2" style={{ color: "oklch(0.65 0.06 148)" }}>No matching customers. Ask the farm to register you.</p>
                )}
              </div>
              <PinField label="Your PIN (last 4 digits of phone)" value={custPin} onChange={setCustPin} show={showCustPin} toggle={() => setShowCustPin(!showCustPin)} />
              <SubmitBtn label={submitting ? "Logging in…" : "Access Customer Portal"} disabled={submitting || loading} />
            </form>
          )}
        </div>

        <p className="text-center text-xs mt-4" style={{ color: "oklch(0.45 0.05 148)" }}>
          FarmPro v1.0 · Made for Kenyan Poultry Farms
        </p>
      </div>
    </div>
  );
}

function PinField({ label, value, onChange, show, toggle, hint }: { label: string; value: string; onChange: (v: string) => void; show: boolean; toggle: () => void; hint?: string }) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wider mb-2 block" style={{ color: "oklch(0.8 0.06 148)" }}>{label}</label>
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "oklch(0.7 0.1 148)" }} />
        <input type={show ? "text" : "password"} value={value} onChange={e => onChange(e.target.value)}
          placeholder="Enter PIN" maxLength={8} required
          className="w-full pl-9 pr-10 py-3 rounded-xl text-sm outline-none"
          style={{ background: "oklch(0 0 0 / 0.25)", color: "white", border: "1px solid oklch(1 0 0 / 0.15)" }} />
        <button type="button" onClick={toggle} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "oklch(0.7 0.1 148)" }}>
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {hint && <p className="text-xs mt-1" style={{ color: "oklch(0.65 0.06 148)" }}>{hint}</p>}
    </div>
  );
}

function SubmitBtn({ label, disabled }: { label: string; disabled?: boolean }) {
  return (
    <button type="submit" disabled={disabled}
      className="w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
      style={{ background: "oklch(0.42 0.14 148)", color: "white", boxShadow: "0 4px 14px oklch(0.42 0.14 148 / 0.5)" }}>
      {label} <ChevronRight className="w-4 h-4" />
    </button>
  );
}
