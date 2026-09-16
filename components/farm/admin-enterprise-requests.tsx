'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { useNav, TopNav } from './navigation';
import {
  Check, X, Clock, AlertTriangle, CheckCircle2, Mail, UserSingle as User,
  Building2, Sprout, HelpCircle,
} from './icons';
import { ENTERPRISE_REGISTRY } from './data';
import { apiClient } from '@/lib/request';

// ── Admin enterprise-requests queue (worker-assignment/enterprise-requests
// tasks — the "an enterprise request nobody can approve" gap) ──────────────
// GET /api/admin/enterprise-requests and PATCH /api/admin/enterprise-requests/
// [id] have existed since the tenant-enterprises feature shipped (see
// components/farm/crops.tsx's EnterpriseSelector, which POSTs the request
// this screen decides on) — both super_admin-gated, both already audited and
// idempotent server-side. `grep -rl "enterprise-requests" components/` found
// nothing before this file: a farm owner could file a request and it would
// notify super_admins by email, but there was no screen anywhere that could
// act on it — only a curl command could grant or refuse it. This screen is
// that missing half, not a new capability: everything it does, the two
// routes already did.
interface ApiEnterpriseRequest {
  id: string;
  tenantId: string;
  tenantName: string | null;
  enterprise: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | string;
  requestedByName: string | null;
  requestedByEmail: string | null;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Enterprise keys are free-form (see db/schemas/enterprises.ts's header) —
// ENTERPRISE_REGISTRY is the known-key lookup for an icon/label; an unknown
// key (a future enterprise type added before the registry catches up) still
// renders honestly with the raw key and a generic icon rather than crashing
// or hiding the row.
function enterpriseDisplay(key: string): { label: string; Icon: typeof Sprout } {
  const cfg = ENTERPRISE_REGISTRY.find((e) => e.subtype === key);
  return cfg ? { label: cfg.label, Icon: cfg.icon } : { label: key, Icon: HelpCircle };
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  pending:  { color: 'var(--status-warning)', bg: 'rgba(251,191,36,0.1)', label: 'Pending' },
  approved: { color: 'var(--status-ok)', bg: 'rgba(74,222,128,0.08)', label: 'Approved' },
  rejected: { color: 'var(--status-critical)', bg: 'rgba(248,113,113,0.08)', label: 'Rejected' },
};

function RequestDecisionSheet({
  req,
  onClose,
  onDecided,
}: {
  req: ApiEnterpriseRequest;
  onClose: () => void;
  onDecided: (updated: ApiEnterpriseRequest) => void;
}) {
  const [note, setNote] = useState(req.decisionNote || '');
  const [saving, setSaving] = useState<'approved' | 'rejected' | null>(null);
  const [actionError, setActionError] = useState('');
  const s = STATUS_CONFIG[req.status] ?? STATUS_CONFIG.pending;
  const { label, Icon } = enterpriseDisplay(req.enterprise);
  const isPending = req.status === 'pending';

  async function decide(status: 'approved' | 'rejected') {
    setSaving(status);
    setActionError('');
    // Guarded server-side on status='pending' IN THE UPDATE (see PATCH
    // /api/admin/enterprise-requests/[id]) — two admins deciding the same
    // request at once means the loser gets a real 409 back here, not a
    // silent double-grant. That message is shown verbatim rather than a
    // generic "failed" string, because it tells the admin exactly what
    // happened and that their own tap did NOT apply.
    const res = await apiClient.patch<ApiEnterpriseRequest>(`/api/admin/enterprise-requests/${req.id}`, {
      status,
      decisionNote: note.trim(),
    });
    setSaving(null);
    if (!res.success) {
      setActionError(res.error || `Failed to ${status === 'approved' ? 'approve' : 'reject'} this request.`);
      return;
    }
    onDecided(res.data);
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '22px 22px 0 0', width: '100%', maxHeight: '88%', overflowY: 'auto', border: '1px solid var(--border-subtle)', padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700 }}>{req.tenantName || 'Unknown tenant'}</div>
            <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, padding: '3px 9px', borderRadius: 100, background: s.bg, color: s.color, border: `1px solid ${s.color}40` }}>{s.label.toUpperCase()}</span>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Requested Enterprise</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon size={28} color="var(--primary-green)" aria-hidden="true" />
            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)' }}>{label}</div>
          </div>
        </div>

        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Requested By</div>
          {[
            { icon: <User size={13} />, label: 'Name', value: req.requestedByName || '—' },
            { icon: <Mail size={13} />, label: 'Email', value: req.requestedByEmail || '—' },
          ].map((row) => (
            <div key={row.label} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
              <div style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{row.icon}</div>
              <div>
                <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{row.label}</div>
                <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', fontWeight: 500 }}>{row.value}</div>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            <Clock size={12} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Requested: {formatWhen(req.createdAt)}</span>
          </div>
        </div>

        {req.reason && (
          <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="section-eyebrow" style={{ marginBottom: 8 }}>Reason Given</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{req.reason}</div>
          </div>
        )}

        {!isPending && (
          <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="section-eyebrow" style={{ marginBottom: 8 }}>Decision</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginBottom: 6 }}>
              {s.label} {formatWhen(req.decidedAt)}
            </div>
            {req.decisionNote && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5, fontStyle: 'italic' }}>&ldquo;{req.decisionNote}&rdquo;</div>
            )}
          </div>
        )}

        {isPending && (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                Note to the farm (optional)
              </label>
              {/* This is not an internal admin note — a rejection's decisionNote
                 is sent straight to the requester (see PATCH's notification
                 body), so the label says who reads it rather than leaving that
                 as a surprise once "Reject" is tapped. */}
              <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginBottom: 6, lineHeight: 1.5 }}>
                Whatever you type here is shown to the person who asked for this, in-app and by email.
              </div>
              <textarea
                className="farm-input"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Approved — let us know once the first batch is in."
                style={{ resize: 'none' }}
              />
            </div>

            {actionError && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10 }}>{actionError}</div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                disabled={saving !== null}
                onClick={() => void decide('approved')}
                style={{ flex: 1, padding: 11, borderRadius: 12, fontSize: 'var(--fs-base)', fontWeight: 700, background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.35)', color: 'var(--status-ok)', cursor: saving !== null ? 'default' : 'pointer', opacity: saving !== null ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <Check size={14} /> {saving === 'approved' ? 'Approving…' : 'Approve'}
              </button>
              <button
                disabled={saving !== null}
                onClick={() => void decide('rejected')}
                style={{ flex: 1, padding: 11, borderRadius: 12, fontSize: 'var(--fs-base)', fontWeight: 700, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: 'var(--status-critical)', cursor: saving !== null ? 'default' : 'pointer', opacity: saving !== null ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <X size={14} /> {saving === 'rejected' ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function AdminEnterpriseRequestsScreen() {
  const { navigate } = useNav();
  const [requests, setRequests] = useState<ApiEnterpriseRequest[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [selected, setSelected] = useState<ApiEnterpriseRequest | null>(null);

  // Fetched once as `status=all` and filtered client-side (same shape as
  // AdminOnboardingScreen) — the summary counts below need every status in
  // hand at once, not just whichever one the filter chip currently shows.
  const load = useCallback(async () => {
    const res = await apiClient.get<ApiEnterpriseRequest[]>('/api/admin/enterprise-requests?status=all');
    if (res.success) { setRequests(res.data); setLoadError(''); }
    else setLoadError(res.error || 'Failed to load enterprise requests.');
  }, []);

  useEffect(() => { load(); }, [load]);

  const loading = requests === null && !loadError;
  const all = requests ?? [];
  const pendingCount = all.filter((r) => r.status === 'pending').length;
  const filtered = filter === 'all' ? all : all.filter((r) => r.status === filter);

  // A decision (or a load that discovers the row moved under us — the 409
  // paths below) replaces just that row in place rather than a full reload,
  // so the list doesn't jump/flicker mid-review.
  function applyDecision(updated: ApiEnterpriseRequest) {
    setRequests((rs) => (rs ? rs.map((r) => (r.id === updated.id ? updated : r)) : rs));
    setSelected(null);
  }

  return (
    <div className="screen-content">
      <TopNav
        title="Enterprise Requests"
        subtitle={loading ? 'Loading…' : `${pendingCount} pending review`}
      />

      <div className="px-screen" style={{ paddingTop: 12 }}>
        {loadError && (
          <div className="farm-card" style={{ padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={16} color="var(--status-critical)" />
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)' }}>{loadError}</span>
          </div>
        )}
        {loading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 'var(--fs-base)' }}>Loading requests…</div>
        )}

        {!loading && !loadError && (
          <>
            {/* This queue is a widen-scope request, not a new tenant — the
               onboarding queue (new farms) has its own screen; a link back
               keeps an admin from thinking they've landed in the wrong
               "Requests" list. */}
            <button
              className="farm-card"
              onClick={() => navigate('admin-onboarding')}
              style={{ width: '100%', textAlign: 'left', padding: 12, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', fontWeight: 600 }}>Looking for new-tenant applications? That&apos;s the Onboarding queue</span>
              <Building2 size={14} color="var(--text-muted)" />
            </button>

            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {[
                { label: 'Pending', value: all.filter((r) => r.status === 'pending').length, color: 'var(--status-warning)', bg: 'rgba(251,191,36,0.1)' },
                { label: 'Approved', value: all.filter((r) => r.status === 'approved').length, color: 'var(--status-ok)', bg: 'rgba(74,222,128,0.08)' },
                { label: 'Rejected', value: all.filter((r) => r.status === 'rejected').length, color: 'var(--status-critical)', bg: 'rgba(248,113,113,0.08)' },
              ].map((s) => (
                <div key={s.label} style={{ flex: 1, background: s.bg, borderRadius: 12, padding: 10, textAlign: 'center', border: `1px solid ${s.color}30` }}>
                  <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div className="chip-row" style={{ marginBottom: 14 }}>
              {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`filter-chip ${filter === f ? 'active' : ''}`} style={{ textTransform: 'capitalize' }}>
                  {f === 'all' ? 'All' : f}
                  {f === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 80 }}>
              {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                  <CheckCircle2 size={32} style={{ marginBottom: 10, opacity: 0.4 }} />
                  <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>No {filter === 'all' ? '' : filter} requests</div>
                </div>
              ) : (
                filtered.map((req) => {
                  const s = STATUS_CONFIG[req.status] ?? STATUS_CONFIG.pending;
                  const { label, Icon } = enterpriseDisplay(req.enterprise);
                  return (
                    <button
                      key={req.id}
                      onClick={() => setSelected(req)}
                      className="farm-card"
                      style={{ padding: 14, width: '100%', textAlign: 'left', cursor: 'pointer', border: req.status === 'pending' ? '1px solid rgba(251,191,36,0.25)' : '1px solid var(--border-subtle)' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                          <Icon size={22} color="var(--text-primary)" aria-hidden="true" style={{ flexShrink: 0 }} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)' }}>{req.tenantName || 'Unknown tenant'}</div>
                            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>wants {label}</div>
                          </div>
                        </div>
                        <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, padding: '3px 9px', borderRadius: 100, background: s.bg, color: s.color, border: `1px solid ${s.color}40`, flexShrink: 0 }}>{s.label.toUpperCase()}</span>
                      </div>
                      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                        <User size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                        {req.requestedByName || 'Unknown requester'} · {formatWhen(req.createdAt)}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {selected && (
        <RequestDecisionSheet
          req={selected}
          onClose={() => setSelected(null)}
          onDecided={applyDecision}
        />
      )}
    </div>
  );
}
