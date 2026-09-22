'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNav, TopNav } from './navigation';
import { useToast } from './ui-shared';
import { apiClient } from '@/lib/request';
import {
  CloudSun, Sun, Cloud, CloudFog, CloudRain, CloudLightning, Snowflake,
  Droplets, Wind, Thermometer, Info, MapPin, RefreshCw,
  Sprout, Wheat, Leaf, Package, Syringe, Home, DollarSign, Sparkles,
  ExternalLink, AlertTriangle, ClipboardList, Check, type LucideIcon,
} from './icons';
import type { WeatherData, WeatherIconKeyLike } from '@/lib/weather-types';
import { PageHeader } from '@/components/ui-kit/page-header';
import { Badge } from '@/components/ui-kit/badge';
import { Button } from '@/components/ui-kit/button';
import { Input } from '@/components/ui-kit/input';
import { Field, controlClass } from '@/components/ui-kit/field';
import { EmptyState } from '@/components/ui-kit/empty-state';
import { Continue } from '@/components/ui-kit/continue';

/* ── Farm recommendations ──────────────────────────────────────────────────
 * Cards from GET /api/weather/advice: what to do over the next few days,
 * generated from this farm's OWN records plus the real forecast for its pin,
 * and cached server-side for six hours because each generation is a paid AI
 * call with web search.
 *
 * Each card states its BASIS, and that is the part that matters. "From your
 * records" and "general guidance" carry completely different authority, and a
 * farmer deciding whether to act on a card needs to know which one they are
 * reading — the same rule the reports and the advisor already follow. A card
 * sourced from the open web says so, and links out.
 *
 * ── Redesign (pkg/e-weather-advisor) ────────────────────────────────────────
 * Reference's weather.tsx (scratchpad/grok/src/routes/weather.tsx) makes the
 * current-temp card the hero and buries "what the houses need" as a plain
 * list under it. Lead call: here the recommendations ARE the hero — "what
 * this weather means for the farm today" — with the forecast strip demoted
 * to a compact strip beneath. Every field/endpoint below is unchanged; only
 * the layout and the one-tap "Assign this" (new, reusing POST /api/tasks
 * exactly as tasks.tsx already calls it) are new. */
type Activity = 'plant' | 'harvest' | 'weed' | 'irrigate' | 'feed' | 'health' | 'stock' | 'shelter' | 'sell' | 'other';

interface Recommendation {
  title: string; action: string; from: string; to: string;
  urgency: 'today' | 'soon' | 'plan';
  basis: 'records' | 'forecast' | 'general';
  why: string; activity: Activity; enterprise: string | null;
  sourceUrl?: string; sourceTitle?: string;
}

const ACTIVITY_ICON: Record<Activity, LucideIcon> = {
  plant: Sprout, harvest: Wheat, weed: Leaf, irrigate: Droplets,
  feed: Package, health: Syringe, stock: Package, shelter: Home,
  sell: DollarSign, other: Sparkles,
};

const URGENCY_STYLE: Record<Recommendation['urgency'], { label: string; badge: 'danger' | 'warning' | 'default'; iconBg: string; iconColor: string }> = {
  today: { label: 'Today', badge: 'danger', iconBg: 'var(--color-danger-soft)', iconColor: 'var(--color-danger)' },
  soon: { label: 'This week', badge: 'warning', iconBg: 'var(--color-warning-soft)', iconColor: 'var(--color-warning)' },
  plan: { label: 'Plan ahead', badge: 'default', iconBg: 'var(--color-surface-2)', iconColor: 'var(--color-muted)' },
};

const BASIS_LABEL: Record<Recommendation['basis'], string> = {
  records: 'From your records',
  forecast: 'From the forecast',
  general: 'General guidance',
};

function fmtRange(from: string, to: string): string {
  const f = new Date(from), t = new Date(to);
  const d = (x: Date) => x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return from === to ? d(f) : `${d(f)} – ${d(t)}`;
}

// Best-effort due date for the one-tap task: 8am on the recommendation's
// start day. `from` is always "YYYY-MM-DD" per the advisor's own prompt
// contract (lib/farm-advice.ts) but this degrades to "no due date" rather
// than crash if a future model ever drifts from that shape.
function dueAtFromRecommendation(from: string): string | undefined {
  const d = new Date(`${from}T08:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
const URGENCY_PRIORITY: Record<Recommendation['urgency'], 'high' | 'medium' | 'low'> = {
  today: 'high', soon: 'medium', plan: 'low',
};

function RecommendationCard({
  r, canAssign, busy, assigned, onAssign,
}: {
  r: Recommendation; canAssign: boolean; busy: boolean; assigned: boolean; onAssign: () => void;
}) {
  const Icon = ACTIVITY_ICON[r.activity] ?? Sparkles;
  const u = URGENCY_STYLE[r.urgency];
  return (
    <li className="border-b border-border py-4 last:border-0">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{ background: u.iconBg }}>
          <Icon size={16} color={u.iconColor} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-medium text-fg">{r.title}</span>
            <Badge variant={u.badge}>{u.label}</Badge>
          </div>
          <div className="mt-0.5 text-xs text-subtle">
            {fmtRange(r.from, r.to)}
            {r.enterprise ? ` · ${r.enterprise.replace(/_/g, ' ')}` : ''}
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{r.action}</p>
          {r.why && <p className="mt-1 text-xs leading-relaxed text-subtle">{r.why}</p>}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted">{BASIS_LABEL[r.basis]}</span>
            {r.sourceUrl && (
              <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer"
                 className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <ExternalLink size={11} aria-hidden="true" /> {r.sourceTitle || 'Read more'}
              </a>
            )}
            {canAssign && (
              <Button
                type="button" variant={assigned ? 'secondary' : 'outline'} size="sm"
                className="ml-auto"
                onClick={onAssign}
                disabled={busy || assigned}
              >
                {assigned ? <><Check size={12} /> Assigned</> : <><ClipboardList size={12} /> {busy ? 'Assigning…' : 'Assign this'}</>}
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

// ── Weather Screen (ui-polish-theme-weather; redesigned pkg/e-weather-advisor)
// Calls GET /api/weather, which fetches Open-Meteo (free, keyless) server
// side. See that route's header for the coordinate story: farms.latitude/
// longitude is a NEW column — most existing farms have neither, so "no
// coordinates yet" is a first-class, honest state here, not an error.

const ICONS: Record<WeatherIconKeyLike, React.ComponentType<{ size?: number; color?: string }>> = {
  sun: Sun,
  'cloud-sun': CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  rain: CloudRain,
  snow: Snowflake,
  storm: CloudLightning,
};

function WeatherIcon({ icon, size = 26, color = 'var(--color-fg)' }: { icon: string; size?: number; color?: string }) {
  const Cmp = ICONS[icon as WeatherIconKeyLike] ?? Cloud;
  return <Cmp size={size} color={color} />;
}

function dayLabel(iso: string, index: number): string {
  if (index === 0) return 'Today';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      {icon}
      <span className="text-sm font-medium text-fg tabular-nums">{value}</span>
      <span className="text-[10px] font-medium tracking-wide text-subtle uppercase">{label}</span>
    </div>
  );
}

export function WeatherScreen() {
  const { farms, activeFarmId, tenantId, role, navigate } = useNav();
  const { showToast } = useToast();

  // Weather is inherently per-farm — 'ALL' doesn't resolve to coordinates.
  // With exactly one farm there's nothing to ask the user, so default to it;
  // with several, let them pick one right here instead of forcing a trip to
  // the farm switcher first.
  const [pickedFarmId, setPickedFarmId] = useState<string>('');
  const effectiveFarmId = activeFarmId !== 'ALL' ? activeFarmId : (pickedFarmId || (farms.length === 1 ? farms[0].id : ''));
  const farm = farms.find(f => f.id === effectiveFarmId) ?? null;

  const [data, setData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Recommendations. Fetched separately from the forecast and allowed to fail
  // on their own: a broken or unconfigured AI must never take the weather
  // screen down with it, because the forecast is the thing the farmer came for.
  const [advice, setAdvice] = useState<Recommendation[] | null>(null);
  const [adviceAt, setAdviceAt] = useState<string>('');
  const [adviceStale, setAdviceStale] = useState(false);
  const [adviceError, setAdviceError] = useState('');
  const [adviceBusy, setAdviceBusy] = useState(false);
  // Owner/manager only, matching the endpoint — these read the farm's batches,
  // stock and open work, so a worker would just get a 403. The one-tap
  // "assign this" reuses POST /api/tasks, which the same roles can call.
  const canSeeAdvice = role === 'owner' || role === 'manager';

  const loadAdvice = useCallback((refresh = false) => {
    if (!canSeeAdvice || !effectiveFarmId) return;
    setAdviceBusy(true);
    setAdviceError('');
    apiClient.get<{ recommendations: Recommendation[]; generatedAt: string; stale?: boolean }>(
      `/api/weather/advice?tenantId=${tenantId}&farmId=${effectiveFarmId}${refresh ? '&refresh=true' : ''}`
    ).then((res) => {
      setAdviceBusy(false);
      if (!res.success) { setAdviceError(res.error || 'Could not load recommendations.'); return; }
      setAdvice(res.data.recommendations);
      setAdviceAt(res.data.generatedAt);
      setAdviceStale(!!res.data.stale);
    });
  }, [canSeeAdvice, effectiveFarmId, tenantId]);

  useEffect(() => { loadAdvice(false); }, [loadAdvice]);

  // One-tap "Assign this" (§2 Weather PARTIAL row) — reuses the exact same
  // POST /api/tasks call tasks.tsx's create-task sheet makes; no new payload
  // shape, no new endpoint. Keyed by title+index since recommendations have
  // no id of their own.
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const [assignedKeys, setAssignedKeys] = useState<Set<string>>(new Set());
  async function assignRecommendation(key: string, r: Recommendation) {
    if (!effectiveFarmId) return;
    setAssigningKey(key);
    const res = await apiClient.post('/api/tasks', {
      tenantId,
      title: r.title,
      notes: [r.action, r.why].filter(Boolean).join('\n\n') || undefined,
      priority: URGENCY_PRIORITY[r.urgency],
      dueAt: dueAtFromRecommendation(r.from),
      farmId: effectiveFarmId,
    });
    setAssigningKey(null);
    if (!res.success) { showToast(res.error ?? 'Could not create the task', 'error'); return; }
    setAssignedKeys(prev => new Set(prev).add(key));
    showToast('Task created', 'success');
  }

  const [savingPin, setSavingPin] = useState(false);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const [editingPin, setEditingPin] = useState(false);

  const canSetCoordinates = role === 'owner' || role === 'manager' || role === 'super_admin';

  const load = useCallback(async () => {
    if (!effectiveFarmId) return;
    setLoading(true);
    setError('');
    const res = await apiClient.get<WeatherData>(`/api/weather?farmId=${effectiveFarmId}&tenantId=${tenantId}`);
    setLoading(false);
    if (res.success) setData(res.data);
    else { setError(res.error ?? 'Could not load weather'); setData(null); }
  }, [effectiveFarmId, tenantId]);

  useEffect(() => { load(); }, [load]);

  async function useCurrentLocation() {
    if (!navigator.geolocation) { showToast('This device does not support location.', 'error'); return; }
    setSavingPin(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await savePin(pos.coords.latitude, pos.coords.longitude);
      },
      () => { setSavingPin(false); showToast('Could not get your location. Enter coordinates manually instead.', 'error'); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function savePin(lat: number, lng: number) {
    if (!effectiveFarmId) return;
    setSavingPin(true);
    const res = await apiClient.patch(`/api/farms/${effectiveFarmId}?tenantId=${tenantId}`, { latitude: lat, longitude: lng });
    setSavingPin(false);
    if (!res.success) { showToast(res.error ?? 'Could not save the farm location.', 'error'); return; }
    showToast('Farm location saved.', 'success');
    setEditingPin(false);
    await load();
  }

  function submitManual() {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) { showToast('Latitude must be a number between -90 and 90.', 'error'); return; }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) { showToast('Longitude must be a number between -180 and 180.', 'error'); return; }
    savePin(lat, lng);
  }

  const rainHeadline = data?.current
    ? (data.current.rainy ? 'Rain right now' : (data.daily?.[0]?.rainy ? `${data.daily[0].precipitationProbabilityPct}% chance of rain today` : 'No rain expected today'))
    : '';
  const rainDetail = data?.current
    ? [
        data.current.precipitationMm > 0 ? `${data.current.precipitationMm.toFixed(1)}mm falling now` : '',
        data.daily?.[0] ? `${data.daily[0].precipitationSumMm.toFixed(1)}mm expected today` : '',
      ].filter(Boolean).join(' · ')
    : '';

  const forecastScale = useMemo(() => {
    const days = data?.daily ?? [];
    return {
      maxHi: Math.max(...days.map(d => d.tempMaxC), 1),
      maxRain: Math.max(...days.map(d => d.precipitationSumMm), 1),
    };
  }, [data?.daily]);

  return (
    <div className="screen-content">
      <TopNav title="" />
      <div className="px-screen pt-3 pb-10">
        <PageHeader
          kicker="Daily"
          title="Weather"
          lede={`Not a city forecast — what the sky does to ${farm?.name ?? 'the farm'}, and what it means for today's work.`}
        />

        {/* No active farm selected and this tenant has more than one: pick one. */}
        {!effectiveFarmId && farms.length > 1 && (
          <div className="mt-5 rounded-xl bg-surface p-4 shadow-(--shadow-border)">
            <Field label="Which farm?">
              <select className={controlClass} value={pickedFarmId} onChange={e => setPickedFarmId(e.target.value)}>
                <option value="" disabled>Select a farm…</option>
                {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </Field>
          </div>
        )}

        {!effectiveFarmId && farms.length === 0 && (
          <div className="mt-5">
            <EmptyState icon={<Info size={20} />} title="No farm on this account yet" body="Weather needs a farm to attach a location to. Add a farm first." />
          </div>
        )}

        {effectiveFarmId && (
          <>
            {loading && !data && (
              <div className="mt-5 py-10 text-center text-sm text-muted">Loading weather…</div>
            )}

            {error && (
              <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
                <span>{error}</span>
                <Button type="button" variant="outline" size="icon-sm" onClick={load} aria-label="Retry"><RefreshCw size={13} /></Button>
              </div>
            )}

            {data && (!data.hasCoordinates || editingPin) && (
              <div className="mt-5 flex flex-col items-center gap-3 rounded-xl bg-surface p-6 text-center shadow-(--shadow-border)">
                <div className="flex size-14 items-center justify-center rounded-full bg-surface-2">
                  <MapPin size={24} className="text-muted" />
                </div>
                <div className="text-lg font-medium text-fg">
                  {data.hasCoordinates ? `Update location for ${data.farmName}` : `No location set for ${data.farmName}`}
                </div>
                <div className="max-w-sm text-sm leading-relaxed text-muted">
                  {data.hasCoordinates
                    ? 'Set a new GPS pin — this replaces the one on file.'
                    : <>Weather comes from this farm&apos;s GPS coordinates, and none are on file yet.{canSetCoordinates ? ' Set one below.' : ' Ask an owner or manager to set one.'}</>}
                </div>

                {canSetCoordinates && (
                  <div className="mt-2 w-full max-w-xs text-left">
                    <Button type="button" className="w-full justify-center" onClick={useCurrentLocation} disabled={savingPin}>
                      <MapPin size={14} /> {savingPin ? 'Getting location…' : 'Use my current location'}
                    </Button>
                    <div className="my-3 border-t border-border" />
                    <div className="mb-1.5 text-xs text-subtle">Or enter coordinates manually</div>
                    <div className="mb-2 flex gap-2">
                      <Input placeholder="Latitude" inputMode="decimal" value={manualLat} onChange={e => setManualLat(e.target.value)} />
                      <Input placeholder="Longitude" inputMode="decimal" value={manualLng} onChange={e => setManualLng(e.target.value)} />
                    </div>
                    <Button type="button" variant="secondary" className="w-full justify-center" onClick={submitManual} disabled={savingPin}>
                      {savingPin ? 'Saving…' : 'Save location'}
                    </Button>
                    {data.hasCoordinates && (
                      <button type="button" onClick={() => setEditingPin(false)} className="mt-2 w-full py-1.5 text-center text-sm text-muted">
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {data && data.hasCoordinates && !editingPin && data.current && (
              <>
                {/* Compact "right now" strip — demoted on purpose (lead call):
                    the recommendations below are the hero, not the temperature. */}
                <div className="mt-5 rounded-xl bg-surface p-4 shadow-(--shadow-border)">
                  <div className="flex items-start gap-4">
                    <WeatherIcon icon={data.current.icon} size={44} color={data.current.rainy ? 'var(--color-primary)' : 'var(--color-warning)'} />
                    <div className="min-w-0 flex-1">
                      {/* Farm name, then the place this forecast is actually
                          for — the free-text location can disagree with the
                          GPS pin (see savePin's flow below). */}
                      <div className="truncate text-xs font-medium text-subtle">
                        {data.farmName}
                        {(data.location || data.latitude != null) && (
                          <>
                            {' · '}
                            {data.location}
                            {data.location && data.latitude != null ? ' · ' : ''}
                            {data.latitude != null && data.longitude != null && (
                              <span className="font-mono">{data.latitude.toFixed(3)}, {data.longitude.toFixed(3)}</span>
                            )}
                          </>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-baseline gap-2">
                        <span className="font-display text-4xl leading-none tabular-nums">{Math.round(data.current.temperatureC)}°</span>
                        <span className="text-sm text-muted">{data.current.label}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {rainHeadline}{rainDetail ? ` · ${rainDetail}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3">
                    <MiniStat icon={<Thermometer size={14} className="text-danger" />} label="Feels like" value={`${Math.round(data.current.apparentTemperatureC)}°`} />
                    <MiniStat icon={<Droplets size={14} className="text-primary" />} label="Humidity" value={`${Math.round(data.current.humidityPct)}%`} />
                    <MiniStat icon={<Wind size={14} className="text-muted" />} label="Wind" value={`${Math.round(data.current.windKph)} km/h`} />
                  </div>
                </div>

                {/* ── HERO: what this weather means for the farm today ── */}
                {canSeeAdvice && (
                  <section className="mt-5 rounded-xl bg-surface p-5 shadow-(--shadow-border) lg:p-6">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium tracking-widest text-muted uppercase">What this weather means</p>
                        <h2 className="font-display mt-1 text-2xl leading-tight font-medium">Today at {farm?.name ?? 'your farm'}</h2>
                      </div>
                      <button
                        type="button"
                        onClick={() => loadAdvice(true)}
                        disabled={adviceBusy}
                        className="text-xs font-semibold text-primary disabled:opacity-50"
                      >
                        {adviceBusy ? 'Thinking…' : 'Refresh'}
                      </button>
                    </div>

                    {advice === null && adviceBusy && (
                      <div className="mt-4 py-6 text-center text-sm text-muted">Reading your batches, stock and the forecast…</div>
                    )}

                    {adviceError && (
                      <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3.5 py-3 text-xs leading-relaxed text-fg">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                        {adviceError}
                      </div>
                    )}

                    {advice && advice.length > 0 && (
                      <ul className="mt-3">
                        {advice.map((r, i) => {
                          const key = `${r.title}-${i}`;
                          return (
                            <RecommendationCard
                              key={key} r={r} canAssign={canSeeAdvice}
                              busy={assigningKey === key} assigned={assignedKeys.has(key)}
                              onAssign={() => assignRecommendation(key, r)}
                            />
                          );
                        })}
                      </ul>
                    )}

                    {advice !== null && advice.length === 0 && !adviceBusy && !adviceError && (
                      <p className="mt-4 text-sm leading-relaxed text-muted">
                        Nothing urgent from your records and this week&rsquo;s forecast. Record more of your day-to-day work and these get sharper.
                      </p>
                    )}

                    {adviceAt && advice && advice.length > 0 && (
                      <p className="mt-4 text-xs leading-relaxed text-subtle">
                        {/* Always dated. Advice whose age is hidden invites
                            acting on a three-day-old plan as if it were today's. */}
                        Prepared {new Date(adviceAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {adviceStale ? ' · could not refresh just now, so these may be out of date' : ''}
                        . Advisory only — check against what you can see on the ground.
                      </p>
                    )}
                  </section>
                )}

                {/* ── Forecast strip, beneath the hero on purpose ── */}
                {data.daily && data.daily.length > 0 && (
                  <section className="mt-5 rounded-xl bg-surface p-4 shadow-(--shadow-border)">
                    <p className="text-xs font-medium tracking-widest text-muted uppercase">5-day forecast</p>
                    <div className="mt-3 flex items-end gap-2">
                      {data.daily.map((d, i) => (
                        <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                          <span className="text-[10px] tabular-nums text-muted">{Math.round(d.tempMaxC)}°</span>
                          <span className="flex h-16 w-full items-end justify-center gap-0.5">
                            <span className="w-1.5 rounded-sm bg-primary/25" style={{ height: `${Math.max(0, d.tempMinC / forecastScale.maxHi) * 64}px` }} />
                            <span className="w-2 rounded-sm bg-primary" style={{ height: `${Math.max(0, d.tempMaxC / forecastScale.maxHi) * 64}px` }} />
                            {d.precipitationSumMm > 0 ? (
                              <span className="w-1.5 rounded-sm bg-warning" style={{ height: `${(d.precipitationSumMm / forecastScale.maxRain) * 48}px` }} />
                            ) : null}
                          </span>
                          <span className="text-[10px] font-medium text-muted uppercase">{dayLabel(d.date, i)}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-[10px] text-subtle">Forest = high. Pale = low. Amber = rain (mm).</p>

                    <div className="mt-4 divide-y divide-border border-t border-border">
                      {data.daily.map((d, i) => (
                        <div key={d.date} className="flex items-center gap-3 py-2.5 text-sm">
                          <span className="w-11 shrink-0 font-medium text-fg">{dayLabel(d.date, i)}</span>
                          <WeatherIcon icon={d.icon} size={18} color={d.rainy ? 'var(--color-primary)' : 'var(--color-muted)'} />
                          <span className="min-w-0 flex-1 truncate text-xs text-muted">{d.label}</span>
                          <span className={`w-9 shrink-0 text-right text-xs font-medium ${d.rainy ? 'text-primary' : 'text-subtle'}`}>{d.precipitationProbabilityPct}%</span>
                          <span className="w-16 shrink-0 text-right text-sm font-medium text-fg">
                            {Math.round(d.tempMaxC)}° <span className="font-normal text-subtle">{Math.round(d.tempMinC)}°</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {canSetCoordinates && (
                  <Button type="button" variant="secondary" className="mt-5 w-full justify-center" onClick={() => setEditingPin(true)}>
                    <MapPin size={13} /> Not the right spot? Update the pin
                  </Button>
                )}

                <p className="mt-3 text-center text-[11px] text-subtle">
                  Forecast by Open-Meteo{data.updatedAt ? ` · updated ${new Date(data.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
                </p>

                <Continue
                  items={[
                    { label: 'See who is carrying it', hint: 'Tasks assigned from a recommendation land on the queue.', onClick: () => navigate('tasks') },
                    { label: 'Ask the advisor', hint: 'Ground a question in tonight’s forecast and your own records.', onClick: () => navigate('ai-chat') },
                  ]}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
