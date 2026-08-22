'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { useNav, TopNav } from './navigation';
import {
  Check, X, Clock, ChevronRight, MessageSquare,
  UserSingle as User, MapPin, Phone, Mail, Building2, AlertTriangle, CheckCircle2, Sprout
} from './icons';
import { ENTERPRISE_REGISTRY, type OnboardRequest } from './data';
import { GpsMapBlock, useReverseGeocode } from './auth';
import { apiClient } from '@/lib/request';
import { detectGpsLocation } from '@/lib/geolocation';

// ── Real backend wiring (issues #251/#252) ──────────────────────────────────
// GET/PATCH /api/onboard-requests[/:id] already exist and work (issue #251,
// merged) — this screen used to render the mock request list from data.ts; it
// now loads the real queue and posts real approve/reject/info-needed decisions.
// The API now also returns and persists `address`/`latitude`/`longitude`
// (nullable columns on onboard_requests — db/schemas/onboarding.ts), so
// LocationEditor reads its initial state from the server and PATCHes edits
// back rather than staying client-local. There is still no `plan` concept (no
// plans table anywhere in this backend), so the old "Plan to Assign" selector
// — which never posted anywhere real — has been removed rather than left
// wired to nothing.
interface ApiOnboardRequest {
  id: string;
  farmerName: string;
  email: string;
  phone: string;
  farmName: string;
  location: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  // Applicant's consent record — set once, at submission time, from the
  // server's clock. Null on rows that predate consent capture; never set or
  // changed by anything this screen does (PATCH refuses to touch it).
  consentAt: string | null;
  consentVersion: string | null;
  enterprises: string[];
  status: OnboardRequest['status'];
  notes: string | null;
  requestedAt: string;
  tenantId: string | null;
  // Only present in the PATCH response for the approval call that actually
  // provisions the tenant (issue #291) — never persisted, never sent again.
  ownerTempPassword?: string;
}

function formatRequestedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// `OnboardRequest` (from data.ts) predates the consent columns, so it has no
// slot for them. Extend it locally rather than touching the shared mock-data
// type — this file is display-only for consent, nothing else needs the field.
type AdminOnboardRequest = OnboardRequest & {
  consentAt?: string | null;
  consentVersion?: string | null;
};

function toOnboardRequest(row: ApiOnboardRequest): AdminOnboardRequest {
  return {
    id: row.id,
    farmerName: row.farmerName,
    email: row.email,
    phone: row.phone,
    farmName: row.farmName,
    location: row.location,
    address: row.address ?? undefined,
    lat: row.latitude ?? undefined,
    lng: row.longitude ?? undefined,
    consentAt: row.consentAt ?? null,
    consentVersion: row.consentVersion ?? null,
    enterprises: row.enterprises,
    requestedAt: formatRequestedAt(row.requestedAt),
    status: row.status,
    notes: row.notes ?? undefined,
  };
}

const STATUS_CONFIG: Record<OnboardRequest['status'], { color: string; bg: string; label: string }> = {
  pending:      { color: 'var(--status-warning)', bg: 'rgba(251,191,36,0.1)', label: 'Pending' },
  approved:     { color: 'var(--status-ok)', bg: 'rgba(74,222,128,0.08)', label: 'Approved' },
  rejected:     { color: 'var(--status-critical)', bg: 'rgba(248,113,113,0.08)', label: 'Rejected' },
  'info-needed': { color: 'var(--accent-blue)', bg: 'rgba(96,165,250,0.08)', label: 'Info Needed' },
};

// Client-side mirror of the server's validation (server stays authoritative —
// this only saves the admin a round trip for obviously-bad input). Returns
// the first message plus a per-field map, matching the shape of the 400 body
// documented in the PATCH contract.
function validateLocationDraft(address: string, lat: string, lng: string): { message: string; fields: Record<string, string> } | null {
  const fields: Record<string, string> = {};
  if (address.trim().length > 300) {
    fields.address = 'Address must be 300 characters or fewer.';
  }
  const latTrim = lat.trim();
  const lngTrim = lng.trim();
  if ((latTrim === '') !== (lngTrim === '')) {
    // Latitude/longitude are all-or-nothing on the server — catch the
    // half-filled case before it round-trips.
    fields.latitude = 'Latitude and longitude must be set together.';
    fields.longitude = 'Latitude and longitude must be set together.';
  } else if (latTrim !== '' && lngTrim !== '') {
    const latN = Number(latTrim);
    const lngN = Number(lngTrim);
    if (!Number.isFinite(latN) || latN < -90 || latN > 90) {
      fields.latitude = 'Latitude must be a number between -90 and 90.';
    }
    if (!Number.isFinite(lngN) || lngN < -180 || lngN > 180) {
      fields.longitude = 'Longitude must be a number between -180 and 180.';
    }
  }
  const first = fields.address || fields.latitude || fields.longitude;
  return first ? { message: first, fields } : null;
}

/* ── Location editor sub-component (hooks must live at component level) ── */
function LocationEditor({
  req,
  onSaved,
}: {
  req: AdminOnboardRequest;
  onSaved: (id: string, patch: { address: string | null; lat: number | null; lng: number | null }) => void;
}) {
  // `persisted` mirrors what the server actually has on record — it only
  // changes on load or after a confirmed successful save, never while the
  // admin is merely typing. `locationSaved` below is derived from it, not
  // from session-only draft state, so it can't lie about what's stored.
  const [persisted, setPersisted] = useState({
    address: req.address ?? '',
    lat: req.lat != null ? String(req.lat) : '',
    lng: req.lng != null ? String(req.lng) : '',
  });
  const [adminAddress, setAdminAddress] = useState(persisted.address);
  const [adminLat, setAdminLat] = useState(persisted.lat);
  const [adminLng, setAdminLng] = useState(persisted.lng);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Session-only freshness flag — we have no backend field recording *who*
  // set a location, so this can only ever say "you just changed this",
  // never assert provenance for coordinates that were already on the row
  // when the panel opened (those might be applicant-submitted GPS, or an
  // admin edit from an earlier session — genuinely indistinguishable here).
  const [justSaved, setJustSaved] = useState(false);

  const locationSaved = !!(persisted.address || (persisted.lat !== '' && persisted.lng !== ''));

  // Reverse-geocode: prefill address when coords change (only if address blank)
  useReverseGeocode(adminLat, adminLng, (addr) => {
    setAdminAddress(prev => prev ? prev : addr);
  });

  function detectGPS() {
    setGpsLoading(true); setGpsError('');
    detectGpsLocation(
      coords => { setAdminLat(coords.latitude); setAdminLng(coords.longitude); setGpsLoading(false); },
      message => { setGpsError(message); setGpsLoading(false); }
    );
  }

  function openForm() {
    // Re-seed the draft from the last-known-persisted values every time the
    // form opens, so a cancelled earlier edit never leaks into the next one.
    setAdminAddress(persisted.address);
    setAdminLat(persisted.lat);
    setAdminLng(persisted.lng);
    setSaveError('');
    setFieldErrors({});
    setShowLocationForm(true);
  }

  async function saveLocation() {
    const validation = validateLocationDraft(adminAddress, adminLat, adminLng);
    if (validation) {
      setFieldErrors(validation.fields);
      setSaveError(validation.message);
      return;
    }
    setFieldErrors({});
    setSaveError('');
    setSaving(true);

    const trimmedAddress = adminAddress.trim();
    const latTrim = adminLat.trim();
    const lngTrim = adminLng.trim();
    // Location is independent of the approve/reject/info-needed decision —
    // this PATCH only ever carries address/latitude/longitude, never status,
    // and (per the consent scope) never consentAt/consentVersion either.
    const payload = {
      address: trimmedAddress === '' ? null : trimmedAddress,
      latitude: latTrim === '' ? null : Number(latTrim),
      longitude: lngTrim === '' ? null : Number(lngTrim),
    };

    const res = await apiClient.patch<ApiOnboardRequest>(`/api/onboard-requests/${req.id}`, payload);
    setSaving(false);

    if (!res.success) {
      // The server's 400 body carries a per-field `fields` map alongside the
      // summary `error` string, and apiClient now passes both through — so a
      // genuine server-side rejection (e.g. a race where another admin's
      // edit landed first, or a rule validateLocationDraft doesn't mirror)
      // gets the exact same field-level treatment as our own pre-flight
      // checks below. The admin can't tell which layer complained, which is
      // the point.
      setFieldErrors(res.fields ?? {});
      setSaveError(res.error || 'Failed to save location.');
      return;
    }

    const next = {
      address: res.data.address ?? '',
      lat: res.data.latitude != null ? String(res.data.latitude) : '',
      lng: res.data.longitude != null ? String(res.data.longitude) : '',
    };
    setPersisted(next);
    setAdminAddress(next.address);
    setAdminLat(next.lat);
    setAdminLng(next.lng);
    setShowLocationForm(false);
    setJustSaved(true);
    onSaved(req.id, { address: res.data.address ?? null, lat: res.data.latitude ?? null, lng: res.data.longitude ?? null });
  }

  return (
    <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: locationSaved || showLocationForm ? 10 : 4 }}>
        <div>
          <div className="section-eyebrow" style={{ marginBottom: 2 }}>Farm Location</div>
          {locationSaved && !showLocationForm && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 3 }}>
              <MapPin size={11} aria-hidden="true" />
              {persisted.address || req.location}
              {persisted.lat && persisted.lng && <span style={{ marginLeft: 2, color: 'var(--accent-cyan)', fontFamily: 'monospace', fontSize: 'var(--fs-2xs)' }}>{parseFloat(persisted.lat).toFixed(4)}, {parseFloat(persisted.lng).toFixed(4)}</span>}
              {justSaved && <span style={{ marginLeft: 2, color: 'var(--primary-green)', fontWeight: 700 }}>· saved</span>}
            </div>
          )}
          {!locationSaved && !showLocationForm && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--text-dim)', marginTop: 3 }}>
              <MapPin size={11} aria-hidden="true" />
              {req.location} · no coordinates on file
            </div>
          )}
        </div>
        <button onClick={() => (showLocationForm ? setShowLocationForm(false) : openForm())} style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, padding: '4px 12px', borderRadius: 8, background: locationSaved ? 'rgba(74,222,128,0.1)' : 'var(--surface)', border: '1px solid var(--border-subtle)', color: locationSaved ? 'var(--primary-green)' : 'var(--text-muted)', cursor: 'pointer' }}>
          {showLocationForm ? 'Cancel' : locationSaved ? 'Edit' : 'Set Location'}
        </button>
      </div>

      {/* Map preview when saved and coords exist */}
      {locationSaved && !showLocationForm && persisted.lat && persisted.lng && (
        <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border-subtle)', height: 140, marginTop: 6 }}>
          <iframe
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${(parseFloat(persisted.lng)-0.01).toFixed(4)},${(parseFloat(persisted.lat)-0.01).toFixed(4)},${(parseFloat(persisted.lng)+0.01).toFixed(4)},${(parseFloat(persisted.lat)+0.01).toFixed(4)}&layer=mapnik&marker=${persisted.lat},${persisted.lng}`}
            width="100%" height="140"
            style={{ border: 'none', display: 'block' }}
            title="Farm location map"
            loading="lazy"
          />
        </div>
      )}

      {showLocationForm && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <GpsMapBlock
            lat={adminLat} lng={adminLng} address={adminAddress}
            onLatChange={setAdminLat} onLngChange={setAdminLng} onAddressChange={setAdminAddress}
            loading={gpsLoading} error={gpsError} onDetect={detectGPS}
          />
          {(fieldErrors.address || fieldErrors.latitude || fieldErrors.longitude) && (
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)' }}>
              {fieldErrors.address && <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><AlertTriangle size={11} aria-hidden="true" /> {fieldErrors.address}</div>}
              {fieldErrors.latitude && <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><AlertTriangle size={11} aria-hidden="true" /> {fieldErrors.latitude}</div>}
              {fieldErrors.longitude && !fieldErrors.latitude && <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><AlertTriangle size={11} aria-hidden="true" /> {fieldErrors.longitude}</div>}
            </div>
          )}
          {saveError && !fieldErrors.address && !fieldErrors.latitude && !fieldErrors.longitude && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--status-critical)' }}><AlertTriangle size={11} aria-hidden="true" /> {saveError}</div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowLocationForm(false)} disabled={saving} className="btn-secondary" style={{ flex: 1, justifyContent: 'center', fontSize: 'var(--fs-sm)', padding: 9 }}>Cancel</button>
            <button
              onClick={() => void saveLocation()}
              disabled={saving}
              className="btn-primary" style={{ flex: 1, justifyContent: 'center', fontSize: 'var(--fs-sm)', padding: 9, opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}>
              <Check size={13} /> {saving ? 'Saving…' : 'Save Location'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── One-time temp password reveal (issue #291) ──────────────────────────────
// The approve PATCH returns the new owner's temp password exactly once, on
// the call that actually provisions the tenant. There is no other channel
// (no email delivery yet) — so this dialog is the only chance the admin gets
// to see and relay it before it's gone for good.
function TempPasswordModal({
  email,
  password,
  onClose,
}: {
  email: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 20 }}
      onClick={onClose}
    >
      <div
        className="farm-card"
        style={{ width: '100%', maxWidth: 380, padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <CheckCircle2 size={18} color="var(--status-ok)" />
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700 }}>Tenant Approved</div>
        </div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
          Owner account created for <strong>{email}</strong>. Share this one-time password with them now.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
          <code style={{ fontFamily: 'monospace', fontSize: 'var(--fs-md)', fontWeight: 700, flex: 1, letterSpacing: '0.02em', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
            {password}
          </code>
          <button
            onClick={() => {
              if (navigator.clipboard) void navigator.clipboard.writeText(password);
              setCopied(true);
            }}
            style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, padding: '5px 10px', borderRadius: 8, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', color: 'var(--primary-green)', cursor: 'pointer', flexShrink: 0 }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, fontSize: 'var(--fs-2xs)', color: 'var(--status-warning)', marginBottom: 16, lineHeight: 1.4 }}>
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>This password cannot be retrieved again once you close this dialog. If it&apos;s lost, the owner&apos;s password must be reset directly.</span>
        </div>
        <button onClick={onClose} className="btn-primary" style={{ width: '100%', justifyContent: 'center', fontSize: 'var(--fs-base)', padding: 10 }}>
          Done
        </button>
      </div>
    </div>
  );
}

function RequestDetail({
  req,
  onAction,
  onLocationSaved,
  onClose,
}: {
  req: AdminOnboardRequest;
  onAction: (id: string, action: OnboardRequest['status'], notes?: string) => Promise<string | null>;
  onLocationSaved: (id: string, patch: { address: string | null; lat: number | null; lng: number | null }) => void;
  onClose: () => void;
}) {
  const [infoNote, setInfoNote] = useState(req.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const s = STATUS_CONFIG[req.status];

  async function handle(action: OnboardRequest['status']) {
    setSaving(true);
    setActionError('');
    const failure = await onAction(req.id, action, infoNote.trim() || undefined);
    setSaving(false);
    if (!failure) onClose();
    else setActionError(failure);
  }

  const enterpriseLabels = req.enterprises.map((e) => {
    const cfg = ENTERPRISE_REGISTRY.find((r) => r.subtype === e);
    return { key: e, Icon: cfg?.icon ?? Sprout, label: cfg ? cfg.label : e };
  });

  return (
    <div
      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--surface)', borderRadius: '22px 22px 0 0', width: '100%', maxHeight: '88%', overflowY: 'auto', border: '1px solid var(--border-subtle)', padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700 }}>{req.farmName}</div>
            <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, padding: '3px 9px', borderRadius: 100, background: s.bg, color: s.color, border: `1px solid ${s.color}40` }}>{s.label.toUpperCase()}</span>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Farmer info */}
        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Applicant</div>
          {[
            { icon: <User size={13} />, label: 'Name', value: req.farmerName },
            { icon: <Mail size={13} />, label: 'Email', value: req.email },
            { icon: <Phone size={13} />, label: 'Phone', value: req.phone },
            { icon: <MapPin size={13} />, label: 'Location', value: req.location },
          ].map((row) => (
            <div key={row.label} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
              <div style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{row.icon}</div>
              <div>
                <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{row.label}</div>
                <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', fontWeight: 500 }}>{row.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Farm Location — admin-editable */}
        <LocationEditor req={req} onSaved={onLocationSaved} />

        {/* Applicant consent — display-only; PATCH never touches this */}
        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Consent</div>
          {req.consentAt ? (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
              <CheckCircle2 size={13} color="var(--status-ok)" style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Consented {formatRequestedAt(req.consentAt)}
              <span style={{ marginLeft: 6, fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontFamily: 'monospace' }}>({req.consentVersion || 'version unknown'})</span>
            </div>
          ) : (
            // Legacy rows genuinely have no consent record — this is neutral,
            // not an error state: it predates consent capture, not a
            // violation of it.
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>
              Not recorded (predates consent capture)
            </div>
          )}
        </div>

        {/* Farm enterprises */}
        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Requested Enterprises</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {enterpriseLabels.map(({ key, Icon, label }) => (
              <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', padding: '5px 11px', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 100, color: 'var(--primary-green)', fontWeight: 600 }}>
                <Icon size={13} aria-hidden="true" />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Request meta */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          <Clock size={12} style={{ flexShrink: 0 }} />
          <span>Submitted: {req.requestedAt}</span>
          <span style={{ marginLeft: 4, fontWeight: 700, color: 'var(--text-dim)' }}>{req.id}</span>
        </div>

        {/* Notes / info request */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
            Notes / Info Request
          </label>
          <textarea
            className="farm-input"
            rows={3}
            value={infoNote}
            onChange={(e) => setInfoNote(e.target.value)}
            placeholder="Request documents, clarify location, or add admin notes…"
            style={{ resize: 'none' }}
          />
        </div>

        {actionError && (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10 }}>{actionError}</div>
        )}

        {/* Action buttons */}
        {req.status === 'pending' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              disabled={saving}
              onClick={() => handle('approved')}
              style={{ flex: 1, padding: 11, borderRadius: 12, fontSize: 'var(--fs-base)', fontWeight: 700, background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.35)', color: 'var(--status-ok)', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Check size={14} /> Approve & Onboard
            </button>
            <button
              disabled={saving}
              onClick={() => handle('rejected')}
              style={{ flex: 1, padding: 11, borderRadius: 12, fontSize: 'var(--fs-base)', fontWeight: 700, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: 'var(--status-critical)', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <X size={14} /> Reject
            </button>
          </div>
        )}
        {req.status === 'pending' && (
          <button
            disabled={saving}
            onClick={() => handle('info-needed')}
            style={{ width: '100%', marginTop: 8, padding: 11, borderRadius: 12, fontSize: 'var(--fs-base)', fontWeight: 700, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)', color: 'var(--accent-blue)', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <MessageSquare size={14} /> Request More Info
          </button>
        )}
      </div>
    </div>
  );
}

export function AdminOnboardingScreen() {
  const [requests, setRequests] = useState<AdminOnboardRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<AdminOnboardRequest | null>(null);
  const [actionError, setActionError] = useState('');
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiClient.get<ApiOnboardRequest[]>('/api/onboard-requests');
    if (res.success) {
      setRequests(res.data.map(toOnboardRequest));
      setLoadError('');
    } else {
      setLoadError(res.error || 'Failed to load onboarding requests.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Returns null on success, or the server's own message on failure. It used
  // to return a boolean, which threw the reason away — an admin approving a
  // request whose email already exists was told "Failed to update this
  // request. Try again.", advice that could never work.
  async function act(id: string, action: OnboardRequest['status'], notes?: string): Promise<string | null> {
    const res = await apiClient.patch<ApiOnboardRequest>(`/api/onboard-requests/${id}`, {
      status: action,
      ...(notes !== undefined ? { notes } : {}),
    });
    if (!res.success) {
      const message = res.error || 'Failed to update this request.';
      setActionError(message);
      return message;
    }
    setActionError('');
    setRequests((rs) => rs.map((r) => (r.id === id ? toOnboardRequest(res.data) : r)));
    if (res.data.ownerTempPassword) {
      setTempPassword({ email: res.data.email, password: res.data.ownerTempPassword });
    }
    return null;
  }

  // LocationEditor already PATCHed and got back the persisted values — this
  // just fans the confirmed result out to the list and the open detail panel
  // so both stay in sync with the server without a full reload.
  function handleLocationSaved(id: string, patch: { address: string | null; lat: number | null; lng: number | null }) {
    const merge = (r: AdminOnboardRequest) => ({
      ...r,
      address: patch.address ?? undefined,
      lat: patch.lat ?? undefined,
      lng: patch.lng ?? undefined,
    });
    setRequests((rs) => rs.map((r) => (r.id === id ? merge(r) : r)));
    setSelected((s) => (s && s.id === id ? merge(s) : s));
  }

  const filtered = filter === 'all' ? requests : requests.filter((r) => r.status === filter);
  const pending = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="screen-content">
      <TopNav
        title="Onboarding Requests"
        subtitle={loading ? 'Loading…' : `${pending} pending review`}
      />

      <div className="px-screen" style={{ paddingTop: 12 }}>
        {loadError && (
          <div className="farm-card" style={{ padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={16} color="var(--status-critical)" />
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)' }}>{loadError}</span>
          </div>
        )}
        {loading && !loadError && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 'var(--fs-base)' }}>Loading requests…</div>
        )}
        {actionError && (
          <div className="farm-card" style={{ padding: 12, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={16} color="var(--status-critical)" />
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)' }}>{actionError}</span>
          </div>
        )}
        {!loading && !loadError && (
        <>
        {/* Summary */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[
            { label: 'Pending', value: requests.filter(r => r.status === 'pending').length, color: 'var(--status-warning)', bg: 'rgba(251,191,36,0.1)' },
            { label: 'Info Needed', value: requests.filter(r => r.status === 'info-needed').length, color: 'var(--accent-blue)', bg: 'rgba(96,165,250,0.08)' },
            { label: 'Approved', value: requests.filter(r => r.status === 'approved').length, color: 'var(--status-ok)', bg: 'rgba(74,222,128,0.08)' },
          ].map((s) => (
            <div key={s.label} style={{ flex: 1, background: s.bg, borderRadius: 12, padding: '10px', textAlign: 'center', border: `1px solid ${s.color}30` }}>
              <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="chip-row" style={{ marginBottom: 14 }}>
          {['all', 'pending', 'info-needed', 'approved', 'rejected'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`filter-chip ${filter === f ? 'active' : ''}`}
              style={{ textTransform: 'capitalize' }}
            >
              {f === 'all' ? 'All' : f.replace(/-/g, ' ')}
              {f === 'pending' && pending > 0 ? ` (${pending})` : ''}
            </button>
          ))}
        </div>

        {/* Request list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 80 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              <CheckCircle2 size={32} style={{ marginBottom: 10, opacity: 0.4 }} />
              <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>No {filter} requests</div>
            </div>
          ) : (
            filtered.map((req) => {
              const s = STATUS_CONFIG[req.status];
              const enterprises = req.enterprises.map((e) => {
                const cfg = ENTERPRISE_REGISTRY.find((r) => r.subtype === e);
                return cfg?.icon ?? Sprout;
              });

              return (
                <button
                  key={req.id}
                  onClick={() => setSelected(req)}
                  className="farm-card"
                  style={{ padding: 14, width: '100%', textAlign: 'left', cursor: 'pointer', border: req.status === 'pending' ? '1px solid rgba(251,191,36,0.25)' : '1px solid var(--border-subtle)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)' }}>{req.farmName}</div>
                      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                        <User size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                        {req.farmerName} · {req.location}
                      </div>
                    </div>
                    <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, padding: '3px 9px', borderRadius: 100, background: s.bg, color: s.color, border: `1px solid ${s.color}40`, flexShrink: 0 }}>
                      {s.label.toUpperCase()}
                    </span>
                  </div>

                  {/* Enterprises row */}
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    {enterprises.map((Icon, i) => (
                      <Icon key={i} size={15} color="var(--text-muted)" aria-hidden="true" />
                    ))}
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', alignSelf: 'center' }}>
                      {req.enterprises.join(', ')}
                    </span>
                  </div>

                  {/* Coordinates, when set — either submitted by the applicant or set by
                      an admin; there's no backend field to tell those apart, so this
                      shows the fact of the coordinates without claiming a source. */}
                  {(req.address || (req.lat != null && req.lng != null)) && (
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MapPin size={10} />
                      {req.address || 'GPS pin on file'}
                      {req.lat != null && req.lng != null && (
                        <span style={{ fontFamily: 'monospace', fontSize: 'var(--fs-2xs)', color: 'var(--accent-cyan)' }}>
                          {req.address ? '· ' : ''}{req.lat.toFixed(4)}, {req.lng.toFixed(4)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Notes strip */}
                  {req.notes && (
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent-blue)', padding: '6px 10px', background: 'rgba(96,165,250,0.06)', borderRadius: 8, marginBottom: 8, border: '1px solid rgba(96,165,250,0.15)' }}>
                      <MessageSquare size={10} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                      {req.notes}
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)' }}>
                      <Clock size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                      {req.requestedAt} · {req.id}
                    </span>
                    <ChevronRight size={14} color="var(--text-muted)" />
                  </div>

                  {/* Inline quick actions for pending */}
                  {req.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => { e.stopPropagation(); void act(req.id, 'approved'); }}
                        style={{ flex: 1, padding: '7px', borderRadius: 8, fontSize: 'var(--fs-xs)', fontWeight: 700, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', color: 'var(--status-ok)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                      >
                        <Check size={12} /> Approve
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); void act(req.id, 'rejected'); }}
                        style={{ flex: 1, padding: '7px', borderRadius: 8, fontSize: 'var(--fs-xs)', fontWeight: 700, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: 'var(--status-critical)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                      >
                        <X size={12} /> Reject
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelected(req); }}
                        style={{ padding: '7px 12px', borderRadius: 8, fontSize: 'var(--fs-xs)', background: 'var(--surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer' }}
                      >
                        Details
                      </button>
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
        </>
        )}
      </div>

      {selected && (
        <RequestDetail
          req={selected}
          onAction={act}
          onLocationSaved={handleLocationSaved}
          onClose={() => setSelected(null)}
        />
      )}

      {tempPassword && (
        <TempPasswordModal
          email={tempPassword.email}
          password={tempPassword.password}
          onClose={() => setTempPassword(null)}
        />
      )}
    </div>
  );
}
