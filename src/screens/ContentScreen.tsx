import { useState, useCallback, useRef } from 'react';
import {
  Sparkles, Download, Upload, ImageOff, Languages, Undo2,
} from 'lucide-react';
import clsx from 'clsx';
import { useProject } from '@/store/project';
import { computeAiCost } from '@/lib/ai-tracking';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { toLocalUrl } from '@/lib/local-url';
import type { Scene } from '@/types';
import { GenerateModal } from './content/GenerateModal';
import { ImportDiffModal } from './content/ImportDiffModal';
import type { ImportChange, ImportDiffResult } from '../../electron/preload';

// ── Inline editable cell ──────────────────────────────────────────────────────

interface EditableCellProps {
  value: string;
  placeholder?: string;
  multiline?: boolean;
  onSave: (v: string) => void;
  onGenerateCell?: () => void;
}

function EditableCell({ value, placeholder, multiline, onSave, onGenerateCell }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function commit() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }

  if (editing) {
    if (multiline) {
      return (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
          className="w-full text-xs bg-white border border-accent rounded px-1.5 py-1 resize-none outline-none leading-relaxed"
          rows={3}
        />
      );
    }
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
        className="w-full text-xs bg-white border border-accent rounded px-1.5 py-0.5 outline-none"
      />
    );
  }

  return (
    <div className="group/cell relative flex items-start gap-1 min-h-[1.5rem]">
      <span
        onClick={() => { setDraft(value); setEditing(true); }}
        className={clsx(
          'flex-1 text-xs leading-relaxed cursor-text rounded px-1 py-0.5 hover:bg-paper-strong transition-colors',
          value ? 'text-ink' : 'text-ink-faded italic'
        )}
      >
        {value || placeholder || '—'}
      </span>
      {onGenerateCell && (
        <button
          onClick={onGenerateCell}
          title="Generate with Claude"
          className="opacity-0 group-hover/cell:opacity-100 transition-opacity shrink-0 p-0.5 rounded text-purple-400 hover:text-purple-600 hover:bg-purple-50"
        >
          <Sparkles size={11} />
        </button>
      )}
    </div>
  );
}

// ── Scene row ─────────────────────────────────────────────────────────────────

interface SceneRowProps {
  scene: Scene;
  langs: string[];
  defaultLang: string;
  onUpdateTitle: (lang: string, val: string) => void;
  onUpdateDesc: (lang: string, val: string) => void;
  onGenerateCell: (field: 'title' | 'description', lang: string) => void;
  onGenerateScene: () => void;
  selected: boolean;
  onToggleSelect: () => void;
}

function SceneRow({
  scene, langs, onUpdateTitle, onUpdateDesc,
  onGenerateCell, onGenerateScene, selected, onToggleSelect,
}: SceneRowProps) {
  const [imgError, setImgError] = useState(false);
  const thumbUrl = scene.media?.sourcePath && !imgError
    ? toLocalUrl(scene.media.sourcePath)
    : null;

  return (
    <tr className={clsx('group border-b border-line-soft hover:bg-paper-tinted/40 transition-colors', selected && 'bg-accent/5')}>
      {/* Select */}
      <td className="px-2 py-2 w-6 align-top">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="w-3.5 h-3.5 accent-accent mt-1"
        />
      </td>

      {/* Thumbnail */}
      <td className="px-2 py-2 align-top">
        <div className="w-16 h-10 rounded overflow-hidden bg-line shrink-0 relative">
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt=""
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink-faded">
              <ImageOff size={14} />
            </div>
          )}
        </div>
      </td>

      {/* Slug */}
      <td className="px-2 py-2 align-top w-32">
        <span className="text-xs font-mono text-ink-faded">{scene.slug}</span>
      </td>

      {/* Titles per language */}
      {langs.map((lang) => (
        <td key={`title-${lang}`} className="px-2 py-2 align-top min-w-[140px]">
          <EditableCell
            value={scene.title?.[lang] ?? ''}
            placeholder={`Title (${lang})`}
            onSave={(v) => onUpdateTitle(lang, v)}
            onGenerateCell={() => onGenerateCell('title', lang)}
          />
        </td>
      ))}

      {/* Descriptions per language */}
      {langs.map((lang) => (
        <td key={`desc-${lang}`} className="px-2 py-2 align-top min-w-[180px]">
          <EditableCell
            value={scene.description?.[lang] ?? ''}
            placeholder={`Description (${lang})`}
            multiline
            onSave={(v) => onUpdateDesc(lang, v)}
            onGenerateCell={() => onGenerateCell('description', lang)}
          />
        </td>
      ))}

      {/* Scene-level generate */}
      <td className="px-2 py-2 align-top w-8">
        <button
          onClick={onGenerateScene}
          title="Generate all fields for this scene"
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-purple-400 hover:text-purple-600 hover:bg-purple-50"
        >
          <Sparkles size={14} />
        </button>
      </td>
    </tr>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

// ── Helpers to rebuild patches from accepted ImportChanges ────────────────────

function applyField(
  patch: Record<string, unknown>,
  field: string,
  value: unknown,
  currentEntity: Record<string, unknown> | null | undefined,
) {
  const dot = field.indexOf('.');
  if (dot === -1) {
    patch[field] = value;
  } else {
    const parent = field.slice(0, dot);
    const sub = field.slice(dot + 1);
    if (patch[parent] === undefined) {
      patch[parent] = { ...(currentEntity?.[parent] as Record<string, unknown> ?? {}) };
    }
    (patch[parent] as Record<string, unknown>)[sub] = value;
  }
}

function buildPatchesFromChanges(changes: ImportChange[], project: ReturnType<typeof useProject>['project']) {
  const scenePatch: Record<string, Record<string, unknown>> = {};
  const catPatch: Record<string, Record<string, unknown>> = {};
  const pagePatch: Record<string, Record<string, unknown>> = {};
  const analyticsPatch: Record<string, unknown> = {};
  const hotspotPatch: Record<string, { sceneId: string; patch: Record<string, unknown> }> = {};
  const metaPatch: Record<string, unknown> = {};
  const modulesPatch: Record<string, unknown> = {};
  const aiContextPatch: Record<string, unknown> = {};

  const sceneById = new Map(project.scenes.map((s) => [s.id, s as unknown as Record<string, unknown>]));
  const catById = new Map(project.categories.map((c) => [c.id, c as unknown as Record<string, unknown>]));
  const pageById = new Map((project.pages ?? []).map((p) => [p.id, p as unknown as Record<string, unknown>]));

  const hotspotById = new Map<string, Record<string, unknown>>();
  for (const sc of project.scenes) {
    for (const h of sc.hotspots) {
      hotspotById.set(h.id, h as unknown as Record<string, unknown>);
    }
  }

  for (const ch of changes) {
    if (ch.entityType === 'scene') {
      if (!scenePatch[ch.entityId]) scenePatch[ch.entityId] = {};
      applyField(scenePatch[ch.entityId], ch.field, ch.patchValue, sceneById.get(ch.entityId));
    } else if (ch.entityType === 'hotspot') {
      const sceneId = ch.parentId ?? '';
      if (!hotspotPatch[ch.entityId]) hotspotPatch[ch.entityId] = { sceneId, patch: {} };
      applyField(hotspotPatch[ch.entityId].patch, ch.field, ch.patchValue, hotspotById.get(ch.entityId));
    } else if (ch.entityType === 'category') {
      if (!catPatch[ch.entityId]) catPatch[ch.entityId] = {};
      applyField(catPatch[ch.entityId], ch.field, ch.patchValue, catById.get(ch.entityId));
    } else if (ch.entityType === 'page') {
      if (!pagePatch[ch.entityId]) pagePatch[ch.entityId] = {};
      applyField(pagePatch[ch.entityId], ch.field, ch.patchValue, pageById.get(ch.entityId));
    } else if (ch.entityType === 'analytics') {
      applyField(analyticsPatch, ch.field, ch.patchValue, project.analytics as unknown as Record<string, unknown>);
    } else if (ch.entityType === 'project') {
      metaPatch[ch.field] = ch.patchValue;
    } else if (ch.entityType === 'modules') {
      modulesPatch[ch.field] = ch.patchValue;
    } else if (ch.entityType === 'ai_context') {
      aiContextPatch[ch.field] = ch.patchValue;
    }
  }

  return {
    scenePatch,
    catPatch,
    pagePatch,
    analyticsPatch: Object.keys(analyticsPatch).length ? analyticsPatch : undefined,
    hotspotPatch: Object.keys(hotspotPatch).length ? hotspotPatch : undefined,
    metaPatch: Object.keys(metaPatch).length ? metaPatch : undefined,
    modulesPatch: Object.keys(modulesPatch).length ? modulesPatch : undefined,
    aiContextPatch: Object.keys(aiContextPatch).length ? aiContextPatch : undefined,
  };
}

// ── Main screen ───────────────────────────────────────────────────────────────

export function ContentScreen() {
  const { project, updateScene, applyImport, undo, recordAiUsage } = useProject();
  const langs = project.languages.available ?? ['en'];
  const defaultLang = project.languages.default || 'en';
  const projectDir = useProject((s) => s.projectDir);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [showGenModal, setShowGenModal] = useState(false);
  const [genScopeSceneId, setGenScopeSceneId] = useState<string | null>(null);
  const [pendingDiff, setPendingDiff] = useState<ImportDiffResult | null>(null);
  const [importUndoBanner, setImportUndoBanner] = useState<string | null>(null);
  const undoBannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function showUndoBanner(summary: string) {
    if (undoBannerTimer.current) clearTimeout(undoBannerTimer.current);
    setImportUndoBanner(summary);
    undoBannerTimer.current = setTimeout(() => setImportUndoBanner(null), 60_000);
  }

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selected.size === project.scenes.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(project.scenes.map((s) => s.id)));
    }
  }, [selected.size, project.scenes]);

  async function handleExport() {
    const result = await window.conchitect.exportExcelStyled(project);
    if (!result.canceled && result.path) showToast(`Exported to ${result.path.split('\\').pop()}`);
    else if (result.error) showToast(`Export failed: ${result.error}`);
  }

  async function handleImport() {
    let result;
    try {
      result = await window.conchitect.importExcel(project);
    } catch (err) {
      showToast(`Import error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (result.canceled) return;
    if (result.error) {
      showToast(result.error);
      return;
    }
    if (result.changes.length === 0 && result.validationErrors.length === 0) {
      showToast('No changes found in the Excel file.');
      return;
    }
    setPendingDiff(result);
  }

  async function handleApplyImport(accepted: ImportChange[]) {
    setPendingDiff(null);
    if (accepted.length === 0) return;

    const { scenePatch, catPatch, pagePatch, analyticsPatch, hotspotPatch, metaPatch, modulesPatch, aiContextPatch } = buildPatchesFromChanges(accepted, project);
    applyImport(scenePatch, catPatch, pagePatch, analyticsPatch, hotspotPatch, metaPatch, modulesPatch, aiContextPatch);

    const summary = `${accepted.length} change${accepted.length !== 1 ? 's' : ''} imported`;
    showToast(summary);
    showUndoBanner(summary);

    // Try silent git commit in the background
    if (projectDir) {
      window.conchitect.gitCommit(projectDir, `Excel import: ${summary}`).catch(() => {});
    }
  }

  function handleUndoImport() {
    undo();
    setImportUndoBanner(null);
    showToast('Import undone.');
  }

  function openGenerateModal(sceneId?: string) {
    setGenScopeSceneId(sceneId ?? null);
    setShowGenModal(true);
  }

  if (project.scenes.length === 0) {
    return (
      <ScreenShell title="Content" subtitle="Edit titles and descriptions across all scenes.">
        <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
          <Languages size={32} className="text-ink-faded" />
          <p className="text-sm text-ink-soft">No scenes yet. Import photos first.</p>
        </div>
      </ScreenShell>
    );
  }

  const allSelected = selected.size === project.scenes.length;

  return (
    <ScreenShell title="Content" subtitle="Edit titles and descriptions across all scenes.">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={handleImport} className="btn gap-1.5 text-xs">
          <Upload size={13} /> Import Excel
        </button>
        <button onClick={handleExport} className="btn gap-1.5 text-xs">
          <Download size={13} /> Export Excel
        </button>
        <div className="flex-1" />
        <button
          onClick={() => openGenerateModal()}
          className="btn btn-accent gap-1.5 text-xs"
        >
          <Sparkles size={13} />
          Generate with AI…
          {selected.size > 0 && <span className="text-accent/70">({selected.size} selected)</span>}
        </button>
      </div>

      {/* ── Undo import banner ────────────────────────────────────────────── */}
      {importUndoBanner && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          <span className="flex-1">{importUndoBanner} — data updated.</span>
          <button
            onClick={handleUndoImport}
            className="flex items-center gap-1 font-medium text-amber-700 hover:text-amber-900"
          >
            <Undo2 size={11} /> Undo import
          </button>
          <button onClick={() => setImportUndoBanner(null)} className="text-amber-500 hover:text-amber-700 ml-1">×</button>
        </div>
      )}

      {/* ── Grid ─────────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="text-left w-full border-collapse">
          <thead>
            <tr className="bg-paper-strong border-b border-line">
              <th className="px-2 py-2 w-6">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="w-3.5 h-3.5 accent-accent"
                />
              </th>
              <th className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faded w-16">
                Photo
              </th>
              <th className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faded w-32">
                Slug
              </th>
              {langs.map((lang) => (
                <th key={`th-title-${lang}`} className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faded min-w-[140px]">
                  Title <span className="text-accent font-bold">{lang.toUpperCase()}</span>
                </th>
              ))}
              {langs.map((lang) => (
                <th key={`th-desc-${lang}`} className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faded min-w-[180px]">
                  Description <span className="text-accent font-bold">{lang.toUpperCase()}</span>
                </th>
              ))}
              <th className="px-2 py-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {project.scenes.map((scene) => (
              <SceneRow
                key={scene.id}
                scene={scene}
                langs={langs}
                defaultLang={defaultLang}
                selected={selected.has(scene.id)}
                onToggleSelect={() => toggleSelect(scene.id)}
                onUpdateTitle={(lang, val) =>
                  updateScene(scene.id, { title: { ...scene.title, [lang]: val } })
                }
                onUpdateDesc={(lang, val) =>
                  updateScene(scene.id, { description: { ...scene.description, [lang]: val } })
                }
                onGenerateCell={(_field, _lang) => openGenerateModal(scene.id)}
                onGenerateScene={() => openGenerateModal(scene.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Legend ───────────────────────────────────────────────────────── */}
      <p className="text-[11px] text-ink-faded mt-2">
        Click any cell to edit inline · Hover a cell for the{' '}
        <Sparkles size={10} className="inline text-purple-400" /> AI button ·
        {selected.size > 0
          ? ` ${selected.size} scene${selected.size !== 1 ? 's' : ''} selected`
          : ' Use checkboxes to select scenes for batch generation'}
      </p>

      {/* ── Import diff modal ─────────────────────────────────────────────── */}
      {pendingDiff && (
        <ImportDiffModal
          changes={pendingDiff.changes}
          validationErrors={pendingDiff.validationErrors}
          onApply={handleApplyImport}
          onCancel={() => setPendingDiff(null)}
        />
      )}

      {/* ── Generate modal ────────────────────────────────────────────────── */}
      {showGenModal && (
        <GenerateModal
          project={project}
          selectedSceneIds={genScopeSceneId ? new Set([genScopeSceneId]) : selected}
          defaultLang={defaultLang}
          onClose={() => setShowGenModal(false)}
          onApply={(patches) => {
            for (const [sceneId, patch] of Object.entries(patches)) {
              updateScene(sceneId, patch as Partial<Scene>);
            }
            showToast(`Applied AI content to ${Object.keys(patches).length} scene${Object.keys(patches).length !== 1 ? 's' : ''}`);
          }}
          onToast={showToast}
          onRecordUsage={(tokensIn, tokensOut, modelId, provider) => {
            recordAiUsage({ provider, modelId, inputTokens: tokensIn, outputTokens: tokensOut, costUsd: computeAiCost(modelId, tokensIn, tokensOut), operation: 'content-gen' });
          }}
        />
      )}

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-xs px-4 py-2 rounded-full shadow-lg z-50 pointer-events-none">
          {toast}
        </div>
      )}
    </ScreenShell>
  );
}
