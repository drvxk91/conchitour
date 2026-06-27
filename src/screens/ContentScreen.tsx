import { useState, useCallback } from 'react';
import {
  Sparkles, Download, Upload, ImageOff, Languages,
} from 'lucide-react';
import clsx from 'clsx';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { toLocalUrl } from '@/lib/local-url';
import type { Scene } from '@/types';
import { GenerateModal } from './content/GenerateModal';

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

export function ContentScreen() {
  const { project, updateScene } = useProject();
  const langs = project.languages.available ?? ['en'];
  const defaultLang = project.languages.default || 'en';

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [showGenModal, setShowGenModal] = useState(false);
  const [genScopeSceneId, setGenScopeSceneId] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
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
    const result = await window.conchitect.importExcel(project);
    if (result.canceled) return;
    if (result.scenePatch) {
      for (const [slug, patch] of Object.entries(result.scenePatch)) {
        const scene = project.scenes.find((s) => s.slug === slug);
        if (scene) updateScene(scene.id, patch as Partial<Scene>);
      }
    }
    showToast(`Imported${result.updated ? ` — ${result.updated} scenes updated` : ''}`);
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
                onGenerateCell={(field, lang) => openGenerateModal(scene.id)}
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
