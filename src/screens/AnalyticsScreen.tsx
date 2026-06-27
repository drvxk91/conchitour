import { useState } from 'react';
import {
  BarChart3, Check, Copy, AlertTriangle, Info,
  ExternalLink, Loader2, CheckCircle, AlertCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { DEFAULT_ANALYTICS } from '@/lib/factory';
import type { TrackableEvent } from '@/types';

export const GA_ID_RE = /^G-[A-Z0-9]{9,12}$/;

interface EventEntry {
  id: TrackableEvent;
  label: string;
  description: string;
}

interface EventGroup {
  label: string;
  events: EventEntry[];
}

const EVENT_GROUPS: EventGroup[] = [
  {
    label: 'Navigation',
    events: [
      { id: 'tour_started',   label: 'Tour started',   description: 'First scene loads' },
      { id: 'scene_view',     label: 'Scene view',     description: 'Each scene becomes active' },
      { id: 'scene_change',   label: 'Scene change',   description: 'Navigating between scenes (with from/to)' },
      { id: 'tour_completed', label: 'Tour completed', description: 'Visitor has viewed all scenes' },
    ],
  },
  {
    label: 'Hotspots',
    events: [
      { id: 'link_hotspot_click',  label: 'Link hotspot click',  description: 'Navigation hotspot clicked' },
      { id: 'external_link_click', label: 'External link click', description: 'External URL hotspot opened' },
      { id: 'hotspot_click',       label: 'Hotspot click',       description: 'Generic hotspot interaction' },
      { id: 'info_hotspot_open',   label: 'Info panel open',     description: 'Text/info popup opened from hotspot' },
      { id: 'video_play',          label: 'Video play',          description: 'Video hotspot started' },
      { id: 'form_open',           label: 'Form open',           description: 'Contact form popup opened' },
      { id: 'form_submit',         label: 'Form submit',         description: 'Contact form submitted' },
    ],
  },
  {
    label: 'Map & UI',
    events: [
      { id: 'map_open',         label: 'Map opened',       description: 'Visitor opened the map panel' },
      { id: 'map_marker_click', label: 'Map marker click', description: 'Visitor clicked a scene pin on the map' },
      { id: 'info_panel_open',  label: 'Info panel open',  description: 'Right-side info panel toggled open' },
      { id: 'fullscreen_enter', label: 'Fullscreen enter', description: 'Visitor entered fullscreen mode' },
      { id: 'share_click',      label: 'Share click',      description: 'Social share button clicked (with platform)' },
      { id: 'language_change',  label: 'Language change',  description: 'Visitor switched language' },
      { id: 'cookie_accepted',  label: 'Cookie accepted',  description: 'Visitor accepted the cookie consent banner' },
    ],
  },
];

const ALL_EVENT_IDS = EVENT_GROUPS.flatMap((g) => g.events.map((e) => e.id));

export function AnalyticsScreen() {
  const { project, updateAnalytics } = useProject();
  const cfg = project.analytics ?? DEFAULT_ANALYTICS;
  const [copied, setCopied] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState('');

  const idValid = GA_ID_RE.test(cfg.measurementId);

  function setEvent(id: TrackableEvent, value: boolean) {
    updateAnalytics({ events: { ...cfg.events, [id]: value } });
  }

  function setAllEvents(value: boolean) {
    const events = Object.fromEntries(ALL_EVENT_IDS.map((id) => [id, value])) as Record<TrackableEvent, boolean>;
    updateAnalytics({ events });
  }

  function resetToRecommended() {
    updateAnalytics({ events: { ...DEFAULT_ANALYTICS.events } });
  }

  function openUrl(url: string) {
    window.conchitect.openUrl(url);
  }

  async function handleTest() {
    if (!idValid) return;
    setTestState('testing');
    setTestMsg('');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      await fetch(`https://www.googletagmanager.com/gtag/js?id=${cfg.measurementId}`, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      setTestState('ok');
      setTimeout(() => setTestState('idle'), 3000);
    } catch {
      clearTimeout(timer);
      setTestState('error');
      setTestMsg('Could not reach GA4 servers');
    }
  }

  function copySnippet() {
    const snippet = `gtag('event', 'test_ping', { source: 'conchitect_verify' });\nconsole.log('GA4 ID:', '${cfg.measurementId}');`;
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <ScreenShell title="Analytics" subtitle="Track visitor engagement with Google Analytics 4.">
      <div className="max-w-2xl space-y-5">

        {/* ── Config block ─────────────────────────────────────────────── */}
        <div className="rounded-xl border border-line-soft bg-paper-tinted p-4 space-y-3">

          {/* Enable toggle */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => {
                if (e.target.checked && !idValid) return;
                updateAnalytics({ enabled: e.target.checked });
              }}
              className="w-4 h-4 accent-accent shrink-0"
            />
            <BarChart3 size={14} className={cfg.enabled ? 'text-accent' : 'text-ink-faded'} />
            <span className={clsx('text-sm font-medium', cfg.enabled ? 'text-ink-strong' : 'text-ink')}>
              Enable Google Analytics 4
            </span>
            <span className="text-xs text-ink-faded">Injects gtag.js into the compiled tour.</span>
          </label>

          {/* Measurement ID */}
          <div className="border-t border-line-soft pt-3 space-y-2">
            <div className="flex items-start gap-2">
              <label className="text-xs text-ink-soft w-28 shrink-0 pt-2">Measurement ID</label>
              <div className="flex-1 space-y-1">
                <div className="flex gap-2">
                  <input
                    className={clsx(
                      'flex-1 bg-paper-strong border rounded px-3 py-1.5 text-sm text-ink placeholder-ink-faded font-mono focus:outline-none',
                      cfg.measurementId && !idValid ? 'border-red-400 focus:border-red-400' :
                      idValid ? 'border-green-500/60 focus:border-green-500' :
                      'border-line-soft focus:border-accent',
                    )}
                    type="text"
                    value={cfg.measurementId}
                    placeholder="G-XXXXXXXXXX"
                    onChange={(e) => {
                      setTestState('idle');
                      updateAnalytics({ measurementId: e.target.value.toUpperCase() });
                    }}
                  />
                  <button
                    onClick={handleTest}
                    disabled={!idValid || testState === 'testing'}
                    className={clsx(
                      'btn shrink-0 text-xs min-w-[48px] disabled:opacity-40',
                      testState === 'ok' && 'text-green-600',
                      testState === 'error' && 'text-red-500',
                    )}
                  >
                    {testState === 'testing' ? <Loader2 size={12} className="animate-spin" />
                      : testState === 'ok' ? <CheckCircle size={12} />
                      : testState === 'error' ? <AlertCircle size={12} />
                      : 'Test'}
                  </button>
                </div>

                {cfg.measurementId && !idValid && (
                  <p className="text-[11px] text-red-500 flex items-center gap-1">
                    <AlertTriangle size={10} /> Expected format: G-XXXXXXXXXX
                  </p>
                )}
                {idValid && testState === 'idle' && (
                  <p className="text-[11px] text-green-600 flex items-center gap-1">
                    <Check size={10} /> Valid Measurement ID
                  </p>
                )}
                {idValid && testState === 'ok' && (
                  <p className="text-[11px] text-green-600 flex items-center gap-1">
                    <Check size={10} /> Valid · GA4 servers reachable
                  </p>
                )}
                {testState === 'error' && (
                  <p className="text-[11px] text-red-500 flex items-center gap-1">
                    <AlertCircle size={10} /> {testMsg}
                  </p>
                )}
              </div>
            </div>

            {/* Helper links */}
            <div className="flex items-center gap-3 pl-[7.5rem] text-[11px]">
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); openUrl('https://analytics.google.com/'); }}
                className="flex items-center gap-1 text-accent hover:underline"
              >
                <ExternalLink size={10} /> Open GA4 dashboard
              </a>
              <span className="text-ink-faded">·</span>
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); openUrl('https://support.google.com/analytics/answer/9539598'); }}
                className="flex items-center gap-1 text-accent hover:underline"
              >
                <ExternalLink size={10} /> How to find Measurement ID
              </a>
            </div>
          </div>

          {/* GDPR options */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line-soft pt-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cfg.anonymizeIp}
                onChange={(e) => updateAnalytics({ anonymizeIp: e.target.checked })}
                className="w-3.5 h-3.5 accent-accent"
              />
              <span className="text-xs text-ink">
                Anonymize IP <span className="text-ink-faded">(GDPR)</span>
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cfg.respectCookieConsent}
                onChange={(e) => updateAnalytics({ respectCookieConsent: e.target.checked })}
                className="w-3.5 h-3.5 accent-accent"
              />
              <span className="text-xs text-ink">Wait for cookie consent</span>
            </label>
            {!cfg.respectCookieConsent && (
              <p className="w-full text-[11px] text-amber-600 flex items-center gap-1">
                <AlertTriangle size={10} />
                Events fire immediately without consent — may not comply with GDPR/ePrivacy in the EU.
              </p>
            )}
          </div>
        </div>

        {/* ── Event groups ─────────────────────────────────────────────── */}
        <div className="space-y-3">
          <p className="text-[10px] uppercase tracking-widest text-ink-faded font-semibold">
            Events to track
          </p>

          {EVENT_GROUPS.map((group) => (
            <fieldset key={group.label} className="border border-line-soft rounded-xl p-4">
              <legend className="text-xs font-semibold text-ink px-1.5 -ml-1.5">{group.label}</legend>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mt-1.5">
                {group.events.map(({ id, label, description }) => (
                  <label
                    key={id}
                    title={`${id}\n${description}`}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={cfg.events[id] ?? true}
                      onChange={(e) => setEvent(id, e.target.checked)}
                      className="w-3.5 h-3.5 accent-accent shrink-0"
                    />
                    <span className="text-xs text-ink">{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}

          {/* Quick actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAllEvents(true)}
              className="text-xs px-2.5 py-1 rounded-lg border border-line-soft bg-paper hover:bg-paper-tinted transition-colors"
            >
              Select all
            </button>
            <button
              onClick={resetToRecommended}
              className="text-xs px-2.5 py-1 rounded-lg border border-line-soft bg-paper hover:bg-paper-tinted transition-colors"
            >
              Recommended only
            </button>
            <button
              onClick={() => setAllEvents(false)}
              className="text-xs px-2.5 py-1 rounded-lg border border-line-soft bg-paper hover:bg-paper-tinted transition-colors text-ink-faded"
            >
              Clear all
            </button>
          </div>
        </div>

        {/* ── Verify integration ───────────────────────────────────────── */}
        {cfg.enabled && idValid && (
          <div className="rounded-xl border border-line-soft bg-paper p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-ink">Verify integration</p>
              <button
                onClick={copySnippet}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-line-soft bg-paper-tinted hover:bg-paper-strong transition-colors"
              >
                {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                {copied ? 'Copied!' : 'Copy snippet'}
              </button>
            </div>
            <div className="bg-paper-strong rounded-lg px-3 py-2 font-mono text-xs text-ink-soft whitespace-pre-wrap">
              {`gtag('event', 'test_ping', { source: 'conchitect_verify' });\nconsole.log('GA4 ID:', '${cfg.measurementId}');`}
            </div>
            <p className="text-[11px] text-ink-faded">
              Run in the browser console after compiling. Check{' '}
              <strong>GA4 → Reports → Realtime</strong> — <code>test_ping</code> should appear within 30 s.
            </p>
          </div>
        )}

        {/* ── Privacy reminder ─────────────────────────────────────────── */}
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <Info size={13} className="text-blue-500 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            Disclose your use of Google Analytics in your tour's Privacy Policy page.
            Enable <strong>Privacy Policy</strong> in Pages and mention GA4 data collection.
          </p>
        </div>

      </div>
    </ScreenShell>
  );
}
