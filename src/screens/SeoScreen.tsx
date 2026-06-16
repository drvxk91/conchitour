import { useState } from 'react';
import { Tag, X } from 'lucide-react';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';

const inputCls =
  'w-full bg-paper-strong border border-line-soft rounded px-3 py-1.5 text-sm text-ink placeholder-ink-faded focus:outline-none focus:border-accent';

const SCHEMA_TYPES = [
  { value: 'TouristAttraction', label: 'Tourist Attraction' },
  { value: 'Hotel',             label: 'Hotel' },
  { value: 'Museum',            label: 'Museum' },
  { value: 'Place',             label: 'Place' },
] as const;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-ink-strong mt-8 mb-4 border-b border-line pb-2">{children}</h2>;
}

export function SeoScreen() {
  const { project, updateSeo, updateScene } = useProject();
  const s = project.seo;
  const langs = project.languages.available.length ? project.languages.available : ['en'];
  const defaultLang = project.languages.default || 'en';

  // Local keyword state for the tag editor
  const [kwInput, setKwInput] = useState('');

  function addKeyword(kw: string) {
    const trimmed = kw.trim().toLowerCase();
    if (!trimmed || s.keywords.includes(trimmed)) return;
    updateSeo({ keywords: [...s.keywords, trimmed] });
    setKwInput('');
  }

  function removeKeyword(kw: string) {
    updateSeo({ keywords: s.keywords.filter((k) => k !== kw) });
  }

  function handleKwKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addKeyword(kwInput);
    }
  }

  return (
    <ScreenShell title="SEO" subtitle="Meta tags, Schema.org markup, and per-scene alt text for image search.">
      <div className="max-w-2xl">

        {/* ── Global SEO ─────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-faded uppercase tracking-wide">Meta title</label>
            <input
              className={inputCls}
              defaultValue={s.metaTitle}
              placeholder="My hotel virtual tour — Acme Photography"
              onBlur={(e) => updateSeo({ metaTitle: e.target.value })}
            />
            <p className="text-[11px] text-ink-faded/70">Shown in search results. Aim for 50–60 characters.</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-faded uppercase tracking-wide">Meta description</label>
            <textarea
              rows={3}
              className={inputCls + ' resize-none'}
              defaultValue={s.metaDescription}
              placeholder="Explore every corner of our 5-star hotel in stunning 360°…"
              onBlur={(e) => updateSeo({ metaDescription: e.target.value })}
            />
            <p className="text-[11px] text-ink-faded/70">Shown below the title in search results. Aim for 120–160 characters.</p>
          </div>

          {/* Keywords tag input */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-faded uppercase tracking-wide">Keywords</label>
            <div className="flex flex-wrap gap-1.5 p-2 bg-paper-strong border border-line-soft rounded min-h-[38px]">
              {s.keywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 bg-ink/10 text-ink text-xs px-2 py-0.5 rounded-full"
                >
                  <Tag size={9} />
                  {kw}
                  <button onClick={() => removeKeyword(kw)} className="text-ink-faded hover:text-red-500 ml-0.5">
                    <X size={10} />
                  </button>
                </span>
              ))}
              <input
                className="flex-1 min-w-[120px] bg-transparent text-sm text-ink placeholder-ink-faded focus:outline-none"
                placeholder="Add keyword, press Enter…"
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={handleKwKey}
                onBlur={() => { if (kwInput.trim()) addKeyword(kwInput); }}
              />
            </div>
          </div>

          {/* Schema type */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-faded uppercase tracking-wide">Schema.org type</label>
            <select
              className={inputCls}
              value={s.schemaType}
              onChange={(e) => updateSeo({ schemaType: e.target.value as typeof s.schemaType })}
            >
              {SCHEMA_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-ink-faded/70">Used in the JSON-LD structured data block in the output HTML.</p>
          </div>

          {/* Image sitemap toggle */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={s.imageSitemap}
              onChange={(e) => updateSeo({ imageSitemap: e.target.checked })}
              className="w-4 h-4 accent-accent"
            />
            <span className="text-sm text-ink">Generate image sitemap (<code className="text-[11px]">sitemap-images.xml</code>)</span>
          </label>
        </div>

        {/* ── Per-scene alt text ──────────────────────────────── */}
        {project.scenes.length > 0 && (
          <>
            <SectionTitle>Per-scene alt text</SectionTitle>
            <p className="text-xs text-ink-faded mb-3">
              Alt text describes each panorama for screen readers and image search.
            </p>

            {langs.length > 1 && (
              <p className="text-[11px] text-ink-faded mb-2">
                Languages: {langs.map((l) => l.toUpperCase()).join(' · ')}
              </p>
            )}

            <div className="space-y-3">
              {project.scenes.map((scene) => (
                <div key={scene.id} className="bg-paper-strong border border-line-soft rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium text-ink-strong truncate">
                    {scene.title[defaultLang] || scene.title.en || scene.slug}
                    <span className="text-ink-faded font-mono font-normal ml-2">{scene.slug}</span>
                  </p>
                  {langs.map((lang) => (
                    <div key={lang} className="flex items-center gap-2">
                      <span className="text-[10px] text-ink-faded w-6 flex-shrink-0 uppercase">{lang}</span>
                      <input
                        className="flex-1 bg-paper border border-line-soft rounded px-2 py-1 text-xs text-ink placeholder-ink-faded focus:outline-none focus:border-accent"
                        defaultValue={scene.altText?.[lang] ?? ''}
                        placeholder="Describe what the panorama shows…"
                        onBlur={(e) =>
                          updateScene(scene.id, {
                            altText: { ...(scene.altText ?? {}), [lang]: e.target.value },
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </ScreenShell>
  );
}
