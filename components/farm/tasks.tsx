"use client";
import React, { useState, useMemo, useRef } from "react";
import { useNav, TopNav } from "./navigation";
import {
  Plus, CheckCircle2, Clock, AlertTriangle, Users, Calendar,
  ChevronRight, X, Check, Filter, MapPin, RefreshCw, ShieldCheck,
  Trash2, Search, ChevronDown, ChevronUp, Edit2, Download, UserSingle as UserPlus,
  Camera,
} from "./icons";
import { TASKS_DATA, EMPLOYEES_DATA, BATCHES_DATA, OWNER_ROLES, downloadCSV, type Task } from "./data";
import { useToast } from "./ui-shared";
import { SearchBar, GovernanceGateBanner } from "./ui-shared";
import { CsvImportModal } from "./csv-import";

const TASK_TYPES = [
  "feeding", "egg-collection", "milking", "mortality", "health",
  "physical-count", "harvest", "weight", "weed", "spray", "ploughing", "stock-count", "custom",
];
const TYPE_EMOJI: Record<string, string> = {
  feeding: "🌾", "egg-collection": "🥚", milking: "🐄", mortality: "💀",
  health: "💉", "physical-count": "📋", harvest: "🌽", weight: "⚖️",
  weed: "🌿", spray: "🧴", ploughing: "🚜", "stock-count": "📦", custom: "✅",
};
const PRIORITY_COLOR: Record<string, string> = {
  high: "var(--status-critical)", medium: "var(--status-warning)", low: "var(--text-muted)",
};
const FREQ_LABEL: Record<string, string> = {
  once: "One-time", daily: "Daily", weekly: "Weekly", "on-demand": "On-demand",
};

type SortField = "title" | "priority" | "status" | "startDate" | "dueTime" | "assigneeName";
type SortDir = "asc" | "desc";

/* ── helpers ── */
function isGroupTask(t: Task) { return t.assigneeCode.startsWith("GROUP:"); }

function exportTaskCSV(tasks: Task[], filename = "tasks_export.csv") {
  const cols = ["code","title","type","assigneeName","batchCode","unitCode","location","lat","lng","startDate","endDate","dueTime","frequency","status","priority","maxPhotos","notes"];
  const rows = [cols.join(","), ...tasks.map(t => cols.map(c => {
    const v = (t as unknown as Record<string, unknown>)[c] ?? "";
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(","))];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportExternalWorkersCSV(task: Task) {
  if (!task.externalWorkers?.length) return;
  const cols = ["taskCode","taskTitle","name","phone","portion"];
  const rows = [cols.join(","), ...task.externalWorkers.map(w =>
    `"${task.code}","${task.title}","${w.name}","${w.phone ?? ""}","${w.portion ?? ""}"`
  )];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `external_workers_${task.code}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* ── Task Detail Sheet ── */
function TaskDetailSheet({
  task, role, onClose, onDone, onDelete, onUpdatePhotos,
}: {
  task: Task; role: string; onClose: () => void;
  onDone: (code: string) => void;
  onDelete: (code: string) => void;
  onUpdatePhotos: (code: string, photos: Task["photos"]) => void;
}) {
  const [showDeleteGate, setShowDeleteGate] = useState(false);
  const [viewPhoto, setViewPhoto] = useState<NonNullable<Task["photos"]>[0] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();
  const needsApproval = role === "worker" || role === "manager";
  const isGroup = isGroupTask(task);

  const hasCoords = task.lat != null && task.lng != null;
  const mapSrc = hasCoords
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${(task.lng! - 0.005).toFixed(5)},${(task.lat! - 0.005).toFixed(5)},${(task.lng! + 0.005).toFixed(5)},${(task.lat! + 0.005).toFixed(5)}&layer=mapnik&marker=${task.lat},${task.lng}`
    : null;

  const photos = task.photos ?? [];
  const maxPhotos = task.maxPhotos;
  const canAddMore = maxPhotos === undefined ? photos.length < 20 : photos.length < maxPhotos;
  const photosAllowed = maxPhotos !== 0;

  function handleAddPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!canAddMore) { showToast(`Max ${maxPhotos} photo${maxPhotos === 1 ? "" : "s"} allowed for this task`, "error"); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      const newPhoto = {
        id: `PHO-${Date.now()}`,
        dataUrl,
        takenAt: new Date().toISOString().slice(0, 16).replace("T", " "),
        takenBy: role,
      };
      onUpdatePhotos(task.code, [...photos, newPhoto]);
      showToast("Photo added ✓", "success");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function deletePhoto(id: string) {
    onUpdatePhotos(task.code, photos.filter(p => p.id !== id));
    setViewPhoto(null);
    showToast("Photo deleted", "success");
  }

  function handleDelete() {
    if (needsApproval) setShowDeleteGate(true);
    else { onDelete(task.code); showToast(`Task ${task.code} deleted`, "success"); onClose(); }
  }

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "flex-end", zIndex: 200 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: "22px 22px 0 0", width: "100%", maxHeight: "92%", overflowY: "auto", border: "1px solid var(--border-subtle)", padding: 20 }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1 }}>
            <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, fontSize: 22, background: task.status === "DONE" ? "rgba(74,222,128,0.15)" : task.status === "OVERDUE" ? "rgba(248,113,113,0.12)" : "var(--card)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {TYPE_EMOJI[task.type] ?? "✅"}
              </div>
              {task.unitCode && (
                <div style={{ fontSize: 8, fontWeight: 800, color: "var(--accent-cyan)", background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.3)", borderRadius: 5, padding: "1px 5px", maxWidth: 44, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {task.unitCode}
                </div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.3, color: "var(--text-primary)", marginBottom: 4 }}>{task.title}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span className={`chip ${task.status === "DONE" ? "chip-ok" : task.status === "OVERDUE" ? "chip-critical" : "chip-warning"}`} style={{ fontSize: 9 }}>{task.status}</span>
                <span style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-dim)", padding: "2px 6px", background: "var(--card)", borderRadius: 4 }}>{task.code}</span>
              </div>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Governance gate */}
        {showDeleteGate && (
          <div style={{ marginBottom: 12 }}>
            <GovernanceGateBanner action="Delete Task" onRequest={() => { setShowDeleteGate(false); showToast("Approval request sent to owner", "info"); }} onCancel={() => setShowDeleteGate(false)} />
          </div>
        )}

        {/* Details grid */}
        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              ["Assigned To", task.assigneeName, isGroup ? "var(--accent-purple)" : "var(--text-secondary)"],
              ["Due", task.dueTime ?? "–", task.status === "OVERDUE" ? "var(--status-critical)" : "var(--text-secondary)"],
              ["Start", task.startDate, "var(--text-secondary)"],
              ["End", task.endDate ?? "Ongoing", "var(--text-secondary)"],
              ["Frequency", FREQ_LABEL[task.frequency], "var(--text-secondary)"],
              ["Priority", task.priority, PRIORITY_COLOR[task.priority]],
              ...(task.batchCode ? [["Batch", task.batchCode, "var(--text-muted)"]] : []),
              ...(task.location ? [["Location", task.location, "var(--text-muted)"]] : []),
              ...(maxPhotos !== undefined ? [["Max Photos", maxPhotos === 0 ? "None" : String(maxPhotos), "var(--text-muted)"]] : []),
            ].map(([k, v, c]) => (
              <div key={k as string}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{k}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: c as string }}>{v}</div>
              </div>
            ))}
          </div>
          {task.requiresApproval && (
            <div style={{ marginTop: 10, padding: "7px 10px", background: "rgba(251,191,36,0.08)", borderRadius: 8, border: "1px solid rgba(251,191,36,0.25)", display: "flex", alignItems: "center", gap: 6 }}>
              <ShieldCheck size={12} color="var(--accent-amber)" />
              <span style={{ fontSize: 11, color: "var(--accent-amber)", fontWeight: 600 }}>Requires owner approval before marking done</span>
            </div>
          )}
          {task.notes && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--card)", borderRadius: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              📝 {task.notes}
            </div>
          )}
        </div>

        {/* Map */}
        {hasCoords && mapSrc && (
          <div style={{ marginBottom: 14 }}>
            <div className="section-eyebrow" style={{ marginBottom: 8 }}>Task Location</div>
            <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid var(--border-subtle)", height: 160 }}>
              <iframe src={mapSrc} width="100%" height="160" style={{ border: "none", display: "block" }} title="Task location" loading="lazy" />
            </div>
            <div style={{ fontSize: 10, color: "var(--accent-cyan)", fontFamily: "monospace", marginTop: 4 }}>
              📍 {task.lat!.toFixed(5)}, {task.lng!.toFixed(5)}
            </div>
          </div>
        )}

        {/* Photos section */}
        {photosAllowed && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div className="section-eyebrow">
                Photo Evidence {photos.length > 0 && `(${photos.length}${maxPhotos !== undefined ? `/${maxPhotos}` : ""})`}
              </div>
              {canAddMore && task.status !== "DONE" && (
                <>
                  <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleAddPhoto} />
                  <button onClick={() => fileInputRef.current?.click()} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "var(--accent-cyan)", background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.3)", padding: "5px 12px", borderRadius: 8, cursor: "pointer" }}>
                    <Camera size={13} /> Add Photo
                  </button>
                </>
              )}
              {!canAddMore && maxPhotos !== undefined && (
                <span style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 600 }}>Limit reached ({maxPhotos})</span>
              )}
            </div>

            {photos.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-dim)", fontSize: 12 }}>
                <Camera size={24} style={{ opacity: 0.3, marginBottom: 6 }} />
                <div>No photos yet. {task.status !== "DONE" && canAddMore ? "Tap Add Photo to attach evidence." : ""}</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {photos.map(p => (
                  <div key={p.id} onClick={() => setViewPhoto(p)} style={{ aspectRatio: "1", borderRadius: 10, overflow: "hidden", border: "1px solid var(--border-subtle)", cursor: "pointer", position: "relative" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.dataUrl} alt="Evidence" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,0.6))", padding: "6px 4px 4px", fontSize: 8, color: "rgba(255,255,255,0.8)", textAlign: "center" }}>
                      {p.takenAt.slice(11)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {maxPhotos === 0 && (
          <div style={{ marginBottom: 14, padding: "8px 12px", background: "rgba(248,113,113,0.06)", borderRadius: 8, fontSize: 11, color: "var(--text-dim)", border: "1px solid rgba(248,113,113,0.15)" }}>
            📵 Photo upload disabled for this task
          </div>
        )}

        {/* External workers */}
        {isGroup && task.externalWorkers && task.externalWorkers.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="section-eyebrow" style={{ marginBottom: 8 }}>External Workers ({task.externalWorkers.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {task.externalWorkers.map((w, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--card)", borderRadius: 10, border: "1px solid var(--border-subtle)" }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{w.name}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{w.phone ?? "–"}{w.portion ? ` · ${w.portion}` : ""}</div>
                  </div>
                  <span className="chip chip-purple" style={{ fontSize: 8 }}>External</span>
                </div>
              ))}
              <button onClick={() => exportExternalWorkersCSV(task)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "8px", borderRadius: 8, fontSize: 11, fontWeight: 700, background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.3)", color: "var(--accent-purple)", cursor: "pointer" }}>
                <Download size={12} /> Export Workers CSV
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8 }}>
          {task.status !== "DONE" && (
            <button onClick={() => { onDone(task.code); onClose(); }} style={{ flex: 1, padding: "11px", borderRadius: 10, fontSize: 13, fontWeight: 700, background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.35)", color: "var(--primary-green)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Check size={14} /> Mark Done
            </button>
          )}
          {task.status !== "DONE" && (
            <button onClick={handleDelete} style={{ padding: "11px 14px", borderRadius: 10, fontSize: 12, fontWeight: 700, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "var(--status-critical)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              <Trash2 size={13} />
            </button>
          )}
          <button onClick={onClose} style={{ padding: "11px 16px", borderRadius: 10, fontSize: 12, fontWeight: 700, background: "var(--card)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", cursor: "pointer" }}>Close</button>
        </div>
      </div>

      {/* Full-screen photo viewer */}
      {viewPhoto && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)", zIndex: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setViewPhoto(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewPhoto.dataUrl} alt="Evidence" style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 12, objectFit: "contain" }} onClick={e => e.stopPropagation()} />
          <div style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", textAlign: "center" }}>
              <div>{viewPhoto.takenAt}</div>
              <div>By: {viewPhoto.takenBy}</div>
            </div>
          </div>
          <button
            onClick={e => { e.stopPropagation(); deletePhoto(viewPhoto.id); }}
            style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8, padding: "10px 22px", borderRadius: 10, fontSize: 13, fontWeight: 700, background: "rgba(248,113,113,0.2)", border: "1px solid rgba(248,113,113,0.5)", color: "#f87171", cursor: "pointer" }}>
            <Trash2 size={14} /> Delete Photo
          </button>
          <div style={{ marginTop: 8, fontSize: 10, color: "rgba(255,255,255,0.35)" }}>Tap outside to close</div>
        </div>
      )}
    </div>
  );
}

/* ── Task Card ── */
function TaskCard({
  task, onDone, onDelete, role, onOpen,
}: {
  task: Task;
  onDone: (code: string) => void;
  onDelete: (code: string) => void;
  role: string;
  onOpen: (task: Task) => void;
}) {
  const isGroup = isGroupTask(task);
  const photoCount = task.photos?.length ?? 0;

  return (
    <div
      className="farm-card"
      style={{ padding: 14, borderLeft: `3px solid ${task.status === "OVERDUE" ? "var(--status-critical)" : task.status === "DONE" ? "var(--status-ok)" : isGroup ? "var(--accent-purple)" : PRIORITY_COLOR[task.priority]}`, cursor: "pointer" }}
      onClick={() => onOpen(task)}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, fontSize: 18, background: task.status === "DONE" ? "rgba(74,222,128,0.15)" : task.status === "OVERDUE" ? "rgba(248,113,113,0.12)" : "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {TYPE_EMOJI[task.type] ?? "✅"}
          </div>
          {task.unitCode && (
            <div style={{ fontSize: 8, fontWeight: 800, color: "var(--accent-cyan)", background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.3)", borderRadius: 5, padding: "1px 4px", letterSpacing: "0.02em", maxWidth: 38, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={task.unitCode}>
              {task.unitCode}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3, color: task.status === "DONE" ? "var(--text-muted)" : "var(--text-primary)", textDecoration: task.status === "DONE" ? "line-through" : "none", flex: 1, marginRight: 8 }}>
              {task.title}
            </div>
            <span className={`chip ${task.status === "DONE" ? "chip-ok" : task.status === "OVERDUE" ? "chip-critical" : "chip-warning"}`} style={{ fontSize: 9, flexShrink: 0 }}>{task.status}</span>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <Users size={11} color={isGroup ? "var(--accent-purple)" : "var(--text-muted)"} />
              <span style={{ fontSize: 11, color: isGroup ? "var(--accent-purple)" : "var(--text-muted)", fontWeight: isGroup ? 700 : 400 }}>{task.assigneeName}</span>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <Clock size={11} color={task.status === "OVERDUE" ? "var(--status-critical)" : "var(--text-muted)"} />
              <span style={{ fontSize: 11, color: task.status === "OVERDUE" ? "var(--status-critical)" : "var(--text-muted)" }}>{task.dueTime}</span>
            </div>
            {task.location && (
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <MapPin size={11} color={task.lat != null ? "var(--accent-cyan)" : "var(--text-muted)"} />
                <span style={{ fontSize: 11, color: task.lat != null ? "var(--accent-cyan)" : "var(--text-muted)" }}>{task.location}</span>
              </div>
            )}
            {task.batchCode && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>📦 {task.batchCode}</span>}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, alignItems: "center" }}>
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 100, background: "rgba(255,255,255,0.05)", color: "var(--text-muted)", border: "1px solid var(--border-subtle)" }}>🔁 {FREQ_LABEL[task.frequency]}</span>
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 100, background: "rgba(255,255,255,0.05)", color: "var(--text-muted)", border: "1px solid var(--border-subtle)" }}>📅 {task.startDate}</span>
            {task.requiresApproval && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 100, background: "rgba(251,191,36,0.1)", color: "var(--accent-amber)", border: "1px solid rgba(251,191,36,0.3)" }}><ShieldCheck size={9} style={{ verticalAlign: "middle", marginRight: 2 }} />Approval</span>}
            {photoCount > 0 && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 100, background: "rgba(96,165,250,0.1)", color: "var(--accent-cyan)", border: "1px solid rgba(96,165,250,0.25)" }}>📷 {photoCount}</span>}
            {task.lat != null && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 100, background: "rgba(96,165,250,0.08)", color: "var(--accent-cyan)", border: "1px solid rgba(96,165,250,0.2)" }}>📍 Map</span>}
            <span style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "monospace" }}>{task.code}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Add Task Sheet (3-step) ── */
function AddTaskSheet({ onClose, onAdd, prefillBatch, prefillUnit }: {
  onClose: () => void;
  onAdd: (t: Task) => void;
  prefillBatch?: string;
  prefillUnit?: string;
}) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("feeding");
  const [assignMode, setAssignMode] = useState<"individual" | "group" | "external">("individual");
  const [assignee, setAssignee] = useState(EMPLOYEES_DATA[0]);
  const [groupRole, setGroupRole] = useState(OWNER_ROLES[0].id);
  const [batch, setBatch] = useState(prefillBatch ?? "");
  const [unitCode, setUnitCode] = useState(prefillUnit ?? "");
  const [location, setLocation] = useState(prefillUnit ?? "");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [startDate, setStartDate] = useState("2026-08-12");
  const [endDate, setEndDate] = useState("");
  const [dueTime, setDueTime] = useState("08:00");
  const [frequency, setFrequency] = useState<Task["frequency"]>("once");
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [notes, setNotes] = useState("");
  const [maxPhotos, setMaxPhotos] = useState<string>(""); // "" = unlimited, "0" = none
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [extWorkers, setExtWorkers] = useState<{ name: string; phone: string; portion: string }[]>([]);
  const [extName, setExtName] = useState("");
  const [extPhone, setExtPhone] = useState("");
  const [extPortion, setExtPortion] = useState("");
  const { showToast } = useToast();

  const taskCode = `TSK-KMU-${String(TASKS_DATA.length + 1 + 84).padStart(4, "0")}`;

  const selectedBatch = BATCHES_DATA.find(b => b.code === batch);
  const batchUnitCode = selectedBatch?.unitCode ?? "";
  const transferUnit = selectedBatch?.transferToUnitCode;
  const availableUnits = selectedBatch ? [batchUnitCode, ...(transferUnit ? [transferUnit] : [])] : [];

  function validateStep(s: number) {
    const e: Record<string, string> = {};
    if (s === 1 && !type) e.type = "Please select a task type";
    if (s === 2 && !startDate) e.startDate = "Start date is required";
    if (s === 2 && !dueTime) e.dueTime = "Due time is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function addExternalWorker() {
    if (!extName.trim()) return;
    setExtWorkers(ws => [...ws, { name: extName.trim(), phone: extPhone.trim(), portion: extPortion.trim() }]);
    setExtName(""); setExtPhone(""); setExtPortion("");
  }

  function submit() {
    if (!validateStep(3)) return;
    const isGroup = assignMode !== "individual";
    const grpLabel = OWNER_ROLES.find(r => r.id === groupRole)?.name ?? groupRole;
    const maxP = maxPhotos === "" ? undefined : parseInt(maxPhotos);
    onAdd({
      code: taskCode,
      title: title || `${TYPE_EMOJI[type] ?? ""} ${type.replace(/-/g, " ")} task`,
      type,
      assigneeCode: isGroup ? `GROUP:${groupRole}` : assignee.code,
      assigneeName: isGroup ? `All ${grpLabel}s` : assignee.name,
      farmCode: "FRM-KMU-001",
      batchCode: batch || undefined,
      unitCode: unitCode || undefined,
      location: location || undefined,
      lat: lat ? parseFloat(lat) : undefined,
      lng: lng ? parseFloat(lng) : undefined,
      startDate, endDate: endDate || undefined,
      dueTime, frequency, status: "PENDING", requiresApproval, priority,
      notes: notes || undefined,
      maxPhotos: maxP,
      externalWorkers: assignMode === "external" && extWorkers.length > 0 ? extWorkers : undefined,
    });
    showToast(`Task ${taskCode} created`, "success");
    onClose();
  }

  function ErrorMsg({ field }: { field: string }) {
    if (!errors[field]) return null;
    return <div style={{ fontSize: 11, color: "var(--status-critical)", marginTop: 4 }}>⚠ {errors[field]}</div>;
  }

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "flex-end", zIndex: 100 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: "24px 24px 0 0", padding: 20, width: "100%", maxHeight: "90%", overflowY: "auto", border: "1px solid var(--border-subtle)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>New Task</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--primary-green)", background: "rgba(74,222,128,0.1)", padding: "3px 8px", borderRadius: 100, border: "1px solid rgba(74,222,128,0.3)", fontFamily: "monospace" }}>{taskCode}</span>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {[1, 2, 3].map(s => (
            <div key={s} onClick={() => setStep(s)} style={{ flex: 1, height: 4, borderRadius: 100, background: step >= s ? "var(--primary-green)" : "var(--border-subtle)", cursor: "pointer" }} />
          ))}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12, fontWeight: 600 }}>
          {step === 1 ? "Step 1 of 3 · What & Who" : step === 2 ? "Step 2 of 3 · Batch, Unit & Schedule" : "Step 3 of 3 · Options & Photos"}
        </div>

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Task Type *</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {TASK_TYPES.map(t => (
                  <button key={t} onClick={() => { setType(t); setErrors(e => ({ ...e, type: "" })); }}
                    style={{ padding: "6px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", background: type === t ? "rgba(74,222,128,0.15)" : "var(--card)", border: type === t ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)", color: type === t ? "var(--primary-green)" : "var(--text-muted)" }}>
                    {TYPE_EMOJI[t]} {t.replace(/-/g, " ")}
                  </button>
                ))}
              </div>
              <ErrorMsg field="type" />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Task Title</label>
              <input className="farm-input" value={title} onChange={e => setTitle(e.target.value)} placeholder={`e.g. Morning ${type.replace(/-/g, " ")} – House A1`} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>Assign To</label>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                {(["individual","group","external"] as const).map(m => (
                  <button key={m} onClick={() => setAssignMode(m)} style={{ flex: 1, padding: "8px 4px", borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: "pointer", background: assignMode === m ? "rgba(74,222,128,0.15)" : "var(--card)", border: assignMode === m ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)", color: assignMode === m ? "var(--primary-green)" : "var(--text-muted)" }}>
                    {m === "individual" ? "👤 Individual" : m === "group" ? "👥 Group/Role" : "🔗 External"}
                  </button>
                ))}
              </div>
              {assignMode === "individual" && (
                <select className="farm-input" value={assignee.code} onChange={e => { const emp = EMPLOYEES_DATA.find(x => x.code === e.target.value); if (emp) setAssignee(emp); }}>
                  {EMPLOYEES_DATA.filter(e => e.farmCode === "FRM-KMU-001").map(e => (
                    <option key={e.code} value={e.code}>{e.name} ({e.role})</option>
                  ))}
                </select>
              )}
              {assignMode === "group" && (
                <div>
                  <select className="farm-input" value={groupRole} onChange={e => setGroupRole(e.target.value)}>
                    {OWNER_ROLES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    <option value="all">All Staff</option>
                  </select>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 5 }}>All employees with this role will see this task.</div>
                </div>
              )}
              {assignMode === "external" && (
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Add casual / contract workers per task.</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
                    <input className="farm-input" style={{ fontSize: 12 }} placeholder="Name *" value={extName} onChange={e => setExtName(e.target.value)} />
                    <input className="farm-input" style={{ fontSize: 12 }} placeholder="Phone" value={extPhone} onChange={e => setExtPhone(e.target.value)} />
                  </div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    <input className="farm-input" style={{ fontSize: 12, flex: 1 }} placeholder="Portion e.g. Rows 1–4, Section A" value={extPortion} onChange={e => setExtPortion(e.target.value)} />
                    <button onClick={addExternalWorker} style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", color: "var(--primary-green)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>+ Add</button>
                  </div>
                  {extWorkers.map((w, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "var(--card)", borderRadius: 8, marginBottom: 4, border: "1px solid var(--border-subtle)", fontSize: 12 }}>
                      <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{w.name}</span>
                      <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{w.portion}</span>
                      <button onClick={() => setExtWorkers(ws => ws.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-dim)", padding: "0 4px" }}><X size={12} /></button>
                    </div>
                  ))}
                  <button onClick={() => downloadCSV("external_workers")} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "var(--accent-purple)", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.3)", padding: "7px 12px", borderRadius: 8, cursor: "pointer", marginTop: 4 }}>
                    <Download size={12} /> Download CSV Template
                  </button>
                </div>
              )}
            </div>
            <button className="btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => validateStep(1) && setStep(2)}>Next: Batch & Schedule →</button>
          </div>
        )}

        {/* ── STEP 2 ── */}
        {step === 2 && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Batch (optional)</label>
              <select className="farm-input" value={batch} onChange={e => { setBatch(e.target.value); setUnitCode(""); }}>
                <option value="">None — farm-level task</option>
                {BATCHES_DATA.filter(b => b.farmCode === "FRM-KMU-001").map(b => (
                  <option key={b.code} value={b.code}>{b.code} – {b.label}</option>
                ))}
              </select>
            </div>

            {batch && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Unit / Pen / House</label>
                {availableUnits.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {availableUnits.map(u => (
                      <button key={u} onClick={() => { setUnitCode(u); setLocation(u); }}
                        style={{ padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", background: unitCode === u ? "rgba(96,165,250,0.15)" : "var(--card)", border: unitCode === u ? "1px solid rgba(96,165,250,0.5)" : "1px solid var(--border-subtle)", color: unitCode === u ? "var(--accent-cyan)" : "var(--text-muted)" }}>
                        🏠 {u}
                      </button>
                    ))}
                    <button onClick={() => setUnitCode("")} style={{ padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", background: !unitCode ? "rgba(255,255,255,0.06)" : "var(--card)", border: "1px solid var(--border-subtle)", color: "var(--text-dim)" }}>None</button>
                  </div>
                ) : (
                  <input className="farm-input" style={{ fontSize: 12 }} value={unitCode} onChange={e => { setUnitCode(e.target.value); setLocation(e.target.value); }} placeholder="e.g. HSE-KMU-A01" />
                )}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Start Date *</label>
                <input className="farm-input" type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setErrors(ev => ({ ...ev, startDate: "" })); }} />
                <ErrorMsg field="startDate" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>End Date</label>
                <input className="farm-input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Due Time *</label>
                <input className="farm-input" type="time" value={dueTime} onChange={e => { setDueTime(e.target.value); setErrors(ev => ({ ...ev, dueTime: "" })); }} />
                <ErrorMsg field="dueTime" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Frequency</label>
                <select className="farm-input" value={frequency} onChange={e => setFrequency(e.target.value as Task["frequency"])}>
                  <option value="once">One-time</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="on-demand">On-demand</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Location / Area</label>
              <input className="farm-input" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. House A01, Pen B02, Field F01" />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>GPS Coordinates <span style={{ fontWeight: 400, color: "var(--text-dim)" }}>(optional — shows map in task detail)</span></label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <input className="farm-input" style={{ fontSize: 12 }} value={lat} onChange={e => setLat(e.target.value)} placeholder="Latitude e.g. -0.2802" type="number" step="any" />
                </div>
                <div>
                  <input className="farm-input" style={{ fontSize: 12 }} value={lng} onChange={e => setLng(e.target.value)} placeholder="Longitude e.g. 36.066" type="number" step="any" />
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Priority</label>
              <div style={{ display: "flex", gap: 8 }}>
                {(["high", "medium", "low"] as const).map(p => (
                  <button key={p} onClick={() => setPriority(p)} style={{ flex: 1, padding: "8px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", background: priority === p ? `${PRIORITY_COLOR[p]}20` : "var(--card)", border: priority === p ? `1px solid ${PRIORITY_COLOR[p]}60` : "1px solid var(--border-subtle)", color: priority === p ? PRIORITY_COLOR[p] : "var(--text-muted)", textTransform: "capitalize" }}>{p}</button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: "center" }} onClick={() => setStep(1)}>← Back</button>
              <button className="btn-primary" style={{ flex: 2, justifyContent: "center" }} onClick={() => validateStep(2) && setStep(3)}>Next: Options →</button>
            </div>
          </div>
        )}

        {/* ── STEP 3 ── */}
        {step === 3 && (
          <div>
            {/* Approval toggle */}
            <div style={{ marginBottom: 14, padding: "12px 14px", background: "var(--card)", borderRadius: 12, border: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Requires Owner Approval</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Worker submits for review before marking done</div>
              </div>
              <button onClick={() => setRequiresApproval(x => !x)} style={{ width: 44, height: 24, borderRadius: 100, cursor: "pointer", border: "none", background: requiresApproval ? "var(--primary-green)" : "var(--border-subtle)", position: "relative", flexShrink: 0 }}>
                <div style={{ position: "absolute", top: 2, left: requiresApproval ? 22 : 2, width: 20, height: 20, borderRadius: "50%", background: "white", transition: "left 0.15s" }} />
              </button>
            </div>

            {/* Photo limit */}
            <div style={{ marginBottom: 14, padding: "12px 14px", background: "var(--card)", borderRadius: 12, border: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>📷 Photo Evidence</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Set max photos workers can attach. 0 = none allowed.</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["0","1","2","3","5","10",""].map(n => (
                  <button key={n} onClick={() => setMaxPhotos(n)}
                    style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", background: maxPhotos === n ? "rgba(96,165,250,0.15)" : "var(--surface)", border: maxPhotos === n ? "1px solid rgba(96,165,250,0.5)" : "1px solid var(--border-subtle)", color: maxPhotos === n ? "var(--accent-cyan)" : "var(--text-muted)" }}>
                    {n === "" ? "Unlimited" : n === "0" ? "None" : `Max ${n}`}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 8 }}>
                {maxPhotos === "0" ? "Workers cannot attach photos to this task." : maxPhotos === "" ? "Workers can attach any number of photos." : `Workers can attach up to ${maxPhotos} photo${maxPhotos === "1" ? "" : "s"}.`}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Notes / Instructions</label>
              <textarea className="farm-input" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Instructions for the assignee…" style={{ resize: "none" }} />
            </div>

            {/* Summary */}
            <div style={{ padding: 14, background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--primary-green)", marginBottom: 8 }}>Task Summary</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {[
                  ["Code", taskCode], ["Type", `${TYPE_EMOJI[type]} ${type.replace(/-/g, " ")}`],
                  ["Assign", assignMode === "individual" ? assignee.name : assignMode === "group" ? `All ${OWNER_ROLES.find(r=>r.id===groupRole)?.name ?? groupRole}s` : `${extWorkers.length} external`],
                  ["Batch", batch || "None"], ["Unit", unitCode || "None"],
                  ["Start", startDate], ["Time", dueTime],
                  ["Priority", priority],
                  ["Photos", maxPhotos === "0" ? "None" : maxPhotos === "" ? "Unlimited" : `Max ${maxPhotos}`],
                  ["Approval", requiresApproval ? "Required" : "Not required"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{k}</div>
                    <div style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 600, marginTop: 1 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: "center" }} onClick={() => setStep(2)}>← Back</button>
              <button className="btn-primary" style={{ flex: 2, justifyContent: "center" }} onClick={submit}>
                <Check size={14} /> Create Task
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Filter Sheet ── */
function FilterSheet({
  filterStatus, setFilterStatus,
  filterType, setFilterType,
  filterPriority, setFilterPriority,
  filterAssignee, setFilterAssignee,
  filterBatch, setFilterBatch,
  filterUnit, setFilterUnit,
  onClose, onReset,
}: {
  filterStatus: string; setFilterStatus: (v: string) => void;
  filterType: string; setFilterType: (v: string) => void;
  filterPriority: string; setFilterPriority: (v: string) => void;
  filterAssignee: string; setFilterAssignee: (v: string) => void;
  filterBatch: string; setFilterBatch: (v: string) => void;
  filterUnit: string; setFilterUnit: (v: string) => void;
  onClose: () => void; onReset: () => void;
}) {
  const batchUnits = filterBatch !== "All"
    ? Array.from(new Set(TASKS_DATA.filter(t => t.batchCode === filterBatch && t.unitCode).map(t => t.unitCode!)))
    : Array.from(new Set(TASKS_DATA.filter(t => t.unitCode).map(t => t.unitCode!)));

  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "flex-end", zIndex: 200 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: "22px 22px 0 0", width: "100%", maxHeight: "80%", overflowY: "auto", padding: 20, border: "1px solid var(--border-subtle)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Filter Tasks</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase" }}>Status</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["All", "PENDING", "OVERDUE", "DONE", "APPROVED", "REJECTED"].map(v => (
              <button key={v} onClick={() => setFilterStatus(v)} style={{ padding: "6px 12px", borderRadius: 100, fontSize: 11, fontWeight: 700, cursor: "pointer", background: filterStatus === v ? "rgba(74,222,128,0.15)" : "var(--card)", border: filterStatus === v ? "1px solid rgba(74,222,128,0.5)" : "1px solid var(--border-subtle)", color: filterStatus === v ? "var(--primary-green)" : "var(--text-muted)" }}>{v}</button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase" }}>Priority</div>
          <div style={{ display: "flex", gap: 6 }}>
            {["All", "high", "medium", "low"].map(v => (
              <button key={v} onClick={() => setFilterPriority(v)} style={{ flex: 1, padding: "7px", borderRadius: 100, fontSize: 11, fontWeight: 700, cursor: "pointer", background: filterPriority === v ? `${v === "high" ? "rgba(248,113,113,0.15)" : v === "medium" ? "rgba(251,191,36,0.15)" : "rgba(255,255,255,0.08)"}` : "var(--card)", border: filterPriority === v ? `1px solid ${v === "high" ? "rgba(248,113,113,0.5)" : v === "medium" ? "rgba(251,191,36,0.4)" : "rgba(255,255,255,0.2)"}` : "1px solid var(--border-subtle)", color: filterPriority === v ? (v === "high" ? "var(--status-critical)" : v === "medium" ? "var(--accent-amber)" : "var(--text-secondary)") : "var(--text-muted)", textTransform: "capitalize" }}>{v}</button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase" }}>Type</div>
          <select className="farm-input" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="All">All Types</option>
            {TASK_TYPES.map(t => <option key={t} value={t}>{TYPE_EMOJI[t]} {t.replace(/-/g, " ")}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase" }}>Assignee</div>
          <select className="farm-input" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
            <option value="All">All Employees</option>
            {EMPLOYEES_DATA.filter(e => e.farmCode === "FRM-KMU-001").map(e => <option key={e.code} value={e.code}>{e.name}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase" }}>Batch</div>
          <select className="farm-input" value={filterBatch} onChange={e => { setFilterBatch(e.target.value); setFilterUnit("All"); }}>
            <option value="All">All Batches</option>
            {BATCHES_DATA.filter(b => b.farmCode === "FRM-KMU-001").map(b => <option key={b.code} value={b.code}>{b.code} – {b.label}</option>)}
          </select>
        </div>
        {batchUnits.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase" }}>Unit / House / Pen</div>
            <select className="farm-input" value={filterUnit} onChange={e => setFilterUnit(e.target.value)}>
              <option value="All">All Units</option>
              {batchUnits.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onReset} style={{ flex: 1, padding: "11px", borderRadius: 12, background: "var(--card)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Reset All</button>
          <button onClick={onClose} className="btn-primary" style={{ flex: 2, justifyContent: "center" }}>
            <Check size={14} /> Apply Filters
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Screen ── */
export function TasksScreen({ prefillBatch: prefillBatchProp, prefillUnit: prefillUnitProp }: { prefillBatch?: string; prefillUnit?: string } = {}) {
  const { role, params } = useNav();
  const prefillBatch = prefillBatchProp ?? params.batch ?? undefined;
  const prefillUnit  = prefillUnitProp  ?? params.unit  ?? undefined;

  const [showAdd, setShowAdd] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [tasks, setTasks] = useState<Task[]>(TASKS_DATA);
  const { showToast } = useToast();

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterType, setFilterType] = useState("All");
  const [filterPriority, setFilterPriority] = useState("All");
  const [filterAssignee, setFilterAssignee] = useState("All");
  const [filterBatch, setFilterBatch] = useState(prefillBatch ?? "All");
  const [filterUnit, setFilterUnit] = useState(prefillUnit ?? "All");
  const [sortField, setSortField] = useState<SortField>("startDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  }

  const activeFilters = [filterStatus !== "All", filterType !== "All", filterPriority !== "All", filterAssignee !== "All", filterBatch !== "All", filterUnit !== "All"].filter(Boolean).length;

  const filtered = useMemo(() => {
    let ts = tasks;
    if (search) {
      const q = search.toLowerCase();
      ts = ts.filter(t =>
        t.title.toLowerCase().includes(q) || t.code.toLowerCase().includes(q) ||
        t.assigneeName.toLowerCase().includes(q) ||
        (t.batchCode ?? "").toLowerCase().includes(q) ||
        (t.unitCode ?? "").toLowerCase().includes(q) ||
        (t.location ?? "").toLowerCase().includes(q)
      );
    }
    if (filterStatus !== "All") ts = ts.filter(t => t.status === filterStatus);
    if (filterType !== "All") ts = ts.filter(t => t.type === filterType);
    if (filterPriority !== "All") ts = ts.filter(t => t.priority === filterPriority);
    if (filterAssignee !== "All") ts = ts.filter(t => t.assigneeCode === filterAssignee);
    if (filterBatch !== "All") ts = ts.filter(t => t.batchCode === filterBatch);
    if (filterUnit !== "All") ts = ts.filter(t => t.unitCode === filterUnit);
    ts = [...ts].sort((a, b) => {
      let av = "", bv = "";
      if (sortField === "priority") {
        const ord = { high: 0, medium: 1, low: 2 };
        av = String(ord[a.priority] ?? 99);
        bv = String(ord[b.priority] ?? 99);
      } else {
        av = String((a as unknown as Record<string, unknown>)[sortField] ?? "");
        bv = String((b as unknown as Record<string, unknown>)[sortField] ?? "");
      }
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return ts;
  }, [tasks, search, filterStatus, filterType, filterPriority, filterAssignee, filterBatch, filterUnit, sortField, sortDir]);

  const overdue = tasks.filter(t => t.status === "OVERDUE").length;
  const pending = tasks.filter(t => t.status === "PENDING").length;
  const done = tasks.filter(t => t.status === "DONE").length;
  const todayTasks = tasks.filter(t => t.startDate === "2026-08-11");
  const completionPct = todayTasks.length > 0 ? Math.round((todayTasks.filter(t => t.status === "DONE").length / todayTasks.length) * 100) : 0;

  function markDone(code: string) {
    const task = tasks.find(t => t.code === code);
    setTasks(ts => ts.map(t => t.code === code ? { ...t, status: "DONE" as const } : t));
    showToast(task?.requiresApproval ? "Submitted for owner approval" : "Task marked as done ✓", task?.requiresApproval ? "info" : "success");
  }

  function deleteTask(code: string) { setTasks(ts => ts.filter(t => t.code !== code)); }
  function addTask(t: Task) { setTasks(ts => [...ts, t]); }
  function updatePhotos(code: string, photos: Task["photos"]) {
    setTasks(ts => ts.map(t => t.code === code ? { ...t, photos } : t));
    // Keep openTask in sync
    setOpenTask(prev => prev?.code === code ? { ...prev, photos } : prev);
  }

  function resetFilters() {
    setFilterStatus("All"); setFilterType("All"); setFilterPriority("All");
    setFilterAssignee("All"); setFilterBatch(prefillBatch ?? "All"); setFilterUnit(prefillUnit ?? "All"); setSearch("");
  }

  function handleImportRows(rows: Record<string, string>[]) {
    const newTasks: Task[] = rows
      .filter(r => r.code && r.title)
      .filter(r => !tasks.some(t => t.code === r.code))
      .map(r => ({
        code: r.code,
        title: r.title,
        type: r.type || "custom",
        assigneeCode: r.assigneeCode || "EMP-KMU-001",
        assigneeName: EMPLOYEES_DATA.find(e => e.code === r.assigneeCode)?.name ?? r.assigneeCode ?? "Unknown",
        farmCode: "FRM-KMU-001",
        batchCode: r.batchCode || undefined,
        unitCode: r.unitCode || undefined,
        location: r.location || undefined,
        lat: r.lat ? parseFloat(r.lat) : undefined,
        lng: r.lng ? parseFloat(r.lng) : undefined,
        startDate: r.startDate || new Date().toISOString().slice(0,10),
        endDate: r.endDate || undefined,
        dueTime: r.dueTime || "08:00",
        frequency: (r.frequency as Task["frequency"]) || "once",
        status: (r.status as Task["status"]) || "PENDING",
        requiresApproval: r.requiresApproval === "true",
        priority: (r.priority as Task["priority"]) || "medium",
        notes: r.notes || undefined,
        maxPhotos: r.maxPhotos !== "" && r.maxPhotos !== undefined ? parseInt(r.maxPhotos) : undefined,
      }));
    setTasks(ts => [...ts, ...newTasks]);
    showToast(`Imported ${newTasks.length} task${newTasks.length !== 1 ? "s" : ""}`, "success");
  }

  function SortBtn({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field;
    return (
      <button onClick={() => handleSort(field)} style={{ border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 2, color: active ? "var(--primary-green)" : "var(--text-muted)", fontWeight: active ? 700 : 600, fontSize: 10, padding: "4px 8px", borderRadius: 6, background: active ? "rgba(74,222,128,0.08)" : "transparent" }}>
        {label}{active ? (sortDir === "asc" ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : <ChevronDown size={10} style={{ opacity: 0.4 }} />}
      </button>
    );
  }

  const contextBatch = prefillBatch ? BATCHES_DATA.find(b => b.code === prefillBatch) : null;

  return (
    <div className="screen-content">
      <TopNav
        title={contextBatch ? `${contextBatch.label} Tasks` : "Tasks"}
        subtitle={`${filtered.length} shown${activeFilters > 0 ? ` · ${activeFilters} filter${activeFilters > 1 ? "s" : ""}` : ""}${prefillUnit ? ` · ${prefillUnit}` : ""}`}
        rightEl={
          <div style={{ display: "flex", gap: 6 }}>
            {/* Import CSV */}
            <button onClick={() => setShowImport(true)} style={{ width: 36, height: 36, borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} title="Import tasks from CSV">
              <RefreshCw size={13} color="var(--text-muted)" />
            </button>
            {/* Export CSV */}
            <button onClick={() => exportTaskCSV(filtered)} style={{ width: 36, height: 36, borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} title="Export tasks to CSV">
              <Download size={14} color="var(--text-muted)" />
            </button>
            <button className="btn-fab" style={{ width: 36, height: 36, borderRadius: 10 }} onClick={() => setShowAdd(true)}>
              <Plus size={16} />
            </button>
          </div>
        }
      />

      <div className="px-screen" style={{ paddingTop: 12 }}>
        {contextBatch && (
          <div style={{ padding: "10px 14px", background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 12, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--primary-green)" }}>📦 {contextBatch.label}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{contextBatch.code} · {prefillUnit ?? "All units"}</div>
            </div>
            <span className="chip chip-ok" style={{ fontSize: 9 }}>{contextBatch.status}</span>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {[
            { label: "Overdue", value: overdue, color: "var(--status-critical)", bg: "rgba(248,113,113,0.1)" },
            { label: "Pending", value: pending, color: "var(--status-warning)", bg: "rgba(251,191,36,0.1)" },
            { label: "Done Today", value: done, color: "var(--status-ok)", bg: "rgba(74,222,128,0.1)" },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, background: s.bg, borderRadius: 12, padding: "12px 8px", textAlign: "center", border: `1px solid ${s.color}30` }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Today's completion</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{completionPct}%</span>
          </div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${completionPct}%` }} /></div>
        </div>

        <SearchBar value={search} onChange={setSearch} placeholder="Search tasks, codes, units, assignees…" />

        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
          <button onClick={() => setShowFilter(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer", background: activeFilters > 0 ? "rgba(74,222,128,0.12)" : "var(--card)", border: activeFilters > 0 ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)", color: activeFilters > 0 ? "var(--primary-green)" : "var(--text-muted)", flexShrink: 0 }}>
            <Filter size={13} /> Filters {activeFilters > 0 && `(${activeFilters})`}
          </button>
          <div style={{ display: "flex", gap: 4, overflowX: "auto", scrollbarWidth: "none", flex: 1 }}>
            <SortBtn field="priority" label="Priority" />
            <SortBtn field="status" label="Status" />
            <SortBtn field="startDate" label="Date" />
            <SortBtn field="assigneeName" label="Assignee" />
          </div>
          {activeFilters > 0 && (
            <button onClick={resetFilters} style={{ flexShrink: 0, padding: "6px 10px", borderRadius: 8, fontSize: 10, fontWeight: 700, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "var(--status-critical)", cursor: "pointer" }}>Clear</button>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 80 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
              <CheckCircle2 size={32} style={{ marginBottom: 10, opacity: 0.4 }} />
              <div style={{ fontSize: 14, fontWeight: 600 }}>No tasks match your filters</div>
              <button onClick={resetFilters} style={{ marginTop: 12, padding: "8px 16px", borderRadius: 10, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", color: "var(--primary-green)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Clear Filters</button>
            </div>
          ) : (
            filtered.map(t => <TaskCard key={t.code} task={t} onDone={markDone} onDelete={deleteTask} role={role} onOpen={setOpenTask} />)
          )}
        </div>
      </div>

      {showAdd && <AddTaskSheet onClose={() => setShowAdd(false)} onAdd={addTask} prefillBatch={prefillBatch} prefillUnit={prefillUnit} />}
      {showFilter && (
        <FilterSheet
          filterStatus={filterStatus} setFilterStatus={setFilterStatus}
          filterType={filterType} setFilterType={setFilterType}
          filterPriority={filterPriority} setFilterPriority={setFilterPriority}
          filterAssignee={filterAssignee} setFilterAssignee={setFilterAssignee}
          filterBatch={filterBatch} setFilterBatch={setFilterBatch}
          filterUnit={filterUnit} setFilterUnit={setFilterUnit}
          onClose={() => setShowFilter(false)}
          onReset={resetFilters}
        />
      )}
      {openTask && (
        <TaskDetailSheet
          task={openTask}
          role={role}
          onClose={() => setOpenTask(null)}
          onDone={markDone}
          onDelete={deleteTask}
          onUpdatePhotos={updatePhotos}
        />
      )}
      {showImport && (
        <CsvImportModal
          entity="tasks"
          onClose={() => setShowImport(false)}
          onImport={handleImportRows}
        />
      )}
    </div>
  );
}
