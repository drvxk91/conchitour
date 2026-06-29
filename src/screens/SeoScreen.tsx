import { useState, useRef, useMemo, useEffect } from 'react';
import { Tag, X, Sparkles, Loader2, CheckCircle, Undo2, Redo2, ChevronDown, ChevronRight, Globe } from 'lucide-react';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { generateSeoWithAi } from '@/lib/ai-seo';
import { resolveAiProvider } from '@/lib/ai-resolve';
import { runSeoAudit, type SeoCheck, type SeoCheckStatus } from '@/lib/seo-audit';
import { withContextGate } from '@/lib/ai-context-gate';

const inputCls =
  'w-full bg-paper-strong border border-line-soft rounded px-3 py-1.5 text-sm text-ink placeholder-ink-faded focus:outline-none focus:border-accent';

const SCHEMA_TYPES = [
  { value: 'TouristAttraction', label: 'Tourist Attraction' },
  { value: 'Hotel',             label: 'Hotel' },
  { value: 'Museum',            label: 'Museum' },
  { value: 'Place',             label: 'Place' },
] as const;

// ── SEO Audit Panel ───────────────────────────────────────────────────────────

const STATUS_DOT: Record<SeoCheckStatus, string> = {
  good:        'bg-green-500',
  improvement: 'bg-amber-400',
  problem:     'bg-red-500',
};

const GRADE_CONFIG = {
  good: { color: 'text-green-600', bg: 'bg-green-50 border-green-200',   ring: 'text-green-600',  label: 'Good' },
  ok:   { color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200',   ring: 'text-amber-600',  label: 'Needs work' },
  poor: { color: 'text-red-600',   bg: 'bg-red-50 border-red-200',       ring: 'text-red-600',    label: 'Poor' },
};

function CheckItem({ check }: { check: SeoCheck }) {
  return (
    <li className="flex items-start gap-2 py-0.5">
      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[check.status]}`} />
      <span className="text-[11px] text-ink leading-snug">
        <span className="font-medium">{check.label}</span>
        {' — '}
        <span className="text-ink-soft">{check.detail}</span>
      </span>
    </li>
  );
}

function SeoAuditPanel({ project }: { project: Parameters<typeof runSeoAudit>[0] }) {
  const [open, setOpen] = useState(false);
  const audit = useMemo(() => runSeoAudit(project), [project]);
  const g = GRADE_CONFIG[audit.grade];

  const problems     = audit.checks.filter((c) => c.status === 'problem');
  const improvements = audit.checks.filter((c) => c.status === 'improvement');
  const good         = audit.checks.filter((c) => c.status === 'good');

  return (
    <div className={`rounded-lg border ${g.bg} overflow-hidden`}>
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-baseline gap-1 flex-shrink-0">
          <span className={`text-xl font-bold leading-none ${g.color}`}>{audit.score}</span>
          <span className="text-[9px] text-ink-faded">/100</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-semibold ${g.color}`}>SEO — {g.label}</p>
          <p className="text-[10px] text-ink-faded mt-px flex gap-1.5 flex-wrap">
            {problems.length > 0     && <span className="text-red-500">{problems.length} problem{problems.length > 1 ? 's' : ''}</span>}
            {improvements.length > 0 && <span className="text-amber-500">{improvements.length} improvement{improvements.length > 1 ? 's' : ''}</span>}
            {good.length > 0         && <span className="text-green-600">{good.length} good</span>}
          </p>
        </div>
        {open ? <ChevronDown size={12} className="text-ink-faded flex-shrink-0" /> : <ChevronRight size={12} className="text-ink-faded flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-current/10">
          {problems.length > 0 && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-red-600 mt-2 mb-1">Problems</p>
              <ul className="space-y-px">{problems.map((ch) => <CheckItem key={ch.id} check={ch} />)}</ul>
            </div>
          )}
          {improvements.length > 0 && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-amber-600 mt-2 mb-1">Improvements</p>
              <ul className="space-y-px">{improvements.map((ch) => <CheckItem key={ch.id} check={ch} />)}</ul>
            </div>
          )}
          {good.length > 0 && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-green-600 mt-2 mb-1">Good</p>
              <ul className="space-y-px">{good.map((ch) => <CheckItem key={ch.id} check={ch} />)}</ul>
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
  const DESC_MAX  = 160;
  const titleOver = title.length > TITLE_MAX;

  return (
    <div className="rounded-lg border border-[#dadce0] bg-white px-3 py-2.5 font-[Arial,Helvetica,sans-serif] text-[#202124] shadow-sm">
      <div className="flex items-center gap-1.5 mb-0.5">
        <div className="w-4 h-4 rounded-sm bg-gray-200 flex items-center justify-center text-[8px] font-bold text-gray-500 flex-shrink-0 uppercase">
          {favicon}
        </div>
        <p className="text-[12px] leading-[18px] text-[#4d5156] truncate">{breadcrumb || 'yoursite.com › virtual-tour'}</p>
      </div>
      <p className={`text-[17px] leading-[24px] truncate ${
        title ? (titleOver ? 'text-amber-600' : 'text-[#1a0dab]') : 'text-gray-300 italic text-[14px]'
      }`}>
        {title || 'Meta title will appear here…'}
        {titleOver && <span className="ml-1 text-[10px] text-amber-500">({title.length} — may be cut)</span>}
      </p>
      <p className="text-[12px] leading-[18px] text-[#4d5156] mt-0.5 line-clamp-2">
        {description
          ? description.slice(0, DESC_MAX) + (description.length > DESC_MAX ? '…' : '')
          : <span className="italic text-gray-300">Meta description…</span>}
      </p>
    </div>
  );
}

// ── Field label ───────────────────────────────────────────────────────────────

function FieldLabel({ label, hint }: { label: string; hint?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between mb-1">
      <label className="text-[10px] font-semibold text-ink-faded uppercase tracking-wider">{label}</label>
      {hint && <span className="text-[10px] text-ink-faded/70">{hint}</span>}
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export function SeoScreen() {
  const { project, updateSeo, updateScene, setActiveScreen } = useProject();
  const s = project.seo;
  const langs = project.languages.available.length ? project.languages.available : ['en'];
  const defaultLang = project.languages.default || 'en';

  const [kwInput, setKwInput] = useState('');

  const [previewTitle, setPreviewTitle] = useState(s.metaTitle ?? '');
  const [previewDesc,  setPreviewDesc]  = useState(s.metaDescription ?? '');
  const [serpMode, setSerpMode]         = useState<'tour' | 'scene'>('tour');
  const [serpSceneIdx, setSerpSceneIdx] = useState(0);
  useEffect(() => { setPreviewTitle(s.metaTitle ?? ''); },       [s.metaTitle]);
  useEffect(() => { setPreviewDesc(s.metaDescription ?? ''); },  [s.metaDescription]);

  const publicationBase = project.meta.publicationUrl?.replace(/\/+$/, '') || 'yoursite.com';
  const siteLabel       = publicationBase.replace(/^https?:\/\//, '');
  const faviconLetter   = (project.meta.name || siteLabel).charAt(0).toUpperCase();

  const serpScene      = project.scenes[Math.min(serpSceneIdx, project.scenes.length - 1)];
  const serpSceneTitle = serpScene ? (serpScene.title?.[defaultLang] || langs.map(l => serpScene.title?.[l]).find(Boolean) || serpScene.slug) : '';
  // Fallback: defaultLang description → any lang description → defaultLang altText → any lang altText
  const serpSceneDesc  = serpScene
    ? (serpScene.description?.[defaultLang]?.trim()
       || langs.map(l => serpScene.description?.[l]).find(v => v?.trim())
       || serpScene.altText?.[defaultLang]?.trim()
       || langs.map(l => serpScene.altText?.[l]).find(v => v?.trim())
       || '')
    : '';
  const serpSceneHasRealDesc = !!serpScene?.description?.[defaultLang]?.trim()
    || langs.some(l => !!serpScene?.description?.[l]?.trim());
  const serpSceneUrl   = serpScene ? `${siteLabel} › scene › ${serpScene.slug}` : siteLabel;

  const [aiState,      setAiState]      = useState<'idle' | 'running' | 'done'>('idle');
  const [aiError,      setAiError]      = useState('');
  const [fillMode,     setFillMode]     = useState<'all' | 'empty'>('empty');
  const [genAltTexts,  setGenAltTexts]  = useState(false);
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
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addKeyword(kwInput); }
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
    if (!resolved) { setAiError('No API key configured — set it in the AI screen first.'); return; }

    await withContextGate(project, async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setAiState('running');
      setAiError('');
      setUndoSnapshot(null);
      setRedoSnapshot(null);

      try {
        const result = await generateSeoWithAi(
          project, resolved.provider, resolved.apiKey,
          defaultLang, langs, fillMode, genAltTexts,
          () => {}, controller.signal,
        );

        setUndoSnapshot({ ...s });
        updateSeo({
          metaTitle:       result.metaTitle,
          metaDescription: result.metaDescription,
          keywords:        result.keywords,
          schemaType:      result.schemaType,
        });

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
        setTimeout(() => setAiState('idle'), 3000);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setAiError(String(err));
        setAiState('idle');
      }
    }, 'seo');
  }

  return (
    <ScreenShell title="SEO" subtitle="Meta tags, Schema.org markup, and per-scene alt text.">
      <div className="max-w-6xl mx-auto">

        {/* ── AI bar ── compact single row ──────────────────────────────────── */}
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-line-soft bg-paper-tinted px-3 py-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-ink leading-none mb-0.5">Generate with AI</p>
            <p className="text-[11px] text-ink-faded">
              Meta + keywords{genAltTexts ? ' + alt texts' : ''} in {defaultLang.toUpperCase()}
              {langs.length > 1 && genAltTexts && <> ({langs.map((l) => l.toUpperCase()).join(', ')})</>}
            </p>
          </div>

          {/* options */}
          <div className="flex items-center gap-3 text-[11px] text-ink-soft flex-shrink-0">
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="seoFillMode" value="empty"
                checked={fillMode === 'empty'} onChange={() => setFillMode('empty')} className="accent-accent" />
              Empty only
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="seoFillMode" value="all"
                checked={fillMode === 'all'} onChange={() => setFillMode('all')} className="accent-accent" />
              Regenerate all
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={genAltTexts} onChange={(e) => setGenAltTexts(e.target.checked)} className="w-3 h-3 accent-accent" />
              Alt texts
            </label>
          </div>

          {/* action buttons */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {aiError && <span className="text-[10px] text-red-500 max-w-[140px] truncate">{aiError}</span>}
            {aiState === 'done' && <CheckCircle size={12} className="text-green-500" />}
            {undoSnapshot && (
              <button onClick={handleUndo} className="btn text-xs gap-1 text-amber-600 border-amber-200 hover:bg-amber-50 py-0.5">
                <Undo2 size={11} /> Undo
              </button>
            )}
            {redoSnapshot && (
              <button onClick={handleRedo} className="btn text-xs gap-1 text-blue-600 border-blue-200 hover:bg-blue-50 py-0.5">
                <Redo2 size={11} /> Redo
              </button>
            )}
            {aiState === 'running' ? (
              <button onClick={() => abortRef.current?.abort()} className="btn text-xs gap-1 py-0.5">
                <Loader2 size={11} className="animate-spin" /> Cancel
              </button>
            ) : (
              <button onClick={handleGenerateSeo} className="btn btn-accent text-xs gap-1 py-0.5">
                <Sparkles size={11} /> Generate
              </button>
            )}
          </div>
        </div>

        {/* ── 2-column layout ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-[1fr_360px] gap-6 items-start">

          {/* LEFT — form fields */}
          <div className="space-y-4">

            {/* Meta title */}
            <div>
              <FieldLabel
                label="Meta title"
                hint={<span className={previewTitle.length > 60 ? 'text-amber-500 font-medium' : ''}>{previewTitle.length}/60</span>}
              />
              <input
                className={inputCls}
                value={previewTitle}
                placeholder="My hotel virtual tour — Acme Photography"
                onChange={(e) => setPreviewTitle(e.target.value)}
                onBlur={(e) => updateSeo({ metaTitle: e.target.value })}
              />
            </div>

            {/* Meta description */}
            <div>
              <FieldLabel
                label="Meta description"
                hint={<span className={previewDesc.length > 160 ? 'text-amber-500 font-medium' : ''}>{previewDesc.length}/160</span>}
              />
              <textarea
                rows={3}
                className={inputCls + ' resize-none'}
                value={previewDesc}
                placeholder="Explore every corner of our 5-star hotel in stunning 360°…"
                onChange={(e) => setPreviewDesc(e.target.value)}
                onBlur={(e) => updateSeo({ metaDescription: e.target.value })}
              />
            </div>

            {/* Keywords */}
            <div>
              <FieldLabel label="Keywords" hint="First = focus keyword" />
              <div className="flex flex-wrap gap-1.5 p-2 bg-paper-strong border border-line-soft rounded min-h-[36px]">
                {s.keywords.map((kw) => (
                  <span key={kw} className="inline-flex items-center gap-1 bg-ink/10 text-ink text-[11px] px-2 py-0.5 rounded-full">
                    <Tag size={8} />
                    {kw}
                    <button onClick={() => removeKeyword(kw)} className="text-ink-faded hover:text-red-500 ml-0.5">
                      <X size={9} />
                    </button>
                  </span>
                ))}
                <input
                  className="flex-1 min-w-[100px] bg-transparent text-xs text-ink placeholder-ink-faded focus:outline-none"
                  placeholder="Add keyword, press Enter…"
                  value={kwInput}
                  onChange={(e) => setKwInput(e.target.value)}
                  onKeyDown={handleKwKey}
                  onBlur={() => { if (kwInput.trim()) addKeyword(kwInput); }}
                />
              </div>
            </div>

            {/* Schema type + image sitemap — one row */}
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <FieldLabel label="Schema.org type" />
                <select
                  className={inputCls}
                  value={s.schemaType}
                  onChange={(e) => updateSeo({ schemaType: e.target.value as typeof s.schemaType })}
                >
                  {SCHEMA_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer pb-2 shrink-0 text-sm text-ink select-none">
                <input
                  type="checkbox"
                  checked={s.imageSitemap}
                  onChange={(e) => updateSeo({ imageSitemap: e.target.checked })}
                  className="w-4 h-4 accent-accent"
                />
                Image sitemap
              </label>
            </div>

            {/* ── Per-scene alt text ─────────────────────────────────────────── */}
            {project.scenes.length > 0 && (
              <div className="pt-2 border-t border-line">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-faded mb-3">
                  Alt text per scene
                  {langs.length > 1 && <span className="font-normal ml-1.5">({langs.map((l) => l.toUpperCase()).join(' · ')})</span>}
                </p>
                <div className="space-y-2">
                  {project.scenes.map((scene) => (
                    <div key={scene.id} className="bg-paper-strong border border-line-soft rounded-lg p-2.5">
                      <p className="text-[11px] font-medium text-ink truncate mb-1.5">
                        {scene.title[defaultLang] || scene.title.en || scene.slug}
                        <span className="text-ink-faded/60 font-mono font-normal ml-1.5 text-[10px]">{scene.slug}</span>
                      </p>
                      <div className="space-y-1">
                        {langs.map((lang) => (
                          <div key={lang} className="flex items-center gap-2">
                            <span className="text-[9px] font-bold text-ink-faded w-5 flex-shrink-0 uppercase">{lang}</span>
                            <input
                              className="flex-1 bg-paper border border-line-soft rounded px-2 py-1 text-xs text-ink placeholder-ink-faded focus:outline-none focus:border-accent"
                              defaultValue={scene.altText?.[lang] ?? ''}
                              placeholder="Describe what the panorama shows…"
                              onBlur={(e) =>
                                updateScene(scene.id, { altText: { ...(scene.altText ?? {}), [lang]: e.target.value } })
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT — sticky preview + audit */}
          <div className="space-y-3 sticky top-4">

            {/* SERP preview */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-ink-faded">
                  <Globe size={10} /> Google preview
                </div>
                {project.scenes.length > 0 && (
                  <div className="flex items-center gap-0.5 bg-paper-strong rounded border border-line-soft">
                    <button
                      onClick={() => setSerpMode('tour')}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors ${serpMode === 'tour' ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink'}`}
                    >
                      Tour
                    </button>
                    <button
                      onClick={() => setSerpMode('scene')}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors ${serpMode === 'scene' ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink'}`}
                    >
                      Scene
                    </button>
                  </div>
                )}
              </div>
              {serpMode === 'scene' && project.scenes.length > 0 && (
                <select
                  className="w-full bg-paper-strong border border-line-soft rounded px-2 py-1 text-xs text-ink focus:outline-none focus:border-accent mb-2"
                  value={serpSceneIdx}
                  onChange={(e) => setSerpSceneIdx(Number(e.target.value))}
                >
                  {project.scenes.map((sc, i) => (
                    <option key={sc.id} value={i}>{sc.title?.[defaultLang] || sc.slug}</option>
                  ))}
                </select>
              )}
              {serpMode === 'tour' ? (
                <SerpPreview title={previewTitle} description={previewDesc} breadcrumb={siteLabel} favicon={faviconLetter} />
              ) : (
                <>
                  <SerpPreview
                    title={serpSceneTitle ? `${serpSceneTitle} — ${project.meta.name || siteLabel}` : ''}
                    description={serpSceneDesc}
                    breadcrumb={serpSceneUrl}
                    favicon={faviconLetter}
                  />
                  {serpScene && !serpSceneHasRealDesc && (
                    <p className="mt-1.5 text-[10px] text-amber-600 leading-snug">
                      {serpSceneDesc
                        ? 'Showing alt text — add a scene description for better SEO. '
                        : 'No description for this scene. '}
                      <button
                        onClick={() => setActiveScreen('content' as import('@/store/project').ScreenId)}
                        className="underline hover:text-amber-800"
                      >
                        Edit in Content
                      </button>
                    </p>
                  )}
                </>
              )}
            </div>

            {/* SEO audit */}
            <SeoAuditPanel project={project} />
          </div>
        </div>

      </div>
    </ScreenShell>
  );
}
