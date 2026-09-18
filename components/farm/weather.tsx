'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { useNav, TopNav } from './navigation';
import { useToast } from './ui-shared';
import { apiClient } from '@/lib/request';
import {
  CloudSun, Sun, Cloud, CloudFog, CloudRain, CloudLightning, Snowflake,
  Droplets, Wind, Thermometer, Info, MapPin, RefreshCw,
  Sprout, Wheat, Leaf, Package, Syringe, Home, DollarSign, Sparkles,
  ExternalLink, AlertTriangle, type LucideIcon,
} from './icons';
import type { WeatherData, WeatherIconKeyLike } from '@/lib/weather-types';

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
 * sourced from the open web says so, and links out. */
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

const URGENCY_STYLE: Record<Recommendation['urgency'], { label: string; color: string; bg: string }> = {
  today: { label: 'Today', color: 'var(--status-critical)', bg: 'rgba(var(--critical-rgb),0.12)' },
  soon:  { label: 'This week', color: 'var(--accent-amber)', bg: 'rgba(var(--warning-rgb),0.12)' },
  plan:  { label: 'Plan ahead', color: 'var(--text-muted)', bg: 'var(--card)' },
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

function RecommendationCard({ r }: { r: Recommendation }) {
  const Icon = ACTIVITY_ICON[r.activity] ?? Sparkles;
  const u = URGENCY_STYLE[r.urgency];
  return (
    <div className="farm-card" style={{ padding: 13, marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: u.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={15} color={u.color} aria-hidden="true" />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 3 }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 750, color: 'var(--text-primary)' }}>{r.title}</span>
            <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 800, color: u.color }}>{u.label}</span>
          </div>
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginBottom: 5 }}>
            {fmtRange(r.from, r.to)}
            {r.enterprise ? ` · ${r.enterprise.replace(/_/g, ' ')}` : ''}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{r.action}</div>
          {r.why && <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 4 }}>{r.why}</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 7 }}>
            <span className="chip" style={{ fontSize: 'var(--fs-2xs)' }}>{BASIS_LABEL[r.basis]}</span>
            {r.sourceUrl && (
              <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer"
                 style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--primary-green)', textDecoration: 'none' }}>
                <ExternalLink size={10} aria-hidden="true" /> {r.sourceTitle || 'Read more'}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Weather Screen (ui-polish-theme-weather) ────────────────────────────────
// Replaces the old zero-network "not available yet" placeholder with a real
// call to GET /api/weather, which fetches Open-Meteo (free, keyless) server
// side. See that route's header for the coordinate story: farms.latitude/
// longitude is a NEW column (this task) — most existing farms have neither,
// so "no coordinates yet" is a first-class, honest state here, not an error.

const ICONS: Record<WeatherIconKeyLike, React.ComponentType<{ size?: number; color?: string }>> = {
  sun: Sun,
  'cloud-sun': CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  rain: CloudRain,
  snow: Snowflake,
  storm: CloudLightning,
};

function WeatherIcon({ icon, size = 26, color = 'var(--text-primary)' }: { icon: string; size?: number; color?: string }) {
  const Cmp = ICONS[icon as WeatherIconKeyLike] ?? Cloud;
  return <Cmp size={size} color={color} />;
}

function dayLabel(iso: string, index: number): string {
  if (index === 0) return 'Today';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

export function WeatherScreen() {
  const { farms, activeFarmId, tenantId, role } = useNav();
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
  // stock and open work, so a worker would just get a 403.
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

  return (
    <div className="screen-content">
      <TopNav title="Weather" subtitle={farm?.location ?? 'Select a farm'} />
      <div className="px-screen" style={{ paddingTop: 16, paddingBottom: 32 }}>

        {/* No active farm selected and this tenant has more than one: pick one. */}
        {!effectiveFarmId && farms.length > 1 && (
          <div className="farm-card" style={{ padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Which farm?</div>
            <select className="farm-input" value={pickedFarmId} onChange={e => setPickedFarmId(e.target.value)}>
              <option value="" disabled>Select a farm…</option>
              {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        )}

        {!effectiveFarmId && farms.length <= 1 && farms.length === 0 && (
          <EmptyCard icon={<Info size={22} color="var(--text-muted)" />} title="No farm on this account yet"
            body="Weather needs a farm to attach a location to. Add a farm first." />
        )}

        {effectiveFarmId && (
          <>
            {loading && !data && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 'var(--fs-base)' }}>Loading weather…</div>
            )}

            {error && (
              <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 12, background: 'var(--chip-critical-bg)', border: '1px solid var(--status-critical)', fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>{error}</span>
                <button className="btn-icon" style={{ width: 28, height: 28, flexShrink: 0 }} onClick={load}><RefreshCw size={13} /></button>
              </div>
            )}

            {data && (!data.hasCoordinates || editingPin) && (
              <div className="farm-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--card-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <MapPin size={26} color="var(--text-muted)" />
                </div>
                <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {data.hasCoordinates ? `Update location for ${data.farmName}` : `No location set for ${data.farmName}`}
                </div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: 320 }}>
                  {data.hasCoordinates
                    ? 'Set a new GPS pin — this replaces the one on file.'
                    : <>Weather comes from this farm&apos;s GPS coordinates, and none are on file yet.{canSetCoordinates ? ' Set one below.' : ' Ask an owner or manager to set one.'}</>}
                </div>

                {canSetCoordinates && (
                  <div style={{ width: '100%', maxWidth: 320, marginTop: 8, textAlign: 'left' }}>
                    <button className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }} onClick={useCurrentLocation} disabled={savingPin}>
                      <MapPin size={14} /> {savingPin ? 'Getting location…' : 'Use my current location'}
                    </button>
                    <div className="farm-divider" style={{ margin: '10px 0' }} />
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)', marginBottom: 6 }}>Or enter coordinates manually</div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <input className="farm-input" placeholder="Latitude" inputMode="decimal" value={manualLat} onChange={e => setManualLat(e.target.value)} />
                      <input className="farm-input" placeholder="Longitude" inputMode="decimal" value={manualLng} onChange={e => setManualLng(e.target.value)} />
                    </div>
                    <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={submitManual} disabled={savingPin}>
                      {savingPin ? 'Saving…' : 'Save location'}
                    </button>
                    {data.hasCoordinates && (
                      <button onClick={() => setEditingPin(false)} style={{ width: '100%', textAlign: 'center', marginTop: 8, background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', cursor: 'pointer', padding: 6 }}>
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {data && data.hasCoordinates && !editingPin && data.current && (
              <>
                <div className="farm-card" style={{ padding: 20, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ minWidth: 0 }}>
                    {/* Farm name, then the place this forecast is actually for.
                        The free-text location is a label somebody typed at
                        signup; the forecast comes from the farm's GPS pin, and
                        the two can disagree — a pin one valley over from the
                        town in the label reads as a forecast for the wrong
                        place with nothing on screen to reveal it. Showing the
                        coordinates makes the mismatch visible, and the button
                        below is how it gets corrected. */}
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 2 }}>{data.farmName}</div>
                    {(data.location || data.latitude != null) && (
                      <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {data.location}
                        {data.location && data.latitude != null ? ' · ' : ''}
                        {data.latitude != null && data.longitude != null && (
                          <span style={{ fontFamily: 'monospace' }}>{data.latitude.toFixed(4)}, {data.longitude.toFixed(4)}</span>
                        )}
                      </div>
                    )}
                    <div className="weather-temp">{Math.round(data.current.temperatureC)}°</div>
                    <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', fontWeight: 600, marginTop: 2 }}>{data.current.label}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)', marginTop: 2 }}>Feels like {Math.round(data.current.apparentTemperatureC)}°</div>
                  </div>
                  <WeatherIcon icon={data.current.icon} size={56} color={data.current.rainy ? 'var(--status-info)' : 'var(--accent-amber)'} />
                </div>

                {/* Rain expectation — the one number the brief says matters more
                   than the icon: is it raining/about to, and how much. */}
                <div className="farm-card" style={{ padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Droplets size={20} color="var(--status-info)" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {data.current.rainy ? 'Rain right now' : (data.daily?.[0]?.rainy ? `${data.daily[0].precipitationProbabilityPct}% chance of rain today` : 'No rain expected today')}
                    </div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 1 }}>
                      {data.current.precipitationMm > 0 ? `${data.current.precipitationMm.toFixed(1)}mm falling now · ` : ''}
                      {data.daily?.[0] ? `${data.daily[0].precipitationSumMm.toFixed(1)}mm expected today` : ''}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <StatChip icon={<Droplets size={14} color="var(--status-info)" />} label="Humidity" value={`${Math.round(data.current.humidityPct)}%`} />
                  <StatChip icon={<Wind size={14} color="var(--text-muted)" />} label="Wind" value={`${Math.round(data.current.windKph)} km/h`} />
                  <StatChip icon={<Thermometer size={14} color="var(--accent-red)" />} label="Feels like" value={`${Math.round(data.current.apparentTemperatureC)}°`} />
                </div>

                {canSeeAdvice && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 8 }}>
                      <div className="section-eyebrow">What to do next</div>
                      <button
                        onClick={() => loadAdvice(true)}
                        disabled={adviceBusy}
                        style={{ background: 'none', border: 'none', color: 'var(--primary-green)', cursor: adviceBusy ? 'default' : 'pointer', fontSize: 'var(--fs-2xs)', fontWeight: 700, padding: 0, opacity: adviceBusy ? 0.6 : 1 }}
                      >
                        {adviceBusy ? 'Thinking…' : 'Refresh'}
                      </button>
                    </div>

                    {advice === null && adviceBusy && (
                      <div className="farm-card" style={{ padding: 14, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                        Reading your batches, stock and the forecast…
                      </div>
                    )}

                    {adviceError && (
                      <div className="farm-card" style={{ padding: '11px 13px', display: 'flex', gap: 9, alignItems: 'flex-start', border: '1px solid rgba(var(--warning-rgb),0.3)' }}>
                        <AlertTriangle size={14} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.55 }}>{adviceError}</div>
                      </div>
                    )}

                    {advice?.map((r, i) => <RecommendationCard key={`${r.title}-${i}`} r={r} />)}

                    {advice !== null && advice.length === 0 && !adviceBusy && !adviceError && (
                      <div className="farm-card" style={{ padding: 14, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        Nothing urgent from your records and this week&rsquo;s forecast. Record more of your day-to-day work and these get sharper.
                      </div>
                    )}

                    {adviceAt && advice && advice.length > 0 && (
                      <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
                        {/* Always dated. Advice whose age is hidden invites
                            acting on a three-day-old plan as if it were today's. */}
                        Prepared {new Date(adviceAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {adviceStale ? ' · could not refresh just now, so these may be out of date' : ''}
                        . Advisory only — check against what you can see on the ground.
                      </div>
                    )}
                  </div>
                )}

                {data.daily && data.daily.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div className="section-eyebrow" style={{ marginBottom: 8 }}>5-day forecast</div>
                    <div className="farm-card" style={{ overflow: 'hidden' }}>
                      {/* Header row. Without it the columns were unlabelled:
                          two bare numbers on the right are only obviously
                          "high / low" once you already know, and the lone
                          percentage was anyone's guess. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface)' }}>
                        <div style={{ width: 44, fontSize: 'var(--fs-2xs)', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Day</div>
                        <div style={{ width: 20 }} aria-hidden="true" />
                        <div style={{ flex: 1, fontSize: 'var(--fs-2xs)', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Conditions</div>
                        <div style={{ fontSize: 'var(--fs-2xs)', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>Rain</div>
                        <div style={{ width: 62, textAlign: 'right', fontSize: 'var(--fs-2xs)', fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>Hi / Lo</div>
                      </div>
                      {data.daily.map((d, i) => (
                        <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: i < data.daily!.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                          <div style={{ width: 44, fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>{dayLabel(d.date, i)}</div>
                          <WeatherIcon icon={d.icon} size={20} color={d.rainy ? 'var(--status-info)' : 'var(--text-muted)'} />
                          <div style={{ flex: 1, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{d.label}</div>
                          <span style={{ fontSize: 'var(--fs-2xs)', color: d.rainy ? 'var(--status-info)' : 'var(--text-dim)', fontWeight: 700, flexShrink: 0, minWidth: 30, textAlign: 'right' }}>
                            {d.precipitationProbabilityPct}%
                          </span>
                          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0, width: 62, textAlign: 'right' }}>
                            {Math.round(d.tempMaxC)}° <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>{Math.round(d.tempMinC)}°</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {canSetCoordinates && (
                  <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }} onClick={() => setEditingPin(true)}>
                    <MapPin size={13} /> Not the right spot? Update the pin
                  </button>
                )}

                <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', textAlign: 'center' }}>
                  Forecast by Open-Meteo{data.updatedAt ? ` · updated ${new Date(data.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="farm-card" style={{ flex: 1, padding: '10px 8px', textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
      <div className="kpi-label" style={{ marginTop: 2 }}>{label}</div>
    </div>
  );
}

function EmptyCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="farm-card" style={{ padding: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--card-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div>
      <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: 280 }}>{body}</div>
    </div>
  );
}
