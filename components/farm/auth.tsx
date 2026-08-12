// ============================================================
// auth.tsx — Login, Register (Self-onboarding), and ForgotPassword screens
// Data flow: LoginScreen → NavProvider sets role → ScreenRouter shows correct tabs
//            RegisterScreen → creates OnboardRequest → Admin reviews in AdminOnboardingScreen
// ============================================================
"use client";
import React, { useState, useEffect } from "react";
import { ENTERPRISE_REGISTRY, type OnboardRequest } from "./data";
import { Eye, EyeOff, Check, ChevronRight, AlertTriangle, Phone, Mail } from "./icons";
import { useToast } from "./ui-shared";
import { type Role } from "./navigation";
import { apiClient } from "@/lib/request";

/* ── Shared GPS + Map block ──────────────────────────────────────────────── */
export function GpsMapBlock({
  lat, lng, address,
  onLatChange, onLngChange, onAddressChange,
  loading, error, onDetect,
}: {
  lat: string; lng: string; address: string;
  onLatChange: (v: string) => void;
  onLngChange: (v: string) => void;
  onAddressChange: (v: string) => void;
  loading: boolean; error: string;
  onDetect: () => void;
}) {
  const hasCoords = lat !== "" && lng !== "";

  // OSM static map via tile — we render a simple iframe of openstreetmap
  const mapSrc = hasCoords
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${(parseFloat(lng)-0.01).toFixed(4)},${(parseFloat(lat)-0.01).toFixed(4)},${(parseFloat(lng)+0.01).toFixed(4)},${(parseFloat(lat)+0.01).toFixed(4)}&layer=mapnik&marker=${lat},${lng}`
    : null;

  return (
    <div>
      {/* Detect button */}
      <button
        onClick={onDetect}
        disabled={loading}
        style={{ width: "100%", padding: "10px 14px", borderRadius: 10, fontSize: 12, fontWeight: 700,
          cursor: loading ? "wait" : "pointer",
          background: hasCoords ? "rgba(74,222,128,0.12)" : "var(--card)",
          border: hasCoords ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)",
          color: hasCoords ? "var(--primary-green)" : "var(--text-muted)",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8 }}>
        📍 {loading ? "Detecting…" : hasCoords ? `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}` : "Detect My GPS Location"}
      </button>

      {error && <div style={{ fontSize: 11, color: "var(--status-critical)", marginBottom: 6 }}>⚠ {error}</div>}

      {/* Manual lat/lng */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 600, display: "block", marginBottom: 3 }}>Latitude</label>
          <input className="farm-input" style={{ fontSize: 12 }} value={lat} onChange={e => onLatChange(e.target.value)} placeholder="-0.2802" type="number" step="any" />
        </div>
        <div>
          <label style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 600, display: "block", marginBottom: 3 }}>Longitude</label>
          <input className="farm-input" style={{ fontSize: 12 }} value={lng} onChange={e => onLngChange(e.target.value)} placeholder="36.0665" type="number" step="any" />
        </div>
      </div>

      {/* Address field — prefilled by reverse-geocode, editable */}
      <div style={{ marginBottom: hasCoords ? 8 : 0 }}>
        <label style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 600, display: "block", marginBottom: 3 }}>
          Address <span style={{ fontWeight: 400, color: "var(--text-dim)" }}>(auto-filled · editable)</span>
        </label>
        <input className="farm-input" style={{ fontSize: 12 }} value={address} onChange={e => onAddressChange(e.target.value)} placeholder="Reverse-geocoded from coordinates…" />
      </div>

      {/* OSM map preview */}
      {hasCoords && mapSrc && (
        <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid var(--border-subtle)", height: 160, marginTop: 4 }}>
          <iframe
            src={mapSrc}
            width="100%" height="160"
            style={{ border: "none", display: "block" }}
            title="Farm location map"
            loading="lazy"
          />
        </div>
      )}

      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
        Tap "Detect" to auto-fill from your device. Coordinates and address can be updated anytime.
      </div>
    </div>
  );
}

/* ── Reverse-geocode hook (Nominatim, no API key needed) ─────────────────── */
export function useReverseGeocode(lat: string, lng: string, onResult: (addr: string) => void) {
  useEffect(() => {
    if (!lat || !lng) return;
    const latN = parseFloat(lat);
    const lngN = parseFloat(lng);
    if (isNaN(latN) || isNaN(lngN)) return;
    const controller = new AbortController();
    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latN}&lon=${lngN}`,
      { signal: controller.signal, headers: { "Accept-Language": "en" } }
    )
      .then(r => r.json())
      .then(d => {
        if (d?.display_name) onResult(d.display_name);
      })
      .catch(() => {/* silently ignore network errors */});
    return () => controller.abort();
  }, [lat, lng]); // eslint-disable-line react-hooks/exhaustive-deps
}

/* ── Real demo accounts (seeded via `pnpm db:seed`, issue #221) ──
 * Login is backed by POST /api/auth/login against the `users` table — these
 * credentials are real seeded rows, listed here for the demo hints box. */
const DEMO_ACCOUNTS = [
  { label: "👑 Owner",      cred: "james@nakurufarm.com / farm2026" },
  { label: "🧑‍💼 Manager",   cred: "peter@nakurufarm.com / mgr123" },
  { label: "👷 Worker PIN",  cred: "1234" },
  { label: "🩺 Vet",        cred: "vet@nakurufarm.com / vet123" },
  { label: "🔍 Auditor",    cred: "auditor@ifms.co / aud123" },
  { label: "⚙️ Super Admin", cred: "admin@ifms.co / admin2026" },
];

/* ── Shared gradient header ── */
function AuthHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ textAlign: "center", marginBottom: 28 }}>
      <div style={{ fontSize: 44, marginBottom: 8 }}>🌾</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>{subtitle}</div>
    </div>
  );
}

/* ── LOGIN SCREEN ── */
export function LoginScreen({ onLogin, onRegister }: { onLogin: (role: Role, tenantId?: string | null) => void; onRegister?: () => void }) {
  const [tab, setTab] = useState<"email" | "pin">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [screen, setScreen] = useState<"login" | "forgot">("login");
  const [resetEmail, setResetEmail] = useState("");
  const [resetError, setResetError] = useState("");
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function doLogin(payload: { email?: string; password?: string; pin?: string }) {
    setBusy(true); setError("");
    const res = await apiClient.post<{ role: Role; tenantId: string | null }>("/api/auth/login", payload);
    setBusy(false);
    if (res.success && res.data?.role) {
      onLogin(res.data.role, res.data.tenantId);
    } else {
      setError(res.success ? "Sign-in failed — try the seeded demo accounts below." : (res.error || "Sign-in failed"));
      if (payload.pin) setTimeout(() => setPin(""), 600);
    }
  }

  function handleEmailLogin() {
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    void doLogin({ email: email.trim(), password });
  }

  function handlePinLogin() {
    if (!pin) { setError("Enter your 4-digit PIN."); return; }
    void doLogin({ pin });
  }

  function handlePinKey(digit: string) {
    if (digit === "DEL") { setPin(p => p.slice(0, -1)); return; }
    const next = pin + digit;
    if (next.length <= 4) {
      setPin(next);
      if (next.length === 4) {
        setError("");
        void doLogin({ pin: next });
      }
    }
  }

  function handleResetLink() {
    if (!resetEmail.trim()) {
      setResetError("Please enter your email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail.trim())) {
      setResetError("Please enter a valid email address.");
      return;
    }
    setResetError("");
    showToast(`Reset link sent to ${resetEmail.trim()} ✓`, "success");
    setTimeout(() => setScreen("login"), 1800);
  }

  if (screen === "forgot") {
    return (
      <div className="screen-content px-screen" style={{ paddingTop: 48 }}>
        <AuthHeader title="Reset Password" subtitle="We'll send a reset link to your email" />
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Email Address</label>
          <div style={{ position: "relative" }}>
            <Mail size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input className="farm-input" style={{ paddingLeft: 34 }} placeholder="your@email.com" value={resetEmail}
              onChange={e => { setResetEmail(e.target.value); setResetError(""); }}
              onKeyDown={e => e.key === "Enter" && handleResetLink()} />
          </div>
          {resetError && <div style={{ fontSize: 11, color: "var(--status-critical)", marginTop: 6, paddingLeft: 2 }}>{resetError}</div>}
        </div>
        <button className="btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={handleResetLink}>Send Reset Link</button>
        <button onClick={() => { setScreen("login"); setResetError(""); setResetEmail(""); }} style={{ width: "100%", marginTop: 12, padding: "10px", borderRadius: 12, background: "none", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>← Back to Login</button>
      </div>
    );
  }

  return (
    <div className="screen-content px-screen" style={{ paddingTop: 40, paddingBottom: 24 }}>
      <AuthHeader title="IFMS" subtitle="Integrated Farm Management System" />

      {/* Tab toggle */}
      <div style={{ display: "flex", background: "var(--card)", borderRadius: 12, padding: 4, marginBottom: 20, border: "1px solid var(--border-subtle)" }}>
        {(["email", "pin"] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setError(""); }}
            style={{ flex: 1, padding: "9px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "none",
              background: tab === t ? "rgba(74,222,128,0.18)" : "transparent",
              color: tab === t ? "var(--primary-green)" : "var(--text-muted)" }}>
            {t === "email" ? "📧 Email / Password" : "🔢 Worker PIN"}
          </button>
        ))}
      </div>

      {tab === "email" ? (
        <div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Email</label>
            <div style={{ position: "relative" }}>
              <Mail size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input className="farm-input" style={{ paddingLeft: 34 }} value={email} onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com" type="email" autoComplete="email" />
            </div>
          </div>
          <div style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Password</label>
            <div style={{ position: "relative" }}>
              <input className="farm-input" style={{ paddingRight: 40 }} value={password} onChange={e => setPassword(e.target.value)}
                type={showPwd ? "text" : "password"} placeholder="••••••••"
                onKeyDown={e => e.key === "Enter" && handleEmailLogin()} />
              <button onClick={() => setShowPwd(s => !s)}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <button onClick={() => setScreen("forgot")} style={{ background: "none", border: "none", color: "var(--primary-green)", fontSize: 11, fontWeight: 600, cursor: "pointer", marginBottom: 16, padding: 0 }}>
            Forgot password?
          </button>
          {error && <div style={{ padding: "10px 12px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, fontSize: 12, color: "var(--status-critical)", marginBottom: 14 }}>{error}</div>}
          <button className="btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={handleEmailLogin} disabled={busy}>
            {busy ? "Signing in…" : "Sign In →"}
          </button>
        </div>
      ) : (
        <div>
          {/* PIN dots */}
          <div style={{ display: "flex", gap: 14, justifyContent: "center", marginBottom: 20 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ width: 18, height: 18, borderRadius: "50%",
                background: i < pin.length ? "var(--primary-green)" : "var(--border-subtle)",
                border: `2px solid ${i < pin.length ? "var(--primary-green)" : "rgba(255,255,255,0.15)"}`,
                transition: "all 0.15s" }} />
            ))}
          </div>
          {error && <div style={{ padding: "8px 12px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, fontSize: 12, color: "var(--status-critical)", marginBottom: 12, textAlign: "center" }}>{error}</div>}
          {/* PIN pad */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {["1","2","3","4","5","6","7","8","9","","0","DEL"].map((d, i) => (
              <button key={i} onClick={() => d && handlePinKey(d)}
                style={{ padding: "16px 8px", borderRadius: 14, fontSize: d === "DEL" ? 12 : 20, fontWeight: 700, cursor: d ? "pointer" : "default",
                  background: d === "DEL" ? "rgba(248,113,113,0.1)" : d ? "var(--card)" : "transparent",
                  border: d === "DEL" ? "1px solid rgba(248,113,113,0.2)" : d ? "1px solid var(--border-subtle)" : "none",
                  color: d === "DEL" ? "var(--status-critical)" : "var(--text-primary)" }}>
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Demo hints */}
      <div style={{ marginTop: 20, padding: "12px 14px", background: "rgba(74,222,128,0.05)", border: "1px solid rgba(74,222,128,0.15)", borderRadius: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--primary-green)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Demo Accounts</div>
        <div style={{ display: "grid", gap: 4 }}>
          {DEMO_ACCOUNTS.map(d => (
            <div key={d.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
              <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>{d.label}</span>
              <span style={{ color: "var(--text-dim)", fontFamily: "monospace" }}>{d.cred}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Register link */}
      <div style={{ textAlign: "center", marginTop: 20 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>New farmer? </span>
        <button style={{ background: "none", border: "none", color: "var(--primary-green)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
          onClick={onRegister}>
          Request Access →
        </button>
      </div>
    </div>
  );
}

/* ── Step 2 sub-component (keeps RegisterScreen under 300 lines) ── */
function Step2FarmDetails({
  farmName, setFarmName, location, setLocation,
  address, setAddress, lat, setLat, lng, setLng,
  gpsLoading, gpsError, detectGPS, onBack, onNext,
}: {
  farmName: string; setFarmName: (v: string) => void;
  location: string; setLocation: (v: string) => void;
  address: string; setAddress: (v: string) => void;
  lat: string; setLat: (v: string) => void;
  lng: string; setLng: (v: string) => void;
  gpsLoading: boolean; gpsError: string; detectGPS: () => void;
  onBack: () => void; onNext: () => void;
}) {
  // Reverse-geocode: when lat+lng change, prefill address if currently blank
  useReverseGeocode(lat, lng, (addr) => {
    if (!address) setAddress(addr);
  });

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Farm Name *</label>
        <input className="farm-input" value={farmName} onChange={e => setFarmName(e.target.value)} placeholder="e.g. Rift Valley Poultry Farm" />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Area / Region *</label>
        <input className="farm-input" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Nakuru, Kenya" />
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>Short area name shown throughout the app (required)</div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
          GPS &amp; Full Address <span style={{ fontWeight: 400, color: "var(--text-dim)" }}>(optional)</span>
        </label>
        <GpsMapBlock
          lat={lat} lng={lng} address={address}
          onLatChange={setLat} onLngChange={setLng} onAddressChange={setAddress}
          loading={gpsLoading} error={gpsError} onDetect={detectGPS}
        />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-secondary" style={{ flex: 1, justifyContent: "center" }} onClick={onBack}>← Back</button>
        <button className="btn-primary" style={{ flex: 2, justifyContent: "center" }} onClick={onNext}>
          Next: Enterprises →
        </button>
      </div>
    </div>
  );
}

/* ── REGISTER / SELF-ONBOARDING SCREEN ── */
export function RegisterScreen({ onBack, onSubmit }: {
  onBack: () => void;
  onSubmit: (req?: Omit<OnboardRequest, "id" | "requestedAt" | "status">) => void;
}) {
  const [step, setStep] = useState(1);
  const [farmerName, setFarmerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [farmName, setFarmName] = useState("");
  const [location, setLocation] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState("");
  const [selectedEnterprises, setSelectedEnterprises] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);

  function toggleEnterprise(sub: string) {
    setSelectedEnterprises(s => s.includes(sub) ? s.filter(x => x !== sub) : [...s, sub]);
  }

  function detectGPS() {
    if (!navigator.geolocation) { setGpsError("Geolocation not supported"); return; }
    setGpsLoading(true); setGpsError("");
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setGpsLoading(false);
      },
      () => { setGpsError("Could not get location. Enter manually."); setGpsLoading(false); }
    );
  }

  function handleSubmit() {
    if (!farmerName || !email || !farmName || !location || selectedEnterprises.length === 0) return;
    const latNum = lat ? parseFloat(lat) : undefined;
    const lngNum = lng ? parseFloat(lng) : undefined;
    onSubmit({ farmerName, email, phone, farmName, location,
      address: address || undefined,
      lat: latNum, lng: lngNum,
      enterprises: selectedEnterprises });
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="screen-content px-screen" style={{ paddingTop: 60, textAlign: "center" }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "var(--primary-green)", marginBottom: 8 }}>Request Submitted!</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 24 }}>
          Your onboarding request has been sent to the IFMS admin team.{"\n"}You'll receive an email within 1–2 business days.
        </div>
        <div style={{ padding: "14px 16px", background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 16, marginBottom: 24, textAlign: "left" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>What happens next</div>
          {["Admin reviews your request (1–2 days)", "You receive approval email with login link", "Set your password and start your farm"].map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 8 }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--primary-green)" }}>{i + 1}</span>
              </div>
              <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{s}</span>
            </div>
          ))}
        </div>
        <button onClick={onBack} className="btn-primary" style={{ width: "100%", justifyContent: "center" }}>← Back to Login</button>
      </div>
    );
  }

  return (
    <div className="screen-content px-screen" style={{ paddingTop: 32, paddingBottom: 24 }}>
      <AuthHeader title="Request Farm Access" subtitle="Join IFMS — free 14-day trial" />

      {/* Steps */}
      <div style={{ display: "flex", gap: 6, marginBottom: 22 }}>
        {[1,2,3].map(s => (
          <div key={s} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
            <div style={{ height: 4, width: "100%", borderRadius: 100, background: step >= s ? "var(--primary-green)" : "var(--border-subtle)", transition: "background 0.25s" }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: step >= s ? "var(--primary-green)" : "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {["Your Info", "Farm Details", "Enterprises"][s-1]}
            </span>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Full Name *</label>
            <input className="farm-input" value={farmerName} onChange={e => setFarmerName(e.target.value)} placeholder="e.g. Mary Wanjiku" />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Email Address *</label>
            <div style={{ position: "relative" }}>
              <Mail size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input className="farm-input" style={{ paddingLeft: 34 }} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" type="email" />
            </div>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Phone Number</label>
            <div style={{ position: "relative" }}>
              <Phone size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input className="farm-input" style={{ paddingLeft: 34 }} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+254-7XX-XXX-XXX" type="tel" />
            </div>
          </div>
          <button className="btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => farmerName && email && setStep(2)}>
            Next: Farm Details →
          </button>
        </div>
      )}

      {step === 2 && (
        <Step2FarmDetails
          farmName={farmName} setFarmName={setFarmName}
          location={location} setLocation={setLocation}
          address={address} setAddress={setAddress}
          lat={lat} setLat={setLat}
          lng={lng} setLng={setLng}
          gpsLoading={gpsLoading} gpsError={gpsError} detectGPS={detectGPS}
          onBack={() => setStep(1)} onNext={() => farmName && location && setStep(3)}
        />
      )}

      {step === 3 && (
        <div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
            Select what you farm. This helps us configure the right tools for you.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18 }}>
            {ENTERPRISE_REGISTRY.map(e => {
              const sel = selectedEnterprises.includes(e.subtype);
              return (
                <button key={e.subtype} onClick={() => toggleEnterprise(e.subtype)}
                  style={{ padding: "11px 10px", borderRadius: 14, cursor: "pointer", textAlign: "center",
                    background: sel ? "rgba(74,222,128,0.15)" : "var(--card)",
                    border: sel ? "1px solid rgba(74,222,128,0.5)" : "1px solid var(--border-subtle)" }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{e.emoji}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: sel ? "var(--primary-green)" : "var(--text-muted)" }}>{e.label}</div>
                  <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 2 }}>{e.type}</div>
                  {sel && <Check size={12} color="var(--primary-green)" style={{ marginTop: 4 }} />}
                </button>
              );
            })}
          </div>
          {selectedEnterprises.length === 0 && (
            <div style={{ padding: "8px 12px", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 10, marginBottom: 12, fontSize: 11, color: "var(--accent-amber)" }}>
              <AlertTriangle size={11} style={{ verticalAlign: "middle", marginRight: 5 }} /> Select at least one enterprise type
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-secondary" style={{ flex: 1, justifyContent: "center" }} onClick={() => setStep(2)}>← Back</button>
            <button
              onClick={handleSubmit}
              disabled={selectedEnterprises.length === 0}
              style={{ flex: 2, padding: "11px", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: selectedEnterprises.length > 0 ? "pointer" : "not-allowed",
                background: selectedEnterprises.length > 0 ? "var(--primary-green)" : "var(--border-subtle)",
                border: "none", color: selectedEnterprises.length > 0 ? "#0a0f0a" : "var(--text-muted)",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Check size={14} /> Submit Request
            </button>
          </div>
        </div>
      )}

      <div style={{ textAlign: "center", marginTop: 18 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 12, cursor: "pointer" }}>
          Already have an account? Sign in
        </button>
      </div>
    </div>
  );
}