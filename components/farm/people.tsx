"use client";
import React, { useState } from "react";
import { useNav, TopNav } from "./navigation";
import { Plus, Key, Edit2, ChevronRight, Check, X, Search, RefreshCw } from "./icons";
import { EMPLOYEES_DATA, OWNER_ROLES } from "./data";
import { CsvImportModal } from "./csv-import";
import { DataTable, ColDef, usePersistedView } from "./data-table";

// Map data.ts employees to local display format
const EMPLOYEES = EMPLOYEES_DATA.map((e) => ({
  id: e.code,
  name: e.name,
  roleId: e.role,
  role: OWNER_ROLES.find(r => r.id === e.role)?.name ?? e.customRole ?? e.role.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
  phone: e.phone,
  salary: e.salary,
  payday: e.payday,
  active: e.active,
  startDate: e.startDate,
  endDate: e.endDate,
  batches: e.batches,
  pin: e.pin,
  farmCode: e.farmCode,
}));

function getRoleColor(roleId: string) {
  const colors: Record<string, string> = {
    manager: "var(--accent-purple)", worker: "var(--primary-green)",
    vet: "var(--accent-cyan)", harvest_lead: "var(--accent-amber)",
    owner: "var(--accent-amber)", auditor: "var(--accent-blue)",
  };
  return colors[roleId] ?? "var(--text-muted)";
}
function getRoleBadge(roleId: string) {
  const badges: Record<string, string> = {
    manager: "chip-purple", worker: "chip-ok",
    vet: "chip-cyan", harvest_lead: "chip-warning",
    owner: "chip-warning", auditor: "chip-info",
  };
  return badges[roleId] ?? "chip-info";
}

/* Column definitions for the table view */
const PEOPLE_COLS: ColDef<Record<string, unknown>>[] = [
  {
    key: "name", header: "Name", sortable: true, minWidth: 140,
    summary: () => <span style={{ fontWeight: 700, fontSize: 11, color: "var(--text-muted)" }}>TOTALS</span>,
    render: (r) => (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
          background: `${getRoleColor(r.roleId as string)}20`,
          border: `1px solid ${getRoleColor(r.roleId as string)}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 700, color: getRoleColor(r.roleId as string),
        }}>
          {(r.name as string).split(" ").map((n: string) => n[0]).join("")}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 12 }}>{r.name as string}</div>
          <div style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "monospace" }}>{r.id as string}</div>
        </div>
      </div>
    ),
  },
  {
    key: "role", header: "Role", sortable: true, minWidth: 90,
    render: (r) => <span className={`chip ${getRoleBadge(r.roleId as string)}`} style={{ fontSize: 9 }}>{r.role as string}</span>,
  },
  { key: "phone", header: "Phone", minWidth: 120, render: (r) => <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{(r.phone as string) || "—"}</span> },
  {
    key: "salary", header: "Salary", sortable: true, align: "right", minWidth: 90,
    summary: "sum",
    render: (r) => <span style={{ fontSize: 12, fontWeight: 600 }}>KSh {(r.salary as number).toLocaleString()}</span>,
  },
  {
    key: "active", header: "Status", align: "center", minWidth: 70,
    summary: "count",
    render: (r) => <span className={`chip ${r.active ? "chip-ok" : "chip-info"}`} style={{ fontSize: 9 }}>{r.active ? "ACTIVE" : "INACTIVE"}</span>,
  },
  {
    key: "startDate", header: "Joined", sortable: true, minWidth: 90,
    render: (r) => <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.startDate as string}</span>,
  },
];

export function PeopleScreen() {
  const { navigate } = useNav();
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addStep, setAddStep] = useState(1);
  const [showImport, setShowImport] = useState(false);
  const [employees, setEmployees] = useState(EMPLOYEES);
  const [viewMode, setViewMode] = usePersistedView<"card" | "table">("people", "card");

  function handleImportRows(rows: Record<string, string>[]) {
    const imported = rows.map((row, idx) => ({
      id: row.code || `EMP-IMP-${Date.now()}-${idx}`,
      name: row.name || "Imported Employee",
      roleId: row.role || "worker",
      role: OWNER_ROLES.find(r => r.id === row.role)?.name ?? (row.role || "Worker").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      phone: row.phone || "",
      salary: row.salary ? parseFloat(row.salary) : 0,
      payday: row.payday ? parseInt(row.payday) : 28,
      active: row.active !== "false",
      startDate: row.startDate || new Date().toISOString().slice(0, 10),
      endDate: row.endDate || undefined,
      batches: row.batches ? row.batches.split("|").map(b => b.trim()).filter(Boolean) : [],
      pin: row.pin ? row.pin : null,
      farmCode: row.farmCode || "FRM-KMU-001",
    }));
    setEmployees(prev => {
      const existingIds = new Set(prev.map(e => e.id));
      const newRows = imported.filter(r => !existingIds.has(r.id));
      const updated = prev.map(e => {
        const match = imported.find(r => r.id === e.id);
        return match ? { ...e, ...match } : e;
      });
      return [...updated, ...newRows];
    });
  }

  const roles = ["All", ...Array.from(new Set(employees.map(e => e.role)))];
  const filtered = employees
    .filter((e) => filter === "All" || e.role === filter)
    .filter((e) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || (e.phone || "").includes(q);
    });

  return (
    <div className="screen-content">
      <TopNav title="People" subtitle="Staff, roles & access"
        rightEl={
          <div style={{ display: "flex", gap: 6 }}>
            {/* Card / Table toggle */}
            <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", border: "1px solid var(--border-subtle)" }}>
              {(["card","table"] as const).map((m) => (
                <button key={m} onClick={() => setViewMode(m)} style={{
                  width: 32, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                  background: viewMode === m ? "rgba(74,222,128,0.15)" : "var(--surface)", border: "none",
                  color: viewMode === m ? "var(--primary-green)" : "var(--text-dim)", fontSize: 14,
                }} title={m === "card" ? "Card view" : "Table view"}>
                  {m === "card" ? "☰" : "⊞"}
                </button>
              ))}
            </div>
            <button onClick={() => setShowImport(true)} style={{ width: 36, height: 36, borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} title="Import employees CSV">
              <RefreshCw size={13} color="var(--text-muted)" />
            </button>
            <button className="btn-fab" style={{ width: 36, height: 36, borderRadius: 10 }} onClick={() => setShowAdd(true)}>
              <Plus size={16} />
            </button>
          </div>
        }
      />

      <div className="px-screen" style={{ paddingTop: 12 }}>
        {/* Summary */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {[
            { label: "Active", value: employees.filter(e => e.active).length, color: "var(--status-ok)" },
            { label: "Inactive", value: employees.filter(e => !e.active).length, color: "var(--text-muted)" },
            { label: "On Payroll", value: employees.filter(e => e.active).length, color: "var(--accent-amber)" },
          ].map((s) => (
            <div key={s.label} style={{ flex: 1, background: "var(--card)", borderRadius: 12, padding: "10px 8px", textAlign: "center", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: 10 }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
          <input className="farm-input" style={{ paddingLeft: 34, fontSize: 13 }} placeholder="Search name, code, phone…" value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0 }}><X size={14} /></button>}
        </div>

        {/* Filter */}
        <div className="chip-row" style={{ marginBottom: 14 }}>
          {roles.map((r) => (
            <button key={r} onClick={() => setFilter(r)} className={`filter-chip ${filter === r ? "active" : ""}`}>{r}</button>
          ))}
        </div>

        {/* Employee list: card view or table view */}
        {viewMode === "table" ? (
          <div style={{ marginBottom: 80 }}>
            <DataTable
              rows={filtered as unknown as Record<string, unknown>[]}
              columns={PEOPLE_COLS}
              rowKey={(r) => r.id as string}
              onRowClick={(r) => navigate("people-detail", { id: r.id as string })}
              defaultPageSize={20}
              pageSizes={[10, 20, 50, 100, 200]}
              bodyHeight={380}
              tableId="people-staff"
              emptyText="No staff match your search."
            />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 80 }}>
            {filtered.length === 0 && <div style={{ textAlign: "center", padding: "28px 0", color: "var(--text-dim)", fontSize: 13 }}>No staff match your search.</div>}
            {filtered.map((emp) => (
              <button key={emp.id} onClick={() => navigate("people-detail", { id: emp.id })}
                className="farm-card" style={{ padding: 14, textAlign: "left", width: "100%", cursor: "pointer" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                    background: `${getRoleColor(emp.roleId)}20`,
                    border: `1px solid ${getRoleColor(emp.roleId)}40`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 16, fontWeight: 700, color: getRoleColor(emp.roleId),
                  }}>
                    {emp.name.split(" ").map(n => n[0]).join("")}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{emp.name}</span>
                      {!emp.active && <span style={{ fontSize: 10, background: "rgba(255,255,255,0.06)", color: "var(--text-dim)", padding: "1px 6px", borderRadius: 100, fontWeight: 600 }}>Inactive</span>}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className={`chip ${getRoleBadge(emp.roleId)}`} style={{ fontSize: 9 }}>{emp.role}</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{emp.phone}</span>
                    </div>
                    <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>KSh {emp.salary.toLocaleString()}/mo</span>
                      {emp.pin !== null && (
                        <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--text-muted)" }}>
                          <Key size={10} /> PIN set
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={16} color="var(--text-dim)" />
                </div>
                {emp.batches.length > 0 && (
                  <div style={{ marginTop: 10, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {emp.batches.slice(0, 4).map((b) => (
                      <span key={b} style={{ padding: "2px 8px", borderRadius: 100, background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.15)", fontSize: 10, color: "var(--text-secondary)", fontWeight: 600 }}>{b}</span>
                    ))}
                    {emp.batches.length > 4 && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>+{emp.batches.length - 4} more</span>}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* CSV Import Modal */}
      {showImport && (
        <CsvImportModal
          entity="employees"
          onClose={() => setShowImport(false)}
          onImport={handleImportRows}
        />
      )}

      {/* Add Employee Modal */}
      {showAdd && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "flex-end", zIndex: 100 }} onClick={() => setShowAdd(false)}>
          <div style={{ background: "var(--surface)", borderRadius: "24px 24px 0 0", padding: 20, width: "100%", border: "1px solid var(--border-subtle)", maxHeight: "80%" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Add Employee</div>
              <button className="btn-icon" onClick={() => setShowAdd(false)}><X size={16} /></button>
            </div>

            {/* Steps */}
            <div style={{ display: "flex", gap: 0, marginBottom: 20 }}>
              {["Identity", "Access", "Batches"].map((s, i) => (
                <React.Fragment key={s}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <div className={`step-node ${i + 1 < addStep ? "done" : i + 1 === addStep ? "active" : "pending"}`} style={{ width: 22, height: 22, fontSize: 10 }}>{i + 1 < addStep ? "✓" : i + 1}</div>
                    <span style={{ fontSize: 9, fontWeight: 700, color: addStep === i + 1 ? "var(--primary-green)" : "var(--text-dim)" }}>{s}</span>
                  </div>
                  {i < 2 && <div className={`step-line ${i + 1 < addStep ? "done" : ""}`} style={{ marginTop: 11 }} />}
                </React.Fragment>
              ))}
            </div>

            {addStep === 1 && (
              <div>
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Full Name</label>
                  <input className="farm-input" placeholder="Employee name" />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Phone</label>
                  <input className="farm-input" placeholder="+254-7xx-xxx-xxx" type="tel" />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Role</label>
                  <select className="farm-input">
                    <option>Worker</option><option>Manager</option><option>Vet</option><option>Auditor</option>
                  </select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Monthly Salary</label>
                    <input className="farm-input" placeholder="KSh" type="number" />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Payday (1–31)</label>
                    <input className="farm-input" placeholder="28" type="number" />
                  </div>
                </div>
              </div>
            )}

            {addStep === 2 && (
              <div>
                <div style={{ padding: "10px 12px", background: "rgba(74,222,128,0.06)", borderRadius: 10, marginBottom: 14, fontSize: 11, color: "var(--text-muted)" }}>
                  Workers log in with a <strong style={{ color: "var(--text-secondary)" }}>4-digit PIN</strong>. Managers, Vets, and Auditors use <strong style={{ color: "var(--text-secondary)" }}>email + password</strong>.
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Login PIN (4 digits)</label>
                  <input className="farm-input" placeholder="••••" type="password" maxLength={4} style={{ letterSpacing: "0.3em", fontSize: 18, textAlign: "center" }} />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Photo Required Above (deaths)</label>
                  <input className="farm-input" placeholder="e.g. 3" type="number" />
                </div>
              </div>
            )}

            {addStep === 3 && (
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>Select batches this employee can access:</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                  {["All batches (auto-includes future)", "BRO-22 – Broilers Oct", "BRO-23 – Broilers Nov", "LAY-08 – Layers Batch 8", "PIG-04 – Pig Fatteners"].map((b, i) => (
                    <div key={b} style={{ padding: "10px 12px", background: i === 0 ? "rgba(74,222,128,0.08)" : "var(--card)", border: `1px solid ${i === 0 ? "rgba(74,222,128,0.3)" : "var(--border-subtle)"}`, borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: i === 0 ? "var(--primary-green)" : "var(--text-secondary)", fontWeight: i === 0 ? 700 : 400 }}>{b}</span>
                      {i === 0 && <Check size={14} color="var(--primary-green)" />}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              {addStep > 1 && <button className="btn-secondary" style={{ flex: 1, justifyContent: "center", borderRadius: 12, padding: "12px" }} onClick={() => setAddStep(addStep - 1)}>Back</button>}
              <button className="btn-primary" style={{ flex: 2, justifyContent: "center", borderRadius: 12, padding: "12px" }} onClick={() => { if (addStep < 3) setAddStep(addStep + 1); else setShowAdd(false); }}>
                {addStep === 3 ? "Add Employee" : "Next"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PeopleDetailScreen() {
  const { goBack, params } = useNav();
  const empBase = EMPLOYEES.find((e) => e.id === params.id) ?? EMPLOYEES[0];
  const [activeSection, setActiveSection] = useState<"profile" | "permissions" | "payroll">("profile");
  const [assignedRoleId, setAssignedRoleId] = useState(empBase.roleId);
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [roleSaved, setRoleSaved] = useState(false);

  const assignedRole = OWNER_ROLES.find(r => r.id === assignedRoleId);
  const roleName = assignedRole?.name ?? assignedRoleId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  function handleSaveRole(newRoleId: string) {
    setAssignedRoleId(newRoleId);
    setShowRoleDropdown(false);
    setRoleSaved(true);
    setTimeout(() => setRoleSaved(false), 2000);
  }

  return (
    <div className="screen-content">
      <TopNav title={empBase.name} subtitle={`${roleName} · ${empBase.active ? "Active" : "Inactive"}`} showBack />
      <div className="px-screen" style={{ paddingTop: 16 }}>
        {/* Avatar & header */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
          <div style={{
            width: 72, height: 72, borderRadius: "50%",
            background: `${getRoleColor(assignedRoleId)}20`, border: `2px solid ${getRoleColor(assignedRoleId)}50`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 26, fontWeight: 700, color: getRoleColor(assignedRoleId), marginBottom: 10,
          }}>{empBase.name.split(" ").map(n => n[0]).join("")}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>{empBase.name}</div>
          <span className={`chip ${getRoleBadge(assignedRoleId)}`} style={{ marginTop: 6 }}>{roleName}</span>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {(["profile","permissions","payroll"] as const).map((t) => (
            <button key={t} onClick={() => setActiveSection(t)} style={{
              flex: 1, padding: "8px", borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: "pointer",
              background: activeSection === t ? "rgba(74,222,128,0.15)" : "var(--card)",
              border: activeSection === t ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)",
              color: activeSection === t ? "var(--primary-green)" : "var(--text-muted)", textTransform: "capitalize",
            }}>{t}</button>
          ))}
        </div>

        {activeSection === "profile" && (
          <div>
            {/* Role Assignment */}
            <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Role Assignment</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{roleName}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {assignedRole ? `${Object.values(assignedRole.permissions).filter(p => p === "edit").length} edit · ${assignedRole.approvalRequired.length} need approval` : "Custom role"}
                  </div>
                </div>
                <button onClick={() => setShowRoleDropdown(s => !s)}
                  style={{ padding: "7px 12px", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer",
                    background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", color: "var(--primary-green)" }}>
                  {showRoleDropdown ? "Cancel" : "Change Role"}
                </button>
              </div>
              {roleSaved && (
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--status-ok)", fontWeight: 700 }}>✅ Role updated successfully</div>
              )}
              {showRoleDropdown && (
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}>Select a role to assign:</div>
                  {OWNER_ROLES.map((r) => (
                    <button key={r.id} onClick={() => handleSaveRole(r.id)}
                      style={{ padding: "10px 12px", borderRadius: 10, cursor: "pointer", textAlign: "left",
                        background: assignedRoleId === r.id ? "rgba(74,222,128,0.12)" : "var(--surface)",
                        border: assignedRoleId === r.id ? "2px solid var(--primary-green)" : "1px solid var(--border-subtle)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <div style={{ width: 10, height: 10, borderRadius: "50%", background: r.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: assignedRoleId === r.id ? "var(--primary-green)" : "var(--text-primary)" }}>{r.name}</span>
                        </div>
                        {assignedRoleId === r.id && <Check size={13} color="var(--primary-green)" />}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 3, marginLeft: 18 }}>
                        {Object.values(r.permissions).filter(p => p === "edit").length} editable features
                        {r.approvalRequired.length > 0 && ` · ${r.approvalRequired.length} need approval`}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="farm-card" style={{ overflow: "hidden", marginBottom: 14 }}>
              {[
                { label: "Employee Code", value: empBase.id },
                { label: "Phone", value: empBase.phone },
                { label: "Monthly Salary", value: `KSh ${empBase.salary.toLocaleString()}` },
                { label: "Payday", value: `Day ${empBase.payday} of month` },
                { label: "Start Date", value: empBase.startDate },
                { label: "End Date", value: empBase.endDate ?? "Ongoing" },
                { label: "Login", value: empBase.pin !== null ? "PIN (Worker)" : "Email + Password" },
              ].map((row, i, arr) => (
                <div key={row.label} style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", borderBottom: i < arr.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{row.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", fontFamily: row.label === "Employee Code" ? "monospace" : undefined }}>{row.value}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              <button className="btn-secondary" style={{ justifyContent: "center", padding: 12, borderRadius: 12 }}>Edit Details</button>
              <button style={{ padding: 12, borderRadius: 12, fontSize: 13, fontWeight: 700, background: empBase.active ? "rgba(248,113,113,0.1)" : "rgba(74,222,128,0.1)", border: `1px solid ${empBase.active ? "rgba(248,113,113,0.3)" : "rgba(74,222,128,0.3)"}`, color: empBase.active ? "var(--status-critical)" : "var(--status-ok)", cursor: "pointer" }}>
                {empBase.active ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          </div>
        )}

        {activeSection === "permissions" && (
          <div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
              Permissions inherited from the <strong style={{ color: "var(--text-secondary)" }}>{roleName}</strong> role. Go to Governance → Role Builder to edit role permissions.
            </div>
            <div className="farm-card" style={{ overflow: "hidden", marginBottom: 14 }}>
              {assignedRole ? (
                Object.entries(assignedRole.permissions).map(([key, perm], i, arr) => (
                  <div key={key} style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: i < arr.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{key.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
                    <span className={`chip ${perm === "edit" ? "chip-ok" : perm === "view" ? "chip-info" : "chip-critical"}`} style={{ fontSize: 9 }}>
                      {perm === "edit" ? "Editable" : perm === "view" ? "Read-only" : "Hidden"}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ padding: "14px", fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>No role permissions configured</div>
              )}
            </div>
            {assignedRole && assignedRole.approvalRequired.length > 0 && (
              <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-amber)", marginBottom: 8, textTransform: "uppercase" }}>Requires Owner Approval</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {assignedRole.approvalRequired.map(a => (
                    <span key={a} style={{ padding: "4px 10px", borderRadius: 100, fontSize: 10, fontWeight: 700,
                      background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", color: "var(--accent-amber)" }}>
                      {a.replace(/-/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeSection === "payroll" && (
          <div>
            <div className="farm-card" style={{ overflow: "hidden", marginBottom: 14 }}>
              {[
                { period: "Jul 2026", gross: empBase.salary, net: empBase.salary * 0.9, status: "paid" },
                { period: "Jun 2026", gross: empBase.salary, net: empBase.salary * 0.9, status: "paid" },
                { period: "May 2026", gross: empBase.salary, net: empBase.salary * 0.85, status: "paid" },
              ].map((p, i, arr) => (
                <div key={p.period} style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: i < arr.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{p.period}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Gross: KSh {p.gross.toLocaleString()} · Net: KSh {p.net.toLocaleString()}</div>
                  </div>
                  <span className="chip chip-ok" style={{ fontSize: 9 }}>PAID</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}