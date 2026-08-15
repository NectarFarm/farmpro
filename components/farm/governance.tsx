"use client";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNav, TopNav } from "./navigation";
import {
  Shield, ShieldCheck, Check, X, Plus,
  AlertTriangle, CheckCircle2, Edit2, Trash2,
  Eye, EyeOff, ChevronDown, ChevronUp,
  Activity,
} from "./icons";
import { apiClient } from "@/lib/request";
import { useToast, SearchBar } from "./ui-shared";

// ── Governance screen, wired to /api/approvals, /api/role-permissions and the
// new /api/audit-log (issue #244) ───────────────────────────────────────────
// Replaces the previous mock-data-driven prototype (see components/farm/data.ts).
//
// ── Approvals tab ──
// GET /api/approvals + POST /api/approvals/[id]/approve|reject (issue #243).
// The mock had a 3rd "Hold" outcome — the real `approval_requests.status`
// column only ever holds pending|approved|rejected (db/schemas/governance.ts),
// so Hold is dropped rather than faked; flagged as a follow-on in the PR.
//
// ── Role Builder tab ──
// GET/PUT /api/role-permissions (issue #243) is a real per-tenant, per-(role,
// module) config store — an owner's PUT replaces the tenant's whole matrix in
// one transaction. Feature-permission editing (Hidden/View/Edit cycle) and
// per-module "requires approval" both map directly onto real columns
// (`access`, `approval_required`) and persist through this screen.
//
// ── CRUD Rules tab ──
// The mock's CRUD Rules were a separate, free-standing rule list keyed by
// operation id (create-task, transfer-batch, …) with per-rule `affectedRoles`
// — nothing on the real backend models that shape; the only "does this
// require approval" data that exists is `role_permissions.approval_required`,
// which is scoped to (role, module), not to an arbitrary operation across
// roles. Rather than keep a second, unbacked rule list, this tab is
// redrawn as a module-centric view over that same real data: for each
// feature module, which roles currently require approval, toggled inline —
// same PUT, same persistence, just grouped by module instead of by role.
//
// ── Activity Log tab ──
// GET /api/audit-log (new in this issue) — tenant-scoped, newest-first,
// paginated. Replaces the mock activity feed; each row already carries a
// resolved `actorName` (the route joins `users`), so entries show a real
// person, not a raw actor id. The role-filter chip row (issue #302) filters
// on `actorRole`, which the route resolves via that same `users` join.
//
// ── Summary strip ──
// The mock's 4th tile ("CRUD Rules") counted rules with `requiresApproval`
// from its flat mock rule list; there's no such list on the real backend
// (see the CRUD Rules tab note above). Restored (issue #302) as the sum of
// `approvalRequired.length` across every role in the already-loaded
// `roles` state — that's exactly the count of the tenant's real
// `role_permissions` rows with `approval_required = true` (GET
// /api/role-permissions groups those rows onto `RoleMatrixEntry.approvalRequired`
// one entry per true row), so the tile and the CRUD Rules tab's own toggles
// can never disagree.

/* ── Feature modules (mirrors GET/PUT /api/role-permissions' `module` keys) ── */
const FEATURE_GROUPS = [
  {
    group: "Operations",
    features: [
      { key: "feeding", label: "Feeding Records" },
      { key: "egg-collection", label: "Egg Collection" },
      { key: "milking", label: "Milking Records" },
      { key: "mortality", label: "Mortality Records" },
      { key: "health", label: "Health / Vet" },
      { key: "physical-count", label: "Physical Count" },
      { key: "harvest", label: "Harvest Records" },
    ],
  },
  {
    group: "Management",
    features: [
      { key: "tasks", label: "Task Management" },
      { key: "inventory", label: "Inventory / Stock" },
      { key: "batches", label: "Batch Management" },
    ],
  },
  {
    group: "Finance & Admin",
    features: [
      { key: "finance", label: "Financial Reports" },
      { key: "payroll", label: "Payroll" },
      { key: "governance", label: "Governance / Approvals" },
      { key: "delete-record", label: "Delete Records" },
    ],
  },
];
const ALL_MODULES = FEATURE_GROUPS.flatMap(g => g.features);

const PERM_COLOR: Record<string, string> = {
  edit: "var(--status-ok)", view: "var(--accent-blue)", hidden: "var(--text-muted)",
};
const PERM_BG: Record<string, string> = {
  edit: "rgba(74,222,128,0.12)", view: "rgba(96,165,250,0.1)", hidden: "rgba(255,255,255,0.04)",
};
type PermLevel = "edit" | "view" | "hidden";
const ROLE_COLOR: Record<string, string> = {
  owner: "var(--primary-green)", manager: "var(--accent-purple)", worker: "var(--accent-cyan)",
  vet: "var(--accent-blue)", auditor: "var(--accent-amber)",
};

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

function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function actionIcon(action: string): { icon: React.ReactNode; bg: string } {
  if (action.endsWith(".approved")) return { icon: <Check size={13} color="var(--status-ok)" />, bg: "rgba(74,222,128,0.15)" };
  if (action.endsWith(".rejected")) return { icon: <X size={13} color="var(--status-critical)" />, bg: "rgba(248,113,113,0.12)" };
  return { icon: <Shield size={13} color="var(--accent-purple)" />, bg: "rgba(168,85,247,0.1)" };
}

/* ── Role Builder Sheet ── */
function RoleBuilderSheet({
  role, existingRoles, onClose, onSave,
}: {
  role: RoleMatrixEntry | null; existingRoles: string[]; onClose: () => void; onSave: (r: RoleMatrixEntry) => Promise<boolean>;
}) {
  const isNew = role === null;
  const defaultPerms: Record<string, PermLevel> = {};
  ALL_MODULES.forEach(f => { defaultPerms[f.key] = "hidden"; });

  const [name, setName] = useState(role?.role ?? "");
  const [perms, setPerms] = useState<Record<string, PermLevel>>(role?.permissions ?? defaultPerms);
  const [approvals, setApprovals] = useState<string[]>(role?.approvalRequired ?? []);
  const [expandedGroup, setExpandedGroup] = useState<string | null>("Operations");
  const [nameError, setNameError] = useState("");
  const [saving, setSaving] = useState(false);

  function cyclePermission(key: string) {
    const cycle: PermLevel[] = ["hidden", "view", "edit"];
    const cur = perms[key] ?? "hidden";
    setPerms(p => ({ ...p, [key]: cycle[(cycle.indexOf(cur) + 1) % 3] }));
  }
  function toggleApproval(key: string) {
    setApprovals(a => a.includes(key) ? a.filter(x => x !== key) : [...a, key]);
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) { setNameError("Role name is required"); return; }
    if (isNew && existingRoles.includes(trimmed)) { setNameError("A role with this name already exists"); return; }
    setSaving(true);
    const ok = await onSave({ role: trimmed, permissions: perms, approvalRequired: approvals });
    setSaving(false);
    if (!ok) setNameError("Could not save — please try again");
  }

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "flex-end", zIndex: 200 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: "22px 22px 0 0", width: "100%", maxHeight: "90%", overflowY: "auto", border: "1px solid var(--border-subtle)" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "18px 18px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{isNew ? "Create Role" : `Edit: ${role?.role}`}</div>
            <button className="btn-icon" onClick={onClose}><X size={16} /></button>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Role Name *</label>
            <input className="farm-input" value={name} onChange={e => { setName(e.target.value); setNameError(""); }} placeholder="e.g. night_watchman, harvest_lead…" disabled={!isNew} />
            {nameError && <div style={{ fontSize: 11, color: "var(--status-critical)", marginTop: 4 }}>⚠ {nameError}</div>}
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>
            Feature Permissions &nbsp;<span style={{ color: "var(--text-muted)", fontWeight: 400 }}>tap to cycle: Hidden → View → Edit</span>
          </div>

          {FEATURE_GROUPS.map(g => (
            <div key={g.group} style={{ marginBottom: 8 }}>
              <button onClick={() => setExpandedGroup(expandedGroup === g.group ? null : g.group)}
                style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--card)", border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "9px 12px", cursor: "pointer" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{g.group}</span>
                {expandedGroup === g.group ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
              </button>
              {expandedGroup === g.group && (
                <div style={{ marginTop: 4, borderRadius: 10, overflow: "hidden", border: "1px solid var(--border-subtle)" }}>
                  {g.features.map((f, i) => {
                    const perm = perms[f.key] ?? "hidden";
                    return (
                      <div key={f.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: PERM_BG[perm], borderBottom: i < g.features.length - 1 ? "1px solid var(--border-subtle)" : "none", cursor: "pointer" }} onClick={() => cyclePermission(f.key)}>
                        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{f.label}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 100, background: PERM_BG[perm], color: PERM_COLOR[perm], border: `1px solid ${PERM_COLOR[perm]}40`, textTransform: "uppercase" }}>
                          {perm === "hidden" ? <EyeOff size={10} style={{ verticalAlign: "middle", marginRight: 3 }} /> : perm === "view" ? <Eye size={10} style={{ verticalAlign: "middle", marginRight: 3 }} /> : <Edit2 size={10} style={{ verticalAlign: "middle", marginRight: 3 }} />}
                          {perm}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 16, marginBottom: 10 }}>
            Modules Requiring Owner Approval
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
            {ALL_MODULES.map(f => {
              const active = approvals.includes(f.key);
              return (
                <button key={f.key} onClick={() => toggleApproval(f.key)} style={{ padding: "6px 12px", borderRadius: 100, fontSize: 11, fontWeight: 700, cursor: "pointer", background: active ? "rgba(251,191,36,0.15)" : "var(--card)", border: active ? "1px solid rgba(251,191,36,0.5)" : "1px solid var(--border-subtle)", color: active ? "var(--accent-amber)" : "var(--text-muted)" }}>
                  {active && <Check size={10} style={{ verticalAlign: "middle", marginRight: 3 }} />}
                  {f.label}
                </button>
              );
            })}
          </div>

          <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 24 }} onClick={handleSave} disabled={saving}>
            <Check size={14} /> {saving ? "Saving…" : isNew ? "Create Role" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main screen ── */
export function GovernanceScreen() {
  const { tenantId, role: sessionRole } = useNav();
  const { showToast } = useToast();

  const [tab, setTab] = useState<"approvals" | "roles" | "crud" | "audit">("approvals");
  const canEditRoles = sessionRole === "owner";

  const [approvals, setApprovals] = useState<ApprovalRequestRow[] | null>(null);
  const [roles, setRoles] = useState<RoleMatrixEntry[] | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogRow[] | null>(null);
  const [loadError, setLoadError] = useState("");

  const [editRole, setEditRole] = useState<RoleMatrixEntry | null | "new" | undefined>(undefined);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [deleteRoleConfirm, setDeleteRoleConfirm] = useState<string | null>(null);
  const [approvalFilter, setApprovalFilter] = useState("all");
  const [activitySearch, setActivitySearch] = useState("");
  const [activityRoleFilter, setActivityRoleFilter] = useState("all");
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const loadApprovals = useCallback(async () => {
    const res = await apiClient.get<ApprovalRequestRow[]>(`/api/approvals?tenantId=${tenantId}`);
    if (res.success) setApprovals(res.data);
    else setLoadError(res.error ?? "Could not load approvals");
  }, [tenantId]);

  const loadRoles = useCallback(async () => {
    const res = await apiClient.get<RoleMatrixEntry[]>(`/api/role-permissions?tenantId=${tenantId}`);
    if (res.success) setRoles(res.data);
    else setLoadError(res.error ?? "Could not load role permissions");
  }, [tenantId]);

  const loadAuditLog = useCallback(async () => {
    const res = await apiClient.get<AuditLogRow[]>(`/api/audit-log?tenantId=${tenantId}&limit=100`);
    if (res.success) setAuditLog(res.data);
    else setLoadError(res.error ?? "Could not load activity log");
  }, [tenantId]);

  useEffect(() => { loadApprovals(); }, [loadApprovals]);
  useEffect(() => { loadRoles(); }, [loadRoles]);
  useEffect(() => { loadAuditLog(); }, [loadAuditLog]);

  async function decide(a: ApprovalRequestRow, decision: "approve" | "reject") {
    setDecidingId(a.id);
    const res = await apiClient.post(`/api/approvals/${a.id}/${decision}?tenantId=${tenantId}`, {});
    setDecidingId(null);
    if (!res.success) { showToast(res.error ?? `Could not ${decision} request`, "error"); return; }
    showToast(decision === "approve" ? "✅ Approved" : "❌ Rejected", decision === "approve" ? "success" : "error");
    await Promise.all([loadApprovals(), loadAuditLog()]);
  }

  async function persistRoles(next: RoleMatrixEntry[]): Promise<boolean> {
    const res = await apiClient.put<RoleMatrixEntry[]>(`/api/role-permissions`, { roles: next });
    if (!res.success) { showToast(res.error ?? "Could not save role permissions", "error"); return false; }
    setRoles(res.data);
    return true;
  }

  async function saveRole(r: RoleMatrixEntry) {
    const current = roles ?? [];
    const idx = current.findIndex(x => x.role === r.role);
    const next = idx >= 0 ? current.map((x, i) => i === idx ? r : x) : [...current, r];
    const ok = await persistRoles(next);
    if (ok) {
      showToast(`Role "${r.role}" ${idx >= 0 ? "updated" : "created"}`, "success");
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
      showToast(`Role "${roleName}" deleted`, "warning");
      await loadAuditLog();
    }
  }

  // CRUD Rules tab: toggle a single (role, module) approvalRequired flag —
  // same underlying PUT as the Role Builder, just entered from the module side.
  async function toggleModuleApproval(moduleKey: string, roleName: string) {
    const current = roles ?? [];
    const entry = current.find(x => x.role === roleName);
    if (!entry) return;
    const has = entry.approvalRequired.includes(moduleKey);
    const nextApproval = has ? entry.approvalRequired.filter(m => m !== moduleKey) : [...entry.approvalRequired, moduleKey];
    const next = current.map(x => x.role === roleName ? { ...x, approvalRequired: nextApproval } : x);
    const ok = await persistRoles(next);
    if (ok) {
      showToast(`${roleName}: ${moduleKey} ${has ? "no longer requires" : "now requires"} approval`, "info");
      await loadAuditLog();
    }
  }

  const pending = (approvals ?? []).filter(a => a.status === "pending").length;
  const approvedCount = (approvals ?? []).filter(a => a.status === "approved").length;
  const filteredApprovals = approvalFilter === "all" ? (approvals ?? []) : (approvals ?? []).filter(a => a.status === approvalFilter);

  // Sum of every role's approvalRequired list = count of the tenant's real
  // role_permissions rows with approval_required = true (see comment above).
  const crudRulesCount = (roles ?? []).reduce((sum, r) => sum + r.approvalRequired.length, 0);

  const filteredActivity = useMemo(() => {
    let entries = auditLog ?? [];
    if (activityRoleFilter !== "all") entries = entries.filter(e => e.actorRole === activityRoleFilter);
    if (activitySearch) {
      const q = activitySearch.toLowerCase();
      entries = entries.filter(e =>
        e.action.toLowerCase().includes(q) ||
        e.entity.toLowerCase().includes(q) ||
        (e.actorName ?? "").toLowerCase().includes(q)
      );
    }
    return entries;
  }, [auditLog, activityRoleFilter, activitySearch]);

  return (
    <div className="screen-content">
      <TopNav title="Governance" subtitle="Roles, CRUD rules & audit" />

      <div className="px-screen" style={{ paddingTop: 12 }}>
        {loadError && (
          <div style={{ padding: "10px 14px", marginBottom: 12, borderRadius: 12, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", fontSize: 12, color: "var(--status-critical)", display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={13} /> {loadError}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {[
            { label: "Pending", value: pending, color: "var(--status-warning)", bg: "rgba(251,191,36,0.1)" },
            { label: "Approved", value: approvedCount, color: "var(--status-ok)", bg: "rgba(74,222,128,0.08)" },
            { label: "Roles", value: (roles ?? []).length, color: "var(--accent-purple)", bg: "rgba(168,85,247,0.08)" },
            { label: "CRUD Rules", value: crudRulesCount, color: "var(--accent-amber)", bg: "rgba(251,191,36,0.06)" },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, background: s.bg, borderRadius: 12, padding: "10px 4px", textAlign: "center", border: `1px solid ${s.color}30` }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 5, marginBottom: 14, overflowX: "auto", scrollbarWidth: "none" }}>
          {[["approvals", "Approvals"], ["roles", "Roles"], ["crud", "CRUD Rules"], ["audit", "Activity Log"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id as typeof tab)} style={{ flexShrink: 0, padding: "8px 12px", borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: "pointer", background: tab === id ? "rgba(74,222,128,0.15)" : "var(--card)", border: tab === id ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)", color: tab === id ? "var(--primary-green)" : "var(--text-muted)" }}>
              {label}{id === "approvals" && pending > 0 ? ` (${pending})` : ""}
            </button>
          ))}
        </div>

        {/* ── APPROVALS TAB ── */}
        {tab === "approvals" && (
          <div style={{ paddingBottom: 80 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto", scrollbarWidth: "none" }}>
              {["all", "pending", "approved", "rejected"].map(f => (
                <button key={f} onClick={() => setApprovalFilter(f)} style={{ flexShrink: 0, padding: "5px 11px", borderRadius: 100, fontSize: 10, fontWeight: 700, cursor: "pointer", background: approvalFilter === f ? "rgba(74,222,128,0.15)" : "var(--card)", border: approvalFilter === f ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)", color: approvalFilter === f ? "var(--primary-green)" : "var(--text-muted)", textTransform: "capitalize" }}>{f}</button>
              ))}
            </div>
            {approvals === null ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 13 }}>Loading approvals…</div>
            ) : (
              <>
                {filteredApprovals.map(a => (
                  <div key={a.id} style={{ marginBottom: 12, padding: 14, borderRadius: 16, border: `1px solid ${a.status === "pending" ? "rgba(251,191,36,0.3)" : a.status === "approved" ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)"}`, background: a.status === "pending" ? "rgba(251,191,36,0.05)" : a.status === "approved" ? "rgba(74,222,128,0.04)" : "rgba(248,113,113,0.04)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
                          <span className="chip chip-info" style={{ fontSize: 9 }}>{a.type}</span>
                          <span style={{ fontSize: 9, color: "var(--text-dim)", fontWeight: 600, fontFamily: "monospace" }}>{a.id.slice(0, 8)}</span>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.3 }}>{a.title}</div>
                      </div>
                      <span className={`chip ${a.status === "pending" ? "chip-warning" : a.status === "approved" ? "chip-ok" : "chip-critical"}`} style={{ fontSize: 9, flexShrink: 0 }}>
                        {a.status.toUpperCase()}
                      </span>
                    </div>
                    {a.details && <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, lineHeight: 1.5 }}>{a.details}</div>}
                    <div style={{ display: "flex", gap: 12, marginBottom: a.status === "pending" ? 10 : 0, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>By: <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{a.requestedBy}</span></span>
                      <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{fmtTimestamp(a.requestedAt)}</span>
                    </div>
                    {a.status === "pending" && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button disabled={decidingId === a.id} onClick={() => decide(a, "approve")} style={{ flex: 1, padding: "9px", borderRadius: 10, fontSize: 12, fontWeight: 700, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.35)", color: "var(--status-ok)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                          <Check size={13} /> Approve
                        </button>
                        <button disabled={decidingId === a.id} onClick={() => decide(a, "reject")} style={{ flex: 1, padding: "9px", borderRadius: 10, fontSize: 12, fontWeight: 700, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "var(--status-critical)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                          <X size={13} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {filteredApprovals.length === 0 && (
                  <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)" }}>
                    <CheckCircle2 size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
                    <div style={{ fontSize: 13, fontWeight: 600 }}>No {approvalFilter !== "all" ? approvalFilter : ""} requests</div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── ROLE BUILDER TAB ── */}
        {tab === "roles" && (
          <div style={{ paddingBottom: 80 }}>
            <div style={{ padding: "10px 14px", background: "rgba(168,85,247,0.08)", borderRadius: 12, marginBottom: 14, border: "1px solid rgba(168,85,247,0.2)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
              <ShieldCheck size={12} style={{ verticalAlign: "middle", marginRight: 5 }} color="var(--accent-purple)" />
              Roles define what each employee can see and do. All role changes are logged in the Activity Log.
              {!canEditRoles && " Only an owner can make changes."}
            </div>
            {canEditRoles && (
              <button onClick={() => setEditRole("new")} style={{ width: "100%", marginBottom: 12, padding: "11px", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", background: "rgba(74,222,128,0.1)", border: "1px dashed rgba(74,222,128,0.4)", color: "var(--primary-green)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Plus size={15} /> Create New Role
              </button>
            )}

            {roles === null ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 13 }}>Loading roles…</div>
            ) : roles.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 13 }}>No roles configured yet.</div>
            ) : roles.map(r => {
              const expanded = expandedRole === r.role;
              const editableCount = Object.values(r.permissions).filter(p => p === "edit").length;
              const viewCount = Object.values(r.permissions).filter(p => p === "view").length;
              return (
                <div key={r.role} style={{ marginBottom: 10, borderRadius: 14, overflow: "hidden", border: "1px solid var(--border-subtle)" }}>
                  {deleteRoleConfirm === r.role && (
                    <div style={{ padding: "12px 14px", background: "rgba(248,113,113,0.08)", borderBottom: "1px solid rgba(248,113,113,0.2)" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--status-critical)", marginBottom: 8 }}>Delete "{r.role}"? This cannot be undone.</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => setDeleteRoleConfirm(null)} style={{ flex: 1, padding: "8px", borderRadius: 8, background: "var(--card)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Cancel</button>
                        <button onClick={() => deleteRole(r.role)} style={{ flex: 1, padding: "8px", borderRadius: 8, background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.4)", color: "var(--status-critical)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Delete</button>
                      </div>
                    </div>
                  )}

                  <button onClick={() => setExpandedRole(expanded ? null : r.role)} style={{ width: "100%", padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--card)", border: "none", cursor: "pointer" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: ROLE_COLOR[r.role] ?? "var(--accent-purple)", flexShrink: 0 }} />
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{r.role}</div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{editableCount} edit · {viewCount} view · {r.approvalRequired.length} need approval</div>
                      </div>
                    </div>
                    {canEditRoles && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button onClick={e => { e.stopPropagation(); setEditRole(r); }} style={{ padding: "5px 10px", borderRadius: 8, fontSize: 10, fontWeight: 700, background: "var(--surface)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", cursor: "pointer" }}>Edit</button>
                        <button onClick={e => { e.stopPropagation(); setDeleteRoleConfirm(deleteRoleConfirm === r.role ? null : r.role); }} style={{ padding: "5px 8px", borderRadius: 8, fontSize: 10, fontWeight: 700, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "var(--status-critical)", cursor: "pointer" }}>
                          <Trash2 size={11} />
                        </button>
                        {expanded ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
                      </div>
                    )}
                  </button>

                  {expanded && (
                    <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border-subtle)", padding: "12px 14px" }}>
                      {FEATURE_GROUPS.map(g => (
                        <div key={g.group} style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{g.group}</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {g.features.map(f => {
                              const perm = r.permissions[f.key] ?? "hidden";
                              if (perm === "hidden") return null;
                              return (
                                <span key={f.key} style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 100, background: PERM_BG[perm], color: PERM_COLOR[perm], border: `1px solid ${PERM_COLOR[perm]}40` }}>
                                  {perm === "edit" ? "✏️" : "👁️"} {f.label}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {r.approvalRequired.length > 0 && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-subtle)" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent-amber)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Requires Owner Approval</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {r.approvalRequired.map(m => (
                              <span key={m} style={{ fontSize: 10, padding: "3px 9px", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 100, color: "var(--accent-amber)", fontWeight: 600 }}>{m.replace(/-/g, " ")}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── CRUD RULES TAB ── */}
        {tab === "crud" && (
          <div style={{ paddingBottom: 80 }}>
            <div style={{ padding: "10px 14px", background: "rgba(251,191,36,0.07)", borderRadius: 12, marginBottom: 14, border: "1px solid rgba(251,191,36,0.25)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
              <ShieldCheck size={12} style={{ verticalAlign: "middle", marginRight: 5 }} color="var(--accent-amber)" />
              Configure which roles need owner approval per module before an action takes effect. Changes are logged.
              {!canEditRoles && " Only an owner can make changes."}
            </div>

            {roles === null ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>
            ) : roles.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 13 }}>No roles configured yet — create one in the Roles tab first.</div>
            ) : ALL_MODULES.map(f => (
              <div key={f.key} style={{ marginBottom: 10, padding: "14px", borderRadius: 14, background: "var(--card)", border: "1px solid var(--border-subtle)" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>{f.label}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {roles.map(r => {
                    const active = r.approvalRequired.includes(f.key);
                    return (
                      <button
                        key={r.role}
                        disabled={!canEditRoles}
                        onClick={() => toggleModuleApproval(f.key, r.role)}
                        style={{ padding: "6px 12px", borderRadius: 100, fontSize: 11, fontWeight: 700, cursor: canEditRoles ? "pointer" : "default", background: active ? "rgba(251,191,36,0.15)" : "var(--surface)", border: active ? "1px solid rgba(251,191,36,0.5)" : "1px solid var(--border-subtle)", color: active ? "var(--accent-amber)" : "var(--text-muted)" }}>
                        {active && <Check size={10} style={{ verticalAlign: "middle", marginRight: 3 }} />}
                        {r.role}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── ACTIVITY LOG TAB ── */}
        {tab === "audit" && (
          <div style={{ paddingBottom: 80 }}>
            <SearchBar value={activitySearch} onChange={setActivitySearch} placeholder="Search actions, users, entities…" />
            <div style={{ display: "flex", gap: 5, marginBottom: 12, overflowX: "auto", scrollbarWidth: "none" }}>
              {["all", ...Object.keys(ROLE_COLOR)].map(id => (
                <button key={id} onClick={() => setActivityRoleFilter(id)} style={{ flexShrink: 0, padding: "5px 10px", borderRadius: 100, fontSize: 10, fontWeight: 700, cursor: "pointer", background: activityRoleFilter === id ? "rgba(74,222,128,0.15)" : "var(--card)", border: activityRoleFilter === id ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)", color: activityRoleFilter === id ? "var(--primary-green)" : "var(--text-muted)", textTransform: "capitalize" }}>
                  {id === "all" ? "All Roles" : id}
                </button>
              ))}
            </div>
            {auditLog === null ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 13 }}>Loading activity…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filteredActivity.map(entry => {
                  const { icon, bg } = actionIcon(entry.action);
                  return (
                    <div key={entry.id} className="farm-card" style={{ padding: 12 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {icon}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{entry.action}</div>
                            <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 100, background: "rgba(255,255,255,0.06)", color: "var(--text-dim)", fontWeight: 700, flexShrink: 0, marginLeft: 6 }}>{entry.entity}</span>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{entry.entityId}</div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{entry.actorName ?? entry.actorEmail ?? entry.actor}</span>
                            <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "monospace" }}>{fmtTimestamp(entry.at)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {filteredActivity.length === 0 && (
                  <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)" }}>
                    <Activity size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
                    <div style={{ fontSize: 13, fontWeight: 600 }}>No activity found</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {editRole !== undefined && (
        <RoleBuilderSheet
          role={editRole === "new" ? null : editRole}
          existingRoles={(roles ?? []).map(r => r.role)}
          onClose={() => setEditRole(undefined)}
          onSave={saveRole}
        />
      )}
    </div>
  );
}
