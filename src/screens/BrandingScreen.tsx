import { useState, useRef } from 'react';
import { Upload, X, Sparkles, Loader2 } from 'lucide-react';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { toLocalUrl } from '@/lib/local-url';
import { callAiStreaming } from '@/lib/ai-content';
import { resolvedModelId, computeAiCost } from '@/lib/ai-tracking';
import type { TourTheme } from '@/types';

const inputCls =
  'w-full bg-paper-strong border border-line-soft rounded px-3 py-1.5 text-sm text-ink placeholder-ink-faded focus:outline-none focus:border-accent';

function ColTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold text-ink-faded uppercase tracking-widest mb-4">{children}</h3>;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium text-ink-faded uppercase tracking-wide">{children}</label>;
}

function FileField({ label, hint, value, accept, onPick, onClear }: {
  label: string; hint?: string; value?: string; accept: string;
  onPick: (path: string) => void; onClear: () => void;
}) {
  async function handleDrop(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    onPick(window.conchitect.getPathForFile(file));
  }
  return (
    <div className="space-y-1">
      <FieldLabel>{label}</FieldLabel>
      {value ? (
        <div className="flex items-center gap-2 bg-paper-strong border border-line-soft rounded px-3 py-2">
          <span className="flex-1 text-xs text-ink font-mono truncate">{value}</span>
          <button onClick={onClear} className="text-ink-faded hover:text-red-500 flex-shrink-0" title="Remove"><X size={13} /></button>
        </div>
      ) : (
        <label className="flex items-center gap-2 cursor-pointer w-full bg-paper-strong border border-dashed border-line-strong rounded px-3 py-2 hover:border-accent hover:bg-paper-tinted transition-colors">
          <Upload size={13} className="text-ink-faded" />
          <span className="text-xs text-ink-faded">Click to pick a file…</span>
          <input type="file" accept={accept} className="sr-only" onChange={handleDrop} />
        </label>
      )}
      {hint && <p className="text-[11px] text-ink-faded/70">{hint}</p>}
    </div>
  );
}

function ColorField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="space-y-1">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-8 h-8 rounded border border-line-soft bg-transparent p-0.5 cursor-pointer flex-shrink-0" />
        <input className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      </div>
    </div>
  );
}

const RADIUS_OPTIONS: { id: TourTheme['radius']; label: string; css: string }[] = [
  { id: 'sharp', label: 'Square', css: '0px' },
  { id: 'soft',  label: 'Soft',   css: '10px' },
  { id: 'round', label: 'Round',  css: '20px' },
];

const FONT_OPTIONS: { id: TourTheme['fontFamily']; label: string; sample: string }[] = [
  { id: 'system', label: 'System',    sample: '-apple-system, sans-serif' },
  { id: 'serif',  label: 'Serif',     sample: 'Georgia, serif' },
  { id: 'mono',   label: 'Monospace', sample: 'ui-monospace, monospace' },
];

export function BrandingScreen() {
  const { project, updateBranding, recordAiUsage } = useProject();
  const b = project.branding;
  const langs = project.languages.available.length ? project.languages.available : ['en'];
  const defaultLang = project.languages.default || 'en';
  const [introLang, setIntroLang] = useState(defaultLang);
  const theme: TourTheme = b.tourTheme ?? {};

  const [genState, setGenState] = useState<'idle' | 'generating' | 'error'>('idle');
  const [genError, setGenError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  async function handleGenerateIntro() {
    const mods = project.modules;
    const provider = mods.aiProvider ?? 'claude';
    const apiKey = provider === 'gpt' ? mods.openaiApiKey : mods.anthropicApiKey;
    if (!apiKey?.trim()) {
      setGenError('No AI key configured. Go to AI screen first.');
      setGenState('error');
      return;
    }

    abortRef.current = new AbortController();
    setGenState('generating');
    setGenError('');

    const modelId = resolvedModelId(
      provider,
      provider === 'gpt' ? mods.openaiModel : mods.claudeModel,
    );
    const ctx = project.aiContext;
    const tone = ctx?.tone ?? 'marketing';
    const audience = ctx?.audience ?? 'general';
    const projectContext = ctx?.projectContext?.trim() ?? '';
    const customInstructions = ctx?.customInstructions?.trim() ?? '';
    const shortDesc = project.meta.shortDescription?.trim() ?? '';

    const prompt = `You are writing splash screen intro text for a 360° virtual tour.

Tour name: "${project.meta.name}"
${shortDesc ? `Description: "${shortDesc}"` : ''}
${projectContext ? `Editorial context: "${projectContext}"` : ''}
Tone: ${tone}. Audience: ${audience}.

Write a SHORT welcome message or tagline (1–2 lines maximum) to display below the tour title on the loading screen. It should be warm, enticing, and match the tour's identity.
${customInstructions ? `Additional instructions: ${customInstructions}` : ''}

Languages required: ${langs.join(', ')}

Return ONLY valid JSON (no markdown, no explanation):
{
  ${langs.map((l) => `"${l}": "..."`).join(',\n  ')}
}`;

    try {
      const { text, tokensIn, tokensOut } = await callAiStreaming(
        provider, apiKey, prompt, null,
        abortRef.current.signal,
        () => {},
        modelId,
      );

      const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      let parsed: Record<string, string> = {};
      try { parsed = JSON.parse(clean); } catch { /* keep empty */ }

      const newIntroText = { ...(b.introText ?? {}) };
      for (const l of langs) {
        if (parsed[l]) newIntroText[l] = parsed[l];
      }
      updateBranding({ introText: newIntroText });

      const costUsd = computeAiCost(modelId, tokensIn, tokensOut);
      recordAiUsage({
        provider: provider === 'gpt' ? 'openai' : 'anthropic',
        modelId,
        inputTokens: tokensIn,
        outputTokens: tokensOut,
        costUsd,
        operation: 'other',
      });

      setGenState('idle');
    } catch (err) {
      if ((err as Error).name === 'AbortError') { setGenState('idle'); return; }
      setGenError((err as Error).message || 'Generation failed');
      setGenState('error');
    }
  }

  function patchTheme(patch: Partial<TourTheme>) {
    updateBranding({ tourTheme: { ...theme, ...patch } });
  }

  return (
    <ScreenShell title="Branding" subtitle="Logo, colors, typography, and opening scene for the compiled tour.">
      <div className="grid grid-cols-2 gap-10 max-w-5xl">

        {/* ── LEFT: Assets + Scene + Intro ──────────────────────────── */}
        <div className="space-y-6">
          <ColTitle>Assets</ColTitle>

          <FileField
            label="Logo"
            hint="Displayed in the viewer header. PNG or SVG, transparent background recommended."
            value={b.logoPath}
            accept=".png,.jpg,.jpeg,.svg,.webp"
            onPick={(p) => updateBranding({ logoPath: p })}
            onClear={() => updateBranding({ logoPath: undefined })}
          />
          <FileField
            label="Favicon"
            hint="Browser tab icon. 32×32 or 64×64 PNG recommended."
            value={b.faviconPath}
            accept=".png,.ico"
            onPick={(p) => updateBranding({ faviconPath: p })}
            onClear={() => updateBranding({ faviconPath: undefined })}
          />
          <FileField
            label="Loading screen"
            hint="Shown while the panorama loads. PNG or JPG."
            value={b.loaderPath}
            accept=".png,.jpg,.jpeg,.webp"
            onPick={(p) => updateBranding({ loaderPath: p })}
            onClear={() => updateBranding({ loaderPath: undefined })}
          />

          {b.logoPath && (
            <div className="p-4 bg-zinc-900 rounded-lg flex items-center justify-center">
              <img src={toLocalUrl(b.logoPath)} alt="Logo preview" className="max-h-14 max-w-full object-contain" onError={(e) => { e.currentTarget.style.opacity = '0.3'; }} />
            </div>
          )}

          <div className="border-t border-line pt-6 space-y-3">
            <ColTitle>Opening scene</ColTitle>
            <div className="space-y-1">
              <FieldLabel>Scene shown on first load</FieldLabel>
              <select className={inputCls} value={b.startSceneId ?? ''} onChange={(e) => updateBranding({ startSceneId: e.target.value || undefined })}>
                <option value="">(first scene in list)</option>
                {project.scenes.map((s) => (
                  <option key={s.id} value={s.id}>{s.title[defaultLang] || s.title.en || s.slug}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="border-t border-line pt-6 space-y-3">
            <div className="flex items-center justify-between">
              <ColTitle>Loading screen text</ColTitle>
              <button
                onClick={genState === 'generating' ? () => abortRef.current?.abort() : handleGenerateIntro}
                disabled={false}
                className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border transition-colors ${
                  genState === 'generating'
                    ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                    : 'border-line-soft bg-paper-tinted text-ink-soft hover:bg-paper-strong hover:text-ink'
                }`}
                title="Generate a tagline or welcome message with AI"
              >
                {genState === 'generating'
                  ? <><Loader2 size={11} className="animate-spin" /> Stop</>
                  : <><Sparkles size={11} /> Generate</>}
              </button>
            </div>
            <p className="text-xs text-ink-faded">Displayed on the splash screen while the tour loads. Project title always appears; add a tagline or welcome message below.</p>
            {genState === 'error' && (
              <p className="text-[11px] text-red-500">{genError}</p>
            )}
            {langs.length > 1 && (
              <div className="flex gap-1.5">
                {langs.map((l) => (
                  <button key={l} onClick={() => setIntroLang(l)} className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${introLang === l ? 'bg-ink text-paper' : 'bg-paper-tinted text-ink-soft hover:bg-paper-strong'}`}>
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
            <textarea
              rows={3}
              className={inputCls + ' resize-none'}
              value={b.introText?.[introLang] ?? ''}
              placeholder="Welcome to our virtual tour…"
              onChange={(e) => updateBranding({ introText: { ...(b.introText ?? {}), [introLang]: e.target.value } })}
            />

            {/* Text size */}
            <div className="space-y-1 pt-1">
              <FieldLabel>Text size</FieldLabel>
              <div className="flex items-center gap-3">
                <input type="range" min={12} max={36} step={1} value={theme.introFontSize ?? 18}
                  onChange={(e) => patchTheme({ introFontSize: Number(e.target.value) })}
                  className="flex-1 accent-accent h-1.5" />
                <span className="text-sm font-mono text-ink w-10 text-right flex-shrink-0">{theme.introFontSize ?? 18}px</span>
              </div>
              <div className="flex justify-between text-[10px] text-ink-faded"><span>12px</span><span>18px</span><span>36px</span></div>
            </div>

            {/* Entrance animation */}
            <div className="space-y-2 pt-1">
              <FieldLabel>Entrance animation</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: 'fade',  label: 'Fade',     desc: 'Simple fade in' },
                  { id: 'slide', label: 'Slide up',  desc: 'Rise from below' },
                  { id: 'zoom',  label: 'Zoom in',   desc: 'Scale from center' },
                ] as { id: TourTheme['introAnimation']; label: string; desc: string }[]).map(({ id, label, desc }) => {
                  const active = (theme.introAnimation ?? 'fade') === id;
                  return (
                    <button key={id} onClick={() => patchTheme({ introAnimation: id })}
                      className={`py-2 px-2 rounded-lg border text-center transition-colors ${active ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-line-soft bg-paper-tinted hover:border-line-strong'}`}>
                      <p className={`text-xs font-semibold ${active ? 'text-accent' : 'text-ink'}`}>{label}</p>
                      <p className="text-[10px] text-ink-faded mt-0.5">{desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Colors + Hotspots + UI Theme ───────────────────── */}
        <div className="space-y-6">
          <ColTitle>Colors</ColTitle>

          <div className="grid grid-cols-2 gap-4">
            <ColorField label="Primary color" value={b.primaryColor} onChange={(v) => updateBranding({ primaryColor: v })} placeholder="#185FA5" />
            <ColorField label="Accent color"  value={b.accentColor}  onChange={(v) => updateBranding({ accentColor: v })}  placeholder="#1D9E75" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1 h-7 rounded-lg shadow-sm" style={{ backgroundColor: b.primaryColor }} title="Primary" />
            <div className="flex-1 h-7 rounded-lg shadow-sm" style={{ backgroundColor: b.accentColor }}  title="Accent" />
          </div>

          <div className="border-t border-line pt-6 space-y-4">
            <ColTitle>Hotspots</ColTitle>

            <div className="space-y-1">
              <FieldLabel>Pin size</FieldLabel>
              <div className="flex items-center gap-4">
                <input type="range" min={16} max={80} step={2} value={b.hotspotSizePx ?? 32} onChange={(e) => updateBranding({ hotspotSizePx: Number(e.target.value) })} className="flex-1 accent-accent h-1.5" />
                <span className="text-sm font-mono text-ink w-12 text-right flex-shrink-0">{b.hotspotSizePx ?? 32} px</span>
              </div>
              <div className="flex justify-between text-[10px] text-ink-faded">
                <span>16 px</span><span>32 px</span><span>80 px</span>
              </div>
            </div>

            <div className="space-y-2">
              <FieldLabel>Preview style</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: 'card',    label: 'Card',    preview: <div className="w-12 rounded-md overflow-hidden shadow bg-zinc-800"><div className="h-7 bg-zinc-600"/><div className="px-1 py-1"><div className="h-1 rounded bg-zinc-500 w-8"/></div></div> },
                  { id: 'compact', label: 'Compact', preview: <div className="flex items-center justify-center h-8"><div className="rounded-full bg-zinc-800 shadow px-2 py-1"><div className="h-1 rounded bg-zinc-500 w-10"/></div></div> },
                  { id: 'overlay', label: 'Overlay', preview: <div className="w-12 rounded-md overflow-hidden shadow relative"><div className="h-9 bg-zinc-600"/><div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-gradient-to-t from-zinc-900/90 to-transparent"><div className="h-1 rounded bg-zinc-300/70 w-8"/></div></div> },
                ] as { id: 'card' | 'compact' | 'overlay'; label: string; preview: React.ReactNode }[]).map(({ id, label, preview }) => {
                  const active = (b.hotspotPreviewStyle ?? 'card') === id;
                  return (
                    <button key={id} onClick={() => updateBranding({ hotspotPreviewStyle: id })} className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors ${active ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-line-soft bg-paper-tinted hover:border-line-strong'}`}>
                      {preview}
                      <p className={`text-[10px] font-medium ${active ? 'text-accent' : 'text-ink'}`}>{label}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Tour UI Theme */}
          <div className="border-t border-line pt-6 space-y-5">
            <ColTitle>Tour UI appearance</ColTitle>

            {/* Font family */}
            <div className="space-y-2">
              <FieldLabel>Font family</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                {FONT_OPTIONS.map(({ id, label, sample }) => {
                  const active = (theme.fontFamily ?? 'system') === id;
                  return (
                    <button key={id} onClick={() => patchTheme({ fontFamily: id })} className={`py-2 px-1 rounded-lg border text-center transition-colors ${active ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-line-soft bg-paper-tinted hover:border-line-strong'}`}>
                      <span className="block text-sm" style={{ fontFamily: sample }}>Aa</span>
                      <span className={`text-[10px] font-medium ${active ? 'text-accent' : 'text-ink-soft'}`}>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Border radius */}
            <div className="space-y-2">
              <FieldLabel>Corner style</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                {RADIUS_OPTIONS.map(({ id, label, css }) => {
                  const active = (theme.radius ?? 'soft') === id;
                  return (
                    <button key={id} onClick={() => patchTheme({ radius: id })} className={`py-2 flex flex-col items-center gap-1.5 rounded-lg border transition-colors ${active ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-line-soft bg-paper-tinted hover:border-line-strong'}`}>
                      <div className="w-8 h-5 bg-ink-faded/20" style={{ borderRadius: css }} />
                      <span className={`text-[10px] font-medium ${active ? 'text-accent' : 'text-ink-soft'}`}>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom colors */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <FieldLabel>Header background</FieldLabel>
                <div className="flex items-center gap-2">
                  <input type="color" value={theme.headerBg || '#ffffff'} onChange={(e) => patchTheme({ headerBg: e.target.value })} className="w-8 h-8 rounded border border-line-soft bg-transparent p-0.5 cursor-pointer flex-shrink-0" />
                  <input className={inputCls} value={theme.headerBg || ''} onChange={(e) => patchTheme({ headerBg: e.target.value || undefined })} placeholder="#ffffff (default)" />
                </div>
              </div>
              <div className="space-y-1">
                <FieldLabel>Panel background</FieldLabel>
                <div className="flex items-center gap-2">
                  <input type="color" value={theme.panelBg || '#ffffff'} onChange={(e) => patchTheme({ panelBg: e.target.value })} className="w-8 h-8 rounded border border-line-soft bg-transparent p-0.5 cursor-pointer flex-shrink-0" />
                  <input className={inputCls} value={theme.panelBg || ''} onChange={(e) => patchTheme({ panelBg: e.target.value || undefined })} placeholder="#ffffff (default)" />
                </div>
              </div>
              <div className="space-y-1">
                <FieldLabel>Text color</FieldLabel>
                <div className="flex items-center gap-2">
                  <input type="color" value={theme.textColor || '#111111'} onChange={(e) => patchTheme({ textColor: e.target.value })} className="w-8 h-8 rounded border border-line-soft bg-transparent p-0.5 cursor-pointer flex-shrink-0" />
                  <input className={inputCls} value={theme.textColor || ''} onChange={(e) => patchTheme({ textColor: e.target.value || undefined })} placeholder="#111111 (default)" />
                </div>
              </div>
              <div className="space-y-1">
                <FieldLabel>Font size (body)</FieldLabel>
                <div className="flex items-center gap-2">
                  <input type="range" min={12} max={20} step={1} value={theme.fontSize ?? 15} onChange={(e) => patchTheme({ fontSize: Number(e.target.value) })} className="flex-1 accent-accent h-1.5" />
                  <span className="text-sm font-mono text-ink w-10 text-right flex-shrink-0">{theme.fontSize ?? 15}px</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </ScreenShell>
  );
}
