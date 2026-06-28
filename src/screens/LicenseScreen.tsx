import { useState, useEffect } from 'react';
import { CheckCircle, Clock, AlertTriangle, ExternalLink, Loader2, RotateCw, LogOut } from 'lucide-react';
import clsx from 'clsx';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { useLicense } from '@/store/license';
import type { LocalLicense } from '@/types/license';

function daysLeft(ts: number): number {
  return Math.max(0, Math.ceil((ts - Date.now()) / 86_400_000));
}

function daysAgo(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

function redactKey(key: string): string {
  const parts = key.split('-');
  return parts.length === 5 ? `CONCH-****-****-****-${parts[4]}` : key;
}

export function LicenseScreen() {
  const { status, license, refresh, setStatus } = useLicense();
  const [refreshing, setRefreshing] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [changingKey, setChangingKey] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [activating, setActivating] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  async function handleRefresh() {
    setRefreshing(true);
    setSuccessMsg('');
    try {
      await refresh();
      setSuccessMsg('Status refreshed.');
    } catch { /* ignore */ }
    setRefreshing(false);
  }

  async function handleDeactivate() {
    if (!confirm('Deactivate this machine? You can re-activate later with your key.')) return;
    setDeactivating(true);
    try {
      await window.conchitour.licenseDeactivate();
      setStatus('none', null);
    } catch { /* ignore */ }
    setDeactivating(false);
  }

  async function handleActivateNew() {
    const key = newKey.trim();
    if (!key) return;
    setActivating(true);
    setKeyError('');
    try {
      const result = await window.conchitour.licenseActivate(key);
      if (result.ok && result.license) {
        setStatus('valid', result.license);
        setChangingKey(false);
        setNewKey('');
        setSuccessMsg('License activated.');
      } else {
        setKeyError(result.error ?? 'Activation failed.');
      }
    } catch {
      setKeyError('Network error. Check your connection.');
    }
    setActivating(false);
  }

  return (
    <ScreenShell title="License" subtitle="Manage your Conchitour license and activations.">
      <div className="max-w-xl mx-auto space-y-4">
        {/* Status card */}
        <div className="bg-paper border border-line rounded-xl p-5">
          {status === 'valid' && license && <ActiveCard license={license} />}
          {status === 'trial' && license && <TrialCard license={license} />}
          {status === 'expired' && <ExpiredCard license={license} />}
          {status === 'none' && <NoneCard />}
          {status === 'invalid' && <InvalidCard />}
        </div>

        {successMsg && (
          <p className="text-xs text-green-600 text-center">{successMsg}</p>
        )}

        {/* Actions */}
        {(status === 'valid' || status === 'trial') && (
          <div className="space-y-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="w-full flex items-center justify-center gap-2 py-2 text-sm text-ink-faded hover:text-ink border border-line rounded-lg hover:bg-paper-tinted"
            >
              {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />}
              Refresh status
            </button>
            {status === 'valid' && !changingKey && (
              <button
                onClick={() => setChangingKey(true)}
                className="w-full py-2 text-sm text-ink-faded hover:text-ink border border-line rounded-lg hover:bg-paper-tinted"
              >
                Change license key
              </button>
            )}
            {status === 'valid' && (
              <button
                onClick={handleDeactivate}
                disabled={deactivating}
                className="w-full flex items-center justify-center gap-2 py-2 text-sm text-red-500 hover:text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
              >
                {deactivating ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
                Deactivate this machine
              </button>
            )}
          </div>
        )}

        {/* Change key form */}
        {changingKey && (
          <div className="bg-paper border border-line rounded-xl p-4 space-y-3">
            <label className="block text-xs font-medium text-ink-faded uppercase tracking-wide">New license key</label>
            <input
              value={newKey}
              onChange={(e) => { setNewKey(e.target.value.toUpperCase()); setKeyError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleActivateNew()}
              placeholder="CONCH-XXXX-XXXX-XXXX-XXXX"
              className="w-full bg-paper-strong border border-line-soft rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
              spellCheck={false}
            />
            {keyError && <p className="text-xs text-red-500">{keyError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleActivateNew}
                disabled={activating || !newKey.trim()}
                className="flex-1 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {activating && <Loader2 size={13} className="animate-spin" />}
                Activate
              </button>
              <button
                onClick={() => { setChangingKey(false); setNewKey(''); setKeyError(''); }}
                className="px-4 py-2 text-sm border border-line rounded-lg hover:bg-paper-tinted"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Trial → activate */}
        {status === 'trial' && !changingKey && (
          <button
            onClick={() => setChangingKey(true)}
            className="w-full py-2.5 text-sm font-medium bg-accent text-white rounded-lg hover:bg-accent/90"
          >
            Activate full license
          </button>
        )}

        {/* Manage online */}
        <button
          onClick={() => window.conchitour.openUrl('https://conchitour.com')}
          className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-ink-faded hover:text-ink"
        >
          Manage at conchitour.com <ExternalLink size={11} />
        </button>
      </div>
    </ScreenShell>
  );
}

function ActiveCard({ license }: { license: LocalLicense }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircle size={16} className="text-green-500 flex-shrink-0" />
        <span className="text-sm font-medium text-green-700">Active</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-ink-faded">Key</dt>
        <dd className="font-mono text-xs text-ink">{redactKey(license.key)}</dd>
        {license.email && <><dt className="text-ink-faded">Email</dt><dd className="text-ink">{license.email}</dd></>}
        {license.expiresAt && (
          <><dt className="text-ink-faded">Expires</dt>
          <dd className="text-ink">{new Date(license.expiresAt).toLocaleDateString()} ({daysLeft(license.expiresAt)} days)</dd></>
        )}
        <dt className="text-ink-faded">Last verified</dt>
        <dd className="text-ink">{daysAgo(license.validatedAt)}</dd>
      </dl>
    </div>
  );
}

function TrialCard({ license }: { license: LocalLicense }) {
  const remaining = license.expiresAt ? daysLeft(license.expiresAt) : 0;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock size={16} className="text-amber-500 flex-shrink-0" />
        <span className="text-sm font-medium text-amber-700">Trial — {remaining} day{remaining !== 1 ? 's' : ''} remaining</span>
      </div>
      <p className="text-xs text-ink-faded">
        All features available until{' '}
        {license.expiresAt ? new Date(license.expiresAt).toLocaleDateString() : '—'}.
      </p>
    </div>
  );
}

function ExpiredCard({ license }: { license: LocalLicense | null }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
        <span className="text-sm font-medium text-red-700">Expired</span>
      </div>
      {license?.expiresAt && (
        <p className="text-xs text-ink-faded">
          Expired on {new Date(license.expiresAt).toLocaleDateString()}.
        </p>
      )}
      <button
        onClick={() => window.conchitour.openUrl('https://conchitour.com')}
        className="flex items-center gap-1.5 text-sm text-accent hover:underline"
      >
        Renew at conchitour.com <ExternalLink size={12} />
      </button>
    </div>
  );
}

function NoneCard() {
  return (
    <div className="space-y-2 text-center py-2">
      <p className="text-sm text-ink-faded">No license activated on this machine.</p>
    </div>
  );
}

function InvalidCard() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />
        <span className="text-sm font-medium text-amber-700">Hardware mismatch</span>
      </div>
      <p className="text-xs text-ink-faded">
        License was activated on a different machine. Re-enter your key to activate on this one.
      </p>
    </div>
  );
}
