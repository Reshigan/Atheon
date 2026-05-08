import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { Loader2, CheckCircle, XCircle, Link2 } from "lucide-react";

/**
 * Phase 4.7: ERP OAuth Callback Page
 * Handles OAuth2 authorization code callback from ERP providers (Xero, Sage, Pastel, etc.)
 * URL: /erp/oauth/callback?code=...&state=...&provider=...
 */
export function ERPOAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing ERP authorization...');
  const [provider, setProvider] = useState<string>('');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const providerParam = searchParams.get('provider') || searchParams.get('erp') || '';

    setProvider(providerParam);

    if (!code) {
      // OAuth providers redirect with `error=...` + `error_description=...`
      // when the user denies consent or something explodes server-side. Surface
      // those reasons explicitly instead of the generic "may have been cancelled."
      const oauthError = searchParams.get('error');
      const oauthErrorDesc = searchParams.get('error_description');
      setStatus('error');
      if (oauthError) {
        setMessage(`OAuth provider returned: ${oauthError}${oauthErrorDesc ? ` — ${oauthErrorDesc}` : ''}`);
      } else {
        setMessage('Missing authorization code. The OAuth flow may have been cancelled.');
      }
      return;
    }

    // Exchange the authorization code for an access token
    async function exchangeCode() {
      try {
        await api.erp.createConnection({
          oauth_code: code,
          oauth_state: state,
          provider: providerParam,
          type: 'oauth',
        });
        setStatus('success');
        setMessage(`Successfully connected to ${providerParam || 'ERP provider'}. You can now sync data.`);
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Failed to complete OAuth authorization. Please try again.');
      }
    }

    exchangeCode();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg-primary)' }}>
      <Card className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${
            status === 'loading' ? 'bg-accent/10' :
            status === 'success' ? 'bg-emerald-500/10' :
            'bg-red-500/10'
          }`}>
            {status === 'loading' && <Loader2 className="w-8 h-8 text-accent animate-spin" />}
            {status === 'success' && <CheckCircle className="w-8 h-8 text-emerald-500" />}
            {status === 'error' && <XCircle className="w-8 h-8 text-red-400" />}
          </div>
        </div>

        <div>
          <h1 className="text-xl font-bold t-primary">
            {status === 'loading' ? 'Connecting...' :
             status === 'success' ? 'Connected!' :
             'Connection Failed'}
          </h1>
          {provider && (
            <div className="flex items-center justify-center gap-2 mt-2">
              <Link2 size={14} className="text-accent" />
              <span className="text-sm t-muted capitalize">{provider}</span>
            </div>
          )}
        </div>

        <p className="text-sm t-muted">{message}</p>

        <div className="flex gap-3 justify-center">
          {status === 'success' && (
            <Button variant="primary" size="md" onClick={() => navigate('/integrations')} title="Go to ERP connections page">
              View Connections
            </Button>
          )}
          {status === 'error' && (
            <>
              <Button variant="secondary" size="md" onClick={() => navigate('/integrations')} title="Go back to ERP adapters page">
                Back to ERP
              </Button>
              <Button variant="primary" size="md" onClick={() => window.location.reload()} title="Retry the OAuth authorization">
                Try Again
              </Button>
            </>
          )}
          {status !== 'loading' && (
            <Button variant="secondary" size="md" onClick={() => navigate('/dashboard')} title="Return to dashboard">
              Dashboard
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
