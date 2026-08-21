// ============================================================
// auth.tsx — Login, Register (Self-onboarding), and ForgotPassword screens
// Data flow: LoginScreen → NavProvider sets role → ScreenRouter shows correct tabs
//            RegisterScreen → creates OnboardRequest → Admin reviews in AdminOnboardingScreen
// ============================================================
'use client';
import React, { useState, useEffect } from 'react';
import { ENTERPRISE_REGISTRY } from './data';
import { Eye, EyeOff, Check, ChevronRight, AlertTriangle, Phone, Mail } from './icons';
import { type Role } from './navigation';
import { apiClient } from '@/lib/request';

/* ── Shared GPS + Map block ──────────────────────────────────────────────── */
export function GpsMapBlock({
  lat, lng, address,
  onLatChange, onLngChange, onAddressChange,
  loading, error, onDetect,
  latError, lngError,
}: {
  lat: string; lng: string; address: string;
  onLatChange: (v: string) => void;
  onLngChange: (v: string) => void;
  onAddressChange: (v: string) => void;
  loading: boolean; error: string;
  onDetect: () => void;
  // Optional — only the Register screen validates typed coordinates today.
  // Left undefined by other callers (e.g. admin-onboarding.tsx), which keeps
  // this backward compatible.
  latError?: string; lngError?: string;
}) {
  const hasCoords = lat !== '' && lng !== '';

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
        style={{ width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
          cursor: loading ? 'wait' : 'pointer',
          background: hasCoords ? 'rgba(74,222,128,0.12)' : 'var(--card)',
          border: hasCoords ? '1px solid rgba(74,222,128,0.4)' : '1px solid var(--border-subtle)',
          color: hasCoords ? 'var(--primary-green)' : 'var(--text-muted)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
        📍 {loading ? 'Detecting…' : hasCoords ? `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}` : 'Detect My GPS Location'}
      </button>

      {error && <div style={{ fontSize: 11, color: 'var(--status-critical)', marginBottom: 6 }}>⚠ {error}</div>}

      {/* Manual lat/lng */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <div>
          <label htmlFor="gps-lat" style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, display: 'block', marginBottom: 3 }}>Latitude</label>
          <input
            id="gps-lat" className="farm-input"
            style={{ fontSize: 12, ...(latError ? { border: '1px solid var(--status-critical)' } : {}) }}
            value={lat} onChange={e => onLatChange(e.target.value)} placeholder="-0.2802" type="number" step="any"
            aria-invalid={!!latError} aria-describedby={latError ? 'gps-lat-error' : undefined}
          />
          {latError && <div id="gps-lat-error" style={{ fontSize: 10, color: 'var(--status-critical)', marginTop: 3 }}>{latError}</div>}
        </div>
        <div>
          <label htmlFor="gps-lng" style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, display: 'block', marginBottom: 3 }}>Longitude</label>
          <input
            id="gps-lng" className="farm-input"
            style={{ fontSize: 12, ...(lngError ? { border: '1px solid var(--status-critical)' } : {}) }}
            value={lng} onChange={e => onLngChange(e.target.value)} placeholder="36.0665" type="number" step="any"
            aria-invalid={!!lngError} aria-describedby={lngError ? 'gps-lng-error' : undefined}
          />
          {lngError && <div id="gps-lng-error" style={{ fontSize: 10, color: 'var(--status-critical)', marginTop: 3 }}>{lngError}</div>}
        </div>
      </div>

      {/* Address field — prefilled by reverse-geocode, editable */}
      <div style={{ marginBottom: hasCoords ? 8 : 0 }}>
        <label style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, display: 'block', marginBottom: 3 }}>
          Address <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(auto-filled · editable)</span>
        </label>
        <input className="farm-input" style={{ fontSize: 12 }} value={address} onChange={e => onAddressChange(e.target.value)} placeholder="Reverse-geocoded from coordinates…" />
      </div>

      {/* OSM map preview */}
      {hasCoords && mapSrc && (
        <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border-subtle)', height: 160, marginTop: 4 }}>
          <iframe
            src={mapSrc}
            width="100%" height="160"
            style={{ border: 'none', display: 'block' }}
            title="Farm location map"
            loading="lazy"
          />
        </div>
      )}

      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
        Tap &quot;Detect&quot; to auto-fill from your device. Coordinates and address can be updated anytime.
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
      { signal: controller.signal, headers: { 'Accept-Language': 'en' } }
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
  { label: '👑 Owner',      cred: 'james@nakurufarm.com / farm2026' },
  { label: '🧑‍💼 Manager',   cred: 'peter@nakurufarm.com / mgr123' },
  { label: '👷 Worker PIN',  cred: '1234' },
  { label: '🩺 Vet',        cred: 'vet@nakurufarm.com / vet123' },
  { label: '🔍 Auditor',    cred: 'auditor@ifms.co / aud123' },
  { label: '⚙️ Super Admin', cred: 'admin@ifms.co / admin2026' },
];

/* ── Shared gradient header ── */
function AuthHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 28 }}>
      <div style={{ fontSize: 44, marginBottom: 8 }}>🌾</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>{subtitle}</div>
    </div>
  );
}

/* ── LOGIN SCREEN ── */
export function LoginScreen({ onLogin, onRegister }: { onLogin: (role: Role, tenantId?: string | null, name?: string) => void; onRegister?: () => void }) {
  const [tab, setTab] = useState<'email' | 'pin'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function doLogin(payload: { email?: string; password?: string; pin?: string }) {
    setBusy(true); setError('');
    const res = await apiClient.post<{ role: Role; tenantId: string | null; name?: string }>('/api/auth/login', payload);
    setBusy(false);
    if (res.success && res.data?.role) {
      onLogin(res.data.role, res.data.tenantId, res.data.name ?? '');
    } else {
      setError(res.success ? 'Sign-in failed — try the seeded demo accounts below.' : (res.error || 'Sign-in failed'));
      if (payload.pin) setTimeout(() => setPin(''), 600);
    }
  }

  function handleEmailLogin() {
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    void doLogin({ email: email.trim(), password });
  }

  function handlePinLogin() {
    if (!pin) { setError('Enter your 4-digit PIN.'); return; }
    void doLogin({ pin });
  }

  function handlePinKey(digit: string) {
    if (digit === 'DEL') { setPin(p => p.slice(0, -1)); return; }
    const next = pin + digit;
    if (next.length <= 4) {
      setPin(next);
      if (next.length === 4) {
        setError('');
        void doLogin({ pin: next });
      }
    }
  }

  return (
    <div className="screen-content px-screen" style={{ paddingTop: 40, paddingBottom: 24 }}>
      <AuthHeader title="IFMS" subtitle="Integrated Farm Management System" />

      {/* Tab toggle */}
      <div style={{ display: 'flex', background: 'var(--card)', borderRadius: 12, padding: 4, marginBottom: 20, border: '1px solid var(--border-subtle)' }}>
        {(['email', 'pin'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setError(''); }}
            style={{ flex: 1, padding: '9px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
              background: tab === t ? 'rgba(74,222,128,0.18)' : 'transparent',
              color: tab === t ? 'var(--primary-green)' : 'var(--text-muted)' }}>
            {t === 'email' ? '📧 Email / Password' : '🔢 Worker PIN'}
          </button>
        ))}
      </div>

      {tab === 'email' ? (
        <div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Email</label>
            <div style={{ position: 'relative' }}>
              <Mail size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input className="farm-input" style={{ paddingLeft: 34 }} value={email} onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com" type="email" autoComplete="email" />
            </div>
          </div>
          <div style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input className="farm-input" style={{ paddingRight: 40 }} value={password} onChange={e => setPassword(e.target.value)}
                type={showPwd ? 'text' : 'password'} placeholder="••••••••"
                onKeyDown={e => e.key === 'Enter' && handleEmailLogin()} />
              <button onClick={() => setShowPwd(s => !s)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          {/* No email delivery in this pass (issue #223 decision) — disabled, not a fake flow. */}
          <div style={{ marginBottom: 16 }}>
            <button disabled title="Contact your farm administrator to reset your password."
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 11, fontWeight: 600, cursor: 'not-allowed', padding: 0 }}>
              Forgot password?
            </button>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              Contact your farm administrator to reset your password.
            </div>
          </div>
          {error && <div style={{ padding: '10px 12px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 10, fontSize: 12, color: 'var(--status-critical)', marginBottom: 14 }}>{error}</div>}
          <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={handleEmailLogin} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign In →'}
          </button>
        </div>
      ) : (
        <div>
          {/* PIN dots */}
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginBottom: 20 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ width: 18, height: 18, borderRadius: '50%',
                background: i < pin.length ? 'var(--primary-green)' : 'var(--border-subtle)',
                border: `2px solid ${i < pin.length ? 'var(--primary-green)' : 'rgba(255,255,255,0.15)'}`,
                transition: 'all 0.15s' }} />
            ))}
          </div>
          {error && <div style={{ padding: '8px 12px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 10, fontSize: 12, color: 'var(--status-critical)', marginBottom: 12, textAlign: 'center' }}>{error}</div>}
          {/* PIN pad */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {['1','2','3','4','5','6','7','8','9','','0','DEL'].map((d, i) => (
              <button key={i} onClick={() => d && handlePinKey(d)}
                style={{ padding: '16px 8px', borderRadius: 14, fontSize: d === 'DEL' ? 12 : 20, fontWeight: 700, cursor: d ? 'pointer' : 'default',
                  background: d === 'DEL' ? 'rgba(248,113,113,0.1)' : d ? 'var(--card)' : 'transparent',
                  border: d === 'DEL' ? '1px solid rgba(248,113,113,0.2)' : d ? '1px solid var(--border-subtle)' : 'none',
                  color: d === 'DEL' ? 'var(--status-critical)' : 'var(--text-primary)' }}>
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Demo hints */}
      <div style={{ marginTop: 20, padding: '12px 14px', background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.15)', borderRadius: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary-green)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Demo Accounts</div>
        <div style={{ display: 'grid', gap: 4 }}>
          {DEMO_ACCOUNTS.map(d => (
            <div key={d.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{d.label}</span>
              <span style={{ color: 'var(--text-dim)', fontFamily: 'monospace' }}>{d.cred}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Register link */}
      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>New farmer? </span>
        <button style={{ background: 'none', border: 'none', color: 'var(--primary-green)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
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
  errors, clearFieldError,
}: {
  farmName: string; setFarmName: (v: string) => void;
  location: string; setLocation: (v: string) => void;
  address: string; setAddress: (v: string) => void;
  lat: string; setLat: (v: string) => void;
  lng: string; setLng: (v: string) => void;
  gpsLoading: boolean; gpsError: string; detectGPS: () => void;
  onBack: () => void; onNext: () => void;
  errors: FieldErrors; clearFieldError: (field: string) => void;
}) {
  // Reverse-geocode: when lat+lng change, prefill address if currently blank
  useReverseGeocode(lat, lng, (addr) => {
    if (!address) setAddress(addr);
  });

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <label htmlFor="farm-name" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Farm Name *</label>
        <input
          id="farm-name" className="farm-input"
          style={errors.farmName ? { border: '1px solid var(--status-critical)' } : undefined}
          value={farmName} onChange={e => { setFarmName(e.target.value); clearFieldError('farmName'); }}
          placeholder="e.g. Rift Valley Poultry Farm"
          aria-invalid={!!errors.farmName} aria-describedby={errors.farmName ? 'farm-name-error' : undefined}
        />
        {errors.farmName && <div id="farm-name-error" style={{ fontSize: 10.5, color: 'var(--status-critical)', marginTop: 4 }}>{errors.farmName}</div>}
      </div>

      <div style={{ marginBottom: 14 }}>
        <label htmlFor="farm-location" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Area / Region *</label>
        <input
          id="farm-location" className="farm-input"
          style={errors.location ? { border: '1px solid var(--status-critical)' } : undefined}
          value={location} onChange={e => { setLocation(e.target.value); clearFieldError('location'); }}
          placeholder="e.g. Nakuru, Kenya"
          aria-invalid={!!errors.location} aria-describedby={errors.location ? 'farm-location-error' : 'farm-location-hint'}
        />
        {errors.location
          ? <div id="farm-location-error" style={{ fontSize: 10.5, color: 'var(--status-critical)', marginTop: 4 }}>{errors.location}</div>
          : <div id="farm-location-hint" style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Short area name shown throughout the app (required)</div>}
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
          GPS &amp; Full Address <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(optional)</span>
        </label>
        {/* Point-of-collection notice (not a modal) — the browser's own permission
           prompt says only whether location is shared, never why, and it never
           mentions that useReverseGeocode hands the coordinates to a third
           party (Nominatim) to turn them into an address. */}
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
          Optional — sharing your location helps the reviewing admin find your farm. If you detect or enter coordinates, we look up the matching address using OpenStreetMap&apos;s Nominatim service, which receives those coordinates directly.
        </div>
        <GpsMapBlock
          lat={lat} lng={lng} address={address}
          onLatChange={v => { setLat(v); clearFieldError('latitude'); clearFieldError('longitude'); }}
          onLngChange={v => { setLng(v); clearFieldError('latitude'); clearFieldError('longitude'); }}
          onAddressChange={setAddress}
          loading={gpsLoading} error={gpsError} onDetect={detectGPS}
          latError={errors.latitude} lngError={errors.longitude}
        />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={onBack}>← Back</button>
        <button className="btn-primary" style={{ flex: 2, justifyContent: 'center' }} onClick={onNext}>
          Next: Enterprises →
        </button>
      </div>
    </div>
  );
}

/* ── Register-form client-side validation ──────────────────────────────────
 * lib/validation.ts (the shared validator a backend agent is building for
 * app/api/onboard-requests in parallel) did not exist yet when this was
 * written, so these checks are inline here. They intentionally mirror the
 * server-side rules documented for the /api/onboard-requests contract so the
 * user gets the same feedback instantly instead of after a round trip; the
 * server remains the authority. */
type FieldErrors = Record<string, string>;

function validateRequiredText(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${label} is required`;
  if (trimmed.length < 2) return `${label} must be at least 2 characters`;
  if (trimmed.length > 120) return `${label} must be 120 characters or fewer`;
  return null;
}

function validateEmail(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Email is required';
  if (trimmed.length > 254) return 'Email must be 254 characters or fewer';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'Enter a valid email address';
  return null;
}

function validatePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Phone number is required';
  // Strip separators the same way the server does before checking shape.
  const stripped = trimmed.replace(/[\s\-().]/g, '');
  const isIntl = /^\+\d{7,15}$/.test(stripped); // E.164-ish: + then 7-15 digits
  const isLocalKenyan = /^0[71]\d{8}$/.test(stripped); // 07XXXXXXXX / 01XXXXXXXX
  if (!isIntl && !isLocalKenyan) {
    return 'Enter a valid phone number (e.g. +2547XXXXXXXX or 07XXXXXXXX)';
  }
  return null;
}

function validateCoordinate(value: string, min: number, max: number, label: string): string | null {
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n)) return `${label} must be a number`;
  if (n < min || n > max) return `${label} must be between ${min} and ${max}`;
  return null;
}

function validateStep1(farmerName: string, email: string, phone: string): FieldErrors {
  const errors: FieldErrors = {};
  const nameErr = validateRequiredText(farmerName, 'Full name');
  if (nameErr) errors.farmerName = nameErr;
  const emailErr = validateEmail(email);
  if (emailErr) errors.email = emailErr;
  const phoneErr = validatePhone(phone);
  if (phoneErr) errors.phone = phoneErr;
  return errors;
}

function validateStep2(farmName: string, location: string, lat: string, lng: string): FieldErrors {
  const errors: FieldErrors = {};
  const farmNameErr = validateRequiredText(farmName, 'Farm name');
  if (farmNameErr) errors.farmName = farmNameErr;
  const locationErr = validateRequiredText(location, 'Area / region');
  if (locationErr) errors.location = locationErr;

  // latitude/longitude are all-or-nothing, matching the server contract.
  const hasLat = lat.trim() !== '';
  const hasLng = lng.trim() !== '';
  if (hasLat !== hasLng) {
    const msg = 'Enter both latitude and longitude, or leave both blank';
    if (hasLat) errors.longitude = msg; else errors.latitude = msg;
  } else if (hasLat && hasLng) {
    const latErr = validateCoordinate(lat, -90, 90, 'Latitude');
    if (latErr) errors.latitude = latErr;
    const lngErr = validateCoordinate(lng, -180, 180, 'Longitude');
    if (lngErr) errors.longitude = lngErr;
  }
  return errors;
}

function validateStep3(enterprises: string[], consentGiven: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (enterprises.length === 0) errors.enterprises = 'Select at least one enterprise';
  else if (enterprises.length > 20) errors.enterprises = 'Select at most 20 enterprises';
  if (!consentGiven) errors.consentGiven = 'You must consent to share this information to submit your request.';
  return errors;
}

// Which step a given body/error field belongs to, so a 400 response can jump
// the user back to where the problem actually is instead of leaving it
// invisible on whatever step they happen to be viewing.
const FIELD_STEP: Record<string, number> = {
  farmerName: 1, email: 1, phone: 1,
  farmName: 2, location: 2, address: 2, latitude: 2, longitude: 2,
  enterprises: 3, consentGiven: 3,
};

/* ── REGISTER / SELF-ONBOARDING SCREEN ── */
export function RegisterScreen({ onBack }: {
  onBack: () => void;
}) {
  const [step, setStep] = useState(1);
  const [farmerName, setFarmerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [farmName, setFarmName] = useState('');
  const [location, setLocation] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [selectedEnterprises, setSelectedEnterprises] = useState<string[]>([]);
  const [consentGiven, setConsentGiven] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  function clearFieldError(field: string) {
    setErrors(prev => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  // Replace only the errors that belong to the step just validated, keeping
  // any errors already known for other steps (e.g. from a prior server 400).
  function applyStepErrors(fields: string[], stepErrors: FieldErrors) {
    setErrors(prev => {
      const next = { ...prev };
      for (const f of fields) delete next[f];
      return { ...next, ...stepErrors };
    });
  }

  function handleStep1Next() {
    const stepErrors = validateStep1(farmerName, email, phone);
    applyStepErrors(['farmerName', 'email', 'phone'], stepErrors);
    if (Object.keys(stepErrors).length === 0) setStep(2);
  }

  function handleStep2Next() {
    const stepErrors = validateStep2(farmName, location, lat, lng);
    applyStepErrors(['farmName', 'location', 'latitude', 'longitude'], stepErrors);
    if (Object.keys(stepErrors).length === 0) setStep(3);
  }

  function toggleEnterprise(sub: string) {
    setSelectedEnterprises(s => {
      const next = s.includes(sub) ? s.filter(x => x !== sub) : [...s, sub];
      if (next.length > 0) clearFieldError('enterprises');
      return next;
    });
  }

  const hasLocationData = lat.trim() !== '' && lng.trim() !== '';
  const canSubmit = selectedEnterprises.length > 0 && consentGiven && !submitting;
  // Step 3's Submit button is disabled (not just click-validated like the
  // Next buttons on steps 1/2) whenever these two conditions aren't met, so a
  // click can never happen to surface an error — these messages have to show
  // live instead, or the disabled button would be a silent no-op.
  const enterprisesMessage = errors.enterprises ?? (selectedEnterprises.length === 0 ? 'Select at least one enterprise type' : undefined);
  const consentMessage = errors.consentGiven ?? (!consentGiven ? 'You must consent to share this information to submit your request.' : undefined);

  function detectGPS() {
    if (!navigator.geolocation) { setGpsError('Geolocation not supported'); return; }
    setGpsLoading(true); setGpsError('');
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setGpsLoading(false);
      },
      () => { setGpsError('Could not get location. Enter manually.'); setGpsLoading(false); }
    );
  }

  // POST /api/onboard-requests: { farmerName, email, phone, farmName, location,
  // enterprises, address?, latitude?, longitude?, consentGiven, consentVersion }
  // -> 201 { success: true, data: { id } }. latitude/longitude are
  // all-or-nothing; consentAt is stamped server-side, not sent from here.
  async function handleSubmit() {
    // Re-validate every step in case the user reached step 3 without the
    // earlier steps' Next buttons re-checking edited values.
    const allErrors: FieldErrors = {
      ...validateStep1(farmerName, email, phone),
      ...validateStep2(farmName, location, lat, lng),
      ...validateStep3(selectedEnterprises, consentGiven),
    };
    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors);
      const earliestStep = Math.min(...Object.keys(allErrors).map(f => FIELD_STEP[f] ?? 3));
      setStep(earliestStep);
      return;
    }

    setSubmitting(true);
    setSubmitError('');

    const body: Record<string, unknown> = {
      farmerName: farmerName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      farmName: farmName.trim(),
      location: location.trim(),
      enterprises: selectedEnterprises,
      consentGiven: true,
      consentVersion: 'v1',
    };
    if (address.trim()) body.address = address.trim();
    // Only send lat/lng together — the server treats one-without-the-other as invalid.
    if (lat.trim() !== '' && lng.trim() !== '') {
      body.latitude = lat.trim();
      body.longitude = lng.trim();
    }

    const res = await apiClient.post<{ id: string }>('/api/onboard-requests', body);
    setSubmitting(false);
    if (res.success) {
      setSubmitted(true);
      return;
    }

    if (res.fields) {
      setErrors(prev => ({ ...prev, ...res.fields }));
      const earliestStep = Math.min(...Object.keys(res.fields).map(f => FIELD_STEP[f] ?? 3));
      setStep(earliestStep);
    } else {
      // No field map — network error or a failure the server couldn't
      // attribute to one input (e.g. a 500). Show the general message.
      setSubmitError(res.error || 'Could not submit your request — please try again.');
    }
  }

  if (submitted) {
    return (
      <div className="screen-content px-screen" style={{ paddingTop: 60, textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--primary-green)', marginBottom: 8 }}>Request Submitted!</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 24 }}>
          Your onboarding request has been sent to the IFMS admin team.{'\n'}Expect a response within 1–2 business days — the admin team will review it and contact you directly with your login details.
        </div>
        <div style={{ padding: '14px 16px', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 16, marginBottom: 24, textAlign: 'left' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>What happens next</div>
          {['Admin reviews your request (1–2 days)', 'Admin contacts you directly with your login details', 'Set your password and start your farm'].map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary-green)' }}>{i + 1}</span>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{s}</span>
            </div>
          ))}
          {/* Roadmap note, not a warning — today an admin relays login details by
             hand (no mail dependency exists in this codebase). Kept in the same
             muted weight as the steps above so it doesn't compete with them. */}
          <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 4 }}>
            ⏳ Automatic email notifications — coming soon
          </div>
        </div>
        <button onClick={onBack} className="btn-primary" style={{ width: '100%', justifyContent: 'center' }}>← Back to Login</button>
      </div>
    );
  }

  return (
    <div className="screen-content px-screen" style={{ paddingTop: 32, paddingBottom: 24 }}>
      <AuthHeader title="Request Farm Access" subtitle="Join IFMS — free 14-day trial" />

      {/* Steps */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 22 }}>
        {[1,2,3].map(s => (
          <div key={s} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
            <div style={{ height: 4, width: '100%', borderRadius: 100, background: step >= s ? 'var(--primary-green)' : 'var(--border-subtle)', transition: 'background 0.25s' }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: step >= s ? 'var(--primary-green)' : 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {['Your Info', 'Farm Details', 'Enterprises'][s-1]}
            </span>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div>
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="farmer-name" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Full Name *</label>
            <input
              id="farmer-name" className="farm-input"
              style={errors.farmerName ? { border: '1px solid var(--status-critical)' } : undefined}
              value={farmerName} onChange={e => { setFarmerName(e.target.value); clearFieldError('farmerName'); }}
              placeholder="e.g. Mary Wanjiku"
              aria-invalid={!!errors.farmerName} aria-describedby={errors.farmerName ? 'farmer-name-error' : undefined}
            />
            {errors.farmerName && <div id="farmer-name-error" style={{ fontSize: 10.5, color: 'var(--status-critical)', marginTop: 4 }}>{errors.farmerName}</div>}
          </div>
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="farmer-email" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Email Address *</label>
            <div style={{ position: 'relative' }}>
              <Mail size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                id="farmer-email" className="farm-input"
                style={{ paddingLeft: 34, ...(errors.email ? { border: '1px solid var(--status-critical)' } : {}) }}
                value={email} onChange={e => { setEmail(e.target.value); clearFieldError('email'); }}
                placeholder="you@email.com" type="email"
                aria-invalid={!!errors.email} aria-describedby={errors.email ? 'farmer-email-error' : undefined}
              />
            </div>
            {errors.email && <div id="farmer-email-error" style={{ fontSize: 10.5, color: 'var(--status-critical)', marginTop: 4 }}>{errors.email}</div>}
          </div>
          <div style={{ marginBottom: 20 }}>
            <label htmlFor="farmer-phone" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Phone Number *</label>
            <div style={{ position: 'relative' }}>
              <Phone size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                id="farmer-phone" className="farm-input"
                style={{ paddingLeft: 34, ...(errors.phone ? { border: '1px solid var(--status-critical)' } : {}) }}
                value={phone} onChange={e => { setPhone(e.target.value); clearFieldError('phone'); }}
                placeholder="+254-7XX-XXX-XXX" type="tel"
                aria-invalid={!!errors.phone} aria-describedby={errors.phone ? 'farmer-phone-error' : undefined}
              />
            </div>
            {errors.phone && <div id="farmer-phone-error" style={{ fontSize: 10.5, color: 'var(--status-critical)', marginTop: 4 }}>{errors.phone}</div>}
          </div>
          <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={handleStep1Next}>
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
          onBack={() => setStep(1)} onNext={handleStep2Next}
          errors={errors} clearFieldError={clearFieldError}
        />
      )}

      {step === 3 && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
            Select what you farm. This helps us configure the right tools for you.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
            {ENTERPRISE_REGISTRY.map(e => {
              const sel = selectedEnterprises.includes(e.subtype);
              return (
                <button key={e.subtype} onClick={() => toggleEnterprise(e.subtype)}
                  style={{ padding: '11px 10px', borderRadius: 14, cursor: 'pointer', textAlign: 'center',
                    background: sel ? 'rgba(74,222,128,0.15)' : 'var(--card)',
                    border: sel ? '1px solid rgba(74,222,128,0.5)' : '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{e.emoji}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: sel ? 'var(--primary-green)' : 'var(--text-muted)' }}>{e.label}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>{e.type}</div>
                  {sel && <Check size={12} color="var(--primary-green)" style={{ marginTop: 4 }} />}
                </button>
              );
            })}
          </div>
          {enterprisesMessage && (
            <div style={{ padding: '8px 12px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 10, marginBottom: 12, fontSize: 11, color: 'var(--accent-amber)' }}>
              <AlertTriangle size={11} style={{ verticalAlign: 'middle', marginRight: 5 }} /> {enterprisesMessage}
            </div>
          )}

          {/* Consent — names exactly what is shared, and only claims location
             data is included when the applicant actually provided it. */}
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="consent-checkbox" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
              <input
                id="consent-checkbox" type="checkbox"
                checked={consentGiven}
                onChange={e => { setConsentGiven(e.target.checked); clearFieldError('consentGiven'); }}
                aria-invalid={!!consentMessage}
                aria-describedby={consentMessage ? 'consent-error' : undefined}
                style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, accentColor: 'var(--primary-green)' }}
              />
              <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                I consent to sharing my name, email and phone, farm name and area, and selected enterprise
                types{hasLocationData ? ', along with the GPS coordinates and address I provided' : ''} with
                the IFMS admin team for review.
              </span>
            </label>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, marginLeft: 24 }}>
              Used only to review and set up your farm account.
            </div>
            {consentMessage && (
              <div id="consent-error" style={{ padding: '6px 10px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, fontSize: 10.5, color: 'var(--accent-amber)', marginTop: 6, marginLeft: 24 }}>
                {consentMessage}
              </div>
            )}
          </div>

          {submitError && (
            <div style={{ padding: '10px 12px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 10, fontSize: 12, color: 'var(--status-critical)', marginBottom: 12 }}>
              {submitError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setStep(2)}>← Back</button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{ flex: 2, padding: '11px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed',
                background: canSubmit ? 'var(--primary-green)' : 'var(--border-subtle)',
                border: 'none', color: canSubmit ? '#0a0f0a' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Check size={14} /> {submitting ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: 18 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>
          Already have an account? Sign in
        </button>
      </div>
    </div>
  );
}