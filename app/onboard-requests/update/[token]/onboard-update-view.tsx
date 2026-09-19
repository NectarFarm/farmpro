'use client';
import React, { useEffect, useState } from 'react';
import { apiClient } from '@/lib/request';
import { ENTERPRISE_REGISTRY } from '@/components/farm/data';
import { AuthShell, AuthMasthead, AuthStage, GpsMapBlock } from '@/components/farm/auth';
import { detectGpsLocation } from '@/lib/geolocation';
import Link from 'next/link';

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

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--background)', color: 'var(--text-primary)', overflowX: 'hidden' }}>
      <AuthStage>
      <AuthShell>
        <AuthMasthead eyebrow="IFMS" headline="Fix your application" lede={notes || undefined} />

          {loading && <div className="auth-checking">Checking the link…</div>}

          {!loading && resolveError && (
            <>
              <div className="auth-error">{resolveError}</div>
              <Link href="/" className="btn-primary" style={{ display: 'flex', width: '100%', justifyContent: 'center', textDecoration: 'none' }}>Back to sign in</Link>
            </>
          )}

          {!loading && !resolveError && done && (
            <>
              <p className="auth-lede" style={{ marginBottom: 20 }}>Sent back for review. Watch your email.</p>
              <Link href="/" className="btn-primary" style={{ display: 'flex', width: '100%', justifyContent: 'center', textDecoration: 'none' }}>Back to sign in</Link>
            </>
          )}

          {!loading && !resolveError && !done && (
            <form onSubmit={handleSubmit}>
              <div className="auth-field">
                <label htmlFor="upd-name" className="auth-label">Your name</label>
                <input id="upd-name" className="farm-input" value={farmerName} onChange={(e) => setFarmerName(e.target.value)} />
                {fieldErrors.farmerName && <div className="auth-hint" style={{ color: 'var(--status-critical)' }}>{fieldErrors.farmerName}</div>}
              </div>
              <div className="auth-field">
                <label htmlFor="upd-email" className="auth-label">Email</label>
                <input id="upd-email" className="farm-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                {fieldErrors.email && <div className="auth-hint" style={{ color: 'var(--status-critical)' }}>{fieldErrors.email}</div>}
              </div>
              <div className="auth-field">
                <label htmlFor="upd-phone" className="auth-label">Phone</label>
                <input id="upd-phone" className="farm-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07XXXXXXXX" />
                {fieldErrors.phone && <div className="auth-hint" style={{ color: 'var(--status-critical)' }}>{fieldErrors.phone}</div>}
              </div>
              <div className="auth-field">
                <label htmlFor="upd-farm" className="auth-label">Farm name</label>
                <input id="upd-farm" className="farm-input" value={farmName} onChange={(e) => setFarmName(e.target.value)} />
                {fieldErrors.farmName && <div className="auth-hint" style={{ color: 'var(--status-critical)' }}>{fieldErrors.farmName}</div>}
              </div>
              <div className="auth-field">
                <label htmlFor="upd-location" className="auth-label">Area</label>
                <input id="upd-location" className="farm-input" value={location} onChange={(e) => setLocation(e.target.value)} />
                {fieldErrors.location && <div className="auth-hint" style={{ color: 'var(--status-critical)' }}>{fieldErrors.location}</div>}
              </div>

              {needsPin && (
                <div className={`auth-gps${lat && lng ? ' is-pinned' : ''}`}>
                  <div className="auth-label">Farm pin {lat && lng ? '· pinned' : ''}</div>
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
                      <span className="auth-hint" style={{ margin: 0 }}>
                        I can&apos;t pin the farm right now. No weather until I add it later.
                      </span>
                    </label>
                  )}
                  {fieldErrors.latitude && <div className="auth-hint" style={{ color: 'var(--status-critical)' }}>{fieldErrors.latitude}</div>}
                  {fieldErrors.longitude && <div className="auth-hint" style={{ color: 'var(--status-critical)' }}>{fieldErrors.longitude}</div>}
                </div>
              )}

              <div className="auth-label">What you farm</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
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
              {fieldErrors.enterprises && <div className="auth-hint" style={{ color: 'var(--status-critical)' }}>{fieldErrors.enterprises}</div>}

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, cursor: 'pointer' }}>
                <input type="checkbox" checked={consentGiven} onChange={(e) => setConsentGiven(e.target.checked)} />
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
                  I confirm the information above is accurate.
                </span>
              </label>
              {fieldErrors.consentGiven && <div className="auth-hint" style={{ color: 'var(--status-critical)' }}>{fieldErrors.consentGiven}</div>}

              {submitError && <div className="auth-error">{submitError}</div>}

              <button type="submit" className="btn-primary" disabled={submitting} style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}>
                {submitting ? 'Sending…' : 'Send again'}
              </button>
            </form>
          )}
      </AuthShell>
      </AuthStage>
    </div>
  );
}
