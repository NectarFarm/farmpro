'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { useNav, TopNav } from './navigation';
import { Building2, Users, ChevronRight, AlertTriangle, Lock } from './icons';
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
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      {[['Users', t.users], ['Farms', t.farms]].map(([k, v]) => (
                        <div key={k as string} style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{v as number}</div>
                          <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>{k as string}</div>
                        </div>
                      ))}
                    </div>
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
