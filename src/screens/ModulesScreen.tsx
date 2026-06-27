import { useState } from 'react';
import { Glasses, Smartphone, Maximize, MessageSquare, ClipboardList, Key, Bot, Sparkles, Construction, Cookie, Map, ArrowLeftRight, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { testAiConnection } from '@/lib/audit/ai-checks';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import type { MapModeConfig } from '@/types';

const inputCls =
  'w-full bg-paper-strong border border-line-soft rounded px-3 py-1.5 text-sm text-ink placeholder-ink-faded font-mono focus:outline-none focus:border-accent';

interface ModuleToggleProps {
  Icon: React.ElementType;
  label: string;
  description: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
}

function ModuleToggle({ Icon, label, description, enabled, onChange, children }: ModuleToggleProps) {
  return (
    <div className={`rounded-xl border p-4 transition-colors ${enabled ? 'border-line-strong bg-paper' : 'border-line-soft bg-paper-tinted'}`}>
      <label className="flex items-start gap-3 cursor-pointer select-none">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
          enabled ? 'bg-ink/10 text-ink' : 'bg-paper-strong text-ink-faded'
        }`}>
          <Icon size={18} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-ink">{label}</p>
          <p className="text-xs text-ink-faded mt-0.5">{description}</p>
          {enabled && children && (
            <div className="mt-3" onClick={(e) => e.stopPropagation()}>
              {children}
            </div>
          )}
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 accent-accent flex-shrink-0 mt-1"
        />
      </label>
    </div>
  );
}

const DEFAULT_MAP_MODE: MapModeConfig = {
  enabled: false,
  defaultView: '360',
  tileStyle: 'streets',
  showByDefault: false,
};

export function ModulesScreen() {
  const { project, updateModules } = useProject();
  const m = project.modules;
  const [anthropicTestState, setAnthropicTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [anthropicTestMsg, setAnthropicTestMsg] = useState('');
  // Controlled local state for key fields — avoids losing keys if user forgets Ctrl+S
  const [anthropicKeyDraft, setAnthropicKeyDraft] = useState(m.anthropicApiKey ?? '');
  const [deeplKeyDraft, setDeeplKeyDraft] = useState(m.deeplApiKey ?? '');

  async function autoSave(patch: Parameters<typeof updateModules>[0]) {
    updateModules(patch);
    try {
      const dir = await window.conchitect.getProjectDir();
      if (dir) {
        // Zustand set is synchronous — getState() reflects the patch just applied
        const fresh = useProject.getState().project;
        await window.conchitect.saveProject(fresh);
      }
    } catch { /* non-fatal: user can still Ctrl+S */ }
  }

  async function handleTestAnthropic() {
    const key = anthropicKeyDraft.trim();
    if (!key) return;
    setAnthropicTestState('testing');
    setAnthropicTestMsg('');
    const result = await testAiConnection(key);
    setAnthropicTestState(result.ok ? 'ok' : 'error');
    setAnthropicTestMsg(result.error ?? '');
  }
  const mapMode: MapModeConfig = m.mapMode ?? DEFAULT_MAP_MODE;
  const scenesWithGps = project.scenes.filter((s) => s.geo?.lat !== 0 || s.geo?.lng !== 0).length;

  return (
    <ScreenShell title="Modules" subtitle="Enable optional viewer features and integrations.">
      <div className="max-w-xl space-y-3">

        <ModuleToggle
          Icon={Glasses}
          label="VR / Cardboard mode"
          description="Adds a VR button that splits the view for Google Cardboard headsets."
          enabled={m.vr}
          onChange={(v) => updateModules({ vr: v })}
        />

        <ModuleToggle
          Icon={Smartphone}
          label="Gyroscope navigation"
          description="On mobile, tilting the device rotates the panorama. Requires device motion permission."
          enabled={m.gyroscope}
          onChange={(v) => updateModules({ gyroscope: v })}
        />

        <ModuleToggle
          Icon={Maximize}
          label="Fullscreen button"
          description="Adds a fullscreen toggle in the viewer controls."
          enabled={m.fullscreen}
          onChange={(v) => updateModules({ fullscreen: v })}
        />

        <ModuleToggle
          Icon={MessageSquare}
          label="Feedback button"
          description="Shows a feedback/contact button that opens a mailto: link."
          enabled={m.feedbackMailto !== undefined}
          onChange={(v) => updateModules({ feedbackMailto: v ? (m.feedbackMailto ?? '') : undefined })}
        >
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium">Email address</label>
            <input
              className={inputCls}
              type="email"
              value={m.feedbackMailto ?? ''}
              placeholder="feedback@example.com"
              onChange={(e) => updateModules({ feedbackMailto: e.target.value })}
            />
          </div>
        </ModuleToggle>

        <ModuleToggle
          Icon={ClipboardList}
          label="Contact forms"
          description="Enables Form-type hotspots in the viewer. Submissions are sent by mailto."
          enabled={m.formsEnabled}
          onChange={(v) => updateModules({ formsEnabled: v })}
        />

        <ModuleToggle
          Icon={Cookie}
          label="Cookie consent banner"
          description="Shows a consent banner on the visitor's first visit. Stores acceptance in localStorage."
          enabled={!!m.cookieConsent}
          onChange={(v) => updateModules({ cookieConsent: v })}
        >
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium">Banner text</label>
            <textarea
              rows={3}
              className={inputCls + ' resize-none text-xs'}
              value={m.cookieText?.en ?? ''}
              placeholder="This website uses cookies to enhance your virtual tour experience. By continuing, you accept our cookie policy."
              onChange={(e) =>
                updateModules({ cookieText: { ...(m.cookieText ?? {}), en: e.target.value } })
              }
            />
            <p className="text-[10px] text-ink-faded/70">Currently editing: EN — add per-language variants in the Languages screen (soon).</p>
          </div>
        </ModuleToggle>

        <ModuleToggle
          Icon={Map}
          label="Map mode"
          description={
            scenesWithGps >= 2
              ? 'Show an interactive map panel with scene pins. Powered by OpenStreetMap.'
              : 'Add GPS data to at least 2 scenes in the Map screen to enable map mode.'
          }
          enabled={!!mapMode.enabled && scenesWithGps >= 2}
          onChange={(v) => updateModules({ mapMode: { ...mapMode, enabled: v } })}
        >
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium">Default view</label>
              <div className="flex gap-2">
                {(['360', 'map', 'sidebyside'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => updateModules({ mapMode: { ...mapMode, defaultView: v } })}
                    className={`flex-1 text-xs py-1 rounded border transition-colors ${
                      mapMode.defaultView === v ? 'border-accent bg-accent/10 text-accent' : 'border-line-soft text-ink-faded hover:border-line-strong'
                    }`}
                  >
                    {v === '360' ? '360°' : v === 'map' ? 'Map' : 'Side by side'}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium">Map style</label>
              <select
                className={inputCls + ' text-xs'}
                value={mapMode.tileStyle}
                onChange={(e) => updateModules({ mapMode: { ...mapMode, tileStyle: e.target.value as MapModeConfig['tileStyle'] } })}
              >
                <option value="streets">Streets (OpenStreetMap)</option>
                <option value="satellite">Satellite (Esri)</option>
                <option value="light">Light (CartoDB)</option>
                <option value="dark">Dark (CartoDB)</option>
              </select>
            </div>
          </div>
        </ModuleToggle>

        <ModuleToggle
          Icon={ArrowLeftRight}
          label="Map ↔ Tour hover sync"
          description="Hovering a map marker highlights the matching link hotspot in the panorama, and vice-versa."
          enabled={!!m.mapTourSync}
          onChange={(v) => updateModules({ mapTourSync: v })}
        />

        {/* ── Anthropic API key ────────────────────────────────────────── */}
        <div className="rounded-xl border border-line-soft bg-paper-tinted p-4 mt-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-paper-strong text-ink-faded">
              <Sparkles size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">Anthropic API key</p>
              <p className="text-xs text-ink-faded mt-0.5 mb-3">
                Used for the Tour Audit AI checks — scene quality, narrative flow, and SEO suggestions.
                Get yours at{' '}
                <a className="underline text-accent" onClick={(e) => { e.preventDefault(); window.conchitect.openUrl('https://console.anthropic.com'); }} href="#">
                  console.anthropic.com
                </a>
                {' '}— keys start with <code className="font-mono bg-paper px-0.5 rounded">sk-ant-</code>
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  className={inputCls + ' flex-1'}
                  value={anthropicKeyDraft}
                  placeholder="sk-ant-api03-…"
                  onChange={(e) => { setAnthropicKeyDraft(e.target.value); setAnthropicTestState('idle'); }}
                  onBlur={() => autoSave({ anthropicApiKey: anthropicKeyDraft.trim() || undefined })}
                />
                <button
                  onClick={handleTestAnthropic}
                  disabled={!anthropicKeyDraft.trim() || anthropicTestState === 'testing'}
                  className="btn shrink-0 disabled:opacity-50"
                >
                  {anthropicTestState === 'testing' ? <Loader2 size={13} className="animate-spin" /> : 'Test'}
                </button>
              </div>
              {anthropicTestState === 'ok' && (
                <p className="text-[11px] text-green-600 mt-1 flex items-center gap-1">
                  <CheckCircle size={11} /> Connected — Anthropic API key is valid.
                </p>
              )}
              {anthropicTestState === 'error' && (
                <p className="text-[11px] text-red-500 mt-1 flex items-center gap-1">
                  <AlertCircle size={11} /> {anthropicTestMsg || 'Connection failed. Check your key.'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* DeepL key (also editable from Languages screen) */}
        <div className="rounded-xl border border-line-soft bg-paper-tinted p-4 mt-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-paper-strong text-ink-faded">
              <Key size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">DeepL API key</p>
              <p className="text-xs text-ink-faded mt-0.5 mb-3">
                Used for auto-translation in the Languages screen and the Scenes editor.
              </p>
              <input
                type="password"
                className={inputCls}
                value={deeplKeyDraft}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
                onChange={(e) => setDeeplKeyDraft(e.target.value)}
                onBlur={() => autoSave({ deeplApiKey: deeplKeyDraft.trim() || undefined })}
              />
              {deeplKeyDraft.trim() && (
                <p className="text-[11px] text-green-600 mt-1">API key stored.</p>
              )}
            </div>
          </div>
        </div>

        {/* ── AI integrations ─────────────────────────────────────────────── */}
        <p className="text-[10px] uppercase tracking-widest text-ink-faded font-semibold mt-8 mb-3">AI integrations</p>

        {/* Claude */}
        <div className="rounded-xl border border-dashed border-line-strong bg-paper-tinted p-4 opacity-60">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-paper-strong text-ink-faded">
              <Sparkles size={18} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-ink">Claude (Anthropic)</p>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 border border-amber-300 rounded-full px-2 py-0.5">
                  <Construction size={9} />
                  Development in progress
                </span>
              </div>
              <p className="text-xs text-ink-faded mt-1">
                Auto-generate scene descriptions, alt texts, and SEO content from your panoramas.
              </p>
              <input
                disabled
                className={inputCls + ' mt-3 opacity-50 cursor-not-allowed'}
                placeholder="sk-ant-xxxx — coming soon"
              />
            </div>
          </div>
        </div>

        {/* ChatGPT */}
        <div className="rounded-xl border border-dashed border-line-strong bg-paper-tinted p-4 opacity-60">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-paper-strong text-ink-faded">
              <Bot size={18} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-ink">ChatGPT (OpenAI)</p>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 border border-amber-300 rounded-full px-2 py-0.5">
                  <Construction size={9} />
                  Development in progress
                </span>
              </div>
              <p className="text-xs text-ink-faded mt-1">
                Generate tour narratives, suggest hotspot labels, and enrich metadata with GPT-4.
              </p>
              <input
                disabled
                className={inputCls + ' mt-3 opacity-50 cursor-not-allowed'}
                placeholder="sk-xxxx — coming soon"
              />
            </div>
          </div>
        </div>
      </div>
    </ScreenShell>
  );
}
