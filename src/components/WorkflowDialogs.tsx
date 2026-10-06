import { useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { Check, ShieldCheck, X } from 'lucide-react';
import { reportListing, requestTumVerification } from '../lib/marketplace';
import { supabase } from '../lib/supabase';

type DialogProps = { onClose: () => void };

function DialogShell({ children, onClose, title, className = '' }: DialogProps & { children: React.ReactNode; title: string; className?: string }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`post-modal workflow-modal ${className}`} role="dialog" aria-modal="true" aria-labelledby="workflow-title">
        <button className="modal-close" onClick={onClose} aria-label="Close dialog"><X size={19} /></button>
        <span className="section-kicker">TUMMARKET COMMUNITY</span>
        <h2 id="workflow-title">{title}</h2>
        {children}
      </section>
    </div>
  );
}

export function AuthDialog({ onClose }: DialogProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!supabase) return;

    setBusy(true);
    setNotice('');

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) {
          setNotice(error.message);
          return;
        }

        onClose();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              display_name: displayName.trim() || undefined,
            },
          },
        });

        if (error) {
          setNotice(error.message);
          return;
        }

        if (data.session) {
          onClose();
        } else {
          setNotice(
            'Account created. Check your email to confirm your account, then sign in.'
          );
        }
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Authentication failed. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      onClose={onClose}
      title="Your TUM community, closer."
      className="auth-dialog"
    >
      <p className="post-intro">
        {mode === 'signin'
          ? 'Sign in to buy, sell, save listings and make payments.'
          : 'Create your TUMMarket account.'}
      </p>

      <form className="post-form" onSubmit={submit}>
        {mode === 'signup' && (
          <label>
            Your name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="How should we call you?"
              maxLength={60}
              required
            />
          </label>
        )}

        <label>
          Email address
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            required
            minLength={6}
            autoComplete={
              mode === 'signin' ? 'current-password' : 'new-password'
            }
          />
        </label>

        {notice && (
          <p className="workflow-notice" role="status">
            {notice}
          </p>
        )}

        <button className="post-submit" type="submit" disabled={busy}>
          {busy
            ? mode === 'signin'
              ? 'Signing in...'
              : 'Creating account...'
            : mode === 'signin'
              ? 'Sign in'
              : 'Create account'}
        </button>
      </form>

      <p className="dialog-privacy">
        Your email is used for authentication and is never shown on listings.
      </p>

      <button
        type="button"
        className="auth-switch"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setNotice('');
        }}
      >
        {mode === 'signin'
          ? 'New to TUMMarket? Create an account'
          : 'Already have an account? Sign in'}
      </button>
    </DialogShell>
  );
}

export function VerificationDialog({ user, onClose, onSuccess }: DialogProps & { user: User; onSuccess: () => void }) {
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await requestTumVerification(user.id, String(form.get('universityEmail')).trim(), String(form.get('note')).trim());
      onSuccess();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not submit the verification request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell onClose={onClose} title="Request TUM verification" className="verification-dialog">
      <p className="post-intro">A moderator will review your university email. This request does not automatically verify your account.</p>
      <form className="post-form" onSubmit={submit}>
        <label>TUM email address<input name="universityEmail" type="email" placeholder="name@tum.ac.ke" required maxLength={254} /></label>
        <label>Anything to help review? <span className="optional-label">(optional)</span><textarea name="note" rows={3} maxLength={300} placeholder="Add context, but do not include passwords or financial details." /></label>
        <div className="post-note"><ShieldCheck size={15} /><span>We do not ask for passwords or store student ID images.</span></div>
        {notice && <p className="workflow-notice" role="status">{notice}</p>}
        <button className="post-submit" type="submit" disabled={busy}>{busy ? 'Submitting...' : 'Send for review'}</button>
      </form>
    </DialogShell>
  );
}

export function ReportDialog({ user, listingId, onClose, onSuccess }: DialogProps & { user: User; listingId: string; onSuccess: () => void }) {
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await reportListing(user.id, listingId, String(form.get('reason')), String(form.get('details')).trim());
      onSuccess();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not submit this report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell onClose={onClose} title="Report this listing" className="report-dialog">
      <p className="post-intro">Reports go to the marketplace moderation queue for review.</p>
      <form className="post-form" onSubmit={submit}>
        <label>What is the issue?<select name="reason" required><option>Scam or suspicious</option><option>Wrong information</option><option>Inappropriate content</option><option>Already sold or unavailable</option><option>Other</option></select></label>
        <label>Details <span className="optional-label">(optional)</span><textarea name="details" rows={3} maxLength={500} placeholder="Tell us what happened." /></label>
        {notice && <p className="workflow-notice" role="status">{notice}</p>}
        <button className="post-submit" type="submit" disabled={busy}><Check size={16} />{busy ? 'Sending report...' : 'Submit report'}</button>
      </form>
    </DialogShell>
  );
}
