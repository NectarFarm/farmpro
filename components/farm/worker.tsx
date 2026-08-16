"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useNav, TopNav } from "./navigation";
import { useToast } from "./ui-shared";
import { useLogout } from "@/app/page";
import { apiClient } from "@/lib/request";
import {
  Plus, Camera,
  ChevronRight, Wifi, Check, Lock, ClipboardList,
} from "./icons";
import {
  splitNotes, displayStatus, STATUS_LABEL, statusChipClass,
  type ApiTask,
} from "./tasks";

// ── Real API shapes (issue #248) ────────────────────────────────────────────
// Wired to GET /api/employees/me and GET/POST /api/records (issue #247).
// Replaces the old hardcoded task-list mock and the hardcoded `count >= 3`
// mortality gate — the photo threshold now comes from the worker's real
// employees row.
interface ApiEmployeeMe {
  id: string;
  tenantId: string;
  userId: string | null;
  name: string;
  phone: string;
  role: string;
  assignedBatchIds: string[];
  mortalityPhotoThreshold: number;
  status: string;
}

interface ApiBatch {
  id: string;
  code: string;
  name: string;
  currentQty: number;
}

interface ApiRecord {
  id: string;
  tenantId: string;
  batchId: string;
  employeeId: string;
  type: string;
  data: Record<string, unknown>;
  photoUrl: string | null;
  createdAt: string | null;
}

const RECORD_TYPE_LABEL: Record<string, { label: string; emoji: string }> = {
  feeding: { label: "Feeding", emoji: "🌾" },
  mortality: { label: "Mortality", emoji: "⚠️" },
  physical_count: { label: "Physical Count", emoji: "🔢" },
};

// The backend only supports these three record types today (db/schemas/people.ts).
// Other tile ideas from the old mock (morning round, collect products, health &
// vaccine, weight sample, closing stock) have no backend yet — shown as an
// honest "not available yet" group instead of silently disappearing or being
// wired to fabricated data.
const UNAVAILABLE_RECORD_TYPES = [
  { label: "Morning Round", emoji: "🌅" },
  { label: "Collect Products", emoji: "🥚" },
  { label: "Health & Vaccine", emoji: "💉" },
  { label: "Weight Sample", emoji: "⚖️" },
  { label: "Closing Stock", emoji: "📦" },
];

/* Shared fetch of the logged-in worker's own employee row + their assigned
 * batches. Each screen below calls this independently (same per-screen-fetch
 * convention as components/farm/crops.tsx — there is no shared worker-portal
 * provider on this branch). */
function useWorkerContext() {
  const { tenantId } = useNav();
  const [employee, setEmployee] = useState<ApiEmployeeMe | null>(null);
  const [employeeError, setEmployeeError] = useState("");
  const [batches, setBatches] = useState<ApiBatch[] | null>(null);

  const reload = useCallback(() => {
    apiClient.get<ApiEmployeeMe>(`/api/employees/me?tenantId=${tenantId}`).then((res) => {
      if (res.success) { setEmployee(res.data); setEmployeeError(""); }
      else setEmployeeError(res.error || "Could not load your worker profile.");
    });
  }, [tenantId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!employee) return;
    apiClient.get<ApiBatch[]>(`/api/batches?tenantId=${tenantId}`).then((res) => {
      if (!res.success) { setBatches([]); return; }
      // No "ALL" sentinel on the real backend (db/schemas/people.ts) — an
      // employee with an empty assignedBatchIds genuinely has no batches
      // assigned yet, not implicit access to every batch.
      const assigned = employee.assignedBatchIds.length > 0
        ? res.data.filter((b) => employee.assignedBatchIds.includes(b.id))
        : [];
      setBatches(assigned);
    });
  }, [employee, tenantId]);

  return { tenantId, employee, employeeError, batches, reload };
}

function timeOf(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function isToday(iso: string | null) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// ── "My Tasks Today" (issue #303) ───────────────────────────────────────────
// Restores the original Happy Seeds design's Worker Home checklist ("what do
// I still need to do today"), dropped when this screen was wired to real data
// (issue #248) and replaced with "Recent Activity" ("what did I just do") —
// a good addition, but not a substitute. Sourced from the same GET /api/tasks
// (issue #227, extended #243/#244) the Tasks/Governance screens already use;
// the server-side `due=today` filter is the exact one built for this
// purpose (see app/api/tasks/route.ts's header comment). There's no
// `assigneeId` column on `tasks`, so — exactly like components/farm/tasks.tsx
// — the assignee's name is parsed back out of `notes`'s "Assigned: <name>"
// prefix via the shared `splitNotes` helper; a task counts as "mine" when
// that name matches the logged-in worker's own employee name.
export function selectMyTasksToday(tasks: ApiTask[], workerName: string): ApiTask[] {
  const name = workerName.trim().toLowerCase();
  if (!name) return [];
  return tasks.filter((t) => splitNotes(t.notes).assignee.trim().toLowerCase() === name);
}

export function WorkerHomeScreen() {
  const { navigate } = useNav();
  const { tenantId, employee, employeeError, batches } = useWorkerContext();
  const { showToast } = useToast();
  const [recent, setRecent] = useState<ApiRecord[] | null>(null);
  const [batchLabel, setBatchLabel] = useState<Record<string, string>>({});
  const [tasksToday, setTasksToday] = useState<ApiTask[] | null>(null);
  const [taskActionId, setTaskActionId] = useState<string | null>(null);

  useEffect(() => {
    if (!employee) return;
    apiClient.get<ApiRecord[]>(`/api/records?tenantId=${tenantId}&employeeId=${employee.id}`).then((res) => {
      if (res.success) setRecent(res.data.slice(0, 5));
    });
  }, [employee, tenantId]);

  const loadTasksToday = useCallback(() => {
    if (!employee) return;
    apiClient.get<ApiTask[]>(`/api/tasks?tenantId=${tenantId}&due=today`).then((res) => {
      if (res.success) setTasksToday(selectMyTasksToday(res.data, employee.name));
    });
  }, [employee, tenantId]);

  useEffect(() => { loadTasksToday(); }, [loadTasksToday]);

  useEffect(() => {
    if (!batches) return;
    setBatchLabel(Object.fromEntries(batches.map((b) => [b.id, b.code])));
  }, [batches]);

  // Mark-done goes through the identical PATCH /api/tasks/[id] as
  // components/farm/tasks.tsx's `markDone` — including the
  // requiresApproval -> PENDING_APPROVAL transition — so a task completed
  // from Worker Home behaves exactly like completing it from Tasks/Governance.
  async function markTaskDone(task: ApiTask) {
    setTaskActionId(task.id);
    const res = await apiClient.patch<ApiTask & { approvalRequestId?: string }>(`/api/tasks/${task.id}?tenantId=${tenantId}`, { status: "DONE" });
    setTaskActionId(null);
    if (!res.success) { showToast(res.error ?? "Could not update task", "error"); return; }
    showToast(res.data.approvalRequestId ? "Submitted for owner approval" : "Task marked as done ✓", res.data.approvalRequestId ? "info" : "success");
    loadTasksToday();
  }

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const doneTodayTypes = new Set((recent ?? []).filter((r) => isToday(r.createdAt)).map((r) => r.type));

  return (
    <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
      {/* Greeting */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{greeting}</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>{employee?.name ?? "…"} 🌾</div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: "rgba(96,165,250,0.1)", borderRadius: 100, border: "1px solid rgba(96,165,250,0.25)" }}>
            <Wifi size={11} color="var(--accent-blue)" />
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-blue)" }}>Online</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>
        </div>
      </div>

      {employeeError && <div style={{ fontSize: 12, color: "var(--status-critical)", marginBottom: 14 }}>{employeeError}</div>}

      {/* My Tasks Today — real GET /api/tasks?due=today, filtered to this
          worker via the "Assigned: <name>" notes convention (issue #303) */}
      <div className="section-eyebrow" style={{ marginBottom: 10 }}>My Tasks Today</div>
      <div className="farm-card" style={{ marginBottom: 14, overflow: "hidden" }}>
        {tasksToday === null && <div style={{ padding: 14, fontSize: 12, color: "var(--text-dim)" }}>Loading…</div>}
        {tasksToday !== null && tasksToday.length === 0 && (
          <div style={{ padding: 14, fontSize: 12, color: "var(--text-dim)" }}>Nothing due today — all caught up.</div>
        )}
        {tasksToday !== null && tasksToday.map((t, i) => {
          const status = displayStatus(t);
          const done = t.status === "DONE";
          const pendingApproval = status === "PENDING_APPROVAL";
          return (
            <div key={t.id} style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", borderBottom: i < tasksToday.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: done ? "rgba(74,222,128,0.12)" : "var(--surface)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <ClipboardList size={16} color={done ? "var(--status-ok)" : "var(--text-muted)"} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: done ? "var(--text-muted)" : "var(--text-primary)", textDecoration: done ? "line-through" : "none" }}>{t.title}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: status === "OVERDUE" ? "var(--status-critical)" : "var(--text-dim)" }}>Due {timeOf(t.dueAt)}</span>
                  {!done && !pendingApproval && (
                    <span className={`chip ${statusChipClass(status)}`} style={{ fontSize: 9 }}>{STATUS_LABEL[status] ?? status}</span>
                  )}
                  {pendingApproval && <span style={{ fontSize: 11, color: "var(--status-warning)" }}>Pending approval</span>}
                  {done && <span style={{ fontSize: 11, color: "var(--status-ok)" }}>✓ Done</span>}
                </div>
              </div>
              {!done && !pendingApproval && (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => markTaskDone(t)} disabled={taskActionId === t.id} style={{
                    padding: "7px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                    background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)",
                    color: "var(--primary-green)", cursor: taskActionId === t.id ? "default" : "pointer",
                  }} title="Mark this task done">
                    <Check size={12} />
                  </button>
                  <button onClick={() => navigate("worker-record")} style={{
                    padding: "7px 12px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                    background: "var(--card)", border: "1px solid var(--border-subtle)",
                    color: "var(--text-primary)", cursor: "pointer",
                  }}>Open</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent activity (real GET /api/records, not a task mock) */}
      <div className="section-eyebrow" style={{ marginBottom: 10 }}>Recent Activity</div>
      <div className="farm-card" style={{ marginBottom: 14, overflow: "hidden" }}>
        {recent === null && <div style={{ padding: 14, fontSize: 12, color: "var(--text-dim)" }}>Loading…</div>}
        {recent !== null && recent.length === 0 && (
          <div style={{ padding: 14, fontSize: 12, color: "var(--text-dim)" }}>No records submitted yet — use Quick Record below.</div>
        )}
        {recent !== null && recent.map((r, i) => (
          <div key={r.id} style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", borderBottom: i < recent.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0, fontSize: 18,
              background: "rgba(74,222,128,0.12)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{RECORD_TYPE_LABEL[r.type]?.emoji ?? "📋"}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{RECORD_TYPE_LABEL[r.type]?.label ?? r.type}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{batchLabel[r.batchId] ?? r.batchId.slice(0, 8)}</span>
                <span style={{ fontSize: 11, color: "var(--status-ok)" }}>{timeOf(r.createdAt)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Record tiles */}
      <div className="section-eyebrow" style={{ marginBottom: 10 }}>Quick Record</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
        {Object.entries(RECORD_TYPE_LABEL).map(([type, meta]) => (
          <button key={type} onClick={() => navigate("worker-record")} style={{
            padding: "12px 4px", borderRadius: 14, background: doneTodayTypes.has(type) ? "rgba(74,222,128,0.08)" : "var(--card)",
            border: doneTodayTypes.has(type) ? "1px solid rgba(74,222,128,0.25)" : "1px solid var(--border-subtle)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "pointer", position: "relative",
          }}>
            {doneTodayTypes.has(type) && <div style={{ position: "absolute", top: 6, right: 6, width: 8, height: 8, borderRadius: "50%", background: "var(--status-ok)" }} />}
            <span style={{ fontSize: 22 }}>{meta.emoji}</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: doneTodayTypes.has(type) ? "var(--primary-green)" : "var(--text-muted)", textAlign: "center", lineHeight: 1.3 }}>{meta.label}</span>
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
        {UNAVAILABLE_RECORD_TYPES.map((tile) => (
          <div key={tile.label} style={{
            padding: "12px 4px", borderRadius: 14, background: "var(--card)", opacity: 0.5,
            border: "1px dashed var(--border-subtle)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          }}>
            <span style={{ fontSize: 22 }}>{tile.emoji}</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-dim)", textAlign: "center", lineHeight: 1.3 }}>{tile.label}</span>
            <span style={{ fontSize: 7, color: "var(--text-dim)" }}>Not available yet</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkerRecordScreen() {
  const ctx = useWorkerContext();
  const [activeForm, setActiveForm] = useState<null | string>(null);

  if (!ctx.employee) {
    return (
      <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
        {ctx.employeeError ? (
          <div style={{ fontSize: 13, color: "var(--status-critical)" }}>{ctx.employeeError}</div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Loading…</div>
        )}
      </div>
    );
  }

  if (activeForm === "feeding") return <FeedingForm ctx={ctx} onBack={() => setActiveForm(null)} />;
  if (activeForm === "mortality") return <MortalityForm ctx={ctx} onBack={() => setActiveForm(null)} />;
  if (activeForm === "count") return <PhysicalCountForm ctx={ctx} onBack={() => setActiveForm(null)} />;

  const GROUPS = [
    {
      label: "Real record types",
      tiles: [
        { type: "feeding", label: "Feeding", emoji: "🌾", desc: "Log feed per batch" },
        { type: "mortality", label: "Mortality", emoji: "⚠️", desc: "Record deaths" },
        { type: "count", label: "Physical Count", emoji: "🔢", desc: "Vs system count" },
      ],
    },
  ];

  return (
    <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>Record</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Choose what to log</div>
      </div>

      {GROUPS.map((g) => (
        <div key={g.label} style={{ marginBottom: 16 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>{g.label}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {g.tiles.map((tile) => (
              <button key={tile.type} onClick={() => setActiveForm(tile.type)}
                className="farm-card" style={{ padding: 14, textAlign: "left", cursor: "pointer", display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, background: "var(--surface)",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0,
                }}>{tile.emoji}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{tile.label}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{tile.desc}</div>
                </div>
                <ChevronRight size={16} color="var(--text-dim)" />
              </button>
            ))}
          </div>
        </div>
      ))}

      <div style={{ marginBottom: 16 }}>
        <div className="section-eyebrow" style={{ marginBottom: 8 }}>Coming Soon</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {UNAVAILABLE_RECORD_TYPES.map((tile) => (
            <div key={tile.label} className="farm-card" style={{ padding: 14, opacity: 0.5, display: "flex", gap: 12, alignItems: "center", border: "1px dashed var(--border-subtle)" }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{tile.emoji}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-dim)" }}>{tile.label}</div>
                <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Not available yet</div>
              </div>
              <Lock size={14} color="var(--text-dim)" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type WorkerCtx = ReturnType<typeof useWorkerContext>;

function BatchPicker({ batches, onPick }: { batches: ApiBatch[] | null; onPick: (id: string) => void }) {
  if (batches === null) return <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading your batches…</div>;
  if (batches.length === 0) {
    return (
      <div style={{ padding: "14px 16px", borderRadius: 12, background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", fontSize: 12, color: "var(--text-muted)" }}>
        No batches are assigned to you yet. Ask your manager to assign one before submitting records.
      </div>
    );
  }
  return (
    <div>
      {batches.map((b) => (
        <button key={b.id} onClick={() => onPick(b.id)} style={{
          width: "100%", padding: "14px 16px", marginBottom: 8, borderRadius: 12, textAlign: "left", cursor: "pointer",
          background: "var(--card)", border: "1px solid var(--border-subtle)",
          fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
        }}>🐔 {b.code} – {b.name}</button>
      ))}
    </div>
  );
}

function FeedingForm({ ctx, onBack }: { ctx: WorkerCtx; onBack: () => void }) {
  const { showToast } = useToast();
  const [step, setStep] = useState(1);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [feedItems, setFeedItems] = useState<{ item: string; qtyKg: string }[]>([{ item: "", qtyKg: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const batch = ctx.batches?.find((b) => b.id === batchId) ?? null;

  function updateItem(i: number, field: "item" | "qtyKg", value: string) {
    setFeedItems((prev) => prev.map((it, idx) => idx === i ? { ...it, [field]: value } : it));
  }

  async function handleSubmit() {
    if (!ctx.employee || !batchId) return;
    setSubmitting(true); setError("");
    const items = feedItems.filter((f) => f.item.trim() && f.qtyKg).map((f) => ({ item: f.item.trim(), qtyKg: Number(f.qtyKg) }));
    const res = await apiClient.post("/api/records", {
      tenantId: ctx.tenantId,
      batchId,
      employeeId: ctx.employee.id,
      type: "feeding",
      data: { feedItems: items },
    });
    setSubmitting(false);
    if (!res.success) { setError(res.error || "Failed to save record."); return; }
    showToast("Feeding record saved.", "success");
    onBack();
  }

  return (
    <div className="screen-content">
      <div style={{ padding: "0 20px" }}>
        <TopNav title="Feeding Record" showBack />
      </div>
      <div className="px-screen" style={{ paddingTop: 16 }}>
        <div style={{ display: "flex", gap: 0, marginBottom: 20 }}>
          {["Batch","Feed items","Confirm"].map((s, i) => (
            <React.Fragment key={s}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <div className={`step-node ${i + 1 < step ? "done" : i + 1 === step ? "active" : "pending"}`} style={{ width: 24, height: 24, fontSize: 10 }}>{i + 1 < step ? "✓" : i + 1}</div>
                <span style={{ fontSize: 9, fontWeight: 700, color: step === i + 1 ? "var(--primary-green)" : "var(--text-dim)" }}>{s}</span>
              </div>
              {i < 2 && <div className={`step-line ${i + 1 < step ? "done" : ""}`} style={{ marginTop: 12 }} />}
            </React.Fragment>
          ))}
        </div>

        {step === 1 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>Select batch to feed:</div>
            <BatchPicker batches={ctx.batches} onPick={(id) => { setBatchId(id); setStep(2); }} />
          </div>
        )}

        {step === 2 && batch && (
          <div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>{batch.code} – {batch.name} · {batch.currentQty} in system</div>
            {feedItems.map((f, i) => (
              <div key={i} className="farm-card" style={{ padding: 14, marginBottom: 8 }}>
                <input className="farm-input" placeholder="Feed item (e.g. Broiler Starter Mash)" value={f.item} onChange={(e) => updateItem(i, "item", e.target.value)} style={{ marginBottom: 8 }} />
                <input className="farm-input" placeholder="Quantity (kg)" type="number" value={f.qtyKg} onChange={(e) => updateItem(i, "qtyKg", e.target.value)} />
              </div>
            ))}
            <button className="btn-secondary" style={{ width: "100%", justifyContent: "center", marginBottom: 14 }} onClick={() => setFeedItems((prev) => [...prev, { item: "", qtyKg: "" }])}>
              <Plus size={13} /> Add another item
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: "center", borderRadius: 12 }} onClick={() => setStep(1)}>Back</button>
              <button className="btn-primary" style={{ flex: 2, justifyContent: "center", borderRadius: 12 }} onClick={() => setStep(3)}>Review</button>
            </div>
          </div>
        )}

        {step === 3 && batch && (
          <div>
            <div style={{ padding: "14px", background: "rgba(74,222,128,0.06)", borderRadius: 14, border: "1px solid rgba(74,222,128,0.2)", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Summary – {batch.code}</div>
              {feedItems.filter((f) => f.item.trim() && f.qtyKg).map((f, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
                  <span style={{ color: "var(--text-muted)" }}>{f.item}</span><span style={{ fontWeight: 700 }}>{f.qtyKg} kg</span>
                </div>
              ))}
            </div>
            {error && <div style={{ fontSize: 12, color: "var(--status-critical)", marginBottom: 10 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: "center", borderRadius: 12 }} onClick={() => setStep(2)}>Back</button>
              <button className="btn-primary" disabled={submitting} style={{ flex: 2, justifyContent: "center", borderRadius: 12, opacity: submitting ? 0.7 : 1 }} onClick={handleSubmit}>
                <Check size={14} /> {submitting ? "Saving…" : "Save Record"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MortalityForm({ ctx, onBack }: { ctx: WorkerCtx; onBack: () => void }) {
  const { showToast } = useToast();
  const [step, setStep] = useState(1);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [cause, setCause] = useState("Unknown");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const threshold = ctx.employee?.mortalityPhotoThreshold ?? 3;
  const needsPhoto = count >= threshold;
  const batch = ctx.batches?.find((b) => b.id === batchId) ?? null;

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoDataUrl(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    if (!ctx.employee || !batchId) return;
    if (needsPhoto && !photoDataUrl) { setError("A photo is required for this many deaths."); return; }
    setSubmitting(true); setError("");
    const res = await apiClient.post("/api/records", {
      tenantId: ctx.tenantId,
      batchId,
      employeeId: ctx.employee.id,
      type: "mortality",
      data: { count, cause },
      photoUrl: photoDataUrl,
    });
    setSubmitting(false);
    if (!res.success) { setError(res.error || "Failed to save record."); return; }
    showToast("Mortality record saved.", "success");
    onBack();
  }

  return (
    <div className="screen-content">
      <div className="px-screen">
        <TopNav title="Mortality Record" showBack />
      </div>
      <div className="px-screen" style={{ paddingTop: 16 }}>
        <div style={{ display: "flex", gap: 0, marginBottom: 20 }}>
          {["Batch","Count & Cause","Photo","Confirm"].map((s, i) => (
            <React.Fragment key={s}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <div className={`step-node ${i + 1 < step ? "done" : i + 1 === step ? "active" : "pending"}`} style={{ width: 22, height: 22, fontSize: 9 }}>{i + 1 < step ? "✓" : i + 1}</div>
                <span style={{ fontSize: 8, fontWeight: 700, color: step === i + 1 ? "var(--primary-green)" : "var(--text-dim)" }}>{s}</span>
              </div>
              {i < 3 && <div className={`step-line ${i + 1 < step ? "done" : ""}`} style={{ marginTop: 11 }} />}
            </React.Fragment>
          ))}
        </div>

        {step === 1 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Select batch:</div>
            <BatchPicker batches={ctx.batches} onPick={(id) => { setBatchId(id); setStep(2); }} />
          </div>
        )}

        {step === 2 && batch && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>{batch.code} · System count: {batch.currentQty}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "center", marginBottom: 16 }}>
                <button onClick={() => setCount(Math.max(0, count - 1))} style={{ width: 52, height: 52, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border-subtle)", fontSize: 24, color: "var(--text-primary)", cursor: "pointer" }}>−</button>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 52, fontWeight: 700, color: count > 0 ? "var(--status-critical)" : "var(--text-primary)", lineHeight: 1 }}>{count}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>deaths</div>
                </div>
                <button onClick={() => setCount(count + 1)} style={{ width: 52, height: 52, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border-subtle)", fontSize: 24, color: "var(--text-primary)", cursor: "pointer" }}>+</button>
              </div>
              {needsPhoto && <div style={{ padding: "8px 12px", background: "rgba(248,113,113,0.08)", borderRadius: 10, border: "1px solid rgba(248,113,113,0.25)", fontSize: 11, color: "var(--status-critical)", fontWeight: 600, marginBottom: 10 }}>⚠ Photo required for {threshold}+ deaths (your farm&apos;s threshold)</div>}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "var(--text-secondary)" }}>Cause of death:</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              {["Sudden death","Disease","Injury","Heat stress","Respiratory","Unknown"].map((c) => (
                <button key={c} onClick={() => setCause(c)} style={{ padding: "10px 8px", borderRadius: 10, fontSize: 12, fontWeight: 600, background: c === cause ? "rgba(248,113,113,0.12)" : "var(--card)", border: c === cause ? "1px solid rgba(248,113,113,0.3)" : "1px solid var(--border-subtle)", color: c === cause ? "var(--status-critical)" : "var(--text-muted)", cursor: "pointer" }}>{c}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: "center", borderRadius: 12 }} onClick={() => setStep(1)}>Back</button>
              <button className="btn-primary" style={{ flex: 2, justifyContent: "center", borderRadius: 12 }} onClick={() => setStep(needsPhoto ? 3 : 4)}>Next</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ padding: "14px", background: "rgba(248,113,113,0.06)", borderRadius: 14, border: "1px solid rgba(248,113,113,0.2)", marginBottom: 16, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📸</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>Photo Evidence Required</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>Your farm requires a photo for {threshold}+ deaths. This helps with disease investigation.</div>
            </div>
            {photoDataUrl ? (
              <img src={photoDataUrl} alt="Mortality evidence" style={{ width: "100%", borderRadius: 14, marginBottom: 10, maxHeight: 200, objectFit: "cover" }} />
            ) : null}
            <label style={{ width: "100%", padding: "16px", borderRadius: 14, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", color: "var(--primary-green)", fontWeight: 700, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10 }}>
              <Camera size={18} /> {photoDataUrl ? "Retake Photo" : "Take Photo"}
              <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} style={{ display: "none" }} />
            </label>
            <button className="btn-secondary" style={{ width: "100%", justifyContent: "center", marginBottom: 10 }} onClick={() => setStep(2)}>Back</button>
            <button className="btn-primary" disabled={!photoDataUrl} style={{ width: "100%", justifyContent: "center", opacity: photoDataUrl ? 1 : 0.6 }} onClick={() => setStep(4)}>Continue with Photo</button>
          </div>
        )}

        {step === 4 && batch && (
          <div>
            <div style={{ padding: "14px", background: "rgba(74,222,128,0.06)", borderRadius: 14, border: "1px solid rgba(74,222,128,0.2)", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Confirm & Save</div>
              {[["Batch", batch.code],["Deaths",`${count}`],["Cause", cause],["Photo", photoDataUrl ? "Attached ✓" : needsPhoto ? "Missing" : "Not required"]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                  <span style={{ color: "var(--text-muted)" }}>{k}</span>
                  <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{v}</span>
                </div>
              ))}
            </div>
            {error && <div style={{ fontSize: 12, color: "var(--status-critical)", marginBottom: 10 }}>{error}</div>}
            <button className="btn-primary" disabled={submitting} style={{ width: "100%", justifyContent: "center", marginBottom: 8, opacity: submitting ? 0.7 : 1 }} onClick={handleSubmit}>
              <Check size={14} /> {submitting ? "Saving…" : "Save Record"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PhysicalCountForm({ ctx, onBack }: { ctx: WorkerCtx; onBack: () => void }) {
  const { showToast } = useToast();
  const [batchId, setBatchId] = useState<string | null>(ctx.batches?.[0]?.id ?? null);
  const [physicalCount, setPhysicalCount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!batchId && ctx.batches && ctx.batches.length > 0) setBatchId(ctx.batches[0].id);
  }, [ctx.batches, batchId]);

  const batch = ctx.batches?.find((b) => b.id === batchId) ?? null;
  const count = physicalCount === "" ? null : Number(physicalCount);
  const variance = count !== null && batch ? count - batch.currentQty : null;

  async function handleSubmit() {
    if (!ctx.employee || !batchId || count === null || !batch) return;
    setSubmitting(true); setError("");
    const res = await apiClient.post("/api/records", {
      tenantId: ctx.tenantId,
      batchId,
      employeeId: ctx.employee.id,
      type: "physical_count",
      data: { systemCount: batch.currentQty, physicalCount: count, variance, varianceReason: reason },
    });
    setSubmitting(false);
    if (!res.success) { setError(res.error || "Failed to save record."); return; }
    showToast("Physical count saved.", "success");
    onBack();
  }

  return (
    <div className="screen-content">
      <div className="px-screen">
        <TopNav title="Physical Count" showBack />
      </div>
      <div className="px-screen" style={{ paddingTop: 16 }}>
        {ctx.batches !== null && ctx.batches.length === 0 ? (
          <div style={{ padding: "14px 16px", borderRadius: 12, background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", fontSize: 12, color: "var(--text-muted)" }}>
            No batches are assigned to you yet.
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Select Batch</label>
              <select className="farm-input" value={batchId ?? ""} onChange={(e) => setBatchId(e.target.value)}>
                {(ctx.batches ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} – {b.name} ({b.currentQty} in system)</option>)}
              </select>
            </div>
            {batch && (
              <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)" }}>{batch.currentQty}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>System count</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--status-warning)" }}>{count ?? "—"}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Your count</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--status-critical)" }}>{variance !== null ? (variance > 0 ? `+${variance}` : variance) : "—"}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Variance</div>
                  </div>
                </div>
              </div>
            )}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Your Physical Count</label>
              <input className="farm-input" type="number" placeholder="Enter count" value={physicalCount} onChange={(e) => setPhysicalCount(e.target.value)} style={{ fontSize: 22, textAlign: "center", fontWeight: 700 }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>Reason for variance</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {["Suspected theft","Found extra","Uncounted deaths","Counting error"].map((r) => (
                  <button key={r} onClick={() => setReason(r)} style={{ padding: "9px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: r === reason ? "rgba(251,191,36,0.1)" : "var(--card)", border: r === reason ? "1px solid rgba(251,191,36,0.3)" : "1px solid var(--border-subtle)", color: r === reason ? "var(--status-warning)" : "var(--text-muted)", cursor: "pointer" }}>{r}</button>
                ))}
              </div>
            </div>
            <div style={{ padding: "10px 12px", background: "rgba(251,191,36,0.06)", borderRadius: 10, border: "1px solid rgba(251,191,36,0.2)", marginBottom: 14, fontSize: 11, color: "var(--text-muted)" }}>
              This count <strong style={{ color: "var(--text-secondary)" }}>does not change the system count</strong>. Your owner will review and approve any adjustments.
            </div>
            {error && <div style={{ fontSize: 12, color: "var(--status-critical)", marginBottom: 10 }}>{error}</div>}
            <button className="btn-primary" disabled={submitting || count === null} style={{ width: "100%", justifyContent: "center", marginBottom: 8, opacity: submitting || count === null ? 0.7 : 1 }} onClick={handleSubmit}>
              <Check size={14} /> {submitting ? "Saving…" : "Submit Count"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function WorkerPayScreen() {
  return (
    <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>My Pay</div>
      <div className="farm-card" style={{ padding: 28, textAlign: "center" }}>
        <Lock size={28} color="var(--text-dim)" style={{ marginBottom: 10 }} />
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>Not available yet</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Payroll and payslips aren&apos;t tracked in the system yet — there is no real pay data to show. This screen will connect to a real payroll module once one is built.
        </div>
      </div>
    </div>
  );
}

export function WorkerProfileScreen() {
  const { tenantId, employee, employeeError } = useWorkerContext();
  const logout = useLogout();
  const [records, setRecords] = useState<ApiRecord[] | null>(null);
  const [batchLabel, setBatchLabelMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!employee) return;
    apiClient.get<ApiRecord[]>(`/api/records?tenantId=${tenantId}&employeeId=${employee.id}`).then((res) => {
      if (res.success) setRecords(res.data.filter((r) => isToday(r.createdAt)));
    });
  }, [employee, tenantId]);

  useEffect(() => {
    apiClient.get<{ id: string; code: string }[]>(`/api/batches?tenantId=${tenantId}`).then((res) => {
      if (res.success) setBatchLabelMap(Object.fromEntries(res.data.map((b) => [b.id, b.code])));
    });
  }, [tenantId]);

  return (
    <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
      {/* Avatar */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(74,222,128,0.2)", border: "2px solid rgba(74,222,128,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 700, color: "var(--primary-green)", marginBottom: 10 }}>
          {employee ? employee.name.split(" ").filter(Boolean).map((n) => n[0]).join("").slice(0, 2) : "…"}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{employee?.name ?? "Loading…"}</div>
        <span className="chip chip-ok" style={{ marginTop: 4, textTransform: "capitalize" }}>{employee?.role ?? "worker"}</span>
      </div>

      {employeeError && <div style={{ fontSize: 12, color: "var(--status-critical)", marginBottom: 14 }}>{employeeError}</div>}

      {/* Today's records (real GET /api/records, not a mock sync-status list) */}
      <div className="section-eyebrow" style={{ marginBottom: 8 }}>Today&apos;s Records</div>
      <div className="farm-card" style={{ overflow: "hidden", marginBottom: 14 }}>
        {records === null && <div style={{ padding: 12, fontSize: 12, color: "var(--text-dim)" }}>Loading…</div>}
        {records !== null && records.length === 0 && <div style={{ padding: 12, fontSize: 12, color: "var(--text-dim)" }}>No records submitted today.</div>}
        {records !== null && records.map((r, i, arr) => (
          <div key={r.id} style={{ padding: "11px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: i < arr.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{RECORD_TYPE_LABEL[r.type]?.label ?? r.type}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{batchLabel[r.batchId] ?? r.batchId.slice(0, 8)} · {timeOf(r.createdAt)}</div>
            </div>
            <span className="chip chip-ok" style={{ fontSize: 9 }}>SAVED</span>
          </div>
        ))}
      </div>

      {/* Settings (static prefs — not backed by an entity yet) */}
      <div className="section-eyebrow" style={{ marginBottom: 8 }}>Settings</div>
      <div className="farm-card" style={{ overflow: "hidden", marginBottom: 16 }}>
        {[["Language", "English (EN)"],["High Contrast Mode", "Off"],["Sync on WiFi only", "On"]].map(([k, v], i, arr) => (
          <div key={k as string} style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", borderBottom: i < arr.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{k as string}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--primary-green)" }}>{v as string}</span>
          </div>
        ))}
      </div>

      <button onClick={logout} style={{ width: "100%", padding: "14px", borderRadius: 14, fontSize: 14, fontWeight: 700, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "var(--status-critical)", cursor: "pointer", marginBottom: 20 }}>
        Sign Out
      </button>
    </div>
  );
}
