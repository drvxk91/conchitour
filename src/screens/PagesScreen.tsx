import { useState, useMemo, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import { FileText, Plus, Trash2, Eye, EyeOff, GripVertical, Lock, Sparkles, Loader2, Undo2, Redo2 } from 'lucide-react';
import { marked } from 'marked';
import clsx from 'clsx';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import type { StaticPage } from '@/types';
import { BUILTIN_PAGE_SLUGS } from '@/lib/builtin-pages';
import { generatePageWithAi } from '@/lib/ai-seo';
import { resolveAiProvider } from '@/lib/ai-resolve';
import { consumeTrialAiCall } from '@/lib/trial';
import { UpgradeModal } from '@/components/UpgradeModal';
import type { UpgradeFeature } from '@/components/UpgradeModal';

marked.setOptions({ breaks: true });

// ─── helpers ──────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}

function isValidCustomSlug(s: string): boolean {
  if (BUILTIN_PAGE_SLUGS.has(s)) return false;
  return /^[a-z0-9][a-z0-9-]*$/.test(s) && s.length >= 2 && s.length <= 50;
}

// ─── component ────────────────────────────────────────────────────────────────

export function PagesScreen() {
  const { project, addPage, updatePage, deletePage } = useProject();
  const pages: StaticPage[] = project.pages ?? [];
  const langs = project.languages.available;
  const defaultLang = project.languages.default;

  const [selectedId, setSelectedId] = useState<string | null>(pages[0]?.id ?? null);
  const [activeLang, setActiveLang] = useState(defaultLang);
  const [showPreview, setShowPreview] = useState(true);

  // New custom page modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  // AI generation
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [upgradeFeature, setUpgradeFeature] = useState<UpgradeFeature | null>(null);
  const [undoContent, setUndoContent] = useState<{ pageId: string; lang: string; content: string } | null>(null);
  const [redoContent, setRedoContent] = useState<{ pageId: string; lang: string; content: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selected = pages.find((p) => p.id === selectedId) ?? null;

  const builtInPages = pages.filter((p) => p.builtIn);
  const customPages  = pages.filter((p) => !p.builtIn);

  // Sorted enabled footer pages (for preview info)
  const footerPages = useMemo(
    () => [...pages].filter((p) => p.enabled && p.showInFooter).sort((a, b) => a.order - b.order),
    [pages]
  );

  // ── actions ────────────────────────────────────────────────────────────────

  function handleToggleEnabled(page: StaticPage) {
    updatePage(page.id, { enabled: !page.enabled });
  }

  function handleToggleFooter(page: StaticPage) {
    updatePage(page.id, { showInFooter: !page.showInFooter });
  }

  function handleTitleChange(val: string) {
    if (!selected) return;
    updatePage(selected.id, { title: { ...selected.title, [activeLang]: val } });
  }

  function handleContentChange(val: string) {
    if (!selected) return;
    updatePage(selected.id, { content: { ...selected.content, [activeLang]: val } });
  }

  function handleOrderChange(val: string) {
    if (!selected) return;
    const n = parseInt(val, 10);
    if (!isNaN(n)) updatePage(selected.id, { order: n });
  }

  function handleSlugChange(val: string) {
    if (!selected || selected.builtIn) return;
    updatePage(selected.id, { slug: slugify(val) });
  }

  async function handleGeneratePage() {
    if (!selected) return;
    const resolved = resolveAiProvider(project.modules);
    if (!resolved) {
      setAiError('No API key configured — set your key in the AI screen first.');
      return;
    }
    const trialErr = await consumeTrialAiCall();
    if (trialErr) { setUpgradeFeature('ai'); return; }
    const controller = new AbortController();
    abortRef.current = controller;
    setAiGenerating(true);
    setAiError('');
    setUndoContent(null);
    setRedoContent(null);
    const existingContent = selected.content[activeLang] ?? selected.content[defaultLang] ?? '';
    try {
      const content = await generatePageWithAi(
        project,
        selected.slug,
        selected.title[activeLang] || selected.title[defaultLang] || selected.slug,
        activeLang,
        resolved.provider,
        resolved.apiKey,
        existingContent,
        () => {},
        controller.signal,
      );
      // Save undo snapshot before applying
      setUndoContent({ pageId: selected.id, lang: activeLang, content: existingContent });
      updatePage(selected.id, { content: { ...selected.content, [activeLang]: content } });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setAiError(String(err));
    } finally {
      setAiGenerating(false);
    }
  }

  function handleUndoPage() {
    if (!undoContent) return;
    const page = pages.find((p) => p.id === undoContent.pageId);
    if (!page) return;
    const currentContent = page.content[undoContent.lang] ?? '';
    setRedoContent({ pageId: undoContent.pageId, lang: undoContent.lang, content: currentContent });
    updatePage(undoContent.pageId, { content: { ...page.content, [undoContent.lang]: undoContent.content } });
    setUndoContent(null);
  }

  function handleRedoPage() {
    if (!redoContent) return;
    const page = pages.find((p) => p.id === redoContent.pageId);
    if (!page) return;
    const currentContent = page.content[redoContent.lang] ?? '';
    setUndoContent({ pageId: redoContent.pageId, lang: redoContent.lang, content: currentContent });
    updatePage(redoContent.pageId, { content: { ...page.content, [redoContent.lang]: redoContent.content } });
    setRedoContent(null);
  }

  function handleDelete(page: StaticPage) {
    if (page.builtIn) return;
    if (!confirm(`Delete page "${page.title[defaultLang] || page.slug}"? This cannot be undone.`)) return;
    if (selectedId === page.id) setSelectedId(pages.find((p) => p.id !== page.id)?.id ?? null);
    deletePage(page.id);
  }

  function handleAddCustom() {
    const t = newTitle.trim();
    const s = newSlug.trim() || slugify(t);
    if (!t || !isValidCustomSlug(s)) return;

    const takenSlugs = new Set(pages.map((p) => p.slug));
    if (takenSlugs.has(s)) { alert(`Slug "${s}" is already in use.`); return; }

    const page: StaticPage = {
      id: uuid(),
      slug: s,
      enabled: false,
      showInFooter: true,
      order: pages.length,
      title: { [defaultLang]: t },
      content: { [defaultLang]: `# ${t}\n\n` },
    };
    addPage(page);
    setSelectedId(page.id);
    setShowNewModal(false);
    setNewTitle('');
    setNewSlug('');
    setSlugTouched(false);
  }

  // ── derived for editor ─────────────────────────────────────────────────────

  const currentTitle   = selected?.title[activeLang]   ?? selected?.title[defaultLang] ?? '';
  const currentContent = selected?.content[activeLang] ?? selected?.content[defaultLang] ?? '';
  const previewHtml = useMemo(
    () => marked.parse(currentContent) as string,
    [currentContent]
  );

  const slugError = selected && !selected.builtIn && selected.slug
    ? (!isValidCustomSlug(selected.slug) ? 'Invalid slug (a–z, 0–9, hyphens, no reserved words)' : null)
    : null;

  // ─── render ─────────────────────────────────────────────────────────────────

  return (
    <ScreenShell
      title="Pages"
      subtitle="Static pages compiled at /page/<slug>/<lang>/. Add them to the tour footer by enabling them below."
    >
      <div className="flex gap-6 min-h-[600px]">

        {/* ── Left: page list ── */}
        <div className="w-56 flex-shrink-0 flex flex-col gap-1">

          {/* Built-in section */}
          <div className="text-[10px] font-semibold text-ink-faded uppercase tracking-widest mb-1 px-1">
            Built-in
          </div>
          {builtInPages.map((page) => (
            <PageListItem
              key={page.id}
              page={page}
              lang={defaultLang}
              active={selectedId === page.id}
              onClick={() => setSelectedId(page.id)}
              onToggleEnabled={() => handleToggleEnabled(page)}
            />
          ))}

          {/* Custom section */}
          {customPages.length > 0 && (
            <>
              <div className="text-[10px] font-semibold text-ink-faded uppercase tracking-widest mt-4 mb-1 px-1">
                Custom
              </div>
              {customPages.map((page) => (
                <PageListItem
                  key={page.id}
                  page={page}
                  lang={defaultLang}
                  active={selectedId === page.id}
                  onClick={() => setSelectedId(page.id)}
                  onToggleEnabled={() => handleToggleEnabled(page)}
                />
              ))}
            </>
          )}

          <button
            onClick={() => setShowNewModal(true)}
            className="mt-3 flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 px-2 py-1.5 rounded-md hover:bg-accent/8 transition-colors"
          >
            <Plus size={13} /> Add custom page
          </button>

          {/* Footer preview */}
          {footerPages.length > 0 && (
            <div className="mt-6 border-t border-line pt-4">
              <div className="text-[10px] font-semibold text-ink-faded uppercase tracking-widest mb-2 px-1">
                Footer preview
              </div>
              <div className="text-[10px] text-ink-soft px-1 leading-relaxed">
                {footerPages.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && <span className="text-ink-faded mx-1">·</span>}
                    <span className="text-accent">{p.title[defaultLang] || p.slug}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: editor ── */}
        {selected ? (
          <div className="flex-1 min-w-0 flex flex-col gap-5">

            {/* Top controls row */}
            <div className="flex items-center gap-4 flex-wrap">
              {/* Enable toggle */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div
                  onClick={() => handleToggleEnabled(selected)}
                  className={clsx(
                    'relative w-9 h-5 rounded-full transition-colors cursor-pointer',
                    selected.enabled ? 'bg-accent' : 'bg-line'
                  )}
                >
                  <div className={clsx(
                    'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                    selected.enabled ? 'left-[18px]' : 'left-0.5'
                  )} />
                </div>
                <span className="text-sm font-medium text-ink">Enabled</span>
              </label>

              {/* Show in footer toggle */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div
                  onClick={() => handleToggleFooter(selected)}
                  className={clsx(
                    'relative w-9 h-5 rounded-full transition-colors cursor-pointer',
                    selected.showInFooter ? 'bg-accent' : 'bg-line'
                  )}
                >
                  <div className={clsx(
                    'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                    selected.showInFooter ? 'left-[18px]' : 'left-0.5'
                  )} />
                </div>
                <span className="text-sm text-ink-soft">Show in footer</span>
              </label>

              {/* Order */}
              <div className="flex items-center gap-1.5">
                <GripVertical size={13} className="text-ink-faded" />
                <span className="text-xs text-ink-faded">Order</span>
                <input
                  type="number"
                  value={selected.order}
                  onChange={(e) => handleOrderChange(e.target.value)}
                  className="w-14 border border-line rounded px-2 py-1 text-xs text-ink bg-paper focus:outline-none focus:ring-1 focus:ring-accent/40"
                  min={0}
                  max={99}
                />
              </div>

              {/* Delete (custom only) */}
              {!selected.builtIn && (
                <button
                  onClick={() => handleDelete(selected)}
                  className="ml-auto flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={13} /> Delete page
                </button>
              )}
            </div>

            {/* Slug + title row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1.5">
                  Slug
                  {selected.builtIn && (
                    <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] text-ink-faded">
                      <Lock size={9} /> locked
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={selected.slug}
                  disabled={!!selected.builtIn}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  className={clsx(
                    'w-full border rounded px-3 py-1.5 text-sm font-mono bg-paper focus:outline-none focus:ring-1 focus:ring-accent/40',
                    selected.builtIn ? 'border-line text-ink-faded cursor-not-allowed' : 'border-line text-ink',
                    slugError && 'border-red-400'
                  )}
                />
                {slugError && <p className="text-[11px] text-red-500 mt-1">{slugError}</p>}
                <p className="text-[10px] text-ink-faded mt-1">/page/{selected.slug}/</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1.5">
                  Title — {activeLang.toUpperCase()}
                </label>
                <input
                  type="text"
                  value={currentTitle}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder={selected.title[defaultLang] || 'Page title…'}
                  className="w-full border border-line rounded px-3 py-1.5 text-sm text-ink bg-paper focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
              </div>
            </div>

            {/* Language tabs */}
            <div>
              <div className="flex items-center gap-1 mb-3">
                {langs.map((l) => (
                  <button
                    key={l}
                    onClick={() => setActiveLang(l)}
                    className={clsx(
                      'px-3 py-1 rounded text-xs font-medium transition-colors',
                      activeLang === l
                        ? 'bg-accent text-white'
                        : 'text-ink-soft hover:bg-paper-tinted hover:text-ink'
                    )}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
                <div className="flex-1" />
                {aiError && <span className="text-[11px] text-red-500">{aiError}</span>}
                {undoContent && undoContent.pageId === selected?.id && undoContent.lang === activeLang && (
                  <button
                    onClick={handleUndoPage}
                    className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 px-2 py-1 rounded hover:bg-amber-50 transition-colors"
                    title="Undo AI generation"
                  >
                    <Undo2 size={12} /> Undo
                  </button>
                )}
                {redoContent && redoContent.pageId === selected?.id && redoContent.lang === activeLang && (
                  <button
                    onClick={handleRedoPage}
                    className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                    title="Redo AI generation"
                  >
                    <Redo2 size={12} /> Redo
                  </button>
                )}
                <button
                  onClick={aiGenerating ? () => abortRef.current?.abort() : handleGeneratePage}
                  className="flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-700 px-2 py-1 rounded hover:bg-purple-50 transition-colors"
                  title="Generate this page with AI — uses existing content as base"
                >
                  {aiGenerating
                    ? <><Loader2 size={12} className="animate-spin" /> Generating…</>
                    : <><Sparkles size={12} /> Generate with AI</>}
                </button>
                <button
                  onClick={() => setShowPreview((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-ink-faded hover:text-ink px-2 py-1 rounded hover:bg-paper-tinted transition-colors"
                >
                  {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
                  {showPreview ? 'Hide preview' : 'Show preview'}
                </button>
              </div>

              {/* Content editor + live preview */}
              <div className={clsx('grid gap-4', showPreview ? 'grid-cols-2' : 'grid-cols-1')}>
                <div>
                  <label className="block text-[10px] font-semibold text-ink-faded uppercase tracking-widest mb-1.5">
                    Markdown content
                  </label>
                  <textarea
                    value={currentContent}
                    onChange={(e) => handleContentChange(e.target.value)}
                    placeholder="# Page title&#10;&#10;Your content here…"
                    className="w-full h-[420px] border border-line rounded px-3 py-2.5 text-xs font-mono text-ink bg-paper resize-y focus:outline-none focus:ring-1 focus:ring-accent/40 leading-relaxed"
                    spellCheck={false}
                  />
                  {!selected.content[activeLang] && selected.content[defaultLang] && (
                    <p className="text-[10px] text-amber-500 mt-1">
                      No {activeLang.toUpperCase()} content — falling back to {defaultLang.toUpperCase()} at compile time.
                    </p>
                  )}
                </div>

                {showPreview && (
                  <div>
                    <label className="block text-[10px] font-semibold text-ink-faded uppercase tracking-widest mb-1.5">
                      Preview
                    </label>
                    <div
                      className="h-[420px] overflow-y-auto border border-line rounded px-5 py-4 bg-white prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-ink-faded text-sm">
            <div className="text-center space-y-2">
              <FileText size={32} className="mx-auto opacity-30" />
              <p>Select a page to edit</p>
            </div>
          </div>
        )}
      </div>

      {/* ── New custom page modal ── */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setShowNewModal(false)}>
          <div className="bg-paper rounded-xl shadow-xl border border-line p-6 w-80" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-ink mb-4">New custom page</h3>

            <label className="block text-xs font-medium text-ink-soft mb-1.5">Title</label>
            <input
              autoFocus
              type="text"
              value={newTitle}
              onChange={(e) => {
                setNewTitle(e.target.value);
                if (!slugTouched) setNewSlug(slugify(e.target.value));
              }}
              placeholder="e.g. Accessibility"
              className="w-full border border-line rounded px-3 py-1.5 text-sm text-ink bg-paper focus:outline-none focus:ring-1 focus:ring-accent/40 mb-3"
            />

            <label className="block text-xs font-medium text-ink-soft mb-1.5">Slug</label>
            <input
              type="text"
              value={newSlug}
              onChange={(e) => { setSlugTouched(true); setNewSlug(slugify(e.target.value)); }}
              placeholder="e.g. accessibility"
              className={clsx(
                'w-full border rounded px-3 py-1.5 text-sm font-mono text-ink bg-paper focus:outline-none focus:ring-1 focus:ring-accent/40 mb-1',
                newSlug && !isValidCustomSlug(newSlug) ? 'border-red-400' : 'border-line'
              )}
            />
            {newSlug && BUILTIN_PAGE_SLUGS.has(newSlug) && (
              <p className="text-[11px] text-red-500 mb-2">This slug is reserved for a built-in page.</p>
            )}
            <p className="text-[10px] text-ink-faded mb-4">/page/{newSlug || '…'}/</p>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowNewModal(false)}
                className="px-3 py-1.5 text-xs text-ink-soft hover:text-ink rounded hover:bg-paper-tinted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCustom}
                disabled={!newTitle.trim() || !isValidCustomSlug(newSlug || slugify(newTitle))}
                className="px-4 py-1.5 text-xs bg-accent text-white rounded font-medium hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
      {upgradeFeature && <UpgradeModal feature={upgradeFeature} onClose={() => setUpgradeFeature(null)} />}
    </ScreenShell>
  );
}

// ─── PageListItem ─────────────────────────────────────────────────────────────

function PageListItem({
  page, lang, active, onClick, onToggleEnabled,
}: {
  page: StaticPage;
  lang: string;
  active: boolean;
  onClick: () => void;
  onToggleEnabled: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'group flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-md cursor-pointer transition-all border-l-2 text-left',
        active
          ? 'border-accent bg-accent/8 text-accent'
          : 'border-transparent text-ink-soft hover:bg-paper-tinted hover:text-ink'
      )}
    >
      <FileText size={13} className={active ? 'text-accent flex-shrink-0' : 'text-ink-faded flex-shrink-0'} />
      <span className="flex-1 text-xs truncate">{page.title[lang] || page.slug}</span>

      {/* Enabled dot */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleEnabled(); }}
        title={page.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
        className="flex-shrink-0"
      >
        <span className={clsx(
          'inline-block w-2 h-2 rounded-full transition-colors',
          page.enabled ? 'bg-green-400' : 'bg-line group-hover:bg-ink-faded'
        )} />
      </button>
    </div>
  );
}
