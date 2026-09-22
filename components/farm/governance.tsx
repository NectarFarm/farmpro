'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNav, TopNav } from './navigation';
import {
  Shield, ShieldCheck, Check, X, Plus,
  AlertTriangle, CheckCircle2, Edit2, Trash2,
  Eye, EyeOff, ChevronDown, ChevronUp,
  Activity, Search, Download, Users, ClipboardList,
} from './icons';
import { apiClient } from '@/lib/request';
import { useToast } from './ui-shared';
import { cn } from '@/lib/utils';
import { PageHeader, Kpi } from '@/components/ui-kit/page-header';
import { Segmented, Chips } from '@/components/ui-kit/segmented';
import { Badge } from '@/components/ui-kit/badge';
import { Avatar } from '@/components/ui-kit/avatar';
import { Button } from '@/components/ui-kit/button';
import { Input } from '@/components/ui-kit/input';
import { EmptyState } from '@/components/ui-kit/empty-state';
import { Sheet, SheetTitle } from '@/components/ui-kit/sheet';
import { Kv } from '@/components/ui-kit/inspector';
import type { ReportPayload } from '@/lib/report-types';
import { downloadReportCsv, downloadReportPdf, type ExportOptions } from '@/lib/report-export';
import { periodDateRange } from '@/lib/period-range';

// ── Governance screen, redesigned onto the reference (ui/governance-
// reference-redesign) but wired to the exact same backend as before:
// /api/approvals, /api/role-permissions and /api/audit-log. This section
// documents what maps to what; the "keep every API call exactly as it is"
// rule from the redesign brief holds throughout — nothing below changes a
// request URL, payload shape, or a permission check. One read-only ADD: a
// GET /api/employees fetch (already used elsewhere, e.g. components/farm/
// people.tsx) powers the reference's "People on roles" tile and the Roles
// tab's member chips with real headcounts — both are new UI, and inventing
// their numbers instead of fetching them would be exactly the fake-data
// failure mode this codebase's other screens go out of their way to avoid.
//
// ── Layout: page header + 4 stat tiles + a 3-segment tab bar ──
// PageHeader (ui-kit) renders the eyebrow/serif-title/lede/actions block;
// Segmented (ui-kit) is the Approvals / Roles & rules / Audit trail switcher,
// each segment carrying a one-line description like the reference. Both are
// pure presentation — the tab state (`tab`) and every count they show are the
// same state this screen has always computed.
//
// ── Approvals tab: master–detail ──
// GET /api/approvals + POST /api/approvals/[id]/approve|reject (issue #243).
// Left: filter pills (Queue/Approved/Rejected/All) + a row per request.
// Right (desktop) / below (mobile, same reference layout — this tab has no
// separate mobile sheet, the reference stacks list-then-detail in one column
// under `lg:`): the selected request's full detail, which now shows the
// underlying record's fields (mortality count, variance reason, photo — via
// GET /api/records) INLINE rather than behind a second "Review & decide" tap.
// That extra tap existed only to force loading the full record before a
// decision could be made; a master–detail selection already does that the
// moment a row is picked, so the information guarantee is unchanged — only
// the number of taps to reach it is.
// The mock had a 3rd "Hold" outcome — the real `approval_requests.status`
// column only ever holds pending|approved|rejected (db/schemas/governance.ts),
// so Hold stays dropped.
//
// ── Roles & rules tab: master–detail ──
// GET/PUT /api/role-permissions (issue #243) is a real per-tenant, per-(role,
// module) config store — an owner's PUT replaces the tenant's whole matrix in
// one transaction. Left: a role card per configured role (name + real member
// count from GET /api/employees). Right: the role's header (name, description
// stays generic since the backend has none, member chips) and a permission
// matrix. The reference's matrix has Create/Read/Update/Delete/Approve
// columns; our backend only has Hidden/View/Edit + a separate approval-
// required flag per module, so the matrix here has three real columns
// (View/Edit/Approval) instead of inventing two the API can't answer for.
// Feature-permission editing (Hidden/View/Edit cycle) and per-module
// "requires approval" both still map directly onto real columns (`access`,
// `approval_required`) through RoleBuilderSheet, unchanged.
//
// ── Audit trail tab: master–detail ──
// GET /api/audit-log — tenant-scoped, newest-first, paginated. Search box +
// role filter chips (issue #302) + entity filter chips, entries grouped by
// day. Selecting one shows: the action key, actor/role/timestamp, a plain
// key/value dump of any record fields carried in `meta`, a "What changed"
// diff — rendered ONLY when `meta.changes` is the `{field: {old, new}}` shape
// several routes already write (lib/audit.ts's writer; see e.g. PATCH
// /api/farms/[id], PATCH /api/employees/[id], PUT /api/role-permissions) —
// and "Same burst": other loaded entries sharing the same `entityId`, i.e.
// derived from data already on the client, never a second fetch.
//
// ── Summary strip ──
// "Waiting on you" / "Approved — this season" come from the already-loaded
// `approvals` state (season = the current quarter, lib/period-range.ts's
// periodDateRange('quarter') — the same "quarter" this app already calls a
// budget period elsewhere; there is no dedicated farm "season" concept to
// borrow instead). "People on roles" is the new GET /api/employees count.
// "Approval rules" is unchanged: sum of `approvalRequired.length` across
// every loaded role (GET /api/role-permissions groups those rows onto
// `RoleMatrixEntry.approvalRequired`, one entry per true row).
//
// ── Export trail ──
// Client-side only, no new backend route (per the redesign brief: an export
// must be a designed document, not a bare CSV). Builds a `ReportPayload` from
// the currently-loaded/filtered audit entries and reuses lib/report-export.ts
// — the SAME masthead/banner/table/footer renderer components/farm/reports.tsx
// already uses for every other export in this app — so "Export trail"
// produces the same kind of letterhead document as a P&L or mortality report,
// not a plain spreadsheet. CSV is offered too, as a secondary option next to
// it, never as the only format.

/* ── Feature modules (mirrors GET/PUT /api/role-permissions' `module` keys) ── */
const FEATURE_GROUPS = [
  {
    group: 'Operations',
    features: [
      { key: 'feeding', label: 'Feeding Records' },
      { key: 'egg-collection', label: 'Egg Collection' },
      { key: 'milking', label: 'Milking Records' },
      { key: 'mortality', label: 'Mortality Records' },
      { key: 'health', label: 'Health / Vet' },
      { key: 'physical-count', label: 'Physical Count' },
      { key: 'harvest', label: 'Harvest Records' },
    ],
  },
  {
    group: 'Management',
    features: [
      { key: 'tasks', label: 'Task Management' },
      { key: 'inventory', label: 'Inventory / Stock' },
      { key: 'batches', label: 'Batch Management' },
    ],
  },
  {
    group: 'Finance & Admin',
    features: [
      { key: 'finance', label: 'Financial Reports' },
      { key: 'payroll', label: 'Payroll' },
      { key: 'governance', label: 'Governance / Approvals' },
      { key: 'delete-record', label: 'Delete Records' },
    ],
  },
];
const ALL_MODULES = FEATURE_GROUPS.flatMap(g => g.features);

const PERM_COLOR: Record<string, string> = {
  edit: 'var(--status-ok)', view: 'var(--accent-blue)', hidden: 'var(--text-muted)',
};
const PERM_BG: Record<string, string> = {
  edit: 'rgba(var(--primary-rgb),0.12)', view: 'rgba(var(--info-rgb),0.1)', hidden: 'rgba(255,255,255,0.04)',
};
type PermLevel = 'edit' | 'view' | 'hidden';
const ROLE_COLOR: Record<string, string> = {
  owner: 'var(--primary-green)', manager: 'var(--accent-purple)', worker: 'var(--accent-cyan)',
  vet: 'var(--accent-blue)', auditor: 'var(--accent-amber)',
};
const ROLE_FILTERS = ['owner', 'manager', 'worker', 'vet', 'auditor'] as const;

/* ── Real shapes: GET/PUT /api/role-permissions and GET /api/approvals/api/audit-log ── */
interface RoleMatrixEntry {
  role: string;
  permissions: Record<string, PermLevel>;
  approvalRequired: string[];
}
interface ApprovalRequestRow {
  id: string;
  tenantId: string;
  type: string;
  title: string;
  requestedBy: string;
  batchId: string | null;
  entityId: string;
  details: string;
  requestedAt: string;
  status: string;
  priority: string;
  // tasks-scheduling task (migration 0029). `assignedApproverId` is the
  // person the task named; NULL means the old behaviour — anyone with
  // governance rights. `decidedBy`/`decidedAt` let the queue answer "which
  // of these did I sign off?", which the audit log could only answer by
  // being read line by line.
  assignedApproverId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

interface ApproverRow {
  userId: string;
  name: string;
  role: string;
}
interface AuditLogRow {
  id: string;
  actor: string;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  entity: string;
  entityId: string;
  meta: Record<string, unknown> | null;
  at: string;
}
// GET /api/employees — already used by components/farm/people.tsx; only the
// fields this screen actually reads are typed here. `userId` (nullable
// logical link to `users` — db/schemas/people.ts) is what lets this screen
// resolve an approval's `requestedBy` (a users.id) back to a name for
// someone who isn't in the approvers list — a worker who raised a request
// can never approve one, so GET /api/approvals/approvers never carries them.
interface EmployeeRow {
  id: string;
  userId: string | null;
  name: string;
  role: string;
  status: string;
}

// Exported for tests/audit-log-reason.test.ts (issue #309) — pure, so it's
// testable without a component render harness (see
// tests/crops-batch-detail-ui.test.ts's header for why this repo tests UI
// logic this way).
export function auditReason(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null;
  const reason = meta.reason;
  return typeof reason === 'string' && reason.trim().length > 0 ? reason : null;
}

// The "What changed" diff — present ONLY when `meta.changes` is the
// `{ field: { old, new } }` shape lib/audit.ts's callers write (PATCH
// /api/farms/[id], PATCH /api/employees/[id], PUT /api/role-permissions and
// others). Approval decisions and record-creation audit rows don't carry
// this shape, and correctly render no diff section at all — degrading
// honestly instead of inventing a before/after out of unrelated meta keys.
export function auditChanges(meta: Record<string, unknown> | null): [string, { old: unknown; new: unknown }][] | null {
  if (!meta) return null;
  const changes = meta.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return null;
  const entries = Object.entries(changes as Record<string, unknown>).filter(
    (entry): entry is [string, { old: unknown; new: unknown }] => {
      const v = entry[1];
      return !!v && typeof v === 'object' && 'old' in v && 'new' in v;
    },
  );
  return entries.length > 0 ? entries : null;
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return iso;
  const diffMs = Date.now() - d;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

function actionIcon(action: string): { icon: React.ReactNode; bg: string } {
  if (action.endsWith('.approved')) return { icon: <Check size={13} color="var(--status-ok)" />, bg: 'rgba(var(--primary-rgb),0.15)' };
  if (action.endsWith('.rejected')) return { icon: <X size={13} color="var(--status-critical)" />, bg: 'rgba(var(--critical-rgb),0.12)' };
  return { icon: <Shield size={13} color="var(--accent-purple)" />, bg: 'rgba(168,85,247,0.1)' };
}

/* ── Role Builder Sheet ── */
function RoleBuilderSheet({
  role, existingRoles, onClose, onSave,
}: {
  role: RoleMatrixEntry | null; existingRoles: string[]; onClose: () => void; onSave: (r: RoleMatrixEntry) => Promise<boolean>;
}) {
  const isNew = role === null;
  const defaultPerms: Record<string, PermLevel> = {};
  ALL_MODULES.forEach(f => { defaultPerms[f.key] = 'hidden'; });

  const [name, setName] = useState(role?.role ?? '');
  const [perms, setPerms] = useState<Record<string, PermLevel>>(role?.permissions ?? defaultPerms);
  const [approvals, setApprovals] = useState<string[]>(role?.approvalRequired ?? []);
  const [expandedGroup, setExpandedGroup] = useState<string | null>('Operations');
  const [nameError, setNameError] = useState('');
  const [saving, setSaving] = useState(false);

  function cyclePermission(key: string) {
    const cycle: PermLevel[] = ['hidden', 'view', 'edit'];
    const cur = perms[key] ?? 'hidden';
    setPerms(p => ({ ...p, [key]: cycle[(cycle.indexOf(cur) + 1) % 3] }));
  }
  function toggleApproval(key: string) {
    setApprovals(a => a.includes(key) ? a.filter(x => x !== key) : [...a, key]);
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) { setNameError('Role name is required'); return; }
    if (isNew && existingRoles.includes(trimmed)) { setNameError('A role with this name already exists'); return; }
    setSaving(true);
    const ok = await onSave({ role: trimmed, permissions: perms, approvalRequired: approvals });
    setSaving(false);
    if (!ok) setNameError('Could not save — please try again');
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} side="bottom" className="rounded-t-2xl max-h-[92vh]">
      <SheetTitle className="sr-only">{isNew ? 'Create role' : `Edit ${role?.role}`}</SheetTitle>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mb-4 flex items-center justify-between">
          <div className="font-display text-xl font-medium">{isNew ? 'Create Role' : `Edit: ${role?.role}`}</div>
        </div>

        <label className="mb-4 grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted">Role Name *</span>
          <Input value={name} onChange={e => { setName(e.target.value); setNameError(''); }} placeholder="e.g. night_watchman, harvest_lead…" disabled={!isNew} />
          {nameError && <div className="mt-1 flex items-center gap-1.5 text-xs text-danger"><AlertTriangle size={11} aria-hidden="true" /> {nameError}</div>}
        </label>

        <div className="mb-2.5 text-xs font-medium tracking-wide text-subtle uppercase">
          Feature Permissions <span className="normal-case text-subtle/80">— tap to cycle: Hidden → View → Edit</span>
        </div>

        {FEATURE_GROUPS.map(g => (
          <div key={g.group} className="mb-2">
            <button type="button" onClick={() => setExpandedGroup(expandedGroup === g.group ? null : g.group)}
              className="flex w-full items-center justify-between rounded-lg bg-surface-2 px-3 py-2.5 text-left shadow-(--shadow-border)">
              <span className="text-sm font-medium">{g.group}</span>
              {expandedGroup === g.group ? <ChevronUp size={14} className="text-subtle" /> : <ChevronDown size={14} className="text-subtle" />}
            </button>
            {expandedGroup === g.group && (
              <div className="mt-1 overflow-hidden rounded-lg border border-border">
                {g.features.map((f, i) => {
                  const perm = perms[f.key] ?? 'hidden';
                  return (
                    <div key={f.key}
                      className={cn('flex cursor-pointer items-center justify-between px-3 py-2.5', i < g.features.length - 1 && 'border-b border-border')}
                      style={{ background: PERM_BG[perm] }}
                      onClick={() => cyclePermission(f.key)}>
                      <span className="text-sm text-fg">{f.label}</span>
                      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase" style={{ background: PERM_BG[perm], color: PERM_COLOR[perm], border: `1px solid ${PERM_COLOR[perm]}40` }}>
                        {perm === 'hidden' ? <EyeOff size={10} /> : perm === 'view' ? <Eye size={10} /> : <Edit2 size={10} />}
                        {perm}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        <div className="mt-4 mb-2.5 text-xs font-medium tracking-wide text-subtle uppercase">
          Modules Requiring Owner Approval
        </div>
        <div className="mb-6 flex flex-wrap gap-1.5">
          {ALL_MODULES.map(f => {
            const active = approvals.includes(f.key);
            return (
              <button type="button" key={f.key} onClick={() => toggleApproval(f.key)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-bold',
                  active ? 'bg-warning-soft text-warning' : 'bg-surface-2 text-muted',
                )}>
                {active && <Check size={10} className="mr-1 inline align-middle" />}
                {f.label}
              </button>
            );
          })}
        </div>

        <Button className="mb-2 w-full justify-center" onClick={handleSave} disabled={saving}>
          <Check size={14} /> {saving ? 'Saving…' : isNew ? 'Create Role' : 'Save Changes'}
        </Button>
      </div>
    </Sheet>
  );
}

/* ── Main screen ── */
export function GovernanceScreen() {
  const { tenantId, role: sessionRole, activeFarmId, farms, refreshBadges } = useNav();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'approvals' | 'roles' | 'audit'>('approvals');
  const canEditRoles = sessionRole === 'owner';

  const [approvals, setApprovals] = useState<ApprovalRequestRow[] | null>(null);
  const [roles, setRoles] = useState<RoleMatrixEntry[] | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogRow[] | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loadError, setLoadError] = useState('');

  const [editRole, setEditRole] = useState<RoleMatrixEntry | null | 'new' | undefined>(undefined);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [deleteRoleConfirm, setDeleteRoleConfirm] = useState<string | null>(null);
  const [approvalFilter, setApprovalFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(null);
  const [activitySearch, setActivitySearch] = useState('');
  const [activityRoleFilter, setActivityRoleFilter] = useState('all');
  const [activityEntityFilter, setActivityEntityFilter] = useState('all');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [mobileEventOpen, setMobileEventOpen] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [approvers, setApprovers] = useState<ApproverRow[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  // Tenant identity/formatting for the "Export trail" document — same
  // GET /api/settings + active-farm-from-nav pattern components/farm/
  // reports.tsx already uses, so the exported trail carries the same
  // masthead identity a P&L or mortality export would.
  const [exportOpts, setExportOpts] = useState<ExportOptions>({});
  const [orgName, setOrgName] = useState('');
  useEffect(() => {
    let cancelled = false;
    apiClient.get<{ accentColor?: string; currencySymbol?: string; weightUnit?: string; orgName?: string }>(`/api/settings?tenantId=${tenantId}`).then(res => {
      if (!cancelled && res.success) {
        setExportOpts(prev => ({ ...prev, accentColor: res.data.accentColor || undefined }));
        setOrgName(res.data.orgName || '');
      }
    });
    return () => { cancelled = true; };
  }, [tenantId]);
  const activeFarm = activeFarmId === 'ALL' ? undefined : farms.find(f => f.id === activeFarmId);
  const fullExportOpts: ExportOptions = {
    ...exportOpts,
    farmName: activeFarm?.name || orgName || undefined,
    farmCode: activeFarm?.code,
    location: activeFarm?.location,
    preparedFor: sessionRole.charAt(0).toUpperCase() + sessionRole.slice(1).replace('_', ' '),
  };

  // Scoping, not decoration: anyone other than the owner is sent only the
  // requests that are actually theirs — named on them, or unassigned and so
  // open to whoever can approve. A manager seeing another manager's queue,
  // and being able to sign it off, is exactly what naming an approver is
  // meant to stop. The owner still sees everything, because they are the one
  // who has to unblock a queue when an approver is unavailable.
  const scopeParam = sessionRole === 'owner' ? '' : '&scope=mine';
  // farmId is included so this queue can never disagree with the nav
  // Approvals badge (components/farm/navigation.tsx's badge effect), which
  // is farm-scoped the same way. GET /api/approvals treats farmId=ALL (or
  // absent) as unfiltered, so this is a no-op while "All Farms" is active.
  const loadApprovals = useCallback(async () => {
    const res = await apiClient.get<ApprovalRequestRow[]>(`/api/approvals?tenantId=${tenantId}&farmId=${activeFarmId}${scopeParam}`);
    if (res.success) setApprovals(res.data);
    else setLoadError(res.error ?? 'Could not load approvals');
  }, [tenantId, activeFarmId, scopeParam]);

  const loadRoles = useCallback(async () => {
    const res = await apiClient.get<RoleMatrixEntry[]>(`/api/role-permissions?tenantId=${tenantId}`);
    if (res.success) setRoles(res.data);
    else setLoadError(res.error ?? 'Could not load role permissions');
  }, [tenantId]);

  const loadAuditLog = useCallback(async () => {
    const res = await apiClient.get<AuditLogRow[]>(`/api/audit-log?tenantId=${tenantId}&limit=100`);
    if (res.success) setAuditLog(res.data);
    else setLoadError(res.error ?? 'Could not load activity log');
  }, [tenantId]);

  useEffect(() => { loadApprovals(); }, [loadApprovals]);
  useEffect(() => {
    apiClient.get<ApproverRow[]>(`/api/approvals/approvers?tenantId=${tenantId}`).then((res) => {
      if (res.success) setApprovers(res.data);
    });
    // Who am I — needed to tell "waiting on me" from "waiting on Grace".
    apiClient.get<{ id: string }>('/api/auth/session').then((res) => {
      if (res.success) setMyUserId(res.data.id);
    });
    // "People on roles" tile + Roles tab member chips (new UI — see header
    // comment), AND requester/approver name resolution below. Read-only,
    // already-existing endpoint; no write path here. Kept unfiltered by
    // status here — a departed employee still needs to resolve to a real
    // name on an old approval/audit row; the ACTIVE-only view used for
    // headcounts is `activeEmployees` below.
    apiClient.get<EmployeeRow[]>(`/api/employees?tenantId=${tenantId}`).then((res) => {
      if (res.success) setEmployees(res.data);
    });
  }, [tenantId]);
  useEffect(() => { loadRoles(); }, [loadRoles]);
  useEffect(() => { loadAuditLog(); }, [loadAuditLog]);

  async function decide(a: ApprovalRequestRow, decision: 'approve' | 'reject') {
    setDecidingId(a.id);
    const res = await apiClient.post(`/api/approvals/${a.id}/${decision}?tenantId=${tenantId}`, {});
    setDecidingId(null);
    if (!res.success) { showToast(res.error ?? `Could not ${decision} request`, 'error'); return; }
    showToast(decision === 'approve' ? 'Approved' : 'Rejected', decision === 'approve' ? 'success' : 'error');
    await Promise.all([loadApprovals(), loadAuditLog()]);
    // Same fix as marking a notification read (dashboard.tsx's
    // NotificationsScreen): without this, the nav Approvals badge keeps
    // showing the pre-decision count until something else happens to
    // force a refetch (e.g. a farm switch).
    refreshBadges();
  }

  async function persistRoles(next: RoleMatrixEntry[]): Promise<boolean> {
    const res = await apiClient.put<RoleMatrixEntry[]>('/api/role-permissions', { roles: next });
    if (!res.success) { showToast(res.error ?? 'Could not save role permissions', 'error'); return false; }
    setRoles(res.data);
    return true;
  }

  async function saveRole(r: RoleMatrixEntry) {
    const current = roles ?? [];
    const idx = current.findIndex(x => x.role === r.role);
    const next = idx >= 0 ? current.map((x, i) => i === idx ? r : x) : [...current, r];
    const ok = await persistRoles(next);
    if (ok) {
      showToast(`Role "${r.role}" ${idx >= 0 ? 'updated' : 'created'}`, 'success');
      setEditRole(undefined);
      await loadAuditLog();
    }
    return ok;
  }

  async function deleteRole(roleName: string) {
    const current = roles ?? [];
    const next = current.filter(x => x.role !== roleName);
    const ok = await persistRoles(next);
    setDeleteRoleConfirm(null);
    if (ok) {
      showToast(`Role "${roleName}" deleted`, 'warning');
      if (selectedRole === roleName) setSelectedRole(null);
      await loadAuditLog();
    }
  }

  // ACTIVE-only view for headcounts (roles tab counts, member chips, the
  // "People on roles" tile) — `employees` itself stays unfiltered so name
  // resolution below can still find someone who has since left.
  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'ACTIVE'), [employees]);

  const pending = (approvals ?? []).filter(a => a.status === 'pending').length;
  // "Approved — This season": the current quarter, computed from the
  // approvals data already fetched (see header comment for why "quarter").
  const seasonRange = useMemo(() => periodDateRange('quarter'), []);
  const approvedThisSeason = (approvals ?? []).filter(a =>
    a.status === 'approved' && !!a.decidedAt && a.decidedAt.slice(0, 10) >= seasonRange.from && a.decidedAt.slice(0, 10) <= seasonRange.to,
  ).length;
  const peopleOnRoles = activeEmployees.length;

  // Resolves a users.id to a display name against every person this screen
  // actually has loaded: the approvers list first (it already carries the
  // role), then the full employees list (unfiltered by status — see the
  // fetch comment above) matched on `employees.userId`, since a requester
  // who can't approve — any worker — is never in the approvers list at all.
  // Only when NEITHER resolves the id does this say the person is gone; that
  // used to be the approvers list's only possible answer for anyone who
  // wasn't an approver, worker included.
  const approverName = useCallback((userId: string | null) => {
    if (!userId) return null;
    if (userId === myUserId) return 'you';
    const approver = approvers.find((p) => p.userId === userId);
    if (approver) return approver.name;
    const employee = employees.find((e) => e.userId === userId);
    if (employee) return employee.name;
    return 'someone no longer on this farm';
  }, [approvers, employees, myUserId]);
  // `requestedBy` is a raw user id (approval_requests.requestedBy —
  // db/schemas/governance.ts), not a display name — resolved the same way.
  const requesterName = useCallback((userId: string) => approverName(userId) ?? 'a worker on this farm', [approverName]);
  const requesterInitials = useCallback((userId: string) => {
    const resolved = approverName(userId);
    return resolved && resolved !== 'you' ? resolved : '?';
  }, [approverName]);

  // Can I actually decide this one? Mirrors approverCanDecide in
  // lib/governance.ts — the server is still the authority, this only decides
  // whether to offer a button that would be refused.
  const canDecide = useCallback((a: ApprovalRequestRow) => {
    if (!a.assignedApproverId) return true;
    if (a.assignedApproverId === myUserId) return true;
    return sessionRole === 'owner';
  }, [myUserId, sessionRole]);

  const approvalCounts = useMemo(() => {
    const rows = approvals ?? [];
    return {
      pending: rows.filter(a => a.status === 'pending').length,
      approved: rows.filter(a => a.status === 'approved').length,
      rejected: rows.filter(a => a.status === 'rejected').length,
      all: rows.length,
    };
  }, [approvals]);
  const filteredApprovals = useMemo(() => {
    const rows = approvals ?? [];
    // Pending-first within a filter, same as the reference — the thing that
    // needs a signature belongs above things that already have one.
    const sorted = [...rows].sort((a, b) => {
      const order: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };
      return (order[a.status] ?? 3) - (order[b.status] ?? 3) || b.requestedAt.localeCompare(a.requestedAt);
    });
    return approvalFilter === 'all' ? sorted : sorted.filter(a => a.status === approvalFilter);
  }, [approvals, approvalFilter]);
  const selectedApproval = filteredApprovals.find(a => a.id === selectedApprovalId) ?? filteredApprovals[0] ?? null;

  // Sum of every role's approvalRequired list = count of the tenant's real
  // role_permissions rows with approval_required = true (see header comment).
  const crudRulesCount = (roles ?? []).reduce((sum, r) => sum + r.approvalRequired.length, 0);
  const selectedRoleEntry = (roles ?? []).find(r => r.role === selectedRole) ?? (roles ?? [])[0] ?? null;

  const filteredActivity = useMemo(() => {
    let entries = auditLog ?? [];
    if (activityRoleFilter !== 'all') entries = entries.filter(e => e.actorRole === activityRoleFilter);
    if (activityEntityFilter !== 'all') entries = entries.filter(e => e.entity === activityEntityFilter);
    if (activitySearch.trim()) {
      const q = activitySearch.trim().toLowerCase();
      entries = entries.filter(e =>
        e.action.toLowerCase().includes(q) ||
        e.entity.toLowerCase().includes(q) ||
        e.entityId.toLowerCase().includes(q) ||
        (e.actorName ?? '').toLowerCase().includes(q)
      );
    }
    return entries;
  }, [auditLog, activityRoleFilter, activityEntityFilter, activitySearch]);
  const activityEntities = useMemo(() => {
    const set = new Set((auditLog ?? []).map(e => e.entity));
    return Array.from(set).sort();
  }, [auditLog]);
  const activityGroups = useMemo(() => {
    const byDay = new Map<string, AuditLogRow[]>();
    for (const e of filteredActivity) {
      const key = dayKey(e.at);
      const list = byDay.get(key) ?? [];
      list.push(e);
      byDay.set(key, list);
    }
    return Array.from(byDay.entries());
  }, [filteredActivity]);
  const selectedEvent = filteredActivity.find(e => e.id === selectedEventId) ?? filteredActivity[0] ?? null;
  const sameBurst = useMemo(() => {
    if (!selectedEvent) return [];
    return filteredActivity.filter(e => e.id !== selectedEvent.id && e.entityId === selectedEvent.entityId).slice(0, 8);
  }, [filteredActivity, selectedEvent]);

  function pickEvent(id: string) {
    setSelectedEventId(id);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) setMobileEventOpen(true);
  }

  function handleExportTrail(format: 'pdf' | 'csv') {
    const rows = filteredActivity;
    const dates = rows.map(r => r.at.slice(0, 10)).sort();
    const report: ReportPayload = {
      title: 'Audit Trail',
      meta: {
        periodLabel: dates.length ? (dates[0] === dates[dates.length - 1] ? fmtDate(rows[0].at) : `${dates[0]} – ${dates[dates.length - 1]}`) : 'All time',
      },
      columns: ['Timestamp', 'Actor', 'Role', 'Action', 'Entity', 'Entity ID', 'Reason'],
      rows: rows.map(e => [
        fmtTimestamp(e.at), e.actorName ?? e.actorEmail ?? e.actor, e.actorRole ?? '—',
        e.action, e.entity, e.entityId, auditReason(e.meta) ?? '',
      ]),
      headline: [
        { label: 'Entries exported', value: String(rows.length) },
        { label: 'Waiting on you', value: String(pending) },
        { label: 'Approved this season', value: String(approvedThisSeason) },
      ],
      basis: 'Compiled from this tenant’s real audit_log entries currently loaded in the Activity tab, respecting whatever search, role and entity filters are applied.',
      notes: [
        ...(activityRoleFilter !== 'all' ? [`Filtered to role: ${activityRoleFilter}.`] : []),
        ...(activityEntityFilter !== 'all' ? [`Filtered to entity: ${activityEntityFilter}.`] : []),
        ...(activitySearch.trim() ? [`Filtered to entries matching "${activitySearch.trim()}".`] : []),
      ],
    };
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'pdf') {
      downloadReportPdf(report, `audit-trail-${stamp}.pdf`, fullExportOpts);
      showToast('Audit trail exported.', 'success');
    } else {
      downloadReportCsv(report, `audit-trail-${stamp}.csv`, fullExportOpts);
      showToast('CSV downloaded.', 'success');
    }
  }

  return (
    <div className="screen-content">
      <TopNav title="" />
      <div className="px-screen pt-3 pb-10">
        {loadError && (
          <div className="mb-3 flex items-center gap-1.5 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            <AlertTriangle size={13} /> {loadError}
          </div>
        )}

        <PageHeader
          kicker="Company"
          title="Governance"
          lede="Who can do what, what still needs a second look, and a full trail of every change across the group."
          actions={(
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => handleExportTrail('pdf')}>
                <Download size={14} /> Export trail
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleExportTrail('csv')}>CSV</Button>
            </div>
          )}
        />

        <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi
            label="Waiting on you"
            value={pending}
            hint={pending === 0 ? 'Queue is clear' : 'Open the queue'}
            tone={pending > 0 ? 'warn' : 'ok'}
            icon={<ClipboardList size={14} />}
            onClick={() => { setTab('approvals'); setApprovalFilter('pending'); }}
          />
          <Kpi label="Approved" value={approvedThisSeason} hint="This season" icon={<Check size={14} />} onClick={() => setTab('approvals')} />
          <Kpi label="People on roles" value={peopleOnRoles} hint={`${(roles ?? []).length} role${(roles ?? []).length === 1 ? '' : 's'}`} icon={<Users size={14} />} onClick={() => setTab('roles')} />
          <Kpi label="Approval rules" value={crudRulesCount} hint="CRUD gates" icon={<ShieldCheck size={14} />} onClick={() => setTab('roles')} />
        </div>

        <div className="mt-5">
          <Segmented
            value={tab}
            onChange={setTab}
            items={[
              { id: 'approvals', label: 'Approvals', hint: 'What still needs a signature' },
              { id: 'roles', label: 'Roles & rules', hint: 'Who can create, change, or sign' },
              { id: 'audit', label: 'Audit trail', hint: 'Every change, with the diff' },
            ]}
          />
        </div>

        {/* ── APPROVALS TAB ── */}
        {tab === 'approvals' && (
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <div className="rounded-xl bg-surface p-2 shadow-(--shadow-border)">
              <div className="flex gap-1 overflow-x-auto px-1 pt-1 pb-2">
                {([['pending', 'Queue'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']] as const).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setApprovalFilter(id)}
                    className={cn('shrink-0 rounded-md px-2 py-1 text-xs', approvalFilter === id ? 'bg-primary-soft text-primary font-medium' : 'text-muted')}>
                    {label} <span className="ml-1 tabular-nums">{approvalCounts[id]}</span>
                  </button>
                ))}
              </div>
              {approvals === null ? (
                <div className="py-10 text-center text-sm text-muted">Loading approvals…</div>
              ) : filteredApprovals.length === 0 ? (
                <EmptyState icon={<CheckCircle2 size={20} />} title="Nothing waiting" body="New requests that hit a rule will land here for a signature." />
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {filteredApprovals.map((a) => {
                    const active = selectedApproval?.id === a.id;
                    return (
                      <li key={a.id}>
                        <button type="button" onClick={() => setSelectedApprovalId(a.id)}
                          className={cn('flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors', active ? 'bg-primary-soft' : 'hover:bg-surface-2')}>
                          <Avatar name={requesterInitials(a.requestedBy)} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium">{a.title}</span>
                              <Badge variant={a.status === 'pending' ? 'warning' : a.status === 'approved' ? 'success' : 'danger'}>{a.status}</Badge>
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted">
                              {requesterName(a.requestedBy)} · {a.type} · {relativeTime(a.requestedAt)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {selectedApproval ? (
              <ApprovalDetail
                key={selectedApproval.id}
                approval={selectedApproval}
                tenantId={tenantId}
                busy={decidingId === selectedApproval.id}
                approverName={approverName}
                requesterName={requesterName}
                canDecide={canDecide(selectedApproval)}
                isOverride={!!selectedApproval.assignedApproverId && selectedApproval.assignedApproverId !== myUserId}
                onDecide={(decision) => decide(selectedApproval, decision)}
              />
            ) : approvals !== null && (
              <EmptyState icon={<CheckCircle2 size={20} />} title="Nothing selected" body="Pick a request on the left to see its detail." />
            )}
          </div>
        )}

        {/* ── ROLES & RULES TAB ── */}
        {tab === 'roles' && (
          <div className="mt-5 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <ul className="flex gap-1 overflow-x-auto lg:flex-col">
              {roles === null ? (
                <div className="py-6 text-sm text-muted">Loading roles…</div>
              ) : roles.length === 0 ? (
                <div className="py-6 text-sm text-muted">No roles configured yet.</div>
              ) : roles.map((r) => {
                const count = activeEmployees.filter(e => e.role === r.role).length;
                const active = r.role === selectedRoleEntry?.role;
                return (
                  <li key={r.role} className="shrink-0">
                    <button type="button" onClick={() => setSelectedRole(r.role)}
                      className={cn(
                        'flex w-full min-w-40 items-center justify-between gap-3 rounded-xl px-3 py-3 text-left shadow-(--shadow-border) transition-colors lg:min-w-0',
                        active ? 'bg-primary text-primary-fg' : 'bg-surface hover:bg-surface-2',
                      )}>
                      <span>
                        <span className="block text-sm font-medium">{r.role}</span>
                        <span className={cn('block text-xs', active ? 'text-primary-fg/75' : 'text-muted')}>{count} {count === 1 ? 'person' : 'people'}</span>
                      </span>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: active ? 'currentColor' : (ROLE_COLOR[r.role] ?? 'var(--accent-purple)') }} />
                    </button>
                  </li>
                );
              })}
              {canEditRoles && (
                <li className="shrink-0">
                  <button type="button" onClick={() => setEditRole('new')}
                    className="flex min-h-[52px] w-full min-w-40 items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/40 px-3 py-3 text-sm font-medium text-primary lg:min-w-0">
                    <Plus size={14} /> New role
                  </button>
                </li>
              )}
            </ul>

            <div className="flex flex-col gap-4">
              {!canEditRoles && (
                <div className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-xs text-muted">Only an owner can make changes. All role changes are logged in the Audit trail.</div>
              )}
              {selectedRoleEntry ? (
                <RoleDetail
                  entry={selectedRoleEntry}
                  members={activeEmployees.filter(e => e.role === selectedRoleEntry.role)}
                  canEdit={canEditRoles}
                  deleteConfirm={deleteRoleConfirm === selectedRoleEntry.role}
                  onEdit={() => setEditRole(selectedRoleEntry)}
                  onDeleteRequest={() => setDeleteRoleConfirm(selectedRoleEntry.role)}
                  onDeleteCancel={() => setDeleteRoleConfirm(null)}
                  onDeleteConfirm={() => deleteRole(selectedRoleEntry.role)}
                />
              ) : roles !== null && roles.length === 0 && canEditRoles ? (
                <EmptyState icon={<Shield size={20} />} title="No roles yet" body="Create your first role to start assigning permissions." />
              ) : null}
            </div>
          </div>
        )}

        {/* ── AUDIT TRAIL TAB ── */}
        {tab === 'audit' && (
          <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.9fr)]">
            <div className="min-w-0 rounded-xl bg-surface p-3 shadow-(--shadow-border) lg:p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
                <Input value={activitySearch} onChange={(e) => setActivitySearch(e.target.value)} placeholder="Search actions, people, entities…" className="pl-9" aria-label="Search audit trail" />
              </div>
              <div className="mt-3">
                <Chips value={activityRoleFilter} onChange={setActivityRoleFilter} items={[{ id: 'all', label: 'Everyone' }, ...ROLE_FILTERS.map(r => ({ id: r, label: r.charAt(0).toUpperCase() + r.slice(1) }))]} />
              </div>
              {activityEntities.length > 0 && (
                <div className="mt-2">
                  <Chips value={activityEntityFilter} onChange={setActivityEntityFilter} items={[{ id: 'all', label: 'All entities' }, ...activityEntities.map(e => ({ id: e, label: e }))]} />
                </div>
              )}

              <div className="mt-4">
                {auditLog === null ? (
                  <div className="py-10 text-center text-sm text-muted">Loading activity…</div>
                ) : activityGroups.length === 0 ? (
                  <div className="flex flex-col items-center px-2 py-10 text-center">
                    <Activity size={22} className="mb-2 text-subtle" />
                    <p className="text-sm text-muted">No events match those filters.</p>
                  </div>
                ) : activityGroups.map(([day, entries]) => (
                  <section key={day} className="mb-5">
                    <h3 className="sticky top-0 z-10 bg-surface/90 px-2 py-1.5 text-xs font-medium tracking-[0.12em] text-subtle uppercase backdrop-blur-sm">
                      {fmtDate(entries[0].at)}
                    </h3>
                    <ol className="relative ml-3 flex flex-col gap-1 border-l border-border">
                      {entries.map((e) => {
                        const active = selectedEvent?.id === e.id;
                        const { icon } = actionIcon(e.action);
                        return (
                          <li key={e.id} className="relative py-0.5 pl-5">
                            <span className={cn('absolute top-4 -left-1.5 size-3 rounded-full border-2 border-surface', active ? 'bg-primary' : 'bg-border')} />
                            <button type="button" onClick={() => pickEvent(e.id)}
                              className={cn('flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors', active ? 'bg-primary-soft' : 'hover:bg-surface-2')}>
                              <Avatar name={e.actorName ?? e.actorEmail ?? '?'} size="sm" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm">
                                  <span className="font-medium">{e.actorName ?? e.actorEmail ?? 'Someone'}</span>{' '}
                                  <span className="text-muted">{e.action}</span>
                                </span>
                                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-subtle">
                                  <span>{fmtTime(e.at)}</span>
                                  {e.actorRole && <span className="capitalize">{e.actorRole}</span>}
                                  <span>{e.entity}</span>
                                </span>
                              </span>
                              <span className="shrink-0">{icon}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ))}
              </div>
            </div>

            <div className="hidden min-w-0 lg:block">
              {selectedEvent ? (
                <AuditInspector event={selectedEvent} siblings={sameBurst} onPick={pickEvent} />
              ) : (
                <EmptyState icon={<Activity size={20} />} title="No activity yet" body="Changes across the group will appear here as they happen." />
              )}
            </div>

            <Sheet open={mobileEventOpen} onOpenChange={setMobileEventOpen} side="bottom" className="rounded-t-2xl max-h-[85vh]">
              <SheetTitle className="sr-only">Event detail</SheetTitle>
              {selectedEvent && (
                <div className="max-h-[85vh] overflow-y-auto p-5">
                  <AuditInspector event={selectedEvent} siblings={sameBurst} onPick={pickEvent} />
                </div>
              )}
            </Sheet>
          </div>
        )}
      </div>

      {editRole !== undefined && (
        <RoleBuilderSheet
          role={editRole === 'new' ? null : editRole}
          existingRoles={(roles ?? []).map(r => r.role)}
          onClose={() => setEditRole(undefined)}
          onSave={saveRole}
        />
      )}
    </div>
  );
}

/* ── Approvals: detail panel ─────────────────────────────────────────────────
 * The only place an approval can be decided. Loads the underlying record
 * first, because an approval_requests row carries just `data.cause` in
 * `details` while the worker's actual submission — the count, the variance
 * reason, their notes, the photo they were asked for — lives on the record.
 * Selecting a row in the master–detail layout IS the "load the full record
 * before deciding" step now (this used to require a second "Review & decide"
 * tap into a modal — the master–detail layout already shows the full record
 * the moment a row is picked, so the extra tap is gone, not the guarantee).
 *
 * It renders whatever keys the record's `data` blob actually has rather than a
 * fixed field list: `data` is deliberately loose per record type
 * (db/schemas/people.ts), so a hardcoded set would silently hide whatever a
 * future record type puts there — the exact failure this panel exists to fix. */
const DATA_LABELS: Record<string, string> = {
  count: 'Deaths reported', deaths: 'Deaths reported', cause: 'Cause given',
  counted: 'Head counted', varianceReason: 'Reason for the variance',
  notes: 'Worker notes', treatment: 'Treatment given', dose: 'Dose',
  weight: 'Weight (kg)', averageKg: 'Average weight (kg)', sampleSize: 'Samples taken',
};
const HIDDEN_KEYS = new Set(['pendingApproval', 'batchId', 'unitId', 'itemId', 'productId', 'items', 'feedItems', 'samples']);

function ApprovalDetail({ approval, tenantId, busy, onDecide, approverName, requesterName, isOverride, canDecide }: {
  approval: ApprovalRequestRow;
  tenantId: string;
  busy: boolean;
  onDecide: (decision: 'approve' | 'reject') => void;
  approverName: (id: string | null) => string | null;
  requesterName: (id: string) => string;
  isOverride: boolean;
  canDecide: boolean;
}) {
  const [record, setRecord] = useState<{ id: string; type: string; data: Record<string, unknown>; photoUrl: string | null; createdAt: string } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setRecord(null);
    setLoadFailed(false);
    if (!approval.entityId) { setLoadFailed(true); return; }
    let cancelled = false;
    apiClient.get<{ id: string; type: string; data: Record<string, unknown>; photoUrl: string | null; createdAt: string }[]>(
      `/api/records?tenantId=${tenantId}&id=${approval.entityId}`,
    ).then((res) => {
      if (cancelled) return;
      if (res.success && res.data.length > 0) setRecord(res.data[0]);
      else setLoadFailed(true);
    });
    return () => { cancelled = true; };
  }, [approval.entityId, tenantId]);

  const entries = Object.entries(record?.data ?? {})
    .filter(([k, v]) => !HIDDEN_KEYS.has(k) && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => [DATA_LABELS[k] ?? k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()), typeof v === 'object' ? JSON.stringify(v) : String(v)] as [string, string]);

  return (
    <article className="rounded-xl bg-surface p-5 shadow-(--shadow-border) lg:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Badge variant={approval.status === 'pending' ? 'warning' : approval.status === 'approved' ? 'success' : 'danger'}>{approval.status}</Badge>
          <h2 className="font-display mt-3 text-2xl leading-tight font-medium">{approval.title}</h2>
          {/* `details` is `data.cause`/`data.varianceReason` for a mortality or
           * physical-count request (POST /api/records) — already shown, properly
           * labeled, in "What the worker submitted" below once the record loads.
           * Rendering it again here too, with no label at all, is how an honest
           * default value like "Unknown" (MortalityForm's default cause) reads
           * as a broken field: title, then a bare unlabeled word underneath it.
           * For a task-completion request `details` IS the whole story — the
           * completion note, never repeated anywhere else — so it still shows,
           * just with a label instead of dangling under the title. */}
          {approval.type === 'task_completion' && approval.details && (
            <p className="mt-2 text-sm leading-relaxed text-muted"><span className="text-subtle">Notes: </span>{approval.details}</p>
          )}
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Kv label="Requested by" value={requesterName(approval.requestedBy)} />
        <Kv label="Type" value={approval.type} />
        <Kv label="Opened" value={fmtTimestamp(approval.requestedAt)} />
        <Kv label="Resolved" value={approval.decidedAt ? fmtTimestamp(approval.decidedAt) : 'Still open'} />
        {approval.status !== 'pending' && approval.decidedBy && (
          <Kv label={approval.status === 'approved' ? 'Approved by' : 'Rejected by'} value={approverName(approval.decidedBy) ?? '—'} />
        )}
        {approval.status === 'pending' && (
          <Kv label="Waiting on" value={approverName(approval.assignedApproverId) ?? 'anyone who can approve'} />
        )}
      </dl>

      <div className="mt-6 text-xs font-medium tracking-wide text-subtle uppercase">What the worker submitted</div>
      {record === null && !loadFailed && <div className="py-2.5 text-sm text-muted">Loading the full submission…</div>}
      {loadFailed && (
        <div className="mt-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs leading-relaxed text-fg">
          The underlying record could not be loaded, so only the summary above is available. Decide with care — or reject and ask the worker to resubmit.
        </div>
      )}
      {record !== null && (
        <div className="mt-2 overflow-hidden rounded-lg border border-border">
          {entries.length === 0 && <div className="px-3 py-2.5 text-sm text-muted">This record carries no extra detail beyond its title.</div>}
          {entries.map(([label, value], i) => (
            <div key={label} className={cn('flex justify-between gap-3 px-3 py-2.5 text-sm', i < entries.length - 1 && 'border-b border-border')}>
              <span className="shrink-0 text-subtle">{label}</span>
              <span className="text-right font-medium break-words">{value}</span>
            </div>
          ))}
        </div>
      )}
      {record?.photoUrl && (
        <>
          <div className="mt-4 text-xs font-medium tracking-wide text-subtle uppercase">Photo the worker attached</div>
          {/* eslint-config's @next/next/no-img-element is off repo-wide (see eslint.config.mjs) — this app serves user-uploaded photos, not next/image-optimisable static assets. */}
          <img src={record.photoUrl} alt="Photo submitted with this record" className="mt-2 w-full rounded-lg border border-border" />
        </>
      )}

      {isOverride && approval.status === 'pending' && (
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs leading-relaxed text-fg">
          {approverName(approval.assignedApproverId)} was named to decide this. Deciding it yourself is recorded as an override.
        </div>
      )}
      {approval.status === 'pending' && !canDecide && (
        <div className="mt-4 text-xs leading-relaxed text-subtle">{approverName(approval.assignedApproverId)} was named to decide this one.</div>
      )}

      {approval.status === 'pending' && canDecide && (
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={() => onDecide('approve')} disabled={busy}>
            <Check size={14} /> {busy ? 'Working…' : 'Approve'}
          </Button>
          <Button variant="outline" onClick={() => onDecide('reject')} disabled={busy}>
            <X size={14} /> Reject
          </Button>
        </div>
      )}
    </article>
  );
}

/* ── Roles: detail panel — header card + real permission matrix ──
 * Reference's matrix has Create/Read/Update/Delete/Approve columns; our
 * backend only answers Hidden/View/Edit + a separate approval-required flag
 * per module (GET /api/role-permissions), so the matrix below has three real
 * columns instead of inventing two the API has no data for: View (checked
 * when access is 'view' or 'edit' — edit implies you can also see it), Edit
 * (checked only when access is 'edit'), and Approval (checked when the
 * module is in this role's `approvalRequired` list). */
function RoleDetail({ entry, members, canEdit, deleteConfirm, onEdit, onDeleteRequest, onDeleteCancel, onDeleteConfirm }: {
  entry: RoleMatrixEntry;
  members: EmployeeRow[];
  canEdit: boolean;
  deleteConfirm: boolean;
  onEdit: () => void;
  onDeleteRequest: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
}) {
  return (
    <>
      <section className="rounded-xl bg-surface p-5 shadow-(--shadow-border)">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-medium capitalize">{entry.role}</h2>
            <p className="mt-1 max-w-xl text-sm text-muted">
              {Object.values(entry.permissions).filter(p => p === 'edit').length} full-edit modules · {entry.approvalRequired.length} need owner approval
            </p>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={onEdit}><Edit2 size={13} /> Edit</Button>
              <Button variant="outline" size="sm" onClick={onDeleteRequest}><Trash2 size={13} /></Button>
            </div>
          )}
        </div>
        {deleteConfirm && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-3">
            <div className="mb-2 text-sm font-medium text-danger">Delete &quot;{entry.role}&quot;? This cannot be undone.</div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" className="flex-1 justify-center" onClick={onDeleteCancel}>Cancel</Button>
              <Button variant="danger" size="sm" className="flex-1 justify-center" onClick={onDeleteConfirm}>Delete</Button>
            </div>
          </div>
        )}
        {members.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-full bg-surface-2 py-1 pr-3 pl-1 text-xs">
                <Avatar name={m.name} size="sm" /> {m.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-xs text-subtle">Nobody is on this role yet.</p>
        )}
      </section>

      <section className="overflow-x-auto rounded-xl bg-surface p-2 shadow-(--shadow-border)">
        <table className="w-full min-w-2xl text-sm">
          <thead>
            <tr className="text-left text-xs text-subtle">
              <th className="px-3 py-2 font-medium">Module</th>
              <th className="px-2 py-2 text-center font-medium">View</th>
              <th className="px-2 py-2 text-center font-medium">Edit</th>
              <th className="px-2 py-2 text-center font-medium">Approval</th>
            </tr>
          </thead>
          <tbody>
            {FEATURE_GROUPS.map((g) => (
              <React.Fragment key={g.group}>
                <tr>
                  <td colSpan={4} className="px-3 pt-3 pb-1 text-xs font-medium tracking-wide text-subtle uppercase">{g.group}</td>
                </tr>
                {g.features.map((f) => {
                  const perm = entry.permissions[f.key] ?? 'hidden';
                  const view = perm === 'view' || perm === 'edit';
                  const edit = perm === 'edit';
                  const approvalOn = entry.approvalRequired.includes(f.key);
                  return (
                    <tr key={f.key} className="border-t border-border">
                      <td className="px-3 py-2.5">{f.label}</td>
                      <MatrixCell on={view} />
                      <MatrixCell on={edit} />
                      <MatrixCell on={approvalOn} tone="warn" />
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function MatrixCell({ on, tone = 'ok' }: { on: boolean; tone?: 'ok' | 'warn' }) {
  return (
    <td className="px-2 py-2.5 text-center">
      <span className={cn(
        'inline-flex size-6 items-center justify-center rounded-full',
        on ? (tone === 'warn' ? 'bg-warning-soft text-warning' : 'bg-primary-soft text-primary') : 'text-border',
      )}>
        {on ? <Check size={14} /> : <span className="size-1 rounded-full bg-border" />}
      </span>
    </td>
  );
}

/* ── Audit trail: inspector panel ── */
function AuditInspector({ event, siblings, onPick }: { event: AuditLogRow; siblings: AuditLogRow[]; onPick: (id: string) => void }) {
  const changes = auditChanges(event.meta);
  const reason = auditReason(event.meta);
  // Everything else in `meta` that isn't the `changes`/`reason` keys already
  // rendered above — the same "show whatever is actually there" rule
  // ApprovalDetail's record dump follows, not a fixed field list.
  const extra = Object.entries(event.meta ?? {}).filter(([k, v]) =>
    k !== 'changes' && k !== 'reason' && v !== null && v !== undefined && v !== '' && typeof v !== 'object',
  );
  return (
    <article className="rounded-xl bg-surface p-5 shadow-(--shadow-border)">
      <div className="flex items-center gap-2 text-xs text-subtle">
        <Shield size={13} /> {event.action}
      </div>
      <h2 className="font-display mt-2 text-2xl leading-tight font-medium">{event.entity}</h2>
      <p className="mt-1 text-sm text-muted">
        {event.actorName ?? event.actorEmail ?? event.actor} {event.actorRole ? `· ${event.actorRole}` : ''} · {fmtTimestamp(event.at)}
      </p>

      <dl className="mt-5 text-sm">
        <Kv label="Entity ID" value={<span className="font-mono text-xs">{event.entityId}</span>} />
        {reason && <Kv label="Reason" value={reason} />}
        {extra.map(([k, v]) => (
          <Kv key={k} label={k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase())} value={fmtValue(v)} />
        ))}
      </dl>

      {changes && (
        <>
          <h3 className="mt-6 text-xs font-medium tracking-[0.12em] text-subtle uppercase">What changed</h3>
          <ul className="mt-2 divide-y divide-border">
            {changes.map(([field, { old: oldVal, new: newVal }]) => (
              <li key={field} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:justify-between">
                <span className="text-sm">{field.replace(/([a-z0-9])([A-Z])/g, '$1 $2')}</span>
                <span className="text-sm">
                  <span className="text-subtle line-through">{fmtValue(oldVal)}</span>
                  <span className="mx-2 text-subtle">→</span>
                  <span className="font-medium">{fmtValue(newVal)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {siblings.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-medium tracking-[0.12em] text-subtle uppercase">Same burst</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {siblings.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onPick(s.id)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs hover:bg-surface-2">
                  <span>{fmtTimestamp(s.at)} · {s.action}</span>
                  <Badge variant="outline">{s.actorName ?? s.actorEmail ?? 'unknown'}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
