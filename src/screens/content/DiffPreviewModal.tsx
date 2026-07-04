import { useState } from 'react';
import { Check, X, ImageOff } from 'lucide-react';
import clsx from 'clsx';
import type { Project, Scene } from '@/types';
import { toLocalUrl } from '@/lib/local-url';
import type { SceneContentResult } from '@/lib/ai-content';

interface DiffPreviewModalProps {
  project: Project;
  results: SceneContentResult[];
  onApply: (kept: SceneContentResult[]) => void;
  onCancel: () => void;
}

interface FieldDiff {
  field: 'title' | 'description' | 'altText';
  lang: string;
  oldVal: string;
  newVal: string;
}

function computeDiff(scene: Scene, result: SceneContentResult): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of ['title', 'description', 'altText'] as const) {
    const newMap = result[field];
    if (!newMap) continue;
    for (const [lang, newVal] of Object.entries(newMap)) {
      const oldVal = (scene[field] as Record<string, string> | undefined)?.[lang] ?? '';
      if (newVal && newVal !== oldVal) {
        diffs.push({ field, lang, oldVal, newVal });
      }
    }
  }
  return diffs;
}

interface SceneDiffRowProps {
  scene: Scene;
  result: SceneContentResult;
  kept: boolean;
  onToggle: () => void;
  diffs: FieldDiff[];
}

function SceneDiffRow({ scene, result, kept, onToggle, diffs }: SceneDiffRowProps) {
  const [expanded, setExpanded] = useState(true);
  const [imgError, setImgError] = useState(false);
  const thumbUrl = scene.media?.sourcePath && !imgError ? toLocalUrl(scene.media.sourcePath) : null;

  const FIELD_LABELS = { title: 'Title', description: 'Description', altText: 'Alt text' };

  return (
    <div className={clsx('rounded-xl border transition-all', kept ? 'border-line' : 'border-line-soft opacity-50')}>
      {/* Row header */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          checked={kept}
          onChange={onToggle}
          className="w-3.5 h-3.5 accent-accent shrink-0"
        />
        <div className="w-10 h-7 rounded overflow-hidden bg-line shrink-0">
          {thumbUrl
            ? <img src={thumbUrl} alt="" className="w-full h-full object-cover" onError={() => setImgError(true)} />
            : <div className="w-full h-full flex items-center justify-center"><ImageOff size={10} className="text-ink-faded" /></div>}
        </div>
        <span className="text-xs font-mono text-ink-soft flex-1">{scene.slug}</span>
        {result.error ? (
          <span title={result.error} className="text-[10px] text-red-500 max-w-[220px] truncate cursor-help">⚠ {result.error}</span>
        ) : (
          <span className="text-[10px] text-ink-faded">{diffs.length} change{diffs.length !== 1 ? 's' : ''}</span>
        )}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] text-ink-faded hover:text-ink px-1.5 py-0.5 rounded border border-line-soft"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {/* Diffs */}
      {expanded && diffs.length > 0 && (
        <div className="border-t border-line-soft px-3 py-2 space-y-2">
          {diffs.map((d, i) => (
            <div key={i} className="text-xs space-y-0.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-faded">
                {FIELD_LABELS[d.field]} · {d.lang.toUpperCase()}
              </div>
              {d.oldVal && (
                <div className="bg-red-50 border border-red-100 rounded px-2 py-1 text-ink-soft line-through leading-relaxed">
                  {d.oldVal}
                </div>
              )}
              <div className="bg-green-50 border border-green-200 rounded px-2 py-1 text-green-800 leading-relaxed">
                {d.newVal}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DiffPreviewModal({ project, results, onApply, onCancel }: DiffPreviewModalProps) {
  const [kept, setKept] = useState<Set<string>>(new Set(results.map((r) => r.sceneId)));

  const toggle = (id: string) => setKept((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const toggleAll = () => {
    if (kept.size === results.length) setKept(new Set());
    else setKept(new Set(results.map((r) => r.sceneId)));
  };

  const rows = results.map((r) => {
    const scene = project.scenes.find((s) => s.id === r.sceneId);
    if (!scene) return null;
    const diffs = computeDiff(scene, r);
    return { r, scene, diffs };
  }).filter(Boolean) as { r: SceneContentResult; scene: Scene; diffs: FieldDiff[] }[];

  const totalChanges = rows.reduce((n, { diffs }) => n + diffs.length, 0);

  function handleApply() {
    onApply(results.filter((r) => kept.has(r.sceneId)));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-paper rounded-2xl shadow-2xl border border-line w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-line shrink-0">
          <span className="text-sm font-semibold text-ink flex-1">
            Review AI content — {totalChanges} change{totalChanges !== 1 ? 's' : ''} across {rows.length} scene{rows.length !== 1 ? 's' : ''}
          </span>
          <button onClick={onCancel} className="text-ink-faded hover:text-ink transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Batch actions */}
        <div className="flex items-center gap-3 px-5 py-2 border-b border-line-soft bg-paper-tinted shrink-0">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={kept.size === results.length}
              onChange={toggleAll}
              className="w-3.5 h-3.5 accent-accent"
            />
            Keep all ({results.length})
          </label>
          <button
            onClick={() => setKept(new Set())}
            className="text-xs text-ink-faded hover:text-ink transition-colors"
          >
            Reject all
          </button>
          <span className="text-xs text-ink-faded ml-auto">
            {kept.size} of {results.length} selected
          </span>
        </div>

        {/* Scene list */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          {rows.length === 0 && (
            <p className="text-sm text-ink-faded text-center py-8">No changes to review.</p>
          )}
          {rows.map(({ r, scene, diffs }) => (
            <SceneDiffRow
              key={r.sceneId}
              scene={scene}
              result={r}
              kept={kept.has(r.sceneId)}
              onToggle={() => toggle(r.sceneId)}
              diffs={diffs}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-line shrink-0">
          <button onClick={onCancel} className="btn text-xs">
            <X size={13} /> Discard all
          </button>
          <div className="flex-1" />
          <button
            onClick={handleApply}
            disabled={kept.size === 0}
            className={clsx('btn gap-2 text-xs', kept.size > 0 ? 'btn-accent' : 'opacity-50 cursor-not-allowed')}
          >
            <Check size={13} />
            Apply {kept.size} scene{kept.size !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
