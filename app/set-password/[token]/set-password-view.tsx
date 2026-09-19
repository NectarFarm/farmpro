'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/request';
import { AuthShell, AuthMasthead, AuthStage } from '@/components/farm/auth';
import { Eye, EyeOff } from '@/components/farm/icons';

const MIN_PASSWORD_LENGTH = 8;
const REDIRECT_DELAY_SECONDS = 3;

export function SetPasswordView({ token }: { token: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [resolveError, setResolveError] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(REDIRECT_DELAY_SECONDS);

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

  useEffect(() => {
    if (!done) return;
    if (secondsLeft <= 0) {
      router.push('/');
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [done, secondsLeft, router]);

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
    <div style={{ minHeight: '100dvh', background: 'var(--background)', color: 'var(--text-primary)', overflowX: 'hidden' }}>
      <AuthStage>
      <AuthShell>
        <AuthMasthead
          eyebrow="IFMS"
          headline="Set your password"
          lede={loading ? undefined : resolveError ? undefined : done ? undefined : `For ${name} (${email}).`}
        />

        {loading && <div className="auth-checking">Checking the link…</div>}

        {!loading && resolveError && (
          <>
            <div className="auth-error">{resolveError}</div>
            <Link href="/" className="btn-primary" style={{ display: 'flex', width: '100%', justifyContent: 'center', textDecoration: 'none' }}>
              Back to sign in
            </Link>
          </>
        )}

        {!loading && !resolveError && done && (
          <>
            <p className="auth-lede" style={{ marginBottom: 20 }}>
              You can sign in with the new password. Taking you there in {secondsLeft}…
            </p>
            <Link href="/" className="btn-primary" style={{ display: 'flex', width: '100%', justifyContent: 'center', textDecoration: 'none' }}>
              Continue to sign in
            </Link>
          </>
        )}

        {!loading && !resolveError && !done && (
          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label htmlFor="new-password" className="auth-label">New password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="new-password"
                  className="farm-input"
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  style={{ paddingRight: 40 }}
                />
                <button
                  type="button"
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPwd((s) => !s)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  {showPwd ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                </button>
              </div>
              <p className="auth-hint">At least {MIN_PASSWORD_LENGTH} characters.</p>
            </div>
            <div className="auth-field">
              <label htmlFor="confirm-password" className="auth-label">Confirm password</label>
              <input
                id="confirm-password"
                className="farm-input"
                type={showPwd ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
              />
            </div>
            {submitError && <div className="auth-error">{submitError}</div>}
            <button type="submit" className="btn-primary" disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
              {submitting ? 'Saving…' : 'Set password'}
            </button>
          </form>
        )}
      </AuthShell>
      </AuthStage>
    </div>
  );
}
