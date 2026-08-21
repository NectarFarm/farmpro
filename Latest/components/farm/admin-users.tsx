// ============================================================
// admin-users.tsx — Admin user management (search/filter/edit any user),
// admin-mediated password resets, and time-boxed audited impersonation.
//
// Backend: GET/PATCH /api/admin/users[/:id], POST .../reset-password,
// GET /api/admin/password-resets, POST .../impersonate,
// POST /api/admin/impersonate/stop, GET /api/admin/impersonation-log.
// All super_admin-only except the global ImpersonationBanner, which any
// impersonated session renders.
// ============================================================
'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { TopNav } from './navigation';
import {
  Search, X, AlertTriangle, CheckCircle2, Clock, Key,
  UserCheck, ShieldAlert, ChevronRight, Mail, Phone, LogOut,
} from './icons';
import { apiClient } from '@/lib/request';

/* ── Types ── */
interface AdminUser {
  id: string;
  tenantId: string | null;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  createdAt: string | null;
}

interface PendingReset {
  id: string;
  userId: string;
  email: string;
  phone: string;
  status: string;
  requestedAt: string;
  handledBy: string | null;
  handledAt: string | null;
  notes: string | null;
  userName: string;
  userRole: string;
  userStatus: string;
  userTenantId: string | null;
}

interface ImpersonationLogEntry {
  id: string;
  action: 'impersonation.start' | 'impersonation.end';
  at: string;
  admin: { id: string; name: string; email: string };
  target: { id: string; name: string; email: string };
  meta: Record<string, unknown> | null;
}

export interface ImpersonationInfo {
  adminId: string;
  adminName: string;
  adminEmail: string;
  expiresAt: string;
}

type FieldErrors = Record<string, string>;

const ROLES = ['owner', 'manager', 'worker', 'vet', 'auditor', 'super_admin'] as const;
const STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
const DURATIONS = [5, 10, 15, 30] as const;

function roleLabel(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/* ================================================================
 * Global impersonation banner — rendered by app/page.tsx so it is
 * unmissable on every screen while a session is impersonating.
 * ================================================================ */
export function ImpersonationBanner({ info, onReturned }: { info: ImpersonationInfo | null; onReturned: () => void }) {
  const [remainingMs, setRemainingMs] = useState(0);
  const [ending, setEnding] = useState(false);
  const [autoEndTriggered, setAutoEndTriggered] = useState(false);

  useEffect(() => {
    if (!info) return;
    const expiresAt = new Date(info.expiresAt).getTime();
    const tick = () => setRemainingMs(Math.max(0, expiresAt - Date.now()));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [info]);

  const endSession = useCallback(async () => {
    setEnding(true);
    await apiClient.post('/api/admin/impersonate/stop', {});
    onReturned();
  }, [onReturned]);

  // Time box hit zero — end it from the client side too (the server already
  // stops authenticating this session either way; this just makes sure the
  // audit trail gets a real `impersonation.end` row and the admin's own
  // cookie is restored, instead of leaving the admin stuck logged out).
  useEffect(() => {
    if (info && remainingMs <= 0 && !autoEndTriggered) {
      setAutoEndTriggered(true);
      void endSession();
    }
  }, [info, remainingMs, autoEndTriggered, endSession]);

  if (!info) return null;

  const totalSeconds = Math.floor(remainingMs / 1000);
  const mm = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const ss = (totalSeconds % 60).toString().padStart(2, '0');

  return (
    <div
      role="alert"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
        background: 'repeating-linear-gradient(135deg, rgba(251,191,36,0.95), rgba(251,191,36,0.95) 10px, rgba(217,119,6,0.95) 10px, rgba(217,119,6,0.95) 20px)',
        borderBottom: '2px solid var(--status-warning)',
        padding: '9px 14px',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
      }}
    >
      <ShieldAlert size={16} color="#1a1400" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 200, fontSize: 12, fontWeight: 700, color: '#1a1400', lineHeight: 1.35 }}>
        Impersonation active — {info.adminName} ({info.adminEmail}) is signed in as you and is accountable for actions taken during this window.
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 800, color: remainingMs < 60000 ? '#7f1d1d' : '#1a1400', flexShrink: 0 }}>
        {mm}:{ss}
      </div>
      <button
        type="button"
        onClick={() => void endSession()}
        disabled={ending}
        style={{
          flexShrink: 0, padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
          cursor: ending ? 'default' : 'pointer', background: '#1a1400', color: '#fbbf24',
          border: 'none', display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        <LogOut size={12} /> {ending ? 'Returning…' : 'Return to admin'}
      </button>
    </div>
  );
}

/* ================================================================
 * One-time secret reveal (temp password) — same treatment
 * admin-onboarding.tsx's TempPasswordModal gives ownerTempPassword.
 * ================================================================ */
function TempPasswordModal({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 20 }} onClick={onClose}>
      <div className="farm-card" style={{ width: '100%', maxWidth: 380, padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <CheckCircle2 size={18} color="var(--status-ok)" />
          <div style={{ fontSize: 15, fontWeight: 700 }}>Password Reset</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
          New temporary password for <strong>{email}</strong>. Share it with them now — through a channel you trust, out of band.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
          <code style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, flex: 1, letterSpacing: '0.02em', wordBreak: 'break-all', color: 'var(--text-primary)' }}>{password}</code>
          <button
            onClick={() => { if (navigator.clipboard) void navigator.clipboard.writeText(password); setCopied(true); }}
            style={{ fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 8, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', color: 'var(--primary-green)', cursor: 'pointer', flexShrink: 0 }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, fontSize: 10, color: 'var(--status-warning)', marginBottom: 16, lineHeight: 1.4 }}>
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>This password cannot be retrieved again once you close this dialog. If it&apos;s lost, reset it again.</span>
        </div>
        <button onClick={onClose} className="btn-primary" style={{ width: '100%', justifyContent: 'center', fontSize: 13, padding: 10 }}>Done</button>
      </div>
    </div>
  );
}

/* ================================================================
 * Impersonation launcher — duration picker + explicit accountability
 * confirmation step, per the user's own request ("... so that within
 * that period the admin will be responsible for his actions").
 * ================================================================ */
function ImpersonateDialog({ user, onClose, onStarted }: { user: AdminUser; onClose: () => void; onStarted: () => void }) {
  const [minutes, setMinutes] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    if (!minutes) return;
    setStarting(true);
    setError('');
    const res = await apiClient.post(`/api/admin/users/${user.id}/impersonate`, { minutes });
    setStarting(false);
    if (!res.success) {
      setError(res.error || 'Failed to start impersonation.');
      return;
    }
    onStarted();
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 320, padding: 20 }} onClick={onClose}>
      <div className="farm-card" style={{ width: '100%', maxWidth: 380, padding: 20 }} onClick={(e) => e.stopPropagation()}>
        {!confirming ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <UserCheck size={18} color="var(--primary-green)" />
              <div style={{ fontSize: 15, fontWeight: 700 }}>Log in as {user.name}</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
              Choose how long you need. The session ends automatically when time is up — pick the shortest window that covers the task.
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {DURATIONS.map((m) => (
                <button
                  key={m}
                  onClick={() => setMinutes(m)}
                  style={{
                    flex: 1, padding: '12px 6px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                    background: minutes === m ? 'rgba(74,222,128,0.15)' : 'var(--surface)',
                    border: minutes === m ? '1px solid rgba(74,222,128,0.5)' : '1px solid var(--border-subtle)',
                    color: minutes === m ? 'var(--primary-green)' : 'var(--text-secondary)', fontWeight: 700, fontSize: 14,
                  }}
                >
                  {m}<span style={{ fontSize: 10, fontWeight: 600, display: 'block', color: 'var(--text-dim)' }}>min</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
              <button
                onClick={() => setConfirming(true)}
                disabled={!minutes}
                className="btn-primary"
                style={{ flex: 1, justifyContent: 'center', opacity: minutes ? 1 : 0.5, cursor: minutes ? 'pointer' : 'not-allowed' }}
              >
                Continue
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <ShieldAlert size={18} color="var(--status-warning)" />
              <div style={{ fontSize: 15, fontWeight: 700 }}>Confirm accountability</div>
            </div>
            <div style={{ padding: '12px 14px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 10, marginBottom: 16, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              You are about to sign in as <strong>{user.name}</strong> ({user.email}) for <strong>{minutes} minutes</strong>. Every action taken during this window is recorded against your admin account, and you are personally responsible for it. The session ends automatically at expiry, or you can end it early at any time from the banner shown while impersonating.
            </div>
            {error && <div style={{ fontSize: 12, color: 'var(--status-critical)', marginBottom: 12 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirming(false)} disabled={starting} className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>Back</button>
              <button onClick={() => void start()} disabled={starting} className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                {starting ? 'Starting…' : 'I understand — start'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ================================================================
 * User detail / edit panel
 * ================================================================ */
function UserDetail({ user, onClose, onUpdated }: { user: AdminUser; onClose: () => void; onUpdated: (u: AdminUser) => void }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [showImpersonate, setShowImpersonate] = useState(false);

  function clearFieldError(field: string) {
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setSaveError('');
    setSaved(false);
    const res = await apiClient.patch<AdminUser>(`/api/admin/users/${user.id}`, {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || null,
      role,
      status,
    });
    setSaving(false);
    if (!res.success) {
      setErrors(res.fields ?? {});
      setSaveError(res.error || 'Failed to save changes.');
      return;
    }
    setErrors({});
    setSaved(true);
    onUpdated(res.data);
  }

  async function resetPassword() {
    setResetting(true);
    setResetError('');
    const res = await apiClient.post<{ id: string; email: string; tempPassword: string }>(`/api/admin/users/${user.id}/reset-password`, {});
    setResetting(false);
    if (!res.success) {
      setResetError(res.error || 'Failed to reset password.');
      return;
    }
    setTempPassword(res.data.tempPassword);
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '22px 22px 0 0', width: '100%', maxHeight: '90%', overflowY: 'auto', border: '1px solid var(--border-subtle)', padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{user.name}</div>
            <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 9px', borderRadius: 100, background: 'rgba(74,222,128,0.1)', color: 'var(--primary-green)', border: '1px solid rgba(74,222,128,0.3)' }}>
              {roleLabel(user.role).toUpperCase()}
            </span>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Edit form */}
        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="section-eyebrow" style={{ marginBottom: 10 }}>Details</div>

          <div style={{ marginBottom: 12 }}>
            <label htmlFor="edit-user-name" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Name</label>
            <input
              id="edit-user-name" className="farm-input"
              style={errors.name ? { border: '1px solid var(--status-critical)' } : undefined}
              value={name} onChange={(e) => { setName(e.target.value); clearFieldError('name'); }}
              aria-invalid={!!errors.name} aria-describedby={errors.name ? 'edit-user-name-error' : undefined}
            />
            {errors.name && <div id="edit-user-name-error" style={{ fontSize: 10.5, color: 'var(--status-critical)', marginTop: 4 }}>{errors.name}</div>}
          </div>

          <div style={{ marginBottom: 12 }}>
            <label htmlFor="edit-user-email" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Email</label>
            <div style={{ position: 'relative' }}>
              <Mail size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                id="edit-user-email" className="farm-input"
                style={{ paddingLeft: 34, ...(errors.email ? { border: '1px solid var(--status-critical)' } : {}) }}
                value={email} onChange={(e) => { setEmail(e.target.value); clearFieldError('email'); }}
                type="email" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'edit-user-email-error' : undefined}
              />
            </div>
            {errors.email && <div id="edit-user-email-error" style={{ fontSize: 10.5, color: 'var(--status-critical)', marginTop: 4 }}>{errors.email}</div>}
          </div>

          <div style={{ marginBottom: 12 }}>
            <label htmlFor="edit-user-phone" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>
              Phone <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(matched against forgot-password requests)</span>
            </label>
            <div style={{ position: 'relative' }}>
              <Phone size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                id="edit-user-phone" className="farm-input"
                style={{ paddingLeft: 34, ...(errors.phone ? { border: '1px solid var(--status-critical)' } : {}) }}
                value={phone} onChange={(e) => { setPhone(e.target.value); clearFieldError('phone'); }}
                placeholder="+254-7XX-XXX-XXX" type="tel"
                aria-invalid={!!errors.phone} aria-describedby={errors.phone ? 'edit-user-phone-error' : undefined}
              />
            </div>
            {errors.phone && <div id="edit-user-phone-error" style={{ fontSize: 10.5, color: 'var(--status-critical)', marginTop: 4 }}>{errors.phone}</div>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 4 }}>
            <div>
              <label htmlFor="edit-user-role" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Role</label>
              <select
                id="edit-user-role" className="farm-input"
                style={errors.role ? { border: '1px solid var(--status-critical)' } : undefined}
                value={role} onChange={(e) => { setRole(e.target.value); clearFieldError('role'); }}
                aria-invalid={!!errors.role}
              >
                {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
              {errors.role && <div style={{ fontSize: 10.5, color: 'var(--status-critical)', marginTop: 4 }}>{errors.role}</div>}
            </div>
            <div>
              <label htmlFor="edit-user-status" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Status</label>
              <select
                id="edit-user-status" className="farm-input"
                style={errors.status ? { border: '1px solid var(--status-critical)' } : undefined}
                value={status} onChange={(e) => { setStatus(e.target.value); clearFieldError('status'); }}
                aria-invalid={!!errors.status}
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {errors.status && <div style={{ fontSize: 10.5, color: 'var(--status-critical)', marginTop: 4 }}>{errors.status}</div>}
            </div>
          </div>

          {saveError && <div style={{ fontSize: 12, color: 'var(--status-critical)', marginTop: 12 }}>{saveError}</div>}
          {saved && <div style={{ fontSize: 12, color: 'var(--primary-green)', marginTop: 12, display: 'flex', alignItems: 'center', gap: 5 }}><CheckCircle2 size={13} /> Saved</div>}

          <button onClick={() => void save()} disabled={saving} className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

        {/* Meta */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, fontSize: 11, color: 'var(--text-muted)' }}>
          <Clock size={12} style={{ flexShrink: 0 }} />
          <span>Created: {formatDateTime(user.createdAt)}</span>
          <span style={{ marginLeft: 4, fontWeight: 700, color: 'var(--text-dim)' }}>{user.tenantId ?? 'platform'}</span>
        </div>

        {/* Actions */}
        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="section-eyebrow" style={{ marginBottom: 10 }}>Actions</div>
          {resetError && <div style={{ fontSize: 11, color: 'var(--status-critical)', marginBottom: 8 }}>{resetError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => void resetPassword()}
              disabled={resetting}
              style={{ flex: 1, padding: 11, borderRadius: 12, fontSize: 12.5, fontWeight: 700, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)', color: 'var(--accent-blue)', cursor: resetting ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Key size={13} /> {resetting ? 'Resetting…' : 'Reset Password'}
            </button>
            <button
              onClick={() => setShowImpersonate(true)}
              disabled={user.role === 'super_admin'}
              title={user.role === 'super_admin' ? 'Cannot impersonate another super_admin' : undefined}
              style={{ flex: 1, padding: 11, borderRadius: 12, fontSize: 12.5, fontWeight: 700, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', color: 'var(--primary-green)', cursor: user.role === 'super_admin' ? 'not-allowed' : 'pointer', opacity: user.role === 'super_admin' ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <UserCheck size={13} /> Log in as user
            </button>
          </div>
        </div>
      </div>

      {tempPassword && <TempPasswordModal email={user.email} password={tempPassword} onClose={() => setTempPassword(null)} />}
      {showImpersonate && (
        <ImpersonateDialog
          user={user}
          onClose={() => setShowImpersonate(false)}
          onStarted={() => { window.location.reload(); }}
        />
      )}
    </div>
  );
}

/* ================================================================
 * Pending password-reset queue
 * ================================================================ */
function PasswordResetsTab() {
  const [rows, setRows] = useState<PendingReset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiClient.get<PendingReset[]>('/api/admin/password-resets');
    if (res.success) { setRows(res.data); setLoadError(''); } else { setLoadError(res.error || 'Failed to load requests.'); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handle(row: PendingReset) {
    setBusyId(row.id);
    const res = await apiClient.post<{ email: string; tempPassword: string }>(`/api/admin/users/${row.userId}/reset-password`, {});
    setBusyId(null);
    if (res.success) {
      setTempPassword({ email: res.data.email, password: res.data.tempPassword });
      void load();
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>;
  if (loadError) return <div style={{ fontSize: 12, color: 'var(--status-critical)', padding: 14 }}>{loadError}</div>;
  if (rows.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
        <CheckCircle2 size={32} style={{ marginBottom: 10, opacity: 0.4 }} />
        <div style={{ fontSize: 14, fontWeight: 600 }}>No pending password reset requests</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 40 }}>
      {rows.map((row) => (
        <div key={row.id} className="farm-card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{row.userName}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{row.email} · {row.phone}</div>
            </div>
            <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 9px', borderRadius: 100, background: 'rgba(251,191,36,0.1)', color: 'var(--status-warning)', border: '1px solid rgba(251,191,36,0.3)' }}>PENDING</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 10 }}>
            <Clock size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} /> Requested {formatDateTime(row.requestedAt)}
          </div>
          <button
            onClick={() => void handle(row)}
            disabled={busyId === row.id}
            style={{ width: '100%', padding: 9, borderRadius: 10, fontSize: 12, fontWeight: 700, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)', color: 'var(--accent-blue)', cursor: busyId === row.id ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <Key size={12} /> {busyId === row.id ? 'Resetting…' : 'Reset Password'}
          </button>
        </div>
      ))}
      {tempPassword && <TempPasswordModal email={tempPassword.email} password={tempPassword.password} onClose={() => setTempPassword(null)} />}
    </div>
  );
}

/* ================================================================
 * Impersonation history — "show the login of who logged in and when
 * was he logged out" from the user's own request.
 * ================================================================ */
function ImpersonationLogTab() {
  const [rows, setRows] = useState<ImpersonationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    apiClient.get<ImpersonationLogEntry[]>('/api/admin/impersonation-log').then((res) => {
      if (res.success) { setRows(res.data); setLoadError(''); } else { setLoadError(res.error || 'Failed to load log.'); }
      setLoading(false);
    });
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>;
  if (loadError) return <div style={{ fontSize: 12, color: 'var(--status-critical)', padding: 14 }}>{loadError}</div>;
  if (rows.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
        <ShieldAlert size={32} style={{ marginBottom: 10, opacity: 0.4 }} />
        <div style={{ fontSize: 14, fontWeight: 600 }}>No impersonation activity yet</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 40 }}>
      {rows.map((row) => {
        const isStart = row.action === 'impersonation.start';
        const minutes = typeof row.meta?.minutes === 'number' ? row.meta.minutes : null;
        const endedEarly = row.meta?.endedEarly === true;
        return (
          <div key={row.id} className="farm-card" style={{ padding: 12, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isStart ? 'rgba(74,222,128,0.12)' : 'rgba(96,165,250,0.1)', border: `1px solid ${isStart ? 'rgba(74,222,128,0.3)' : 'rgba(96,165,250,0.3)'}` }}>
              {isStart ? <UserCheck size={13} color="var(--primary-green)" /> : <LogOut size={13} color="var(--accent-blue)" />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                <strong>{row.admin.name}</strong> ({row.admin.email}) {isStart ? 'started impersonating' : 'stopped impersonating'} <strong>{row.target.name}</strong> ({row.target.email})
                {isStart && minutes != null && <span style={{ color: 'var(--text-muted)' }}> for {minutes} min</span>}
                {!isStart && <span style={{ color: 'var(--text-muted)' }}> ({endedEarly ? 'ended early' : 'expired'})</span>}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>{formatDateTime(row.at)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ================================================================
 * Main screen
 * ================================================================ */
type Tab = 'users' | 'password-resets' | 'impersonation-log';

export function AdminUsersScreen() {
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (role) params.set('role', role);
    if (status) params.set('status', status);
    const res = await apiClient.get<AdminUser[]>(`/api/admin/users?${params.toString()}`);
    if (res.success) { setUsers(res.data); setLoadError(''); } else { setLoadError(res.error || 'Failed to load users.'); }
    setLoading(false);
  }, [q, role, status]);

  // Debounce the free-text search so every keystroke doesn't fire a request;
  // role/status changes fire immediately via the same effect re-running.
  useEffect(() => {
    const handle = setTimeout(() => { void load(); }, q ? 300 : 0);
    return () => clearTimeout(handle);
  }, [load, q]);

  return (
    <div className="screen-content">
      <TopNav title="User Management" subtitle={loading ? 'Loading…' : `${users.length} user${users.length === 1 ? '' : 's'} shown`} />

      <div className="px-screen" style={{ paddingTop: 12 }}>
        {/* Tabs */}
        <div className="chip-row" style={{ marginBottom: 14 }}>
          {([
            { id: 'users' as Tab, label: 'Users' },
            { id: 'password-resets' as Tab, label: 'Password Resets' },
            { id: 'impersonation-log' as Tab, label: 'Impersonation Log' },
          ]).map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`filter-chip ${tab === t.id ? 'active' : ''}`}>{t.label}</button>
          ))}
        </div>

        {tab === 'users' && (
          <>
            {/* Search + filters */}
            <div style={{ marginBottom: 10, position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                className="farm-input" style={{ paddingLeft: 34 }} value={q}
                onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email…"
                aria-label="Search users by name or email"
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
              <select className="farm-input" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by role">
                <option value="">All roles</option>
                {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
              <select className="farm-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {loadError && (
              <div className="farm-card" style={{ padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                <AlertTriangle size={16} color="var(--status-critical)" />
                <span style={{ fontSize: 12, color: 'var(--status-critical)' }}>{loadError}</span>
              </div>
            )}
            {loading && !loadError && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>Loading users…</div>
            )}
            {!loading && !loadError && users.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                <UserCheck size={32} style={{ marginBottom: 10, opacity: 0.4 }} />
                <div style={{ fontSize: 14, fontWeight: 600 }}>No users match these filters</div>
              </div>
            )}
            {!loading && !loadError && users.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 40 }}>
                {users.map((u) => (
                  <button key={u.id} onClick={() => setSelected(u)} className="farm-card" style={{ padding: 14, width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{u.email}{u.phone ? ` · ${u.phone}` : ''}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 9px', borderRadius: 100, background: 'rgba(74,222,128,0.1)', color: 'var(--primary-green)', border: '1px solid rgba(74,222,128,0.3)' }}>
                          {roleLabel(u.role).toUpperCase()}
                        </span>
                        {u.status !== 'ACTIVE' && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 9px', borderRadius: 100, background: 'rgba(248,113,113,0.1)', color: 'var(--status-critical)', border: '1px solid rgba(248,113,113,0.3)' }}>
                            {u.status}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{u.tenantId ?? 'platform'}</span>
                      <ChevronRight size={14} color="var(--text-muted)" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'password-resets' && <PasswordResetsTab />}
        {tab === 'impersonation-log' && <ImpersonationLogTab />}
      </div>

      {selected && (
        <UserDetail
          user={selected}
          onClose={() => setSelected(null)}
          onUpdated={(u) => { setUsers((rs) => rs.map((r) => (r.id === u.id ? u : r))); setSelected(u); }}
        />
      )}
    </div>
  );
}
