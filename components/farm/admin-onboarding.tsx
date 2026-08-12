"use client";
import React, { useState } from "react";
import { useNav, TopNav } from "./navigation";
import {
  Check, X, Clock, ChevronRight, Plus, MessageSquare,
  UserSingle as User, MapPin, Phone, Mail, Building2, AlertTriangle, CheckCircle2
} from "./icons";
import { ONBOARD_REQUESTS, ENTERPRISE_REGISTRY, type OnboardRequest } from "./data";
import { GpsMapBlock, useReverseGeocode } from "./auth";

const STATUS_CONFIG: Record<OnboardRequest["status"], { color: string; bg: string; label: string }> = {
  pending:      { color: "var(--status-warning)", bg: "rgba(251,191,36,0.1)", label: "Pending" },
  approved:     { color: "var(--status-ok)", bg: "rgba(74,222,128,0.08)", label: "Approved" },
  rejected:     { color: "var(--status-critical)", bg: "rgba(248,113,113,0.08)", label: "Rejected" },
  "info-needed": { color: "var(--accent-blue)", bg: "rgba(96,165,250,0.08)", label: "Info Needed" },
};

/* ── Location editor sub-component (hooks must live at component level) ── */
function LocationEditor({
  req,
}: {
  req: OnboardRequest;
}) {
  const [adminAddress, setAdminAddress] = useState(req.address ?? "");
  const [adminLat, setAdminLat] = useState(req.lat != null ? String(req.lat) : "");
  const [adminLng, setAdminLng] = useState(req.lng != null ? String(req.lng) : "");
  const [locationSaved, setLocationSaved] = useState(!!(req.address || req.lat));
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState("");

  // Reverse-geocode: prefill address when coords change (only if address blank)
  useReverseGeocode(adminLat, adminLng, (addr) => {
    setAdminAddress(prev => prev ? prev : addr);
  });

  function detectGPS() {
    if (!navigator.geolocation) { setGpsError("Geolocation not supported on this device"); return; }
    setGpsLoading(true); setGpsError("");
    navigator.geolocation.getCurrentPosition(
      pos => {
        setAdminLat(pos.coords.latitude.toFixed(6));
        setAdminLng(pos.coords.longitude.toFixed(6));
        setGpsLoading(false);
      },
      () => { setGpsError("Could not get location. Enter manually."); setGpsLoading(false); }
    );
  }

  return (
    <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: locationSaved || showLocationForm ? 10 : 4 }}>
        <div>
          <div className="section-eyebrow" style={{ marginBottom: 2 }}>Farm Location</div>
          {locationSaved && !showLocationForm && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
              📍 {adminAddress || req.location}
              {adminLat && adminLng && <span style={{ marginLeft: 6, color: "var(--accent-cyan)", fontFamily: "monospace", fontSize: 10 }}>{parseFloat(adminLat).toFixed(4)}, {parseFloat(adminLng).toFixed(4)}</span>}
            </div>
          )}
          {!locationSaved && !showLocationForm && (
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}>📍 {req.location}{req.address ? ` · ${req.address}` : ""}</div>
          )}
        </div>
        <button onClick={() => setShowLocationForm(f => !f)} style={{ fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 8, background: locationSaved ? "rgba(74,222,128,0.1)" : "var(--surface)", border: "1px solid var(--border-subtle)", color: locationSaved ? "var(--primary-green)" : "var(--text-muted)", cursor: "pointer" }}>
          {showLocationForm ? "Cancel" : locationSaved ? "Edit" : "Set Location"}
        </button>
      </div>

      {/* Map preview when saved and coords exist */}
      {locationSaved && !showLocationForm && adminLat && adminLng && (
        <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid var(--border-subtle)", height: 140, marginTop: 6 }}>
          <iframe
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${(parseFloat(adminLng)-0.01).toFixed(4)},${(parseFloat(adminLat)-0.01).toFixed(4)},${(parseFloat(adminLng)+0.01).toFixed(4)},${(parseFloat(adminLat)+0.01).toFixed(4)}&layer=mapnik&marker=${adminLat},${adminLng}`}
            width="100%" height="140"
            style={{ border: "none", display: "block" }}
            title="Farm location map"
            loading="lazy"
          />
        </div>
      )}

      {showLocationForm && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <GpsMapBlock
            lat={adminLat} lng={adminLng} address={adminAddress}
            onLatChange={setAdminLat} onLngChange={setAdminLng} onAddressChange={setAdminAddress}
            loading={gpsLoading} error={gpsError} onDetect={detectGPS}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowLocationForm(false)} className="btn-secondary" style={{ flex: 1, justifyContent: "center", fontSize: 12, padding: 9 }}>Cancel</button>
            <button
              onClick={() => { setLocationSaved(true); setShowLocationForm(false); }}
              className="btn-primary" style={{ flex: 1, justifyContent: "center", fontSize: 12, padding: 9 }}>
              <Check size={13} /> Save Location
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RequestDetail({
  req,
  onAction,
  onClose,
}: {
  req: OnboardRequest;
  onAction: (id: string, action: OnboardRequest["status"]) => void;
  onClose: () => void;
}) {
  const [infoNote, setInfoNote] = useState(req.notes ?? "");
  const s = STATUS_CONFIG[req.status];

  const enterpriseLabels = req.enterprises.map((e) => {
    const cfg = ENTERPRISE_REGISTRY.find((r) => r.subtype === e);
    return cfg ? `${cfg.emoji} ${cfg.label}` : e;
  });

  return (
    <div
      style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "flex-end", zIndex: 200 }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--surface)", borderRadius: "22px 22px 0 0", width: "100%", maxHeight: "88%", overflowY: "auto", border: "1px solid var(--border-subtle)", padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{req.farmName}</div>
            <span style={{ fontSize: 9, fontWeight: 700, padding: "3px 9px", borderRadius: 100, background: s.bg, color: s.color, border: `1px solid ${s.color}40` }}>{s.label.toUpperCase()}</span>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Farmer info */}
        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Applicant</div>
          {[
            { icon: <User size={13} />, label: "Name", value: req.farmerName },
            { icon: <Mail size={13} />, label: "Email", value: req.email },
            { icon: <Phone size={13} />, label: "Phone", value: req.phone },
            { icon: <MapPin size={13} />, label: "Location", value: req.location },
          ].map((row) => (
            <div key={row.label} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
              <div style={{ color: "var(--text-muted)", flexShrink: 0 }}>{row.icon}</div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{row.label}</div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>{row.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Farm Location — admin-editable */}
        <LocationEditor req={req} />

        {/* Farm enterprises */}
        <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Requested Enterprises</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {enterpriseLabels.map((e) => (
              <span key={e} style={{ fontSize: 12, padding: "5px 11px", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)", borderRadius: 100, color: "var(--primary-green)", fontWeight: 600 }}>{e}</span>
            ))}
          </div>
        </div>

        {/* Request meta */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14, fontSize: 11, color: "var(--text-muted)" }}>
          <Clock size={12} style={{ flexShrink: 0 }} />
          <span>Submitted: {req.requestedAt}</span>
          <span style={{ marginLeft: 4, fontWeight: 700, color: "var(--text-dim)" }}>{req.id}</span>
        </div>

        {/* Notes / info request */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
            Notes / Info Request
          </label>
          <textarea
            className="farm-input"
            rows={3}
            value={infoNote}
            onChange={(e) => setInfoNote(e.target.value)}
            placeholder="Request documents, clarify location, or add admin notes…"
            style={{ resize: "none" }}
          />
        </div>

        {/* Plan selection for approval */}
        {req.status === "pending" && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>Plan to Assign</label>
            <select className="farm-input">
              <option>Trial (14 days, 1 user, 3 batches)</option>
              <option>Basic (5 users, unlimited batches)</option>
              <option>Pro (15 users, payroll, GL, multi-farm)</option>
            </select>
          </div>
        )}

        {/* Action buttons */}
        {req.status === "pending" && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => { onAction(req.id, "approved"); onClose(); }}
              style={{ flex: 1, padding: 11, borderRadius: 12, fontSize: 13, fontWeight: 700, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.35)", color: "var(--status-ok)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              <Check size={14} /> Approve & Onboard
            </button>
            <button
              onClick={() => { onAction(req.id, "rejected"); onClose(); }}
              style={{ flex: 1, padding: 11, borderRadius: 12, fontSize: 13, fontWeight: 700, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "var(--status-critical)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              <X size={14} /> Reject
            </button>
          </div>
        )}
        {req.status === "pending" && (
          <button
            onClick={() => { onAction(req.id, "info-needed"); onClose(); }}
            style={{ width: "100%", marginTop: 8, padding: 11, borderRadius: 12, fontSize: 13, fontWeight: 700, background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.3)", color: "var(--accent-blue)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <MessageSquare size={14} /> Request More Info
          </button>
        )}
      </div>
    </div>
  );
}

export function AdminOnboardingScreen() {
  const [requests, setRequests] = useState<OnboardRequest[]>(ONBOARD_REQUESTS);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<OnboardRequest | null>(null);

  function act(id: string, action: OnboardRequest["status"]) {
    setRequests((rs) => rs.map((r) => r.id === id ? { ...r, status: action } : r));
  }

  const filtered = filter === "all" ? requests : requests.filter((r) => r.status === filter);
  const pending = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="screen-content">
      <TopNav
        title="Onboarding Requests"
        subtitle={`${pending} pending review`}
        rightEl={
          <button className="btn-fab" style={{ width: 36, height: 36, borderRadius: 10 }}>
            <Plus size={16} />
          </button>
        }
      />

      <div className="px-screen" style={{ paddingTop: 12 }}>
        {/* Summary */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {[
            { label: "Pending", value: requests.filter(r => r.status === "pending").length, color: "var(--status-warning)", bg: "rgba(251,191,36,0.1)" },
            { label: "Info Needed", value: requests.filter(r => r.status === "info-needed").length, color: "var(--accent-blue)", bg: "rgba(96,165,250,0.08)" },
            { label: "Approved", value: requests.filter(r => r.status === "approved").length, color: "var(--status-ok)", bg: "rgba(74,222,128,0.08)" },
          ].map((s) => (
            <div key={s.label} style={{ flex: 1, background: s.bg, borderRadius: 12, padding: "10px", textAlign: "center", border: `1px solid ${s.color}30` }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="chip-row" style={{ marginBottom: 14 }}>
          {["all", "pending", "info-needed", "approved", "rejected"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`filter-chip ${filter === f ? "active" : ""}`}
              style={{ textTransform: "capitalize" }}
            >
              {f === "all" ? "All" : f.replace(/-/g, " ")}
              {f === "pending" && pending > 0 ? ` (${pending})` : ""}
            </button>
          ))}
        </div>

        {/* Request list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 80 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
              <CheckCircle2 size={32} style={{ marginBottom: 10, opacity: 0.4 }} />
              <div style={{ fontSize: 14, fontWeight: 600 }}>No {filter} requests</div>
            </div>
          ) : (
            filtered.map((req) => {
              const s = STATUS_CONFIG[req.status];
              const enterprises = req.enterprises.map((e) => {
                const cfg = ENTERPRISE_REGISTRY.find((r) => r.subtype === e);
                return cfg ? cfg.emoji : "🌱";
              });

              return (
                <button
                  key={req.id}
                  onClick={() => setSelected(req)}
                  className="farm-card"
                  style={{ padding: 14, width: "100%", textAlign: "left", cursor: "pointer", border: req.status === "pending" ? "1px solid rgba(251,191,36,0.25)" : "1px solid var(--border-subtle)" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{req.farmName}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        <User size={10} style={{ verticalAlign: "middle", marginRight: 3 }} />
                        {req.farmerName} · {req.location}
                      </div>
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "3px 9px", borderRadius: 100, background: s.bg, color: s.color, border: `1px solid ${s.color}40`, flexShrink: 0 }}>
                      {s.label.toUpperCase()}
                    </span>
                  </div>

                  {/* Enterprises row */}
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    {enterprises.map((e, i) => (
                      <span key={i} style={{ fontSize: 16 }}>{e}</span>
                    ))}
                    <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center" }}>
                      {req.enterprises.join(", ")}
                    </span>
                  </div>

                  {/* Notes strip */}
                  {req.notes && (
                    <div style={{ fontSize: 11, color: "var(--accent-blue)", padding: "6px 10px", background: "rgba(96,165,250,0.06)", borderRadius: 8, marginBottom: 8, border: "1px solid rgba(96,165,250,0.15)" }}>
                      <MessageSquare size={10} style={{ verticalAlign: "middle", marginRight: 4 }} />
                      {req.notes}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
                      <Clock size={10} style={{ verticalAlign: "middle", marginRight: 3 }} />
                      {req.requestedAt} · {req.id}
                    </span>
                    <ChevronRight size={14} color="var(--text-muted)" />
                  </div>

                  {/* Inline quick actions for pending */}
                  {req.status === "pending" && (
                    <div style={{ display: "flex", gap: 6, marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => { e.stopPropagation(); act(req.id, "approved"); }}
                        style={{ flex: 1, padding: "7px", borderRadius: 8, fontSize: 11, fontWeight: 700, background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", color: "var(--status-ok)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
                      >
                        <Check size={12} /> Approve
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); act(req.id, "rejected"); }}
                        style={{ flex: 1, padding: "7px", borderRadius: 8, fontSize: 11, fontWeight: 700, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "var(--status-critical)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
                      >
                        <X size={12} /> Reject
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelected(req); }}
                        style={{ padding: "7px 12px", borderRadius: 8, fontSize: 11, background: "var(--surface)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", cursor: "pointer" }}
                      >
                        Details
                      </button>
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {selected && (
        <RequestDetail
          req={selected}
          onAction={act}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
