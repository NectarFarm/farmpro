"use client";
import React, { useState } from "react";
import { useNav, TopNav } from "./navigation";
import { Droplets, Wind, Thermometer, CloudRain, Sun, AlertTriangle } from "./icons";

const FORECAST = [
  { day: "Today", emoji: "⛅", high: 24, low: 16, rain: 10, wind: 12, humidity: 68 },
  { day: "Thu", emoji: "☀️", high: 27, low: 17, rain: 0, wind: 8, humidity: 55 },
  { day: "Fri", emoji: "🌤", high: 25, low: 16, rain: 5, wind: 10, humidity: 60 },
  { day: "Sat", emoji: "🌧", high: 19, low: 13, rain: 82, wind: 20, humidity: 88 },
  { day: "Sun", emoji: "🌦", high: 21, low: 14, rain: 45, wind: 15, humidity: 78 },
  { day: "Mon", emoji: "☀️", high: 26, low: 16, rain: 5, wind: 9, humidity: 58 },
  { day: "Tue", emoji: "☀️", high: 28, low: 18, rain: 0, wind: 7, humidity: 52 },
];

const WEATHER_ALERTS = [
  { level: "critical", title: "Heavy Rain Warning", detail: "82% chance of heavy rain on Saturday. Consider harvesting silage early and check drainage in Pig Pen 1.", issued: "Met Dept · 3h ago" },
  { level: "warning", title: "Heat Stress Risk", detail: "Temperatures above 25°C forecast Mon–Tue. Ensure extra ventilation in broiler houses and fresh water access.", issued: "Farm AI · 1h ago" },
];

const FARMING_TIPS = [
  { label: "Planting Window", value: "Optimal this week", ok: true },
  { label: "Frost Risk", value: "None (>16°C lows)", ok: true },
  { label: "Spraying Window", value: "Skip Sat–Sun (rain)", ok: false },
  { label: "Harvest Window", value: "Good Thu–Fri", ok: true },
];

const MONTHLY = [
  { month: "Mar", rain: 120 }, { month: "Apr", rain: 180 }, { month: "May", rain: 210 },
  { month: "Jun", rain: 75 }, { month: "Jul", rain: 40 }, { month: "Aug", rain: 55 },
];
const maxRain = Math.max(...MONTHLY.map((m) => m.rain));

export function WeatherScreen() {
  const [activeDay, setActiveDay] = useState(0);
  const today = FORECAST[activeDay];

  return (
    <div className="screen-content">
      <TopNav title="Weather" subtitle="Nakuru Farm · Real-time" />
      <div className="px-screen" style={{ paddingTop: 16 }}>

        {/* Current conditions hero */}
        <div className="farm-card farm-card-active" style={{ padding: 20, marginBottom: 16, background: "linear-gradient(135deg, #0f1f10 0%, #0a2a1a 100%)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Nakuru, Kenya</div>
              <div style={{ fontSize: 64, fontWeight: 200, color: "var(--text-primary)", lineHeight: 1 }}>{today.high}°</div>
              <div style={{ fontSize: 16, color: "var(--text-muted)", marginTop: 4 }}>Partly Cloudy</div>
            </div>
            <div style={{ fontSize: 72, lineHeight: 1 }}>{today.emoji}</div>
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Droplets size={14} color="var(--accent-blue)" />
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{today.humidity}%</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Wind size={14} color="var(--text-muted)" />
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{today.wind}km/h</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <CloudRain size={14} color={today.rain > 50 ? "var(--accent-blue)" : "var(--text-muted)"} />
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{today.rain}% rain</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Thermometer size={14} color="var(--accent-amber)" />
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>L:{today.low}°</span>
            </div>
          </div>
        </div>

        {/* 7-day forecast scroll */}
        <div style={{ display: "flex", gap: 8, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 8, marginBottom: 16 }}>
          {FORECAST.map((d, i) => (
            <button key={d.day} onClick={() => setActiveDay(i)} style={{
              flexShrink: 0, padding: "12px 10px", borderRadius: 14, minWidth: 64, textAlign: "center",
              background: activeDay === i ? "rgba(74,222,128,0.15)" : "var(--card)",
              border: activeDay === i ? "1px solid rgba(74,222,128,0.4)" : "1px solid var(--border-subtle)",
              cursor: "pointer", transition: "all 0.15s ease",
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: activeDay === i ? "var(--primary-green)" : "var(--text-muted)", marginBottom: 4 }}>{d.day}</div>
              <div style={{ fontSize: 22, marginBottom: 4 }}>{d.emoji}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{d.high}°</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{d.low}°</div>
              {d.rain > 50 && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent-blue)", margin: "4px auto 0" }} />}
            </button>
          ))}
        </div>

        {/* Farm advice */}
        <div style={{ marginBottom: 16 }}>
          <div className="section-eyebrow" style={{ marginBottom: 10 }}>Farming Advice</div>
          <div className="farm-card" style={{ overflow: "hidden" }}>
            {FARMING_TIPS.map((t, i) => (
              <div key={t.label} style={{
                padding: "11px 14px", display: "flex", justifyContent: "space-between", alignItems: "center",
                borderBottom: i < FARMING_TIPS.length - 1 ? "1px solid var(--border-subtle)" : "none",
              }}>
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t.label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: t.ok ? "var(--status-ok)" : "var(--status-warning)" }}>{t.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Weather alerts */}
        <div style={{ marginBottom: 16 }}>
          <div className="section-eyebrow" style={{ marginBottom: 10 }}>Active Alerts</div>
          {WEATHER_ALERTS.map((a, i) => (
            <div key={i} className={`alert-row ${a.level === "critical" ? "density-crit" : "density-warn"}`} style={{ marginBottom: 8 }}>
              <AlertTriangle size={18} color={a.level === "critical" ? "var(--status-critical)" : "var(--status-warning)"} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: a.level === "critical" ? "var(--status-critical)" : "var(--status-warning)", marginBottom: 3 }}>{a.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>{a.detail}</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>{a.issued}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Monthly rainfall */}
        <div style={{ marginBottom: 20 }}>
          <div className="section-eyebrow" style={{ marginBottom: 10 }}>Monthly Rainfall (mm)</div>
          <div className="farm-card" style={{ padding: 16 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 80 }}>
              {MONTHLY.map((m) => (
                <div key={m.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{
                    width: "100%", borderRadius: 4,
                    height: Math.round((m.rain / maxRain) * 64),
                    background: m.month === "Aug" ? "var(--gradient-primary)" : "rgba(74,222,128,0.25)",
                  }} />
                  <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>{m.month}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* IoT sensors placeholder */}
        <div style={{ marginBottom: 20 }}>
          <div className="section-eyebrow" style={{ marginBottom: 10 }}>IoT Sensors (Houses)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { name: "House A1", temp: "28°C", humidity: "72%", status: "ok" },
              { name: "House A2", temp: "31°C", humidity: "78%", status: "warn" },
              { name: "Pen B1", temp: "24°C", humidity: "65%", status: "ok" },
              { name: "Pig Pen 1", temp: "26°C", humidity: "70%", status: "ok" },
            ].map((s) => (
              <div key={s.name} className={`farm-card ${s.status === "warn" ? "density-warn" : ""}`} style={{ padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>{s.name}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Thermometer size={12} color={s.status === "warn" ? "var(--status-warning)" : "var(--text-muted)"} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: s.status === "warn" ? "var(--status-warning)" : "var(--text-primary)" }}>{s.temp}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Droplets size={12} color="var(--accent-blue)" />
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.humidity}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
