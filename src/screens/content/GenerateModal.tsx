import { useState, useRef } from 'react';
import {
  X, Sparkles, Loader2, Bot, ChevronDown, ChevronRight,
  Check, AlertCircle,
} from 'lucide-react';
import clsx from 'clsx';
import type { Project, Scene } from '@/types';
import {
  AI_THEMES, AI_TONE_LABELS, AI_AUDIENCE_LABELS, AI_LENGTH_LABELS,
} from '@/lib/ai-themes';
import {
  generateContent, estimateCost,
  type GenerateOptions, type SceneContentResult, type ContentStreamEvent,
} from '@/lib/ai-content';
import { resolveAiProvider } from '@/lib/ai-resolve';
import { computeAiCost, resolvedModelId } from '@/lib/ai-tracking';
import { DiffPreviewModal } from './DiffPreviewModal';

interface GenerateModalProps {
  project: Project;
  selectedSceneIds: Set<string>;
  defaultLang: string;
  onClose: () => void;
  onApply: (patches: Record<string, Partial<Scene>>) => void;
  onToast: (msg: string) => void;
  onRecordUsage?: (tokensIn: number, tokensOut: number, modelId: string, provider: 'anthropic' | 'openai') => void;
}

export function GenerateModal({
  project, selectedSceneIds, defaultLang, onClose, onApply, onToast, onRecordUsage,
}: GenerateModalProps) {
  const resolved = resolveAiProvider(project.modules ?? {});
  const provider = resolved?.provider ?? 'claude';
  const apiKey = resolved?.apiKey ?? '';
  const modelId = resolvedModelId(
    provider,
    provider === 'gpt' ? project.modules?.openaiModel : project.modules?.claudeModel,
  );
  const langs = project.languages.available ?? ['en'];
  const aiCtx = project.aiContext;

  // ── Form state ─────────────────────────────────────────────────────────────
  const [scope, setScope] = useState<'all' | 'empty' | 'selected'>(
    selectedSceneIds.size > 0 ? 'selected' : 'empty',
  );
  const [genTitles, setGenTitles] = useState(true);
  const [genDescs, setGenDescs] = useState(true);
  const [genAlt, setGenAlt] = useState(false);
  const [selectedLangs, setSelectedLangs] = useState<Set<string>>(new Set(langs));
  const [fillMode, setFillMode] = useState<'empty-only' | 'translate-default' | 'overwrite'>('empty-only');
  const [tone, setTone] = useState(aiCtx?.tone ?? 'marketing');
  const [audience, setAudience] = useState(aiCtx?.audience ?? 'general');
  const [theme, setTheme] = useState(aiCtx?.theme ?? 'Tourism');
  const [length, setLength] = useState(aiCtx?.length ?? 'medium');
  const [customInstructions, setCustomInstructions] = useState(aiCtx?.customInstructions ?? '');
  const [imageQuality, setImageQuality] = useState<'low' | 'medium' | 'high'>('medium');
  const [autoBackup, setAutoBackup] = useState(true);

  // ── Generation state ────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [streamText, setStreamText] = useState('');
  const [streamExpanded, setStreamExpanded] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // ── Diff preview state ──────────────────────────────────────────────────────
  const [results, setResults] = useState<SceneContentResult[] | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  // ── Computed values ─────────────────────────────────────────────────────────
  const scopeScenes = project.scenes.filter((s) => {
    if (scope === 'selected') return selectedSceneIds.has(s.id);
    if (scope === 'empty') {
      const hasTitle = langs.some((l) => s.title?.[l]?.trim());
      const hasDesc = langs.some((l) => s.description?.[l]?.trim());
      return !hasTitle || !hasDesc;
    }
    return true;
  });
  const sceneCount = scopeScenes.length;
  const costEst = estimateCost(sceneCount, imageQuality);

  const canGenerate = apiKey && sceneCount > 0 && selectedLangs.size > 0 && (genTitles || genDescs || genAlt);

  function handleCancel() {
    abortRef.current?.abort();
  }

  async function handleGenerate() {
    if (!canGenerate || running) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setError('');
    setStatus('');
    setStreamText('');
    setProgress(null);

    // Auto-backup
    if (autoBackup) {
      try {
        const projectDir = await window.conchitect.getProjectDir();
        if (projectDir) {
          setStatus('Creating backup…');
          const backup = await window.conchitect.excelBackup(project, projectDir);
          if (backup.ok) {
            const kb = Math.round((backup.bytes ?? 0) / 1024);
            onToast(`Backup saved (${kb} KB)${backup.cleaned ? ` · ${backup.cleaned} old backup(s) removed` : ''}`);
          }
        }
      } catch { /* non-fatal */ }
    }

    const options: GenerateOptions = {
      scope,
      selectedIds: selectedSceneIds,
      generateTitles: genTitles,
      generateDescriptions: genDescs,
      generateAltText: genAlt,
      langs: [...selectedLangs],
      fillMode,
      tone,
      audience,
      theme,
      length,
      customInstructions: customInstructions || undefined,
      imageQuality,
      autoBackup,
    };

    const handleEvent = (ev: ContentStreamEvent) => {
      if (ev.type === 'status') setStatus(ev.message);
      if (ev.type === 'token') setStreamText((t) => t + ev.text);
      if (ev.type === 'scene-start') {
        setProgress({ done: ev.sceneIndex, total: ev.total });
        setStreamText('');
      }
      if (ev.type === 'scene-done') {
        setProgress((p) => p ? { ...p, done: p.done + 1 } : null);
      }
    };

    try {
      const { results: res, tokensIn, tokensOut } = await generateContent(
        project,
        { provider, anthropic: project.modules?.anthropicApiKey, openai: project.modules?.openaiApiKey, modelId },
        options, handleEvent, ctrl.signal,
      );
      if (onRecordUsage) {
        onRecordUsage(tokensIn, tokensOut, modelId, provider === 'gpt' ? 'openai' : 'anthropic');
      }
      setResults(res);
      setShowDiff(true);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        onToast('Generation cancelled');
        onClose();
      } else {
        setError(String(err));
      }
    } finally {
      setRunning(false);
      setStatus('');
    }
  }

  // ── Diff approved ───────────────────────────────────────────────────────────
  function handleDiffApply(kept: SceneContentResult[]) {
    const patches: Record<string, Partial<Scene>> = {};
    for (const r of kept) {
      const patch: Partial<Scene> = {};
      if (r.title) patch.title = { ...(project.scenes.find((s) => s.id === r.sceneId)?.title ?? {}), ...r.title };
      if (r.description) patch.description = { ...(project.scenes.find((s) => s.id === r.sceneId)?.description ?? {}), ...r.description };
      if (r.altText) patch.altText = { ...(project.scenes.find((s) => s.id === r.sceneId)?.altText ?? {}), ...r.altText };
      if (Object.keys(patch).length > 0) patches[r.sceneId] = patch;
    }
    onApply(patches);
    onClose();
  }

  // ── Diff visible ────────────────────────────────────────────────────────────
  if (showDiff && results) {
    return (
      <DiffPreviewModal
        project={project}
        results={results}
        onApply={handleDiffApply}
        onCancel={() => { setShowDiff(false); setResults(null); }}
      />
    );
  }

  // ── Select field render helper ──────────────────────────────────────────────
  function SelectField({ label, value, onChange, options }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: Record<string, string>;
  }) {
    return (
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-ink-soft uppercase tracking-wide">{label}</label>
        <div className="relative">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full text-xs pl-2.5 pr-7 py-1.5 rounded-lg border border-line-soft bg-paper text-ink appearance-none focus:outline-none focus:border-accent"
          >
            {Object.entries(options).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faded pointer-events-none" />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-paper rounded-2xl shadow-2xl border border-line w-full max-w-xl max-h-[90vh] flex flex-col">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-line shrink-0">
          <Sparkles size={16} className="text-purple-500" />
          <span className="text-sm font-semibold text-ink flex-1">Generate Content with AI</span>
          <button onClick={onClose} className="text-ink-faded hover:text-ink transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">

          {!apiKey && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 flex items-center gap-2">
              <AlertCircle size={13} className="shrink-0" />
              No API key configured — add your Claude or GPT key in the <strong>AI</strong> screen to enable generation.
            </div>
          )}

          {/* Scope */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faded">Scope</h3>
            {([
              ['all', `All scenes (${project.scenes.length})`],
              ['empty', `Only scenes with missing fields (${project.scenes.filter((s) => !langs.some((l) => s.title?.[l]?.trim()) || !langs.some((l) => s.description?.[l]?.trim())).length})`],
              ['selected', `Selected scenes only (${selectedSceneIds.size})`],
            ] as const).map(([val, label]) => (
              <label key={val} className={clsx('flex items-center gap-2 text-xs cursor-pointer', val === 'selected' && selectedSceneIds.size === 0 && 'opacity-40')}>
                <input type="radio" name="scope" value={val} checked={scope === val} onChange={() => setScope(val)}
                  disabled={val === 'selected' && selectedSceneIds.size === 0}
                  className="accent-accent" />
                {label}
              </label>
            ))}
          </section>

          {/* What to generate */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faded">What to generate</h3>
            {([
              [genTitles, setGenTitles, 'Titles'],
              [genDescs, setGenDescs, 'Descriptions'],
              [genAlt, setGenAlt, 'Alt text (SEO)'],
            ] as [boolean, (v: boolean) => void, string][]).map(([val, setter, label]) => (
              <label key={label} className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={val} onChange={(e) => setter(e.target.checked)} className="w-3.5 h-3.5 accent-accent" />
                {label}
              </label>
            ))}
          </section>

          {/* Languages */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faded">Languages</h3>
            <div className="flex flex-wrap gap-2">
              {langs.map((l) => (
                <label key={l} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedLangs.has(l)}
                    onChange={(e) => {
                      const n = new Set(selectedLangs);
                      if (e.target.checked) n.add(l); else n.delete(l);
                      setSelectedLangs(n);
                    }}
                    className="w-3.5 h-3.5 accent-accent"
                  />
                  {l.toUpperCase()}
                </label>
              ))}
            </div>
          </section>

          {/* Fill mode */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faded">Fill mode</h3>
            {([
              ['empty-only', 'Only empty fields (don\'t overwrite existing)'],
              ['translate-default', 'Translate from default language only'],
              ['overwrite', 'Overwrite everything'],
            ] as const).map(([val, label]) => (
              <label key={val} className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="radio" name="fillMode" value={val} checked={fillMode === val} onChange={() => setFillMode(val)} className="accent-accent" />
                {label}
              </label>
            ))}
          </section>

          {/* Editorial angle */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faded">Editorial angle</h3>
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Theme" value={theme} onChange={setTheme}
                options={Object.fromEntries(AI_THEMES.map((t) => [t, t]))} />
              <SelectField label="Tone" value={tone} onChange={setTone} options={AI_TONE_LABELS} />
              <SelectField label="Audience" value={audience} onChange={setAudience} options={AI_AUDIENCE_LABELS} />
              <SelectField label="Length" value={length} onChange={setLength} options={AI_LENGTH_LABELS} />
            </div>
            <div>
              <label className="text-[11px] font-medium text-ink-soft uppercase tracking-wide">Custom instructions</label>
              <textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="Optional: emphasize specific aspects, style notes, key phrases…"
                rows={2}
                className="w-full mt-1 text-xs bg-paper-tinted border border-line-soft rounded-lg px-3 py-2 resize-none outline-none focus:border-accent placeholder:text-ink-faded/60"
              />
            </div>
          </section>

          {/* Image quality */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faded">Image quality (for vision AI)</h3>
            {([
              ['low', 'Low — 384px (~5¢/scene, fast)'],
              ['medium', 'Medium — 768px (~12¢/scene, recommended)'],
              ['high', 'High — 1024px (~25¢/scene, best quality)'],
            ] as const).map(([val, label]) => (
              <label key={val} className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="radio" name="quality" value={val} checked={imageQuality === val} onChange={() => setImageQuality(val)} className="accent-accent" />
                {label}
              </label>
            ))}
          </section>

          {/* Options */}
          <section>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={autoBackup} onChange={(e) => setAutoBackup(e.target.checked)} className="w-3.5 h-3.5 accent-accent" />
              Auto-export Excel backup before generating
            </label>
          </section>

          {/* Cost estimate */}
          <div className="rounded-lg bg-paper-strong border border-line-soft px-3 py-2 text-xs text-ink-soft">
            Estimated cost: <span className="font-semibold text-ink">${costEst}</span>
            {' '}({sceneCount} scene{sceneCount !== 1 ? 's' : ''} × {imageQuality} quality)
          </div>

          {/* Running state */}
          {running && (
            <div className="rounded-xl border border-purple-200 bg-purple-50 overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-purple-100">
                <Bot size={15} className="text-purple-600 shrink-0" />
                <span className="text-xs font-medium text-purple-900 flex-1">
                  {progress ? `Scene ${progress.done + 1} of ${progress.total}` : 'Starting…'}
                </span>
                <Loader2 size={13} className="animate-spin text-purple-500" />
              </div>
              <div className="px-4 py-2 space-y-1.5">
                <p className="text-xs text-purple-700">{status}</p>
                {progress && (
                  <div className="w-full bg-purple-100 rounded-full h-1.5">
                    <div
                      className="bg-purple-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                    />
                  </div>
                )}
                <button
                  onClick={() => setStreamExpanded((v) => !v)}
                  className="flex items-center gap-1 text-[11px] text-purple-600 hover:text-purple-800"
                >
                  {streamExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  {streamExpanded ? 'Hide' : 'Show'} live response
                </button>
                {streamExpanded && (
                  <div className="bg-white/60 border border-purple-100 rounded px-2 py-1.5 text-[11px] font-mono text-ink-soft max-h-28 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                    {streamText || <span className="italic text-ink-faded">Waiting…</span>}
                    {streamText && <span className="inline-block w-0.5 h-3 bg-purple-500 ml-0.5 animate-pulse align-middle" />}
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle size={13} className="shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-line shrink-0">
          {running ? (
            <button onClick={handleCancel} className="btn gap-1.5 text-xs text-red-600 border-red-200 hover:bg-red-50">
              <X size={13} /> Cancel
            </button>
          ) : (
            <button onClick={onClose} className="btn text-xs">Cancel</button>
          )}
          <div className="flex-1" />
          <button
            onClick={handleGenerate}
            disabled={!canGenerate || running}
            className={clsx(
              'btn gap-2 text-xs',
              canGenerate && !running ? 'btn-accent' : 'opacity-50 cursor-not-allowed',
            )}
          >
            {running
              ? <><Loader2 size={13} className="animate-spin" /> Generating…</>
              : <><Check size={13} /> Generate now</>}
          </button>
        </div>
      </div>
    </div>
  );
}
