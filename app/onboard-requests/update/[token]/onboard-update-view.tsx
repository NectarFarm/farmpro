'use client';
import React, { useEffect, useState } from 'react';
import { apiClient } from '@/lib/request';
import { ENTERPRISE_REGISTRY } from '@/components/farm/data';
import { GpsMapBlock } from '@/components/farm/auth';
import { detectGpsLocation } from '@/lib/geolocation';

// Public, token-gated "fix and resubmit your application" form — no
// session, no app shell. Same minimal self-contained styling approach as
// app/auditor/[token]/auditor-view.tsx and
// app/set-password/[token]/set-password-view.tsx.
//
// Field set matches what POST /api/onboard-requests/update/[token] actually
// accepts (validateBody, shared with the original public POST
// /api/onboard-requests — see that route's header for why there's no
// second set of rules).
//
// GPS: when a pin is already on file this form doesn't show or send one, and
// the route preserves it (a body without location fields leaves the stored
// pin alone). When there is NO pin, the block appears — because "the
// location is missing" is one of the commonest reasons an admin asks for
// info in the first place, and sending the applicant a correction link that
// can't correct the actual gap would be pointless. Same rule as the public
// form then applies: add the pin, or tick the box saying you can't.
const ENTERPRISE_OPTIONS = Array.from(
  new Map(ENTERPRISE_REGISTRY.map((e) => [e.subtype, e.label])).entries()
);

interface RequestData {
  farmerName: string;
  email: string;
  phone: string;
  farmName: string;
  location: string;
  enterprises: string[];
  status: string;
  notes: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

export function OnboardUpdateView({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [resolveError, setResolveError] = useState('');
  const [notes, setNotes] = useState<string | null>(null);

  const [farmerName, setFarmerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [farmName, setFarmName] = useState('');
  const [location, setLocation] = useState('');
  const [enterprises, setEnterprises] = useState<string[]>([]);
  const [consentGiven, setConsentGiven] = useState(false);

  // Only used when the request arrived without a pin — see the header.
  const [needsPin, setNeedsPin] = useState(false);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [address, setAddress] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [locationSkipped, setLocationSkipped] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    apiClient.get<RequestData>(`/api/onboard-requests/update/${encodeURIComponent(token)}`).then((res) => {
      setLoading(false);
      if (!res.success) {
        setResolveError(res.error || 'This link is invalid, expired, or has already been used to resubmit.');
        return;
      }
      const d = res.data;
      if (d.status !== 'info-needed') {
        setResolveError('This request has already been reviewed and can no longer be edited from this link.');
        return;
      }
      setFarmerName(d.farmerName);
      setEmail(d.email);
      setPhone(d.phone);
      setFarmName(d.farmName);
      setLocation(d.location);
      setEnterprises(d.enterprises);
      setNotes(d.notes);
      setNeedsPin(d.latitude === null || d.longitude === null);
      setAddress(d.address ?? '');
    });
  }, [token]);

  function detectGPS() {
    setGpsLoading(true);
    setGpsError('');
    detectGpsLocation(
      (coords) => {
        setLat(coords.latitude);
        setLng(coords.longitude);
        setLocationSkipped(false);
        setGpsLoading(false);
      },
      (message) => {
        setGpsError(message);
        setGpsLoading(false);
      }
    );
  }

  function toggleEnterprise(subtype: string) {
    setEnterprises((prev) => (prev.includes(subtype) ? prev.filter((e) => e !== subtype) : [...prev, subtype]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError('');
    setFieldErrors({});
    setSubmitting(true);
    const body: Record<string, unknown> = {
      farmerName,
      email,
      phone,
      farmName,
      location,
      enterprises,
      consentGiven,
    };
    // Send location keys ONLY when this form is the one capturing them.
    // Omitting them entirely is what tells the route to keep the pin already
    // on file, so a request that arrived with a pin must not send them.
    if (needsPin) {
      if (lat.trim() !== '' && lng.trim() !== '') {
        body.latitude = lat.trim();
        body.longitude = lng.trim();
        if (address.trim()) body.address = address.trim();
      } else if (locationSkipped) {
        body.locationSkipped = true;
      }
    }
    const res = await apiClient.post(`/api/onboard-requests/update/${encodeURIComponent(token)}`, body);
    setSubmitting(false);
    if (res.success) {
      setDone(true);
    } else {
      setSubmitError(res.error || 'Could not resubmit your request.');
      if (res.fields) setFieldErrors(res.fields);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid var(--border-subtle)',
    background: 'var(--card-bg)',
    color: 'var(--text-primary)',
    marginBottom: 4,
    fontSize: 'var(--fs-base)' as unknown as string,
  };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 'var(--fs-xs)' as unknown as string, color: 'var(--text-muted)', margin: '12px 0 4px' };
  const errStyle: React.CSSProperties = { fontSize: 'var(--fs-2xs)' as unknown as string, color: 'var(--status-critical)', marginBottom: 4 };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--text-primary)' }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 16px 60px' }}>
        <div style={{ marginBottom: 4, fontSize: 'var(--fs-xs)', fontWeight: 700, letterSpacing: 0.5, color: 'var(--accent-purple)', textTransform: 'uppercase' }}>
          IFMS
        </div>
        <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, marginBottom: 20 }}>Update your application</div>

        <div className="farm-card" style={{ padding: 18 }}>
          {loading && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Loading…</div>}

          {!loading && resolveError && (
            <div style={{ fontSize: 'var(--fs-base)', color: 'var(--status-critical)', fontWeight: 600 }}>{resolveError}</div>
          )}

          {!loading && !resolveError && done && (
            <div>
              <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, marginBottom: 6 }}>Resubmitted</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Thanks — your updated application has been sent back for review.
              </div>
            </div>
          )}

          {!loading && !resolveError && !done && (
            <form onSubmit={handleSubmit}>
              {notes && (
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', background: 'var(--card-hover)', borderRadius: 10, padding: 10, marginBottom: 12, lineHeight: 1.5 }}>
                  <strong>What&apos;s missing:</strong> {notes}
                </div>
              )}

              <label style={labelStyle}>Your name</label>
              <input style={inputStyle} value={farmerName} onChange={(e) => setFarmerName(e.target.value)} />
              {fieldErrors.farmerName && <div style={errStyle}>{fieldErrors.farmerName}</div>}

              <label style={labelStyle}>Email</label>
              <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              {fieldErrors.email && <div style={errStyle}>{fieldErrors.email}</div>}

              <label style={labelStyle}>Phone</label>
              <input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} />
              {fieldErrors.phone && <div style={errStyle}>{fieldErrors.phone}</div>}

              <label style={labelStyle}>Farm name</label>
              <input style={inputStyle} value={farmName} onChange={(e) => setFarmName(e.target.value)} />
              {fieldErrors.farmName && <div style={errStyle}>{fieldErrors.farmName}</div>}

              <label style={labelStyle}>Location</label>
              <input style={inputStyle} value={location} onChange={(e) => setLocation(e.target.value)} />
              {fieldErrors.location && <div style={errStyle}>{fieldErrors.location}</div>}

              {needsPin && (
                <div style={{
                  marginTop: 14, padding: 12, borderRadius: 12,
                  border: `1px solid ${lat && lng ? 'rgba(74,222,128,0.35)' : 'var(--status-warning, #f59e0b)'}`,
                  background: lat && lng ? 'rgba(74,222,128,0.06)' : 'rgba(245,158,11,0.06)',
                }}>
                  <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Farm GPS location {lat && lng ? '· pinned' : '· missing'}
                  </div>
                  <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
                    Your application has no map pin. It&apos;s what weather forecasts are calculated from, and how the reviewing admin finds your farm. Detecting or typing coordinates sends them to OpenStreetMap&apos;s Nominatim service to look up the matching address.
                  </div>
                  <GpsMapBlock
                    lat={lat} lng={lng} address={address}
                    onLatChange={setLat} onLngChange={setLng} onAddressChange={setAddress}
                    loading={gpsLoading} error={gpsError} onDetect={detectGPS}
                  />
                  {!(lat && lng) && (
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
                      <input
                        type="checkbox" checked={locationSkipped}
                        onChange={(e) => setLocationSkipped(e.target.checked)}
                        style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        I can&apos;t add GPS coordinates right now — I understand this farm will have no weather forecasts until I add them.
                      </span>
                    </label>
                  )}
                  {fieldErrors.latitude && <div style={{ ...errStyle, marginTop: 8 }}>{fieldErrors.latitude}</div>}
                  {fieldErrors.longitude && <div style={{ ...errStyle, marginTop: 4 }}>{fieldErrors.longitude}</div>}
                </div>
              )}

              <label style={labelStyle}>Enterprises</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
                {ENTERPRISE_OPTIONS.map(([subtype, label]) => (
                  <button
                    type="button"
                    key={subtype}
                    onClick={() => toggleEnterprise(subtype)}
                    className={enterprises.includes(subtype) ? 'chip chip-ok' : 'chip'}
                    style={{ cursor: 'pointer', border: 'none', fontSize: 'var(--fs-xs)', padding: '6px 10px' }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {fieldErrors.enterprises && <div style={errStyle}>{fieldErrors.enterprises}</div>}

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, cursor: 'pointer' }}>
                <input type="checkbox" checked={consentGiven} onChange={(e) => setConsentGiven(e.target.checked)} />
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
                  I confirm the information above is accurate.
                </span>
              </label>
              {fieldErrors.consentGiven && <div style={errStyle}>{fieldErrors.consentGiven}</div>}

              {submitError && (
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', margin: '12px 0' }}>{submitError}</div>
              )}

              <button
                type="submit"
                className="btn-primary"
                disabled={submitting}
                style={{ width: '100%', justifyContent: 'center', borderRadius: 12, padding: 12, marginTop: 16, opacity: submitting ? 0.7 : 1 }}
              >
                {submitting ? 'Resubmitting…' : 'Resubmit for review'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
