import { useState } from 'react';
import { BarChart3, Check, Copy, AlertTriangle, Info } from 'lucide-react';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { DEFAULT_ANALYTICS } from '@/lib/factory';
import type { TrackableEvent } from '@/types';

const GA_ID_RE = /^G-[A-Z0-9]{9,12}$/;

const inputCls =
  'w-full bg-paper-strong border border-line-soft rounded px-3 py-1.5 text-sm text-ink placeholder-ink-faded font-mono focus:outline-none focus:border-accent';

interface EventGroup {
  label: string;
  events: { id: TrackableEvent; label: string; description: string }[];
}

const EVENT_GROUPS: EventGroup[] = [
  {
    label: 'Navigation',
    events: [
      { id: 'tour_started',    label: 'Tour started',    description: 'Fires when the first scene loads' },
      { id: 'scene_view',      label: 'Scene view',      description: 'Fires every time a scene becomes active' },
      { id: 'scene_change',    label: 'Scene change',    description: 'Fires when navigating between scenes (with from/to)' },
      { id: 'tour_completed',  label: 'Tour completed',  description: 'Fires once when the visitor has seen all scenes' },
    ],
  },
  {
    label: 'Hotspots',
    events: [
      { id: 'link_hotspot_click',  label: 'Link hotspot click',  description: 'Navigation hotspot clicked' },
      { id: 'hotspot_click',       label: 'Hotspot click',       description: 'Generic hotspot interaction' },
      { id: 'external_link_click', label: 'External link click', description: 'External URL hotspot opened' },
      { id: 'info_hotspot_open',   label: 'Info panel open',     description: 'Text/info popup opened from hotspot' },
      { id: 'video_play',          label: 'Video play',          description: 'Video hotspot opened' },
      { id: 'form_open',           label: 'Form open',           description: 'Contact form popup opened' },
      { id: 'form_submit',         label: 'Form submit',         description: 'Contact form submitted (mailto opened)' },
    ],
  },
  {
    label: 'Map & UI',
    events: [
      { id: 'map_open',         label: 'Map opened',      description: 'Visitor opened the map panel' },
      { id: 'map_marker_click', label: 'Map marker click', description: 'Visitor clicked a scene pin on the map' },
      { id: 'info_panel_open',  label: 'Info panel open', description: 'Right-side info panel toggled open' },
      { id: 'fullscreen_enter', label: 'Fullscreen enter', description: 'Visitor entered fullscreen mode' },
    ],
  },
  {
    label: 'Sharing & Consent',
    events: [
      { id: 'share_click',      label: 'Share click',      description: 'Social share button clicked (with platform)' },
      { id: 'language_change',  label: 'Language change',  description: 'Visitor switched language' },
      { id: 'cookie_accepted',  label: 'Cookie accepted',  description: 'Visitor accepted the cookie consent banner' },
    ],
  },
];

export function AnalyticsScreen() {
  const { project, updateAnalytics } = useProject();
  const cfg = project.analytics ?? DEFAULT_ANALYTICS;
  const [copied, setCopied] = useState(false);

  const idValid = GA_ID_RE.test(cfg.measurementId);
  const canEnable = cfg.measurementId.length > 0 && idValid;

  function setEvent(id: TrackableEvent, value: boolean) {
    updateAnalytics({ events: { ...cfg.events, [id]: value } });
  }

  function copySnippet() {
    const snippet = `<!-- Paste in your browser console to verify GA4 is firing -->
gtag('event', 'test_ping', { source: 'conchitect_verify' });
console.log('GA4 measurement ID:', '${cfg.measurementId}');`;
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <ScreenShell title="Analytics" subtitle="Track visitor engagement with Google Analytics 4.">
      <div className="max-w-2xl space-y-6">

        {/* ── Master toggle ─────────────────────────────────────────────── */}
        <div className={`rounded-xl border p-5 transition-colors ${cfg.enabled ? 'border-accent/40 bg-accent/4' : 'border-line-soft bg-paper-tinted'}`}>
          <label className="flex items-center gap-4 cursor-pointer select-none">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${cfg.enabled ? 'bg-accent/15 text-accent' : 'bg-paper-strong text-ink-faded'}`}>
              <BarChart3 size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">Enable Google Analytics 4</p>
              <p className="text-xs text-ink-faded mt-0.5">
                Injects the gtag.js snippet into the compiled tour. No data leaves your project — the GA4 property belongs to you.
              </p>
            </div>
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => {
                if (e.target.checked && !canEnable) return;
                updateAnalytics({ enabled: e.target.checked });
              }}
              className="w-4 h-4 accent-accent flex-shrink-0"
            />
          </label>
        </div>

        {/* ── Measurement ID ────────────────────────────────────────────── */}
        <div className="rounded-xl border border-line-soft bg-paper p-5 space-y-3">
          <p className="text-sm font-medium text-ink">Measurement ID</p>
          <div className="space-y-1">
            <input
              className={inputCls + (!idValid && cfg.measurementId ? ' border-red-400' : '')}
              type="text"
              value={cfg.measurementId}
              placeholder="G-XXXXXXXXXX"
              onChange={(e) => updateAnalytics({ measurementId: e.target.value.toUpperCase() })}
            />
            {cfg.measurementId && !idValid && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertTriangle size={11} /> Format must be G- followed by 9–12 uppercase letters/digits
              </p>
            )}
            {idValid && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <Check size={11} /> Valid Measurement ID
              </p>
            )}
          </div>
          <p className="text-xs text-ink-faded">
            Found in your GA4 property → Admin → Data Streams → your stream → Measurement ID.
          </p>

          {/* Privacy options */}
          <div className="border-t border-line-soft pt-3 space-y-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={cfg.anonymizeIp}
                onChange={(e) => updateAnalytics({ anonymizeIp: e.target.checked })}
                className="w-3.5 h-3.5 accent-accent"
              />
              <span className="text-xs text-ink">Anonymize IP addresses <span className="text-ink-faded">(GDPR-safe, recommended)</span></span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={cfg.respectCookieConsent}
                onChange={(e) => updateAnalytics({ respectCookieConsent: e.target.checked })}
                className="w-3.5 h-3.5 accent-accent"
              />
              <span className="text-xs text-ink">
                Block events until visitor accepts cookies{' '}
                <span className="text-ink-faded">(requires Cookie consent module enabled)</span>
              </span>
            </label>
            {!cfg.respectCookieConsent && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-1">
                <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  Events will fire immediately on page load without consent. This may not comply with GDPR/ePrivacy regulations in the EU.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Event checkboxes ──────────────────────────────────────────── */}
        <div className="rounded-xl border border-line-soft bg-paper p-5 space-y-5">
          <p className="text-sm font-medium text-ink">Events to track</p>
          {EVENT_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] uppercase tracking-widest text-ink-faded font-semibold mb-2">{group.label}</p>
              <div className="space-y-1.5">
                {group.events.map(({ id, label, description }) => (
                  <label key={id} className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={cfg.events[id] ?? true}
                      onChange={(e) => setEvent(id, e.target.checked)}
                      className="w-3.5 h-3.5 accent-accent flex-shrink-0 mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-ink font-medium">{label}</span>
                        <code className="text-[10px] font-mono text-ink-faded bg-paper-strong px-1 rounded">{id}</code>
                      </div>
                      <p className="text-[11px] text-ink-faded">{description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Test / verify ─────────────────────────────────────────────── */}
        {cfg.enabled && idValid && (
          <div className="rounded-xl border border-line-soft bg-paper p-5 space-y-3">
            <p className="text-sm font-medium text-ink">Verify integration</p>
            <p className="text-xs text-ink-faded">
              After compiling and opening your tour, open the browser console and run the snippet below.
              Then check <strong>GA4 → Reports → Realtime</strong> — the <code>test_ping</code> event should appear within 30 seconds.
            </p>
            <div className="bg-paper-strong rounded-lg p-3 font-mono text-xs text-ink-soft whitespace-pre-wrap break-all">
              {`gtag('event', 'test_ping', { source: 'conchitect_verify' });`}
            </div>
            <button
              onClick={copySnippet}
              className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-line-soft bg-paper-tinted hover:bg-paper-strong transition-colors"
            >
              {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy snippet'}
            </button>
          </div>
        )}

        {/* ── Privacy reminder ──────────────────────────────────────────── */}
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            You are responsible for disclosing your use of Google Analytics in your tour's Privacy Policy page.
            Enable the <strong>Privacy Policy</strong> page in the Pages screen and mention GA4 data collection.
          </p>
        </div>

      </div>
    </ScreenShell>
  );
}
