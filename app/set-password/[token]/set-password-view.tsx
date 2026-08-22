'use client';
import React, { useEffect, useState } from 'react';
import { apiClient } from '@/lib/request';

// Public, token-gated "set your password" form — no session, no app shell.
// Same minimal, self-contained styling approach as
// app/auditor/[token]/auditor-view.tsx (inline styles against the global CSS
// vars from app/global.css) since this page is reached before the applicant
// has ever signed in.
const MIN_PASSWORD_LENGTH = 8;

export function SetPasswordView({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [resolveError, setResolveError] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    apiClient.get<{ email: string; name: string }>(`/api/set-password/${encodeURIComponent(token)}`).then((res) => {
      setLoading(false);
      if (res.success) {
        setEmail(res.data.email);
        setName(res.data.name);
      } else {
        setResolveError(res.error || 'This link is invalid, expired, or has already been used.');
      }
    });
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError('');
    if (password.length < MIN_PASSWORD_LENGTH) {
      setSubmitError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setSubmitError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    const res = await apiClient.post(`/api/set-password/${encodeURIComponent(token)}`, { password });
    setSubmitting(false);
    if (res.success) {
      setDone(true);
    } else {
      setSubmitError(res.error || 'This link is invalid, expired, or has already been used.');
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--text-primary)' }}>
      <div style={{ maxWidth: 420, margin: '0 auto', padding: '40px 16px' }}>
        <div style={{ marginBottom: 4, fontSize: 'var(--fs-xs)', fontWeight: 700, letterSpacing: 0.5, color: 'var(--accent-purple)', textTransform: 'uppercase' }}>
          IFMS
        </div>
        <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, marginBottom: 20 }}>Set your password</div>

        <div className="farm-card" style={{ padding: 18 }}>
          {loading && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Loading…</div>}

          {!loading && resolveError && (
            <div style={{ fontSize: 'var(--fs-base)', color: 'var(--status-critical)', fontWeight: 600 }}>{resolveError}</div>
          )}

          {!loading && !resolveError && done && (
            <div>
              <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, marginBottom: 6 }}>Password set</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                You can now sign in with your new password.
              </div>
            </div>
          )}

          {!loading && !resolveError && !done && (
            <form onSubmit={handleSubmit}>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
                Setting a password for <strong style={{ color: 'var(--text-primary)' }}>{name}</strong> ({email}).
              </div>

              <label style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 4 }}>New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--card-bg)', color: 'var(--text-primary)', marginBottom: 12, fontSize: 'var(--fs-base)' }}
              />

              <label style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 4 }}>Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--card-bg)', color: 'var(--text-primary)', marginBottom: 16, fontSize: 'var(--fs-base)' }}
              />

              {submitError && (
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 12 }}>{submitError}</div>
              )}

              <button
                type="submit"
                className="btn-primary"
                disabled={submitting}
                style={{ width: '100%', justifyContent: 'center', borderRadius: 12, padding: 12, opacity: submitting ? 0.7 : 1 }}
              >
                {submitting ? 'Setting password…' : 'Set password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
