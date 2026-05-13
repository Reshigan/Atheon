import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { API_URL } from '@/lib/api';
import { CheckCircle, XCircle, Loader2, Mail } from 'lucide-react';

type VerifyState = 'loading' | 'success' | 'error' | 'expired' | 'already_verified';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState<VerifyState>('loading');
  const [message, setMessage] = useState('');
  const [resending, setResending] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [resendSuccess, setResendSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('No verification token provided.');
      return;
    }

    const verify = async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/verify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const data = await res.json() as { success?: boolean; error?: string; message?: string; already_verified?: boolean };

        if (res.ok && data.success) {
          setState('success');
          setMessage(data.message || 'Your email has been verified successfully.');
        } else if (data.already_verified) {
          setState('already_verified');
          setMessage('Your email is already verified. You can log in.');
        } else if (res.status === 410 || (data.error && data.error.toLowerCase().includes('expired'))) {
          setState('expired');
          setMessage(data.error || 'This verification link has expired.');
        } else {
          setState('error');
          setMessage(data.error || 'Verification failed. The link may be invalid.');
        }
      } catch {
        setState('error');
        setMessage('Unable to reach the server. Please try again later.');
      }
    };

    verify();
  }, [token]);

  const handleResend = async () => {
    if (!resendEmail) return;
    setResending(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resendEmail }),
      });
      if (res.ok) {
        setResendSuccess(true);
      } else {
        const data = await res.json() as { error?: string };
        setMessage(data.error || 'Failed to resend verification email.');
      }
    } catch {
      setMessage('Unable to reach the server.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-theme-primary px-4">
      <div className="w-full max-w-md card-glass p-8 text-center space-y-6">
        <div className="flex justify-center">
          {state === 'loading' && <Loader2 className="w-12 h-12 animate-spin" style={{ color: 'var(--accent)' }} />}
          {state === 'success' && <CheckCircle className="w-12 h-12 text-emerald-500" />}
          {state === 'already_verified' && <CheckCircle className="w-12 h-12 text-emerald-500" />}
          {state === 'error' && <XCircle className="w-12 h-12 text-red-500" />}
          {state === 'expired' && <Mail className="w-12 h-12 text-amber-500" />}
        </div>

        <h1 className="text-headline-xl font-bold t-primary tracking-tight leading-tight">
          {state === 'loading' && 'Verifying your email...'}
          {state === 'success' && 'Email Verified'}
          {state === 'already_verified' && 'Already Verified'}
          {state === 'error' && 'Verification Failed'}
          {state === 'expired' && 'Link Expired'}
        </h1>

        <p className="t-secondary text-sm">{message}</p>

        {(state === 'success' || state === 'already_verified') && (
          <Link
            to="/login"
            className="inline-block px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            Go to Login
          </Link>
        )}

        {state === 'expired' && !resendSuccess && (
          <div className="space-y-3">
            <p className="text-xs t-muted">Enter your email to receive a new verification link:</p>
            <input
              type="email"
              placeholder="your@email.com"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-input)' }}
              aria-label="Email address for resend"
            />
            <button
              onClick={handleResend}
              disabled={resending || !resendEmail}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {resending ? 'Sending...' : 'Resend Verification Email'}
            </button>
          </div>
        )}

        {resendSuccess && (
          <p className="text-sm text-emerald-500">
            A new verification email has been sent. Check your inbox.
          </p>
        )}

        {state === 'error' && (
          <Link to="/login" className="inline-block text-sm t-muted hover:underline">
            Back to Login
          </Link>
        )}
      </div>
    </div>
  );
}
