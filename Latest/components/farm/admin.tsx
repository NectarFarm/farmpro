'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { useNav, TopNav } from './navigation';
import { Building2, Users, ChevronRight, ChevronDown, AlertTriangle, Lock, Plus, X, Edit2, Archive, RotateCcw } from './icons';
import { apiClient } from '@/lib/request';

// ── Real backend wiring (issue #252) ────────────────────────────────────────
// GET /api/admin/tenants and GET /api/admin/stats are new, minimal,
// super_admin-only routes built for this issue — no admin backend existed on
// this branch before it (confirmed by grep + the issue's own branch-correction
// note). Both screens below used to render hardcoded FARMS / AUDIT_LOG /
// PLATFORM_HEALTH mock arrays; those are gone rather than left in place next
// to real data, because none of that mock data (plans, revenue, animal
// counts, system health, an audit trail) has a real source at platform scope
// yet — showing it next to real numbers would read as real. The Settings tab
// is explicitly disabled below instead (see AdminSettingsScreen).

interface ApiTenant {
  id: string;
  name: string;
  active: boolean;
  createdAt: string | null;
  farms: number;
  users: number;
}

interface ApiStats {
  totalTenants: number;
  activeTenants: number;
  totalUsers: number;
  onboardRequestsByStatus: Record<'pending' | 'approved' | 'rejected' | 'info-needed', number>;
}

// Farms CRUD (farms/employees CRUD task) — a tenant's own farms, managed
// from a super_admin session. GET/PATCH /api/farms(/[id]) require the
// caller to name the tenant explicitly since a super_admin session carries
// no tenantId of its own; every call below passes the tenant this panel was
// opened for.
interface ApiFarm {
  id: string;
  tenantId: string;
  name: string;
  location: string;
  code: string;
  status: 'ACTIVE' | 'ARCHIVED' | string;
  createdAt: string | null;
}

type FieldErrors = Record<string, string>;

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
}

function useAdminStats() {
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiClient.get<ApiStats>('/api/admin/stats').then((res) => {
      if (cancelled) return;
      if (res.success) { setStats(res.data); setError(''); }
      else setError(res.error || 'Failed to load platform stats.');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return { stats, error, loading };
}

export function AdminDashboardScreen() {
  const { navigate } = useNav();
  const { stats, error, loading } = useAdminStats();

  return (
    <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Platform Admin</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>IFMS Overview</div>
      </div>

      {error && (
        <div className="farm-card" style={{ padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={16} color="var(--status-critical)" />
          <span style={{ fontSize: 12, color: 'var(--status-critical)' }}>{error}</span>
        </div>
      )}
      {loading && !error && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>Loading platform stats…</div>
      )}

      {!loading && !error && stats && (
        <>
          {/* Platform KPIs — real counts only (issue #252: no revenue/animal
              stats exist at platform scope, so none are shown here). */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Tenants', value: stats.totalTenants, sub: `${stats.activeTenants} active`, color: 'var(--primary-green)' },
              { label: 'Users', value: stats.totalUsers, sub: 'active accounts', color: 'var(--accent-blue)' },
              { label: 'Pending Requests', value: stats.onboardRequestsByStatus.pending, sub: 'awaiting review', color: 'var(--status-warning)' },
              { label: 'Onboarded', value: stats.onboardRequestsByStatus.approved, sub: 'requests approved', color: 'var(--status-ok)' },
            ].map((k) => (
              <div key={k.label} className="farm-card" style={{ padding: 14 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>{k.label}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Onboarding queue breakdown — real, from the same stats call. */}
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Onboarding Queue</div>
          <div className="farm-card" style={{ overflow: 'hidden', marginBottom: 14 }}>
            {(['pending', 'info-needed', 'approved', 'rejected'] as const).map((status, i, arr) => (
              <div key={status} style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{status.replace(/-/g, ' ')}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{stats.onboardRequestsByStatus[status]}</span>
              </div>
            ))}
          </div>

          {/* Quick actions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
            <button className="btn-primary" style={{ justifyContent: 'center', padding: 12, borderRadius: 12, fontSize: 12 }} onClick={() => navigate('admin-onboarding')}>
              <Users size={14} /> Review Requests
            </button>
            <button className="btn-secondary" style={{ justifyContent: 'center', padding: 12, borderRadius: 12, fontSize: 12 }} onClick={() => navigate('admin-farms')}>
              <Building2 size={14} /> View Tenants
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function AdminFarmsScreen() {
  const [tenants, setTenants] = useState<ApiTenant[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [expandedTenant, setExpandedTenant] = useState<string | null>(null);
  const { navigate } = useNav();

  const load = useCallback(async () => {
    const res = await apiClient.get<ApiTenant[]>('/api/admin/tenants');
    if (res.success) { setTenants(res.data); setError(''); }
    else setError(res.error || 'Failed to load tenants.');
  }, []);

  useEffect(() => { load(); }, [load]);

  const loading = tenants === null && !error;
  const filtered = tenants
    ? filter === 'all' ? tenants : tenants.filter((t) => (filter === 'active' ? t.active : !t.active))
    : [];

  return (
    <div className="screen-content">
      <TopNav title="Tenants" subtitle={tenants ? `${tenants.length} registered` : 'Loading…'} />

      <div className="px-screen" style={{ paddingTop: 12 }}>
        {error && (
          <div className="farm-card" style={{ padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={16} color="var(--status-critical)" />
            <span style={{ fontSize: 12, color: 'var(--status-critical)' }}>{error}</span>
          </div>
        )}
        {loading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>Loading tenants…</div>
        )}

        {!loading && !error && (
          <>
            <div className="chip-row" style={{ marginBottom: 12 }}>
              {(['all', 'active', 'suspended'] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`filter-chip ${filter === f ? 'active' : ''}`} style={{ textTransform: 'capitalize' }}>{f}</button>
              ))}
            </div>

            {/* New tenants come from approving an onboarding request, not a
                form here — there's no POST /api/admin/tenants in this issue's
                scope (that transaction lives in lib/tenant-provisioning.ts,
                called from PATCH /api/onboard-requests/[id]). */}
            <button
              className="farm-card"
              onClick={() => navigate('admin-onboarding')}
              style={{ width: '100%', textAlign: 'left', padding: 12, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>New tenants are onboarded via the Requests queue</span>
              <ChevronRight size={14} color="var(--text-muted)" />
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 80 }}>
              {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                  <Building2 size={32} style={{ marginBottom: 10, opacity: 0.4 }} />
                  <div style={{ fontSize: 14, fontWeight: 600 }}>No {filter === 'all' ? '' : filter} tenants</div>
                </div>
              ) : (
                filtered.map((t) => (
                  <div key={t.id} className="farm-card" style={{ padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{t.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>Onboarded {formatDate(t.createdAt)}</div>
                      </div>
                      <span className={`chip ${t.active ? 'chip-ok' : 'chip-critical'}`} style={{ fontSize: 9 }}>{t.active ? 'ACTIVE' : 'SUSPENDED'}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                      {[['Users', t.users], ['Farms', t.farms]].map(([k, v]) => (
                        <div key={k as string} style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{v as number}</div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>{k as string}</div>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => setExpandedTenant((cur) => (cur === t.id ? null : t.id))}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 0', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: expandedTenant === t.id ? 'rgba(74,222,128,0.1)' : 'var(--card)', border: '1px solid var(--border-subtle)', color: expandedTenant === t.id ? 'var(--primary-green)' : 'var(--text-muted)' }}
                    >
                      {expandedTenant === t.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {expandedTenant === t.id ? 'Hide Farms' : 'Manage Farms'}
                    </button>
                    {expandedTenant === t.id && (
                      <TenantFarmsPanel tenantId={t.id} onChanged={load} />
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── A tenant's farms: create / edit / archive / restore (farms CRUD task) ──
// Rendered inline under a tenant card on AdminFarmsScreen rather than as a
// separate screen — a super_admin drills into exactly one tenant's farms at
// a time, and every call here passes that tenant's real id explicitly
// (GET/PATCH /api/farms(/[id]) require it from a super_admin session, which
// carries no tenantId of its own).
function TenantFarmsPanel({ tenantId, onChanged }: { tenantId: string; onChanged: () => void }) {
  const [farms, setFarms] = useState<ApiFarm[] | null>(null);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ApiFarm | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ApiFarm | null>(null);

  const load = useCallback(async () => {
    const res = await apiClient.get<ApiFarm[]>(`/api/farms?tenantId=${tenantId}&includeArchived=true`);
    if (res.success) { setFarms(res.data); setError(''); }
    else setError(res.error || 'Failed to load farms.');
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const list = farms ?? [];
  const filtered = list.filter((f) => statusFilter === 'all' ? true : statusFilter === 'active' ? f.status === 'ACTIVE' : f.status === 'ARCHIVED');

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
      {error && <div style={{ fontSize: 11, color: 'var(--status-critical)', marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="chip-row" style={{ margin: 0 }}>
          {(['active', 'archived', 'all'] as const).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)} className={`filter-chip ${statusFilter === f ? 'active' : ''}`} style={{ fontSize: 10, textTransform: 'capitalize' }}>{f}</button>
          ))}
        </div>
        <button
          onClick={() => setShowAdd(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', color: 'var(--primary-green)' }}
        >
          <Plus size={12} /> Add
        </button>
      </div>

      {farms === null && !error && <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '10px 0' }}>Loading farms…</div>}

      {farms !== null && filtered.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '10px 0', textAlign: 'center' }}>No {statusFilter === 'all' ? '' : statusFilter} farms.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map((f) => (
          <div key={f.id} style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{f.name}</span>
                {f.status === 'ARCHIVED' && <span className="chip chip-critical" style={{ fontSize: 8 }}>ARCHIVED</span>}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{f.code} · {f.location || '—'}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => setEditing(f)} title="Edit" style={{ width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', border: '1px solid var(--border-subtle)', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <Edit2 size={12} />
              </button>
              <button onClick={() => setConfirmTarget(f)} title={f.status === 'ARCHIVED' ? 'Restore' : 'Archive'} style={{ width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', border: '1px solid var(--border-subtle)', cursor: 'pointer', color: f.status === 'ARCHIVED' ? 'var(--status-ok)' : 'var(--status-critical)' }}>
                {f.status === 'ARCHIVED' ? <RotateCcw size={12} /> : <Archive size={12} />}
              </button>
            </div>
          </div>
        ))}
      </div>

      {(showAdd || editing) && (
        <FarmFormModal
          tenantId={tenantId}
          farm={editing}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={() => { setShowAdd(false); setEditing(null); load(); onChanged(); }}
        />
      )}

      {confirmTarget && (
        <FarmArchiveConfirm
          tenantId={tenantId}
          farm={confirmTarget}
          onClose={() => setConfirmTarget(null)}
          onDone={() => { setConfirmTarget(null); load(); onChanged(); }}
        />
      )}
    </div>
  );
}

function FarmFormModal({ tenantId, farm, onClose, onSaved }: {
  tenantId: string;
  farm: ApiFarm | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(farm?.name ?? '');
  const [location, setLocation] = useState(farm?.location ?? '');
  const [code, setCode] = useState(farm?.code ?? '');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError('');
    setFieldErrors({});
    const res = farm
      ? await apiClient.patch<ApiFarm>(`/api/farms/${farm.id}`, { tenantId, name: name.trim(), location: location.trim(), code: code.trim() })
      : await apiClient.post<ApiFarm>('/api/farms', { tenantId, name: name.trim(), location: location.trim(), code: code.trim() });
    setSaving(false);
    if (!res.success) {
      setFieldErrors(res.fields ?? {});
      setError(res.error || `Failed to ${farm ? 'save' : 'create'} farm.`);
      return;
    }
    onSaved();
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: 20, width: '100%', border: '1px solid var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{farm ? 'Edit Farm' : 'Add Farm'}</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Name</label>
          <input className="farm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nakuru Main Farm" />
          {fieldErrors.name && <div style={{ fontSize: 11, color: 'var(--status-critical)', marginTop: 4 }}>{fieldErrors.name}</div>}
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Location</label>
          <input className="farm-input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Nakuru, Kenya" />
          {fieldErrors.location && <div style={{ fontSize: 11, color: 'var(--status-critical)', marginTop: 4 }}>{fieldErrors.location}</div>}
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Code</label>
          <input className="farm-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. FRM-KMU-001" style={{ fontFamily: 'monospace' }} />
          {fieldErrors.code && <div style={{ fontSize: 11, color: 'var(--status-critical)', marginTop: 4 }}>{fieldErrors.code}</div>}
        </div>

        {error && <div style={{ fontSize: 12, color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}

        <button className="btn-primary" disabled={saving} style={{ width: '100%', justifyContent: 'center', borderRadius: 12, padding: 12, opacity: saving ? 0.7 : 1 }} onClick={handleSave}>
          {saving ? 'Saving…' : farm ? 'Save Changes' : 'Create Farm'}
        </button>
      </div>
    </div>
  );
}

// Archiving/restoring is destructive-adjacent (it changes what shows up
// everywhere else in the app), so it gets its own explicit confirmation step
// that names the farm — never a bare toggle. If the server refuses (still-live
// production units/batches), that refusal is shown right here instead of
// closing the dialog, so the admin sees exactly what's blocking it.
function FarmArchiveConfirm({ tenantId, farm, onClose, onDone }: {
  tenantId: string;
  farm: ApiFarm;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const restoring = farm.status === 'ARCHIVED';

  async function handleConfirm() {
    setBusy(true);
    setError('');
    const res = await apiClient.patch<ApiFarm>(`/api/farms/${farm.id}`, { tenantId, status: restoring ? 'ACTIVE' : 'ARCHIVED' });
    setBusy(false);
    if (!res.success) {
      setError(res.fields?.status || res.error || `Failed to ${restoring ? 'restore' : 'archive'} farm.`);
      return;
    }
    onDone();
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }} onClick={onClose}>
      <div className="farm-card" style={{ padding: 18, width: '100%', maxWidth: 340 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          {restoring ? <RotateCcw size={16} color="var(--status-ok)" /> : <Archive size={16} color="var(--status-critical)" />}
          <div style={{ fontSize: 14, fontWeight: 700 }}>{restoring ? 'Restore farm?' : 'Archive farm?'}</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 14 }}>
          {restoring
            ? <>This will make <strong>{farm.name}</strong> active again and bring it back into the farm switcher and every list.</>
            : <>This hides <strong>{farm.name}</strong> ({farm.code}) from the farm switcher and default lists. It is never deleted — you can restore it any time from the Archived filter.</>}
        </div>
        {error && <div style={{ fontSize: 12, color: 'var(--status-critical)', marginBottom: 12, lineHeight: 1.5 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} disabled={busy} className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
          <button onClick={() => void handleConfirm()} disabled={busy} className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
            {busy ? 'Working…' : restoring ? 'Restore' : 'Archive'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Platform Settings (branding/plans) has no backend at all — building one is
// real net-new scope beyond issue #252. This is an explicit "not available
// yet" state rather than a form that posts nowhere.
export function AdminSettingsScreen() {
  return (
    <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Platform Config</div>
      <div className="farm-card" style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
          <Lock size={22} color="var(--text-muted)" />
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Not available yet</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Platform branding and plan/package configuration have no backend yet.
          This tab will come online once that admin-settings service exists.
        </div>
      </div>
    </div>
  );
}
