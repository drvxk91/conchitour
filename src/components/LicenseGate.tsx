import { useState } from 'react';
import { Key, AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useLicense } from '@/store/license';
import type { LicenseGateStatus } from '@/types/license';

const KEY_RE = /^CONCH-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

function formatKey(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!clean.startsWith('CONCH')) {
    const digits = clean.slice(0, 16);
    const groups = digits.match(/.{1,4}/g) ?? [];
    return groups.length ? 'CONCH-' + groups.join('-') : raw.toUpperCase();
  }
  const body = clean.slice(5).replace(/-/g, '').slice(0, 16);
  const groups = body.match(/.{1,4}/g) ?? [];
  return 'CONCH-' + groups.join('-');
}

interface Props {
  initialStatus: LicenseGateStatus;
  onUnlocked: () => void;
  onReadOnly: () => void;
}

export function LicenseGate({ initialStatus, onUnlocked, onReadOnly }: Props) {
  const { setStatus } = useLicense();
  const [view, setView] = useState<'main' | 'enterKey'>(
    initialStatus === 'expired' ? 'main' : 'main',
  );
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleActivate() {
    const key = keyInput.trim();
    if (!KEY_RE.test(key)) {
      setError('Invalid format. Keys look like CONCH-XXXX-XXXX-XXXX-XXXX.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await window.conchitour.licenseActivate(key);
      if (result.ok && result.license) {
        setStatus('valid', result.license);
        onUnlocked();
      } else {
        setError(result.error ?? 'Activation failed.');
      }
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  const isExpired = initialStatus === 'expired';
  const isInvalid = initialStatus === 'invalid';
  const isNone = initialStatus === 'none';

  return (
    <div className="fixed inset-0 z-[9999] bg-[#fafaf9] flex items-center justify-center">
      <div className="w-[520px] flex flex-col gap-6">
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/10 mb-4">
            {isExpired ? (
              <Clock size={26} className="text-amber-500" />
            ) : isInvalid ? (
              <AlertTriangle size={26} className="text-amber-500" />
            ) : (
              <Key size={26} className="text-accent" />
            )}
          </div>
          <h1 className="text-xl font-semibold text-ink">
            {isExpired ? 'License expired' : isInvalid ? 'Hardware change detected' : 'Welcome to Conchitour'}
          </h1>
          <p className="text-sm text-ink-faded mt-1.5 max-w-sm mx-auto">
            {isExpired
              ? 'Your Conchitour license has expired. Renew to restore all features.'
              : isInvalid
              ? "This machine doesn't match the one your license was activated on. Re-enter your key to continue."
              : 'Enter your license key below. Need to try Conchitour first? Request a free trial key — we\'ll email it to you instantly.'}
          </p>
        </div>

        {/* Key entry */}
        {(isNone || isInvalid || view === 'enterKey') && (
          <div className="bg-paper border border-line rounded-xl p-5 space-y-3">
            <label className="block text-xs font-medium text-ink-faded uppercase tracking-wide">
              License key
            </label>
            <input
              type="text"
              placeholder="CONCH-XXXX-XXXX-XXXX-XXXX"
              value={keyInput}
              onChange={(e) => {
                setError('');
                setKeyInput(formatKey(e.target.value));
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
              className="w-full bg-paper-strong border border-line-soft rounded-lg px-4 py-2.5 text-sm font-mono text-ink placeholder-ink-faded/50 focus:outline-none focus:border-accent"
              spellCheck={false}
              autoComplete="off"
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button
              onClick={handleActivate}
              disabled={loading || !keyInput.trim()}
              className={clsx(
                'w-full py-2.5 rounded-lg text-sm font-medium transition-colors',
                'bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed',
                'flex items-center justify-center gap-2',
              )}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              {isInvalid ? 'Re-activate' : 'Activate'}
            </button>
          </div>
        )}

        {/* Expired state actions */}
        {isExpired && view === 'main' && (
          <div className="space-y-2">
            <button
              onClick={() => window.conchitour.openUrl('https://conchitour.com')}
              className="w-full py-2.5 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90 flex items-center justify-center gap-2"
            >
              Renew license <ExternalLink size={13} />
            </button>
            <button
              onClick={() => setView('enterKey')}
              className="w-full py-2.5 rounded-lg text-sm font-medium border border-line text-ink hover:bg-paper-tinted"
            >
              Enter a new key
            </button>
            {view === 'main' && (
              <button
                onClick={onReadOnly}
                className="w-full py-2 text-xs text-ink-faded hover:text-ink transition-colors"
              >
                Open existing projects in read-only mode
              </button>
            )}
          </div>
        )}

        {/* Trial + buy — only for 'none' state */}
        {isNone && (
          <div className="space-y-2">
            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px bg-line" />
              <span className="text-xs text-ink-faded">or</span>
              <div className="flex-1 h-px bg-line" />
            </div>
            <button
              onClick={() => window.conchitour.openUrl('https://conchitour.com/trial')}
              className="w-full py-2.5 rounded-lg text-sm font-medium border border-line text-ink hover:bg-paper-tinted flex items-center justify-center gap-2"
            >
              Get a free trial key <ExternalLink size={13} />
            </button>
            <p className="text-center text-[11px] text-ink-faded/70">
              Fill in your details on conchitour.com — we'll email your trial key instantly.
            </p>
            <button
              onClick={() => window.conchitour.openUrl('https://conchitour.com/pricing/')}
              className="w-full py-2 text-xs text-ink-faded hover:text-ink transition-colors flex items-center justify-center gap-1.5"
            >
              Buy a full license at conchitour.com <ExternalLink size={11} />
            </button>
          </div>
        )}

        {/* Enter key link when in expired/enterKey view */}
        {isExpired && view === 'enterKey' && (
          <div className="space-y-2 -mt-2">
            {error && <p className="text-xs text-red-500 text-center">{error}</p>}
            <button
              onClick={() => setView('main')}
              className="w-full py-2 text-xs text-ink-faded hover:text-ink"
            >
              ← Back
            </button>
          </div>
        )}

        <p className="text-center text-[11px] text-ink-faded/60">
          Need help? <a href="mailto:help@conchitour.com" className="underline hover:text-ink-faded">help@conchitour.com</a>
        </p>
      </div>
    </div>
  );
}
