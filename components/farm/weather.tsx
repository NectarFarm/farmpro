"use client";
import React from "react";
import { useNav, TopNav } from "./navigation";
import { CloudSun, Info } from "./icons";

// ── Weather Screen (issue #228 task 5) ──────────────────────────────────────
// This screen used to be entirely hardcoded sample data: a 7-day forecast,
// weather advisories, a rainfall-by-month chart and fake IoT sensor readings
// (all deleted). No weather backend was built in #227 — the provider decision
// (which forecast API, which farm-location field drives it) is still pending
// — so there is nothing real to show. Rather than keep fabricated numbers on
// screen, this renders an explicit "not available yet" state. Wire this up
// for real once #227's weather backend decision lands: swap this body for a
// fetch against whatever GET /api/weather (or similar) that work produces.
export function WeatherScreen() {
  const { farms, activeFarm } = useNav();
  const farm = activeFarm === "ALL" ? null : farms.find(f => f.code === activeFarm) ?? farms[0];

  return (
    <div className="screen-content">
      <TopNav title="Weather" subtitle={farm?.location ?? "Not connected"} />
      <div className="px-screen" style={{ paddingTop: 16 }}>
        <div className="farm-card" style={{ padding: 28, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12 }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <CloudSun size={26} color="var(--text-muted)" />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Weather not available yet</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, maxWidth: 280 }}>
            No weather provider is connected for this farm. This screen showed placeholder forecast data before — it now shows nothing rather than numbers that aren&apos;t real.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, padding: "6px 12px", borderRadius: 100, background: "rgba(255,255,255,0.04)" }}>
            <Info size={12} color="var(--text-dim)" />
            <span style={{ fontSize: 10, color: "var(--text-dim)" }}>Forecast, alerts and rainfall history are pending a provider decision.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
