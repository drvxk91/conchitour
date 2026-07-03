import { X, CheckCircle, Layers, Languages, Wand2, Brain, ExternalLink, Key } from 'lucide-react';
import { useLicense } from '@/store/license';
import { useState } from 'react';

export type UpgradeFeature = 'scenes' | 'languages' | 'ai' | 'watermark' | 'copyright' | 'generic';

const FEATURE_HEADLINES: Record<UpgradeFeature, { icon: React.ReactNode; title: string }> = {
  scenes:    { icon: <Layers size={22} className="text-accent" />,    title: "You've reached the 3-scene trial limit" },
  languages: { icon: <Languages size={22} className="text-accent" />, title: 'Trial allows 2 languages maximum' },
  ai:        { icon: <Brain size={22} className="text-accent" />,     title: "You've used all 50 AI calls in your trial" },
  watermark: { icon: <Wand2 size={22} className="text-accent" />,     title: 'Remove the trial watermark' },
  copyright: { icon: <Wand2 size={22} className="text-accent" />,     title: 'Set your own copyright' },
  generic:   { icon: <Wand2 size={22} className="text-accent" />,     title: 'Unlock the full Conchitour' },
};

const BENEFITS = [
  'Unlimited scenes per tour',
  'Unlimited languages (DeepL + AI translation)',
  'No watermark — your own copyright',
  'Unlimited AI calls (Magic Wand, Audit, generation)',
  '1 year of updates and bug fixes',
  'Activate on up to 2 computers',
  'Priority email support',
];

interface Props {
  feature: UpgradeFeature;
  onClose: () => void;
}

export function UpgradeModal({ feature, onClose }: Props) {
  const { setStatus, license } = useLicense();
  const [showKeyEntry, setShowKeyEntry] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [activating, setActivating] = useState(false);
  const [keyError, setKeyError] = useState('');

  const { icon, title } = FEATURE_HEADLINES[feature];

  async function handleActivate() {
    const key = keyInput.trim();
    if (!key) return;
    setActivating(true);
    setKeyError('');
    try {
      const result = await window.conchitour.licenseActivate(key);
      if (result.ok && result.license) {
        setStatus('valid', result.license);
        onClose();
      } else {
        setKeyError(result.error ?? 'Activation failed.');
      }
    } catch {
      setKeyError('Network error. Check your connection.');
    }
    setActivating(false);
  }

  return (
    <div className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-paper rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative p-6 pb-4 border-b border-line">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-ink-faded hover:text-ink hover:bg-paper-tinted"
          >
            <X size={16} />
          </button>
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-accent/10 flex-shrink-0">{icon}</div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-accent mb-0.5">Upgrade to Conchitour</p>
              <h2 className="text-base font-semibold text-ink leading-snug">{title}</h2>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {!showKeyEntry ? (
            <>
              <p className="text-sm text-ink-faded">
                Get the full version for <span className="font-semibold text-ink">$149</span> — one-time payment, no subscription.
              </p>
              <ul className="space-y-2">
                {BENEFITS.map((b) => (
                  <li key={b} className="flex items-center gap-2.5 text-sm text-ink">
                    <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-ink-faded/70 text-center">Own forever. No renewal required.</p>

              <div className="space-y-2 pt-1">
                <button
                  onClick={() => window.conchitour.openUrl('https://conchitour.com/pricing/')}
                  className="w-full py-3 rounded-xl bg-accent text-white font-semibold text-sm hover:bg-accent/90 flex items-center justify-center gap-2"
                >
                  Buy Conchitour for $149 <ExternalLink size={14} />
                </button>
                <button
                  onClick={() => setShowKeyEntry(true)}
                  className="w-full py-2 text-sm text-ink-faded hover:text-ink flex items-center justify-center gap-2"
                >
                  <Key size={13} /> Already have a key? Enter it here
                </button>
                <button
                  onClick={onClose}
                  className="w-full py-2 text-xs text-ink-faded/60 hover:text-ink-faded"
                >
                  Continue with trial
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <button onClick={() => setShowKeyEntry(false)} className="text-xs text-ink-faded hover:text-ink">← Back</button>
              <p className="text-sm text-ink-faded">Enter your license key to activate full access instantly.</p>
              <input
                value={keyInput}
                onChange={(e) => { setKeyInput(e.target.value.toUpperCase()); setKeyError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
                placeholder="CONCH-XXXX-XXXX-XXXX-XXXX"
                className="w-full bg-paper-strong border border-line-soft rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-accent"
                spellCheck={false}
                autoFocus
              />
              {keyError && <p className="text-xs text-red-500">{keyError}</p>}
              <button
                onClick={handleActivate}
                disabled={activating || !keyInput.trim()}
                className="w-full py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
              >
                {activating ? 'Activating…' : 'Activate'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
