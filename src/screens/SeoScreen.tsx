import { useState, useRef, useMemo, useEffect } from 'react';
import { Tag, X, Sparkles, Loader2, CheckCircle, Undo2, Redo2, ChevronDown, ChevronRight, Globe } from 'lucide-react';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { generateSeoWithAi } from '@/lib/ai-seo';
import { resolveAiProvider } from '@/lib/ai-resolve';
import { runSeoAudit, type SeoCheck, type SeoCheckStatus } from '@/lib/seo-audit';

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

// ── SEO Audit Panel ───────────────────────────────────────────────────────────

const STATUS_DOT: Record<SeoCheckStatus, string> = {
  good:        'bg-green-500',
  improvement: 'bg-amber-400',
  problem:     'bg-red-500',
};

const GRADE_CONFIG = {
  good: { color: 'text-green-600', bg: 'bg-green-50 border-green-200', label: 'Good' },
  ok:   { color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', label: 'Needs work' },
  poor: { color: 'text-red-600',   bg: 'bg-red-50 border-red-200',     label: 'Poor' },
};

function CheckItem({ check }: { check: SeoCheck }) {
  return (
    <li className="flex items-start gap-2 py-1">
      <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[check.status]}`} />
      <span className="text-xs text-ink">
        <span className="font-medium">{check.label}</span>
        {' — '}
        <span className="text-ink-soft">{check.detail}</span>
      </span>
    </li>
  );
}

function SeoAuditPanel({ project }: { project: Parameters<typeof runSeoAudit>[0] }) {
  const [open, setOpen] = useState(true);
  const audit = useMemo(() => runSeoAudit(project), [project]);
  const g = GRADE_CONFIG[audit.grade];

  const problems     = audit.checks.filter((c) => c.status === 'problem');
  const improvements = audit.checks.filter((c) => c.status === 'improvement');
  const good         = audit.checks.filter((c) => c.status === 'good');

  return (
    <div className={`rounded-xl border ${g.bg} mb-6 overflow-hidden`}>
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {/* Score badge */}
        <div className={`flex flex-col items-center w-14 flex-shrink-0`}>
          <span className={`text-2xl font-bold leading-none ${g.color}`}>{audit.score}</span>
          <span className="text-[9px] text-ink-faded uppercase tracking-wider mt-0.5">/ 100</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${g.color}`}>SEO Score — {g.label}</p>
          <p className="text-[11px] text-ink-faded mt-0.5">
            {problems.length > 0 && <span className="text-red-600">{problems.length} problem{problems.length > 1 ? 's' : ''}</span>}
            {problems.length > 0 && improvements.length > 0 && <span className="text-ink-faded"> · </span>}
            {improvements.length > 0 && <span className="text-amber-600">{improvements.length} improvement{improvements.length > 1 ? 's' : ''}</span>}
            {(problems.length > 0 || improvements.length > 0) && good.length > 0 && <span className="text-ink-faded"> · </span>}
            {good.length > 0 && <span className="text-green-600">{good.length} good</span>}
          </p>
        </div>
        {open ? <ChevronDown size={14} className="text-ink-faded flex-shrink-0" /> : <ChevronRight size={14} className="text-ink-faded flex-shrink-0" />}
      </button>

      {/* Body */}
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-current/10">
          {problems.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-red-600 mt-3 mb-1">Problems</p>
              <ul className="space-y-0.5">
                {problems.map((ch) => <CheckItem key={ch.id} check={ch} />)}
              </ul>
            </div>
          )}
          {improvements.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-600 mt-3 mb-1">Improvements</p>
              <ul className="space-y-0.5">
                {improvements.map((ch) => <CheckItem key={ch.id} check={ch} />)}
              </ul>
            </div>
          )}
          {good.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-green-600 mt-3 mb-1">Good results</p>
              <ul className="space-y-0.5">
                {good.map((ch) => <CheckItem key={ch.id} check={ch} />)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Google SERP Preview ───────────────────────────────────────────────────────

function SerpPreview({ title, description, breadcrumb, favicon }: {
  title: string;
  description: string;
  breadcrumb: string;
  favicon: string;
}) {
  const TITLE_MAX = 60;
  const DESC_MAX = 160;
  const titleOver = title.length > TITLE_MAX;

  return (
    <div className="rounded-xl border border-[#dadce0] bg-white px-4 py-3 font-[Arial,Helvetica,sans-serif] text-[#202124] shadow-sm">
      {/* Site line */}
      <div className="flex items-center gap-2 mb-0.5">
        <div className="w-[18px] h-[18px] rounded-sm bg-gray-200 flex items-center justify-center text-[9px] font-bold text-gray-500 flex-shrink-0 uppercase">
          {favicon}
        </div>
        <div className="min-w-0">
          <p className="text-[14px] leading-[20px] text-[#202124] truncate">
            {breadcrumb || <span className="text-gray-400">yoursite.com</span>}
          </p>
          <p className="text-[12px] leading-[14px] text-[#4d5156] truncate">{breadcrumb || 'yoursite.com › virtual-tour'}</p>
        </div>
      </div>
      {/* Title */}
      <p className={`text-[20px] leading-[26px] mt-0.5 truncate cursor-default hover:underline ${
        title ? (titleOver ? 'text-amber-600' : 'text-[#1a0dab]') : 'text-gray-300 italic'
      }`}>
        {title || 'Meta title will appear here…'}
        {titleOver && <span className="ml-1 text-[11px] text-amber-500">({title.length} chars — may be cut)</span>}
      </p>
      {/* Description */}
      <p className="text-[14px] leading-[22px] text-[#4d5156] mt-0.5">
        {description
          ? description.slice(0, DESC_MAX) + (description.length > DESC_MAX ? '…' : '')
          : <span className="italic text-gray-300">Meta description will appear here…</span>}
      </p>
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export function SeoScreen() {
  const { project, updateSeo, updateScene } = useProject();
  const s = project.seo;
  const langs = project.languages.available.length ? project.languages.available : ['en'];
  const defaultLang = project.languages.default || 'en';

  const [kwInput, setKwInput] = useState('');

  // ── SERP preview live state ────────────────────────────────────────────────
  const [previewTitle, setPreviewTitle] = useState(s.metaTitle ?? '');
  const [previewDesc, setPreviewDesc]   = useState(s.metaDescription ?? '');
  const [serpMode, setSerpMode]         = useState<'tour' | 'scene'>('tour');
  const [serpSceneIdx, setSerpSceneIdx] = useState(0);
  // Sync when AI generates or undo/redo updates the store
  useEffect(() => { setPreviewTitle(s.metaTitle ?? ''); }, [s.metaTitle]);
  useEffect(() => { setPreviewDesc(s.metaDescription ?? ''); }, [s.metaDescription]);

  const publicationBase = project.meta.publicationUrl?.replace(/\/+$/, '') || 'yoursite.com';
  const siteLabel = publicationBase.replace(/^https?:\/\//, '');
  const faviconLetter = (project.meta.name || siteLabel).charAt(0).toUpperCase();

  const serpScene = project.scenes[Math.min(serpSceneIdx, project.scenes.length - 1)];
  const serpSceneTitle  = serpScene ? (serpScene.title?.[defaultLang] || serpScene.slug) : '';
  const serpSceneDesc   = serpScene ? (serpScene.description?.[defaultLang] || '') : '';
  const serpSceneUrl    = serpScene ? `${siteLabel} › scene › ${serpScene.slug}` : siteLabel;

  // ── AI SEO generation ──────────────────────────────────────────────────────
  const [aiState, setAiState] = useState<'idle' | 'running' | 'done'>('idle');
  const [aiError, setAiError] = useState('');
  const [fillMode, setFillMode] = useState<'all' | 'empty'>('empty');
  const [genAltTexts, setGenAltTexts] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<typeof s | null>(null);
  const [redoSnapshot, setRedoSnapshot] = useState<typeof s | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  function handleUndo() {
    if (!undoSnapshot) return;
    setRedoSnapshot({ ...s });
    updateSeo(undoSnapshot);
    setUndoSnapshot(null);
  }

  function handleRedo() {
    if (!redoSnapshot) return;
    setUndoSnapshot({ ...s });
    updateSeo(redoSnapshot);
    setRedoSnapshot(null);
  }

  async function handleGenerateSeo() {
    const resolved = resolveAiProvider(project.modules);
    if (!resolved) {
      setAiError('No API key configured — set your key in the AI screen first.');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setAiState('running');
    setAiError('');
    setUndoSnapshot(null);
    setRedoSnapshot(null);

    try {
      const result = await generateSeoWithAi(
        project, resolved.provider, resolved.apiKey,
        defaultLang, langs,
        fillMode, genAltTexts,
        () => {},
        controller.signal,
      );

      setUndoSnapshot({ ...s });

      updateSeo({
        metaTitle: result.metaTitle,
        metaDescription: result.metaDescription,
        keywords: result.keywords,
        schemaType: result.schemaType,
      });

      // Apply alt texts for all languages
      if (result.altTexts) {
        for (const scene of project.scenes) {
          const newAlt = { ...(scene.altText ?? {}) };
          let changed = false;
          for (const lang of langs) {
            const alt = result.altTexts[lang]?.[scene.slug];
            if (alt) { newAlt[lang] = alt; changed = true; }
          }
          if (changed) updateScene(scene.id, { altText: newAlt });
        }
      }

      setAiState('done');
      setTimeout(() => setAiState('idle'), 4000);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setAiError(String(err));
      }
      setAiState('idle');
    }
  }

  return (
    <ScreenShell title="SEO" subtitle="Meta tags, Schema.org markup, and per-scene alt text for image search.">
      <div className="max-w-2xl">

        {/* ── AI generate banner ──────────────────────────────────── */}
        <div className="mb-6 p-4 rounded-xl border border-line-soft bg-paper-tinted space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink">Generate SEO with AI</p>
              <p className="text-xs text-ink-faded mt-0.5">
                Fills meta title, description, keywords and schema type in{' '}
                <span className="font-medium text-ink">{defaultLang.toUpperCase()}</span>
                {langs.length > 1 && (
                  <>, alt texts in all languages ({langs.map((l) => l.toUpperCase()).join(', ')})</>
                )}.
              </p>
              {aiError && <p className="text-[11px] text-red-500 mt-1">{aiError}</p>}
              {aiState === 'done' && (
                <p className="text-[11px] text-green-600 mt-1 flex items-center gap-1">
                  <CheckCircle size={10} /> SEO generated successfully.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {undoSnapshot && (
                <button onClick={handleUndo} className="btn text-xs gap-1.5 text-amber-600 border-amber-200 hover:bg-amber-50">
                  <Undo2 size={12} /> Undo
                </button>
              )}
              {redoSnapshot && (
                <button onClick={handleRedo} className="btn text-xs gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50">
                  <Redo2 size={12} /> Redo
                </button>
              )}
              {aiState === 'running' ? (
                <button onClick={() => abortRef.current?.abort()} className="btn text-xs gap-1.5 shrink-0">
                  <Loader2 size={12} className="animate-spin" /> Cancel
                </button>
              ) : (
                <button onClick={handleGenerateSeo} className="btn btn-accent text-xs gap-1.5 shrink-0">
                  <Sparkles size={12} /> Generate with AI
                </button>
              )}
            </div>
          </div>

          {/* Fill mode + options */}
          <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-line-soft/60">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="radio" name="seoFillMode" value="empty"
                  checked={fillMode === 'empty'}
                  onChange={() => setFillMode('empty')}
                  className="accent-accent"
                />
                Only empty fields
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="radio" name="seoFillMode" value="all"
                  checked={fillMode === 'all'}
                  onChange={() => setFillMode('all')}
                  className="accent-accent"
                />
                Regenerate all
              </label>
            </div>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={genAltTexts}
                onChange={(e) => setGenAltTexts(e.target.checked)}
                className="w-3.5 h-3.5 accent-accent"
              />
              Also generate alt texts for all scenes
              {langs.length > 1 && (
                <span className="text-ink-faded ml-1">({langs.map((l) => l.toUpperCase()).join(' + ')})</span>
              )}
            </label>
          </div>
        </div>

        {/* ── SEO Audit ──────────────────────────────────────────── */}
        <SeoAuditPanel project={project} />

        {/* ── Global SEO ─────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-faded uppercase tracking-wide">Meta title</label>
            <input
              className={inputCls}
              value={previewTitle}
              placeholder="My hotel virtual tour — Acme Photography"
              onChange={(e) => setPreviewTitle(e.target.value)}
              onBlur={(e) => updateSeo({ metaTitle: e.target.value })}
            />
            <p className={`text-[11px] ${previewTitle.length > 60 ? 'text-amber-500' : 'text-ink-faded/70'}`}>
              Shown in search results. Aim for 50–60 characters ({previewTitle.length}/60).
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-faded uppercase tracking-wide">Meta description</label>
            <textarea
              rows={3}
              className={inputCls + ' resize-none'}
              value={previewDesc}
              placeholder="Explore every corner of our 5-star hotel in stunning 360°…"
              onChange={(e) => setPreviewDesc(e.target.value)}
              onBlur={(e) => updateSeo({ metaDescription: e.target.value })}
            />
            <p className={`text-[11px] ${previewDesc.length > 160 ? 'text-amber-500' : 'text-ink-faded/70'}`}>
              Shown below the title in search results. Aim for 120–160 characters ({previewDesc.length}/160).
            </p>
          </div>

          {/* ── Google SERP preview ─────────────────────────────────── */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] text-ink-faded uppercase tracking-widest font-semibold">
                <Globe size={11} /> Google preview
              </div>
              {project.scenes.length > 0 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setSerpMode('tour')}
                    className={`text-[11px] px-2 py-0.5 rounded transition-colors ${serpMode === 'tour' ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink'}`}
                  >
                    Tour page
                  </button>
                  <button
                    onClick={() => setSerpMode('scene')}
                    className={`text-[11px] px-2 py-0.5 rounded transition-colors ${serpMode === 'scene' ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink'}`}
                  >
                    Scene page
                  </button>
                </div>
              )}
            </div>
            {serpMode === 'scene' && project.scenes.length > 0 && (
              <select
                className="w-full bg-paper-strong border border-line-soft rounded px-2 py-1 text-xs text-ink focus:outline-none focus:border-accent"
                value={serpSceneIdx}
                onChange={(e) => setSerpSceneIdx(Number(e.target.value))}
              >
                {project.scenes.map((sc, i) => (
                  <option key={sc.id} value={i}>{sc.title?.[defaultLang] || sc.slug}</option>
                ))}
              </select>
            )}
            {serpMode === 'tour' ? (
              <SerpPreview
                title={previewTitle}
                description={previewDesc}
                breadcrumb={siteLabel}
                favicon={faviconLetter}
              />
            ) : (
              <SerpPreview
                title={serpSceneTitle ? `${serpSceneTitle} — ${project.meta.name || siteLabel}` : ''}
                description={serpSceneDesc}
                breadcrumb={serpSceneUrl}
                favicon={faviconLetter}
              />
            )}
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
            <p className="text-[11px] text-ink-faded/70">First keyword is used as the focus keyword in the SEO analysis above.</p>
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
              {langs.length > 1 && <> Fill in all languages for full coverage.</>}
            </p>

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
