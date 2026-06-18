import { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { toLocalUrl } from '@/lib/local-url';

const inputCls =
  'w-full bg-paper-strong border border-line-soft rounded px-3 py-1.5 text-sm text-ink placeholder-ink-faded focus:outline-none focus:border-accent';

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-ink-strong mt-8 mb-4 border-b border-line pb-2">{children}</h2>;
}

function FileField({
  label,
  hint,
  value,
  accept,
  onPick,
  onClear,
}: {
  label: string;
  hint?: string;
  value?: string;
  accept: string;
  onPick: (path: string) => void;
  onClear: () => void;
}) {
  async function handleDrop(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const path = window.conchitect.getPathForFile(file);
    onPick(path);
  }

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-ink-faded uppercase tracking-wide">{label}</label>
      {value ? (
        <div className="flex items-center gap-2 bg-paper-strong border border-line-soft rounded px-3 py-2">
          <span className="flex-1 text-xs text-ink font-mono truncate">{value}</span>
          <button onClick={onClear} className="text-ink-faded hover:text-red-500 flex-shrink-0" title="Remove">
            <X size={13} />
          </button>
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

export function BrandingScreen() {
  const { project, updateBranding } = useProject();
  const b = project.branding;
  const langs = project.languages.available.length ? project.languages.available : ['en'];
  const defaultLang = project.languages.default || 'en';
  const [introLang, setIntroLang] = useState(defaultLang);

  return (
    <ScreenShell title="Branding" subtitle="Logo, loader, opening scene, colors, and welcome message.">
      <div className="max-w-xl">

        {/* ── Files ─── */}
        <div className="space-y-4">
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
        </div>

        {/* ── Opening scene ─── */}
        <SectionTitle>Opening scene</SectionTitle>
        <div className="space-y-1">
          <label className="text-xs font-medium text-ink-faded uppercase tracking-wide">
            Scene shown on first load
          </label>
          <select
            className={inputCls}
            value={b.startSceneId ?? ''}
            onChange={(e) => updateBranding({ startSceneId: e.target.value || undefined })}
          >
            <option value="">(first scene in list)</option>
            {project.scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title[defaultLang] || s.title.en || s.slug}
              </option>
            ))}
          </select>
        </div>

        {/* ── Colors ─── */}
        <SectionTitle>Colors</SectionTitle>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-faded uppercase tracking-wide">Primary color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={b.primaryColor}
                onChange={(e) => updateBranding({ primaryColor: e.target.value })}
                className="w-10 h-8 rounded border border-line-soft bg-transparent p-0.5 cursor-pointer"
              />
              <input
                className={inputCls}
                value={b.primaryColor}
                onChange={(e) => updateBranding({ primaryColor: e.target.value })}
                placeholder="#185FA5"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-faded uppercase tracking-wide">Accent color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={b.accentColor}
                onChange={(e) => updateBranding({ accentColor: e.target.value })}
                className="w-10 h-8 rounded border border-line-soft bg-transparent p-0.5 cursor-pointer"
              />
              <input
                className={inputCls}
                value={b.accentColor}
                onChange={(e) => updateBranding({ accentColor: e.target.value })}
                placeholder="#1D9E75"
              />
            </div>
          </div>
        </div>

        {/* Color preview swatch */}
        <div className="flex gap-3 mt-3">
          <div
            className="flex-1 h-8 rounded-lg shadow-sm"
            style={{ backgroundColor: b.primaryColor }}
            title="Primary"
          />
          <div
            className="flex-1 h-8 rounded-lg shadow-sm"
            style={{ backgroundColor: b.accentColor }}
            title="Accent"
          />
        </div>

        {/* ── Hotspot size ─── */}
        <SectionTitle>Hotspot size</SectionTitle>
        <p className="text-xs text-ink-faded mb-3">
          Size of navigation pins displayed in the compiled tour.
        </p>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={16}
            max={80}
            step={2}
            value={b.hotspotSizePx ?? 32}
            onChange={(e) => updateBranding({ hotspotSizePx: Number(e.target.value) })}
            className="flex-1 accent-accent h-1.5"
          />
          <span className="text-sm font-mono text-ink w-12 text-right flex-shrink-0">
            {b.hotspotSizePx ?? 32} px
          </span>
        </div>
        <div className="flex justify-between text-[10px] text-ink-faded mt-1">
          <span>Small (16 px)</span>
          <span>Default (32 px)</span>
          <span>Large (80 px)</span>
        </div>

        {/* ── Hotspot preview style ─── */}
        <SectionTitle>Hotspot preview style</SectionTitle>
        <p className="text-xs text-ink-faded mb-3">
          Design of the card shown when hovering a navigation hotspot in the compiled tour.
        </p>
        <div className="grid grid-cols-3 gap-3">
          {([
            {
              id: 'card',
              label: 'Card',
              hint: 'Image + title',
              preview: (
                <div className="w-14 rounded-lg overflow-hidden shadow-md bg-zinc-800">
                  <div className="h-8 bg-zinc-600"/>
                  <div className="px-1.5 py-1 space-y-0.5">
                    <div className="h-1.5 rounded bg-zinc-500 w-10"/>
                  </div>
                </div>
              ),
            },
            {
              id: 'compact',
              label: 'Compact',
              hint: 'Title only',
              preview: (
                <div className="flex items-center justify-center h-10">
                  <div className="rounded-full bg-zinc-800 shadow-md px-3 py-1.5">
                    <div className="h-1.5 rounded bg-zinc-500 w-14"/>
                  </div>
                </div>
              ),
            },
            {
              id: 'overlay',
              label: 'Overlay',
              hint: 'Title on image',
              preview: (
                <div className="w-14 rounded-lg overflow-hidden shadow-md relative">
                  <div className="h-10 bg-zinc-600"/>
                  <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-gradient-to-t from-zinc-900/90 via-zinc-900/50 to-transparent">
                    <div className="h-1.5 rounded bg-zinc-300/70 w-10"/>
                  </div>
                </div>
              ),
            },
          ] as { id: 'card' | 'compact' | 'overlay'; label: string; hint: string; preview: React.ReactNode }[]).map(({ id, label, hint, preview }) => {
            const active = (b.hotspotPreviewStyle ?? 'card') === id;
            return (
              <button
                key={id}
                onClick={() => updateBranding({ hotspotPreviewStyle: id })}
                className={`flex flex-col items-center gap-2 rounded-xl border p-3 transition-colors ${
                  active
                    ? 'border-accent bg-accent/5 ring-1 ring-accent'
                    : 'border-line-soft bg-paper-tinted hover:border-line-strong'
                }`}
              >
                {preview}
                <div className="text-center">
                  <p className={`text-xs font-medium ${active ? 'text-accent' : 'text-ink'}`}>{label}</p>
                  <p className="text-[10px] text-ink-faded">{hint}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Intro text ─── */}
        <SectionTitle>Welcome / intro text</SectionTitle>
        <p className="text-xs text-ink-faded mb-3">
          Shown in the welcome overlay before the user enters the tour (optional).
        </p>
        {langs.length > 1 && (
          <div className="flex gap-1.5 mb-2">
            {langs.map((l) => (
              <button
                key={l}
                onClick={() => setIntroLang(l)}
                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                  introLang === l ? 'bg-ink text-paper' : 'bg-paper-tinted text-ink-soft hover:bg-paper-strong'
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        )}
        <textarea
          rows={4}
          className={inputCls + ' resize-none'}
          value={b.introText?.[introLang] ?? ''}
          placeholder="Welcome to our virtual tour…"
          onChange={(e) =>
            updateBranding({ introText: { ...(b.introText ?? {}), [introLang]: e.target.value } })
          }
        />

        {/* Logo preview */}
        {b.logoPath && (
          <div className="mt-4 p-4 bg-zinc-900 rounded-lg flex items-center justify-center">
            <img
              src={toLocalUrl(b.logoPath)}
              alt="Logo preview"
              className="max-h-16 max-w-full object-contain"
              onError={(e) => { e.currentTarget.style.opacity = '0.3'; }}
            />
          </div>
        )}
      </div>
    </ScreenShell>
  );
}
