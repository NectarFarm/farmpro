"use client";
import React, { useState } from "react";
import { useNav, TopNav } from "./navigation";
import {
  CheckCircle2, Clock, AlertTriangle, Plus, Camera, MapPin,
  ChevronRight, Wifi, WifiOff, Upload, Check, X,
  Clipboard, ClipboardCheck, Scale, Syringe, Heart,
  Droplets, Activity, Package
} from "./icons";

const WORKER_TASKS = [
  { id: 1, title: "Morning Round – House A1", type: "morning-round", emoji: "🌅", dueTime: "08:00", done: true, doneAt: "08:14" },
  { id: 2, title: "Feeding – BRO-22 & BRO-23", type: "feeding", emoji: "🌾", dueTime: "08:30", done: false, doneAt: null },
  { id: 3, title: "Vaccination – Newcastle Day 14", type: "vaccination", emoji: "💉", dueTime: "10:00", done: false, doneAt: null },
];

const QUICK_TILES = [
  { label: "Morning Round", emoji: "🌅", type: "morning" as const, doneToday: true, doneAt: "08:14" },
  { label: "Feeding", emoji: "🌾", type: "feeding" as const, doneToday: false, doneAt: null },
  { label: "Collect Products", emoji: "🥚", type: "collect" as const, doneToday: true, doneAt: "09:05" },
  { label: "Mortality", emoji: "💀", type: "mortality" as const, doneToday: false, doneAt: null },
  { label: "Health & Vaccine", emoji: "💉", type: "health" as const, doneToday: false, doneAt: null },
  { label: "Weight Sample", emoji: "⚖️", type: "weight" as const, doneToday: false, doneAt: null },
  { label: "Physical Count", emoji: "🔢", type: "count" as const, doneToday: false, doneAt: null },
  { label: "Closing Stock", emoji: "📦", type: "closing" as const, doneToday: false, doneAt: null },
];

export function WorkerHomeScreen() {
  const { navigate } = useNav();
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
      {/* Greeting */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{greeting}</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>John Kamau 🌾</div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: "rgba(96,165,250,0.1)", borderRadius: 100, border: "1px solid rgba(96,165,250,0.25)" }}>
            <Wifi size={11} color="var(--accent-blue)" />
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-blue)" }}>Online · Synced</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>
        </div>
      </div>

      {/* Alert (read-only) */}
      <div style={{ padding: "10px 12px", background: "rgba(251,191,36,0.08)", borderRadius: 12, border: "1px solid rgba(251,191,36,0.25)", marginBottom: 14, display: "flex", gap: 8, alignItems: "flex-start" }}>
        <AlertTriangle size={14} color="var(--status-warning)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--status-warning)" }}>Alert from owner</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.4 }}>House A2 – report feed levels when you do the evening round.</div>
        </div>
      </div>

      {/* My Tasks */}
      <div className="section-eyebrow" style={{ marginBottom: 10 }}>My Tasks Today</div>
      <div className="farm-card" style={{ marginBottom: 14, overflow: "hidden" }}>
        {WORKER_TASKS.map((t, i) => (
          <div key={t.id} style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", borderBottom: i < WORKER_TASKS.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0, fontSize: 18,
              background: t.done ? "rgba(74,222,128,0.12)" : "var(--surface)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{t.emoji}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.done ? "var(--text-muted)" : "var(--text-primary)", textDecoration: t.done ? "line-through" : "none" }}>{t.title}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>Due {t.dueTime}</span>
                {t.done && <span style={{ fontSize: 11, color: "var(--status-ok)" }}>✓ Done {t.doneAt}</span>}
              </div>
            </div>
            {!t.done && (
              <button onClick={() => navigate("worker-record")} style={{
                padding: "7px 12px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)",
                color: "var(--primary-green)", cursor: "pointer",
              }}>Open</button>
            )}
          </div>
        ))}
      </div>

      {/* Quick Record tiles */}
      <div className="section-eyebrow" style={{ marginBottom: 10 }}>Quick Record</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
        {QUICK_TILES.map((tile) => (
          <button key={tile.label} onClick={() => navigate("worker-record")} style={{
            padding: "12px 4px", borderRadius: 14, background: tile.doneToday ? "rgba(74,222,128,0.08)" : "var(--card)",
            border: tile.doneToday ? "1px solid rgba(74,222,128,0.25)" : "1px solid var(--border-subtle)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "pointer", position: "relative",
          }}>
            {tile.doneToday && <div style={{ position: "absolute", top: 6, right: 6, width: 8, height: 8, borderRadius: "50%", background: "var(--status-ok)" }} />}
            <span style={{ fontSize: 22 }}>{tile.emoji}</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: tile.doneToday ? "var(--primary-green)" : "var(--text-muted)", textAlign: "center", lineHeight: 1.3 }}>{tile.label}</span>
            {tile.doneToday && <span style={{ fontSize: 8, color: "var(--status-ok)" }}>{tile.doneAt}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WorkerRecordScreen() {
  const { navigate } = useNav();
  const [activeForm, setActiveForm] = useState<null | string>(null);
  const [step, setStep] = useState(1);

  const GROUPS = [
    {
      label: "Every Day",
      tiles: [
        { type: "morning", label: "Morning Round", emoji: "🌅", desc: "Per-unit check-in" },
        { type: "feeding", label: "Feeding", emoji: "🌾", desc: "Log feed per batch" },
        { type: "collect", label: "Collect Products", emoji: "🥚", desc: "Eggs, milk, etc." },
      ],
    },
    {
      label: "As Needed",
      tiles: [
        { type: "mortality", label: "Mortality", emoji: "⚠️", desc: "Record deaths" },
        { type: "health", label: "Health & Vaccine", emoji: "💉", desc: "Treatment log" },
      ],
    },
    {
      label: "Stock Counts",
      tiles: [
        { type: "weight", label: "Weight Sample", emoji: "⚖️", desc: "Batch weights" },
        { type: "count", label: "Physical Count", emoji: "🔢", desc: "Vs system count" },
        { type: "closing", label: "Closing Stock", emoji: "📦", desc: "End-of-day qty" },
      ],
    },
  ];

  if (activeForm === "feeding") return <FeedingForm step={step} setStep={setStep} onBack={() => { setActiveForm(null); setStep(1); }} />;
  if (activeForm === "mortality") return <MortalityForm step={step} setStep={setStep} onBack={() => { setActiveForm(null); setStep(1); }} />;
  if (activeForm === "count") return <PhysicalCountForm onBack={() => setActiveForm(null)} />;

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
    </div>
  );
}

function FeedingForm({ step, setStep, onBack }: { step: number; setStep: (s: number) => void; onBack: () => void }) {
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
            {["BRO-22 – Broilers Oct", "BRO-23 – Broilers Nov", "LAY-08 – Layers Batch 8"].map((b) => (
              <button key={b} onClick={() => setStep(2)} style={{
                width: "100%", padding: "14px 16px", marginBottom: 8, borderRadius: 12, textAlign: "left", cursor: "pointer",
                background: "var(--card)", border: "1px solid var(--border-subtle)",
                fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
              }}>🐔 {b}</button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>BRO-22 – Broilers Oct · 920 birds</div>
            {[{ item: "Broiler Starter Mash", lot: "LOT-2026-045", available: "1240kg" }, { item: "Limestone Grit", lot: "LOT-2026-048", available: "120kg" }].map((f, i) => (
              <div key={f.item} className="farm-card" style={{ padding: 14, marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>🌾 {f.item}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>{f.lot} · Available: {f.available}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button style={{ width: 40, height: 40, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border-subtle)", fontSize: 20, color: "var(--text-primary)", cursor: "pointer" }}>−</button>
                  <div style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)" }}>{i === 0 ? "48" : "12"}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>kg</div>
                  </div>
                  <button style={{ width: 40, height: 40, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border-subtle)", fontSize: 20, color: "var(--text-primary)", cursor: "pointer" }}>+</button>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: "center", borderRadius: 12 }} onClick={() => setStep(1)}>Back</button>
              <button className="btn-primary" style={{ flex: 2, justifyContent: "center", borderRadius: 12 }} onClick={() => setStep(3)}>Review</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ padding: "14px", background: "rgba(74,222,128,0.06)", borderRadius: 14, border: "1px solid rgba(74,222,128,0.2)", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Summary – BRO-22</div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}>
                <span style={{ color: "var(--text-muted)" }}>Broiler Starter Mash</span><span style={{ fontWeight: 700 }}>48 kg</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "var(--text-muted)" }}>Limestone Grit</span><span style={{ fontWeight: 700 }}>12 kg</span>
              </div>
            </div>
            <div style={{ padding: "10px 12px", background: "rgba(96,165,250,0.08)", borderRadius: 10, marginBottom: 16, border: "1px solid rgba(96,165,250,0.2)", display: "flex", gap: 8 }}>
              <MapPin size={13} color="var(--accent-blue)" style={{ marginTop: 1, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>GPS location will be attached to this record</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: "center", borderRadius: 12 }} onClick={() => setStep(2)}>Back</button>
              <button className="btn-primary" style={{ flex: 2, justifyContent: "center", borderRadius: 12 }} onClick={onBack}>
                <Check size={14} /> Save & Continue
              </button>
            </div>
            <button style={{ width: "100%", padding: "12px", borderRadius: 12, fontSize: 13, fontWeight: 600, background: "var(--card)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", cursor: "pointer" }} onClick={onBack}>
              Save & Finish
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MortalityForm({ step, setStep, onBack }: { step: number; setStep: (s: number) => void; onBack: () => void }) {
  const [count, setCount] = useState(2);
  const needsPhoto = count >= 3;

  return (
    <div className="screen-content">
      <div className="px-screen">
        <TopNav title="Mortality Record" showBack />
      </div>
      <div className="px-screen" style={{ paddingTop: 16 }}>
        <div style={{ display: "flex", gap: 0, marginBottom: 20 }}>
          {["Unit","Count & Cause","Photo","Confirm"].map((s, i) => (
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
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Select unit:</div>
            {["House A1 – BRO-22 (920)", "House A2 – BRO-23 (740)", "Pen B1 – LAY-08 (490)"].map((u) => (
              <button key={u} onClick={() => setStep(2)} style={{ width: "100%", padding: "14px 16px", marginBottom: 8, borderRadius: 12, textAlign: "left", cursor: "pointer", background: "var(--card)", border: "1px solid var(--border-subtle)", fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>🏠 {u}</button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>House A1 – BRO-22 · System count: 920</div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "center", marginBottom: 16 }}>
                <button onClick={() => setCount(Math.max(0, count - 1))} style={{ width: 52, height: 52, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border-subtle)", fontSize: 24, color: "var(--text-primary)", cursor: "pointer" }}>−</button>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 52, fontWeight: 700, color: count > 0 ? "var(--status-critical)" : "var(--text-primary)", lineHeight: 1 }}>{count}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>deaths</div>
                </div>
                <button onClick={() => setCount(count + 1)} style={{ width: 52, height: 52, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border-subtle)", fontSize: 24, color: "var(--text-primary)", cursor: "pointer" }}>+</button>
              </div>
              {needsPhoto && <div style={{ padding: "8px 12px", background: "rgba(248,113,113,0.08)", borderRadius: 10, border: "1px solid rgba(248,113,113,0.25)", fontSize: 11, color: "var(--status-critical)", fontWeight: 600, marginBottom: 10 }}>⚠ Photo required for {count}+ deaths</div>}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "var(--text-secondary)" }}>Cause of death:</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              {["Sudden death","Disease","Injury","Heat stress","Respiratory","Unknown"].map((c) => (
                <button key={c} style={{ padding: "10px 8px", borderRadius: 10, fontSize: 12, fontWeight: 600, background: c === "Disease" ? "rgba(248,113,113,0.12)" : "var(--card)", border: c === "Disease" ? "1px solid rgba(248,113,113,0.3)" : "1px solid var(--border-subtle)", color: c === "Disease" ? "var(--status-critical)" : "var(--text-muted)", cursor: "pointer" }}>{c}</button>
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
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>Your owner requires a photo for {count}+ deaths. This helps with disease investigation.</div>
            </div>
            <button style={{ width: "100%", padding: "16px", borderRadius: 14, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", color: "var(--primary-green)", fontWeight: 700, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10 }}>
              <Camera size={18} /> Take Photo
            </button>
            <button className="btn-secondary" style={{ width: "100%", justifyContent: "center", marginBottom: 10 }} onClick={() => setStep(2)}>Back</button>
            <button className="btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => setStep(4)}>Continue with Photo</button>
          </div>
        )}

        {step === 4 && (
          <div>
            <div style={{ padding: "14px", background: "rgba(74,222,128,0.06)", borderRadius: 14, border: "1px solid rgba(74,222,128,0.2)", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Confirm & Save</div>
              {[["Unit","House A1 – BRO-22"],["Deaths",`${count} birds`],["Cause","Disease"],["Photo","Attached ✓"],["GPS","Auto-captured"]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                  <span style={{ color: "var(--text-muted)" }}>{k}</span>
                  <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", background: "rgba(96,165,250,0.08)", borderRadius: 8, marginBottom: 14, border: "1px solid rgba(96,165,250,0.2)" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-blue)", flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "var(--accent-blue)" }}>Offline · Will sync when connected</span>
            </div>
            <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 8 }} onClick={onBack}>
              <Check size={14} /> Save Record
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PhysicalCountForm({ onBack }: { onBack: () => void }) {
  return (
    <div className="screen-content">
      <div className="px-screen">
        <TopNav title="Physical Count" showBack />
      </div>
      <div className="px-screen" style={{ paddingTop: 16 }}>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Select Batch</label>
          <select className="farm-input">
            <option>BRO-22 – Broilers Oct (920 in system)</option>
          </select>
        </div>
        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)" }}>920</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>System count</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--status-warning)" }}>895</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Your count</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--status-critical)" }}>−25</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Variance</div>
            </div>
          </div>
          <div className="progress-track">
            <div style={{ height: "100%", width: "97%", background: "var(--gradient-primary)", borderRadius: 100 }} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 5 }}>Your Physical Count</label>
          <input className="farm-input" type="number" placeholder="Enter count" defaultValue="895" style={{ fontSize: 22, textAlign: "center", fontWeight: 700 }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>Reason for variance</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {["Suspected theft","Found extra","Uncounted deaths","Counting error"].map((r) => (
              <button key={r} style={{ padding: "9px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: r === "Counting error" ? "rgba(251,191,36,0.1)" : "var(--card)", border: r === "Counting error" ? "1px solid rgba(251,191,36,0.3)" : "1px solid var(--border-subtle)", color: r === "Counting error" ? "var(--status-warning)" : "var(--text-muted)", cursor: "pointer" }}>{r}</button>
            ))}
          </div>
        </div>
        <div style={{ padding: "10px 12px", background: "rgba(251,191,36,0.06)", borderRadius: 10, border: "1px solid rgba(251,191,36,0.2)", marginBottom: 14, fontSize: 11, color: "var(--text-muted)" }}>
          This count <strong style={{ color: "var(--text-secondary)" }}>does not change the system count</strong>. Your owner will review and approve any adjustments.
        </div>
        <button className="btn-primary" style={{ width: "100%", justifyContent: "center", marginBottom: 8 }} onClick={onBack}>
          <Check size={14} /> Submit Count
        </button>
      </div>
    </div>
  );
}

export function WorkerPayScreen() {
  return (
    <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>My Pay</div>

      {/* Hero */}
      <div className="farm-card farm-card-active" style={{ padding: 20, marginBottom: 16, textAlign: "center" }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Paid to date</div>
        <div style={{ fontSize: 42, fontWeight: 700 }} className="text-gradient">KSh 108,000</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>6 months · KSh 18,000/mo · Payday: 28th</div>
        <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(74,222,128,0.08)", borderRadius: 10, display: "inline-block" }}>
          <span style={{ fontSize: 12, color: "var(--primary-green)", fontWeight: 600 }}>Next payday: Aug 28, 2026</span>
        </div>
      </div>

      {/* Payslips */}
      <div className="section-eyebrow" style={{ marginBottom: 10 }}>Payslip History</div>
      <div className="farm-card" style={{ overflow: "hidden", marginBottom: 20 }}>
        {[
          { period: "Jul 2026", gross: 18000, advances: 0, fines: 0, bonus: 0, net: 18000, status: "paid" },
          { period: "Jun 2026", gross: 18000, advances: 2000, fines: 500, bonus: 0, net: 15500, status: "paid" },
          { period: "May 2026", gross: 18000, advances: 0, fines: 0, bonus: 1000, net: 19000, status: "paid" },
          { period: "Apr 2026", gross: 18000, advances: 1500, fines: 0, bonus: 0, net: 16500, status: "paid" },
        ].map((p, i, arr) => (
          <div key={p.period} style={{ padding: "13px 14px", borderBottom: i < arr.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>{p.period}</div>
              <span className="chip chip-ok" style={{ fontSize: 9 }}>PAID</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4, fontSize: 11 }}>
              {[["Gross", `${(p.gross/1000).toFixed(0)}K`, "var(--text-secondary)"],
                ["Advances", p.advances > 0 ? `-${(p.advances/1000).toFixed(1)}K` : "–", "var(--status-warning)"],
                ["Bonus", p.bonus > 0 ? `+${(p.bonus/1000).toFixed(1)}K` : "–", "var(--status-ok)"],
                ["Net", `${(p.net/1000).toFixed(1)}K`, "var(--primary-green)"],
              ].map(([k, v, c]) => (
                <div key={k} style={{ textAlign: "center" }}>
                  <div style={{ fontWeight: 700, color: c as string, fontSize: 12 }}>{v as string}</div>
                  <div style={{ color: "var(--text-dim)", fontSize: 9, fontWeight: 600 }}>{k as string}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkerProfileScreen() {
  return (
    <div className="screen-content px-screen" style={{ paddingTop: 16 }}>
      {/* Avatar */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(74,222,128,0.2)", border: "2px solid rgba(74,222,128,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 700, color: "var(--primary-green)", marginBottom: 10 }}>JK</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>John Kamau</div>
        <span className="chip chip-ok" style={{ marginTop: 4 }}>Worker</span>
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <div className="sync-pill"><Upload size={11} /> 2 pending</div>
        </div>
      </div>

      {/* Today's records */}
      <div className="section-eyebrow" style={{ marginBottom: 8 }}>Today's Records</div>
      <div className="farm-card" style={{ overflow: "hidden", marginBottom: 14 }}>
        {[
          { type: "Morning Round", status: "synced", time: "08:14", batch: "House A1" },
          { type: "Feeding", status: "synced", time: "08:42", batch: "BRO-22" },
          { type: "Collect Products", status: "synced", time: "09:05", batch: "LAY-08" },
          { type: "Feeding", status: "pending", time: "—", batch: "BRO-23" },
        ].map((r, i, arr) => (
          <div key={i} style={{ padding: "11px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: i < arr.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{r.type}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{r.batch} · {r.time}</div>
            </div>
            <span className={`chip ${r.status === "synced" ? "chip-ok" : r.status === "pending" ? "chip-warning" : "chip-critical"}`} style={{ fontSize: 9 }}>{r.status.toUpperCase()}</span>
          </div>
        ))}
      </div>

      {/* Settings */}
      <div className="section-eyebrow" style={{ marginBottom: 8 }}>Settings</div>
      <div className="farm-card" style={{ overflow: "hidden", marginBottom: 16 }}>
        {[["Language", "English (EN)"],["High Contrast Mode", "Off"],["Sync on WiFi only", "On"]].map(([k, v], i, arr) => (
          <div key={k as string} style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", borderBottom: i < arr.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{k as string}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--primary-green)" }}>{v as string}</span>
          </div>
        ))}
      </div>

      <button style={{ width: "100%", padding: "14px", borderRadius: 14, fontSize: 14, fontWeight: 700, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "var(--status-critical)", cursor: "pointer", marginBottom: 20 }}>
        Sign Out (keeps unsynced records)
      </button>
    </div>
  );
}
