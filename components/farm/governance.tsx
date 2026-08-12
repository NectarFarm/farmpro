"use client";
import React, { useState, useMemo } from "react";
import { useNav, TopNav } from "./navigation";
import {
  Shield, ShieldCheck, Check, X, Clock, Plus, ChevronRight,
  Key, AlertTriangle, CheckCircle2, FileText, Edit2, Trash2,
  Eye, EyeOff, Lock, Unlock, ChevronDown, ChevronUp, Search,
  Activity, Filter,
} from "./icons";
import { OWNER_ROLES, APPROVALS_DATA, NOTIFICATIONS_DATA, type OwnerRole, type Notification } from "./data";
import { useToast, SearchBar } from "./ui-shared";

/* ── Feature groups for permission matrix ── */
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

const ALL_APPROVAL_ACTIONS = [
  "feeding", "egg-collection", "milking", "mortality",
  "health", "physical-count", "harvest", "variance-adjustment",
  "sale", "purchase", "expense", "delete-task", "edit-batch",
  "transfer-batch", "modify-role",
];

/* ── CRUD Governance Config ── */
// Controls which CRUD operations require owner approval across the system
interface CrudRule {
  id: string;
  label: string;
  description: string;
  requiresApproval: boolean;
  affectedRoles: string[]; // "all" | role ids
}

const DEFAULT_CRUD_RULES: CrudRule[] = [
  { id: "create-task", label: "Create Task", description: "Any employee creating a new task", requiresApproval: false, affectedRoles: ["worker"] },
  { id: "delete-task", label: "Delete Task", description: "Removing a task from the schedule", requiresApproval: true, affectedRoles: ["all"] },
  { id: "edit-task", label: "Edit Task", description: "Modifying task details, dates, or assignees", requiresApproval: true, affectedRoles: ["worker", "manager"] },
  { id: "close-batch", label: "Close Batch", description: "Marking a batch as closed or harvested", requiresApproval: true, affectedRoles: ["all"] },
  { id: "transfer-batch", label: "Transfer Batch Unit", description: "Moving a batch to a different housing unit", requiresApproval: true, affectedRoles: ["all"] },
  { id: "edit-batch", label: "Edit Batch Details", description: "Modifying batch quantities, dates, or settings", requiresApproval: true, affectedRoles: ["worker", "manager"] },
  { id: "variance-adjustment", label: "Inventory Variance", description: "Adjusting stock counts to resolve variance", requiresApproval: true, affectedRoles: ["all"] },
  { id: "create-purchase", label: "Create Purchase", description: "Recording a new purchase / expense", requiresApproval: false, affectedRoles: ["worker"] },
  { id: "approve-expense", label: "Approve Expense", description: "Approving a pending expense request", requiresApproval: false, affectedRoles: ["manager"] },
  { id: "modify-role", label: "Assign / Change Role", description: "Changing an employee's system role", requiresApproval: true, affectedRoles: ["all"] },
  { id: "export-data", label: "Export / Download Data", description: "Exporting CSV, reports, or audit logs", requiresApproval: false, affectedRoles: ["worker"] },
  { id: "reset-pin", label: "Reset Worker PIN", description: "Resetting a worker's PIN / password", requiresApproval: false, affectedRoles: ["manager"] },
];

/* ── Per-Role Activity Log entries ── */
interface ActivityEntry {
  id: string;
  roleId: string;
  roleName: string;
  action: string;
  target: string;
  user: string;
  timestamp: string;
  type: "approve" | "reject" | "security" | "config" | "create" | "delete" | "edit";
}

const ACTIVITY_LOG: ActivityEntry[] = [
  { id: "A001", roleId: "manager", roleName: "Farm Manager", action: "Approval granted", target: "Task TSK-KMU-0083 – Milking", user: "Peter Njoroge (Manager)", timestamp: "2026-08-11 14:32", type: "approve" },
  { id: "A002", roleId: "worker", roleName: "Farm Worker", action: "Mortality submitted", target: "PIG-KMU-004 · 2 pigs", user: "Sarah Mwangi (Worker)", timestamp: "2026-08-11 09:30", type: "create" },
  { id: "A003", roleId: "owner", roleName: "Owner", action: "Role updated", target: "Worker → Harvest Lead (Ann Wambui)", user: "James Kamau (Owner)", timestamp: "2026-08-10 11:00", type: "config" },
  { id: "A004", roleId: "worker", roleName: "Farm Worker", action: "Egg collection submitted", target: "LYR-KMU-008 · 145 trays", user: "John Kamau (Worker)", timestamp: "2026-08-11 07:45", type: "create" },
  { id: "A005", roleId: "manager", roleName: "Farm Manager", action: "Task created", target: "TSK-KMU-0084 – Weed inspection", user: "Peter Njoroge (Manager)", timestamp: "2026-08-09 10:14", type: "create" },
  { id: "A006", roleId: "owner", roleName: "Owner", action: "Sale approved", target: "BRO-KMU-022 · KSh 320,000", user: "James Kamau (Owner)", timestamp: "2026-08-09 10:14", type: "approve" },
  { id: "A007", roleId: "owner", roleName: "Owner", action: "Employee deactivated", target: "Moses Kiptoo", user: "James Kamau (Owner)", timestamp: "2026-08-08 16:00", type: "security" },
  { id: "A008", roleId: "manager", roleName: "Farm Manager", action: "PIN reset", target: "John Kamau", user: "Peter Njoroge (Manager)", timestamp: "2026-08-07 09:30", type: "security" },
  { id: "A009", roleId: "harvest_lead", roleName: "Harvest Lead", action: "Harvest submitted", target: "KIT-KMU-002 · 28kg kale", user: "Ann Wambui (Harvest Lead)", timestamp: "2026-08-10 14:00", type: "create" },
  { id: "A010", roleId: "vet", roleName: "Veterinarian", action: "Health check completed", target: "BRO-KMU-022 · All clear", user: "Dr. Ken Oduya (Vet)", timestamp: "2026-08-09 08:00", type: "config" },
  { id: "A011", roleId: "owner", roleName: "Owner", action: "Purchase rejected", target: "Equipment repair KSh 12,500", user: "James Kamau (Owner)", timestamp: "2026-08-06 08:30", type: "reject" },
  { id: "A012", roleId: "owner", roleName: "Owner", action: "CRUD rule updated", target: "Delete Task → Approval required", user: "James Kamau (Owner)", timestamp: "2026-08-05 14:00", type: "config" },
];

const PERM_COLOR: Record<string, string> = {
  edit: "var(--status-ok)",
  view: "var(--accent-blue)",
  hidden: "var(--text-muted)",
};
const PERM_BG: Record<string, string> = {
  edit: "rgba(74,222,128,0.12)",
  view: "rgba(96,165,250,0.1)",
  hidden: "rgba(255,255,255,0.04)",
};

type PermLevel = "edit" | "view" | "hidden";

/* ── Role Builder Sheet ── */
function RoleBuilderSheet({
  role, onClose, onSave,
}: {
  role: OwnerRole | null; onClose: () => void; onSave: (r: OwnerRole) => void;
}) {
  const isNew = role === null;
  const defaultPerms: Record<string, PermLevel> = {};
  FEATURE_GROUPS.forEach(g => g.features.forEach(f => { defaultPerms[f.key] = "hidden"; }));

  const [name, setName] = useState(role?.name ?? "");
  const [color, setColor] = useState(role?.color ?? "var(--accent-amber)");
  const [perms, setPerms] = useState<Record<string, PermLevel>>(role?.permissions as Record<string, PermLevel> ?? defaultPerms);
  const [approvals, setApprovals] = useState<string[]>(role?.approvalRequired ?? []);
  const [expandedGroup, setExpandedGroup] = useState<string | null>("Operations");
  const [nameError, setNameError] = useState("");
  const { showToast } = useToast();

  const COLORS = [
    "var(--primary-green)", "var(--accent-blue)", "var(--accent-purple)",
    "var(--accent-amber)", "var(--accent-cyan)", "var(--status-critical)",
  ];

  function cyclePermission(key: string) {
    const cycle: PermLevel[] = ["hidden", "view", "edit"];
    const cur = perms[key] ?? "hidden";
    setPerms(p => ({ ...p, [key]: cycle[(cycle.indexOf(cur) + 1) % 3] }));
  }

  function toggleApproval(key: string) {
    setApprovals(a => a.includes(key) ? a.filter(x => x !== key) : [...a, key]);
  }

  function handleSave() {
    if (!name.trim()) { setNameError("Role name is required"); return; }
    onSave({
      id: role?.id ?? name.toLowerCase().replace(/\s+/g, "_"),
      name, color, permissions: perms, approvalRequired: approvals, canApproveFor: role?.canApproveFor ?? [],
    });
    showToast(isNew ? `Role "${name}" created` : `Role "${name}" updated`, "success");
  }

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "flex-end", zIndex: 200 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: "22px 22px 0 0", width: "100%", maxHeight: "90%", overflowY: "auto", border: "1px solid var(--border-subtle)" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "18px 18px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{isNew ? "Create Role" : `Edit: ${role?.name}`}</div>
            <button className="btn-icon" onClick={onClose}><X size={16} /></button>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Role Name *</label>
            <input className="farm-input" value={name} onChange={e => { setName(e.target.value); setNameError(""); }} placeholder="e.g. Night Watchman, Harvest Lead…" />
            {nameError && <div style={{ fontSize: 11, color: "var(--status-critical)", marginTop: 4 }}>⚠ {nameError}</div>}
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 8 }}>Badge Colour</label>
            <div style={{ display: "flex", gap: 10 }}>
              {COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)} style={{ width: 26, height: 26, borderRadius: "50%", background: c, border: color === c ? "2px solid white" : "2px solid transparent", outline: color === c ? "2px solid " + c : "none", cursor: "pointer" }} />
              ))}
            </div>
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
            Activities Requiring Owner Approval
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
            {ALL_APPROVAL_ACTIONS.map(key => {
              const active = approvals.includes(key);
              return (
                <button key={key} onClick={() => toggleApproval(key)} style={{ padding: "6px 12px", borderRadius: 100, fontSize: 11, fontWeight: 700, cursor: "pointer", background: active ? "rgba(251,191,36,0.15)" : "var(--card)", border: active ? "1px solid rgba(251,191,36,0.5)" : "1px solid var(--border-subtle)", color: active ? "var(--accent-amber)" : "var(--text-muted)" }}>
                  {active && <Check size={10} style={{ verticalAlign: "middle", marginRight: 3 }} />}
                  {key.replace(/-/g, " ")}
                </button>
              );
            })}
          </div>

          <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 24 }} onClick={handleSave}>
            <Check size={14} /> {isNew ? "Create Role" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main screen ── */
export function GovernanceScreen() {
  const [tab, setTab] = useState<"approvals" | "roles" | "crud" | "audit">("approvals");
  const [approvals, setApprovals] = useState(APPROVALS_DATA);
  const [roles, setRoles] = useState<OwnerRole[]>(OWNER_ROLES);
  const [crudRules, setCrudRules] = useState<CrudRule[]>(DEFAULT_CRUD_RULES);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>(ACTIVITY_LOG);
  const [editRole, setEditRole] = useState<OwnerRole | null | "new" | undefined>(undefined);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [deleteRoleConfirm, setDeleteRoleConfirm] = useState<string | null>(null);
  const [approvalFilter, setApprovalFilter] = useState("all");
  const [activityRoleFilter, setActivityRoleFilter] = useState("all");
  const [activitySearch, setActivitySearch] = useState("");
  const { showToast } = useToast();

  const pending = approvals.filter(a => a.status === "pending").length;
  const approved = approvals.filter(a => a.status === "approved").length;

  function actApproval(code: string, action: "approved" | "rejected" | "held") {
    const item = approvals.find(a => a.code === code);
    setApprovals(a => a.map(x => x.code === code ? { ...x, status: action } : x));
    if (action === "approved" || action === "rejected") {
      const now = new Date();
      const ts = `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)}`;
      // Add to activity log
      const logEntry: ActivityEntry = {
        id: `A-${Date.now()}`, roleId: "owner", roleName: "Owner",
        action: action === "approved" ? "Approval granted" : "Approval rejected",
        target: `${item?.code} – ${item?.title ?? ""}`,
        user: "James Kamau (Owner)", timestamp: ts,
        type: action === "approved" ? "approve" : "reject",
      };
      setActivityLog(l => [logEntry, ...l]);
      showToast(action === "approved" ? `✅ Approved — worker notified` : `❌ Rejected — worker notified`, action === "approved" ? "success" : "error");
    }
  }

  function saveRole(r: OwnerRole) {
    setRoles(rs => {
      const idx = rs.findIndex(x => x.id === r.id);
      return idx >= 0 ? rs.map((x, i) => i === idx ? r : x) : [...rs, r];
    });
    const now = new Date();
    setActivityLog(l => [{
      id: `A-${Date.now()}`, roleId: "owner", roleName: "Owner",
      action: `Role ${roles.find(x => x.id === r.id) ? "updated" : "created"}`,
      target: r.name, user: "James Kamau (Owner)",
      timestamp: `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)}`,
      type: "config",
    }, ...l]);
    setEditRole(undefined);
  }

  function deleteRole(id: string) {
    const r = roles.find(x => x.id === id);
    setRoles(rs => rs.filter(x => x.id !== id));
    const now = new Date();
    setActivityLog(l => [{
      id: `A-${Date.now()}`, roleId: "owner", roleName: "Owner",
      action: "Role deleted", target: r?.name ?? id, user: "James Kamau (Owner)",
      timestamp: `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)}`,
      type: "delete" as const,
    }, ...l]);
    showToast(`Role "${r?.name}" deleted`, "warning");
    setDeleteRoleConfirm(null);
  }

  function toggleCrudRule(id: string) {
    setCrudRules(rs => rs.map(r => r.id === id ? { ...r, requiresApproval: !r.requiresApproval } : r));
    const rule = crudRules.find(r => r.id === id);
    const now = new Date();
    setActivityLog(l => [{
      id: `A-${Date.now()}`, roleId: "owner", roleName: "Owner",
      action: `CRUD rule ${rule?.requiresApproval ? "relaxed" : "tightened"}`,
      target: `${rule?.label} → ${rule?.requiresApproval ? "No approval" : "Approval required"}`,
      user: "James Kamau (Owner)",
      timestamp: `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)}`,
      type: "config",
    }, ...l]);
    showToast(`${rule?.label}: ${rule?.requiresApproval ? "approval removed" : "approval required"}`, "info");
  }

  const filteredApprovals = approvalFilter === "all" ? approvals : approvals.filter(a => a.status === approvalFilter);

  const filteredActivity = useMemo(() => {
    let entries = activityLog;
    if (activityRoleFilter !== "all") entries = entries.filter(e => e.roleId === activityRoleFilter);
    if (activitySearch) {
      const q = activitySearch.toLowerCase();
      entries = entries.filter(e => e.action.toLowerCase().includes(q) || e.target.toLowerCase().includes(q) || e.user.toLowerCase().includes(q));
    }
    return entries;
  }, [activityLog, activityRoleFilter, activitySearch]);

  const TYPE_ICON: Record<string, React.ReactNode> = {
    approve: <Check size={13} color="var(--status-ok)" />,
    reject: <X size={13} color="var(--status-critical)" />,
    security: <Key size={13} color="var(--accent-blue)" />,
    config: <Shield size={13} color="var(--accent-purple)" />,
    create: <Plus size={13} color="var(--primary-green)" />,
    delete: <Trash2 size={13} color="var(--status-critical)" />,
    edit: <Edit2 size={13} color="var(--accent-amber)" />,
  };

  const TYPE_BG: Record<string, string> = {
    approve: "rgba(74,222,128,0.15)", reject: "rgba(248,113,113,0.12)",
    security: "rgba(96,165,250,0.1)", config: "rgba(168,85,247,0.1)",
    create: "rgba(74,222,128,0.1)", delete: "rgba(248,113,113,0.1)",
    edit: "rgba(251,191,36,0.1)",
  };

  return (
    <div className="screen-content">
      <TopNav title="Governance" subtitle="Roles, CRUD rules & audit" />

      <div className="px-screen" style={{ paddingTop: 12 }}>
        {/* Summary */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {[
            { label: "Pending", value: pending, color: "var(--status-warning)", bg: "rgba(251,191,36,0.1)" },
            { label: "Approved", value: approved, color: "var(--status-ok)", bg: "rgba(74,222,128,0.08)" },
            { label: "Roles", value: roles.length, color: "var(--accent-purple)", bg: "rgba(168,85,247,0.08)" },
            { label: "CRUD Rules", value: crudRules.filter(r => r.requiresApproval).length, color: "var(--accent-amber)", bg: "rgba(251,191,36,0.06)" },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, background: s.bg, borderRadius: 12, padding: "10px 4px", textAlign: "center", border: `1px solid ${s.color}30` }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
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
            {/* Status filter chips */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto", scrollbarWidth: "none" }}>
              {["all", "pending", "approved", "rejected", "held"].map(f => (
                <button key={f} onClick={() => setApprovalFilter(f)} style={{ flexShrink: 0, padding: "5px 11px", borderRadius: 100, fontSize: 10, fontWeight: 700, cursor: "pointer", background: approvalFilter === f ? "rgba(74,222,128,0.15)" : "var(--card)", border: approvalFilter === f ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)", color: approvalFilter === f ? "var(--primary-green)" : "var(--text-muted)", textTransform: "capitalize" }}>{f}</button>
              ))}
            </div>
            {filteredApprovals.map(a => (
              <div key={a.code} style={{ marginBottom: 12, padding: 14, borderRadius: 16, border: `1px solid ${a.status === "pending" ? "rgba(251,191,36,0.3)" : a.status === "approved" ? "rgba(74,222,128,0.25)" : a.status === "held" ? "rgba(168,85,247,0.25)" : "rgba(248,113,113,0.25)"}`, background: a.status === "pending" ? "rgba(251,191,36,0.05)" : a.status === "approved" ? "rgba(74,222,128,0.04)" : a.status === "held" ? "rgba(168,85,247,0.04)" : "rgba(248,113,113,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
                      <span className="chip chip-info" style={{ fontSize: 9 }}>{a.type}</span>
                      <span style={{ fontSize: 9, color: "var(--text-dim)", fontWeight: 600, fontFamily: "monospace" }}>{a.code}</span>
                      {a.evidencePhoto && <span style={{ fontSize: 9, color: "var(--accent-cyan)", fontWeight: 700 }}>📷 Photo</span>}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.3 }}>{a.title}</div>
                  </div>
                  <span className={`chip ${a.status === "pending" ? "chip-warning" : a.status === "approved" ? "chip-ok" : a.status === "held" ? "chip-purple" : "chip-critical"}`} style={{ fontSize: 9, flexShrink: 0 }}>
                    {a.status.toUpperCase()}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, lineHeight: 1.5 }}>{a.details}</div>
                <div style={{ display: "flex", gap: 12, marginBottom: a.status === "pending" ? 10 : 0, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>By: <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{a.requestedByName}</span></span>
                  {a.amount && a.amount > 0 && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Amount: <span style={{ color: "var(--accent-amber)", fontWeight: 700 }}>KSh {a.amount.toLocaleString()}</span></span>}
                  {a.batchCode && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Batch: <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{a.batchCode}</span></span>}
                  <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{a.requestedAt}</span>
                </div>
                {a.status === "pending" && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => actApproval(a.code, "approved")} style={{ flex: 1, padding: "9px", borderRadius: 10, fontSize: 12, fontWeight: 700, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.35)", color: "var(--status-ok)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                      <Check size={13} /> Approve
                    </button>
                    <button onClick={() => actApproval(a.code, "rejected")} style={{ flex: 1, padding: "9px", borderRadius: 10, fontSize: 12, fontWeight: 700, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "var(--status-critical)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                      <X size={13} /> Reject
                    </button>
                    <button onClick={() => actApproval(a.code, "held")} style={{ padding: "9px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600, background: "var(--card)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", cursor: "pointer" }}>Hold</button>
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
          </div>
        )}

        {/* ── ROLE BUILDER TAB ── */}
        {tab === "roles" && (
          <div style={{ paddingBottom: 80 }}>
            <div style={{ padding: "10px 14px", background: "rgba(168,85,247,0.08)", borderRadius: 12, marginBottom: 14, border: "1px solid rgba(168,85,247,0.2)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
              <ShieldCheck size={12} style={{ verticalAlign: "middle", marginRight: 5 }} color="var(--accent-purple)" />
              Roles define what each employee can see and do. All role changes are logged in the Activity Log.
            </div>
            <button onClick={() => setEditRole("new")} style={{ width: "100%", marginBottom: 12, padding: "11px", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", background: "rgba(74,222,128,0.1)", border: "1px dashed rgba(74,222,128,0.4)", color: "var(--primary-green)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Plus size={15} /> Create New Role
            </button>

            {roles.map(r => {
              const expanded = expandedRole === r.id;
              const editableCount = Object.values(r.permissions).filter(p => p === "edit").length;
              const viewCount = Object.values(r.permissions).filter(p => p === "view").length;
              return (
                <div key={r.id} style={{ marginBottom: 10, borderRadius: 14, overflow: "hidden", border: "1px solid var(--border-subtle)" }}>
                  {/* Delete confirm inline */}
                  {deleteRoleConfirm === r.id && (
                    <div style={{ padding: "12px 14px", background: "rgba(248,113,113,0.08)", borderBottom: "1px solid rgba(248,113,113,0.2)" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--status-critical)", marginBottom: 8 }}>Delete "{r.name}"? This cannot be undone.</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => setDeleteRoleConfirm(null)} style={{ flex: 1, padding: "8px", borderRadius: 8, background: "var(--card)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Cancel</button>
                        <button onClick={() => deleteRole(r.id)} style={{ flex: 1, padding: "8px", borderRadius: 8, background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.4)", color: "var(--status-critical)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Delete</button>
                      </div>
                    </div>
                  )}

                  <button onClick={() => setExpandedRole(expanded ? null : r.id)} style={{ width: "100%", padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--card)", border: "none", cursor: "pointer" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: r.color, flexShrink: 0 }} />
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{r.name}</div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{editableCount} edit · {viewCount} view · {r.approvalRequired.length} need approval</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button onClick={e => { e.stopPropagation(); setEditRole(r); }} style={{ padding: "5px 10px", borderRadius: 8, fontSize: 10, fontWeight: 700, background: "var(--surface)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", cursor: "pointer" }}>Edit</button>
                      <button onClick={e => { e.stopPropagation(); setDeleteRoleConfirm(deleteRoleConfirm === r.id ? null : r.id); }} style={{ padding: "5px 8px", borderRadius: 8, fontSize: 10, fontWeight: 700, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "var(--status-critical)", cursor: "pointer" }}>
                        <Trash2 size={11} />
                      </button>
                      {expanded ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
                    </div>
                  </button>

                  {expanded && (
                    <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border-subtle)", padding: "12px 14px" }}>
                      {FEATURE_GROUPS.map(g => (
                        <div key={g.group} style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{g.group}</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {g.features.map(f => {
                              const perm = (r.permissions[f.key] as PermLevel) ?? "hidden";
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
                            {r.approvalRequired.map(a => (
                              <span key={a} style={{ fontSize: 10, padding: "3px 9px", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 100, color: "var(--accent-amber)", fontWeight: 600 }}>{a.replace(/-/g, " ")}</span>
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
              Configure which create/edit/delete actions require your explicit approval before taking effect. Changes are logged.
            </div>

            {crudRules.map(rule => (
              <div key={rule.id} style={{ marginBottom: 10, padding: "14px", borderRadius: 14, background: rule.requiresApproval ? "rgba(251,191,36,0.04)" : "var(--card)", border: `1px solid ${rule.requiresApproval ? "rgba(251,191,36,0.25)" : "var(--border-subtle)"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{rule.label}</div>
                      {rule.requiresApproval && <span className="chip chip-warning" style={{ fontSize: 9 }}>APPROVAL REQUIRED</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>{rule.description}</div>
                    <div style={{ marginTop: 5, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {rule.affectedRoles.map(roleId => (
                        <span key={roleId} style={{ fontSize: 9, padding: "2px 7px", borderRadius: 100, background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.25)", color: "var(--accent-purple)", fontWeight: 700 }}>
                          {roleId === "all" ? "All Roles" : roleId.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                  {/* Toggle */}
                  <button onClick={() => toggleCrudRule(rule.id)} style={{ width: 48, height: 26, borderRadius: 100, cursor: "pointer", border: "none", background: rule.requiresApproval ? "var(--accent-amber)" : "var(--border-subtle)", position: "relative", flexShrink: 0, marginLeft: 12 }}>
                    <div style={{ position: "absolute", top: 3, left: rule.requiresApproval ? 24 : 3, width: 20, height: 20, borderRadius: "50%", background: "white", transition: "left 0.15s" }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── ACTIVITY LOG TAB ── */}
        {tab === "audit" && (
          <div style={{ paddingBottom: 80 }}>
            {/* Search + role filter */}
            <SearchBar value={activitySearch} onChange={setActivitySearch} placeholder="Search actions, users, targets…" />
            <div style={{ display: "flex", gap: 5, marginBottom: 12, overflowX: "auto", scrollbarWidth: "none" }}>
              {[["all", "All Roles"], ...OWNER_ROLES.map(r => [r.id, r.name])].map(([id, label]) => (
                <button key={id} onClick={() => setActivityRoleFilter(id)} style={{ flexShrink: 0, padding: "5px 10px", borderRadius: 100, fontSize: 10, fontWeight: 700, cursor: "pointer", background: activityRoleFilter === id ? "rgba(74,222,128,0.15)" : "var(--card)", border: activityRoleFilter === id ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)", color: activityRoleFilter === id ? "var(--primary-green)" : "var(--text-muted)" }}>{label}</button>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredActivity.map(entry => (
                <div key={entry.id} className="farm-card" style={{ padding: 12 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: TYPE_BG[entry.type] ?? "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {TYPE_ICON[entry.type]}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{entry.action}</div>
                        <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 100, background: "rgba(255,255,255,0.06)", color: "var(--text-dim)", fontWeight: 700, flexShrink: 0, marginLeft: 6 }}>{entry.roleName}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{entry.target}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{entry.user}</span>
                        <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "monospace" }}>{entry.timestamp}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {filteredActivity.length === 0 && (
                <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)" }}>
                  <Activity size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>No activity found</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Role builder sheet */}
      {editRole !== undefined && (
        <RoleBuilderSheet
          role={editRole === "new" ? null : editRole}
          onClose={() => setEditRole(undefined)}
          onSave={saveRole}
        />
      )}
    </div>
  );
}
