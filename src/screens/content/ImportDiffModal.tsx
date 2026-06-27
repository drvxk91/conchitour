import { useState, useMemo } from 'react';
import { X, AlertTriangle, CheckSquare, Square, ChevronDown, ChevronRight } from 'lucide-react';
import type { ImportChange, ImportValidationError } from '../../../electron/preload';

interface Props {
  changes: ImportChange[];
  validationErrors: ImportValidationError[];
  onApply: (accepted: ImportChange[]) => void;
  onCancel: () => void;
}

const ENTITY_LABELS: Record<ImportChange['entityType'], string> = {
  scene: 'Scenes',
  hotspot: 'Hotspots',
  category: 'Categories',
  page: 'Pages',
  analytics: 'Analytics',
  project: 'Project',
  modules: 'Modules',
  ai_context: 'AI Context',
};

function FieldLabel({ field }: { field: string }) {
  const parts = field.split('.');
  if (parts.length === 2) {
    return (
      <span className="text-ink-faded font-mono text-[11px]">
        {parts[0]}
        <span className="text-ink-faded/50">.</span>
        <span className="text-accent/80">{parts[1]}</span>
      </span>
    );
  }
  return <span className="text-ink-faded font-mono text-[11px]">{field}</span>;
}

export function ImportDiffModal({ changes, validationErrors, onApply, onCancel }: Props) {
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set(changes.map((c) => c.id)));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const map = new Map<ImportChange['entityType'], Map<string, ImportChange[]>>();
    for (const ch of changes) {
      if (!map.has(ch.entityType)) map.set(ch.entityType, new Map());
      const entityMap = map.get(ch.entityType)!;
      if (!entityMap.has(ch.entityId)) entityMap.set(ch.entityId, []);
      entityMap.get(ch.entityId)!.push(ch);
    }
    return map;
  }, [changes]);

  function toggleChange(id: string) {
    setAccepted((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function toggleEntity(entityId: string, entityChanges: ImportChange[]) {
    const ids = entityChanges.map((c) => c.id);
    const allSelected = ids.every((id) => accepted.has(id));
    setAccepted((prev) => {
      const n = new Set(prev);
      if (allSelected) ids.forEach((id) => n.delete(id));
      else ids.forEach((id) => n.add(id));
      return n;
    });
  }

  function toggleEntityType(type: ImportChange['entityType']) {
    const ids = changes.filter((c) => c.entityType === type).map((c) => c.id);
    const allSelected = ids.every((id) => accepted.has(id));
    setAccepted((prev) => {
      const n = new Set(prev);
      if (allSelected) ids.forEach((id) => n.delete(id));
      else ids.forEach((id) => n.add(id));
      return n;
    });
  }

  function selectAll() { setAccepted(new Set(changes.map((c) => c.id))); }
  function deselectAll() { setAccepted(new Set()); }

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }

  const acceptedList = changes.filter((c) => accepted.has(c.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-paper rounded-2xl shadow-2xl border border-line w-[680px] max-h-[80vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-line shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-ink-strong">Review Excel import</h2>
            <p className="text-xs text-ink-faded mt-0.5">
              {changes.length} change{changes.length !== 1 ? 's' : ''} detected
              {validationErrors.length > 0 && ` · ${validationErrors.length} format error${validationErrors.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button onClick={onCancel} className="text-ink-faded hover:text-ink transition-colors p-1 rounded">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Validation errors */}
          {validationErrors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-red-700 flex items-center gap-1.5">
                <AlertTriangle size={12} /> Format errors (these rows were skipped)
              </p>
              <div className="space-y-1">
                {validationErrors.map((err, i) => (
                  <div key={i} className="text-xs text-red-600">
                    <span className="font-medium">{err.entityLabel}</span>
                    {' · '}
                    <span className="font-mono">{err.field}</span>
                    {' · '}
                    <span className="italic">"{err.value}"</span>
                    {' — '}
                    {err.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No changes */}
          {changes.length === 0 && (
            <p className="text-sm text-ink-faded text-center py-8">No data changes found in this file.</p>
          )}

          {/* Changes list */}
          {changes.length > 0 && (
            <>
              {/* Select controls */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-ink-faded">{accepted.size} of {changes.length} selected</span>
                <div className="flex-1" />
                <button onClick={selectAll} className="text-xs text-accent hover:underline">Select all</button>
                <button onClick={deselectAll} className="text-xs text-ink-faded hover:underline">Deselect all</button>
              </div>

              {/* Grouped by entity type */}
              {Array.from(grouped.entries()).map(([type, entityMap]) => {
                const typeChanges = changes.filter((c) => c.entityType === type);
                const typeSelected = typeChanges.every((c) => accepted.has(c.id));
                const typeSome = typeChanges.some((c) => accepted.has(c.id));
                const typeCollapsed = collapsed.has(type);

                return (
                  <div key={type} className="border border-line-soft rounded-xl overflow-hidden">
                    {/* Section header */}
                    <div
                      className="flex items-center gap-2 px-3 py-2 bg-paper-strong cursor-pointer select-none"
                      onClick={() => toggleCollapse(type)}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleEntityType(type); }}
                        className="text-ink-faded hover:text-accent transition-colors shrink-0"
                      >
                        {typeSelected ? <CheckSquare size={14} className="text-accent" /> : typeSome ? <CheckSquare size={14} className="text-accent/50" /> : <Square size={14} />}
                      </button>
                      <span className="text-xs font-semibold text-ink-strong flex-1">{ENTITY_LABELS[type]}</span>
                      <span className="text-[11px] text-ink-faded">{typeChanges.length} change{typeChanges.length !== 1 ? 's' : ''}</span>
                      {typeCollapsed ? <ChevronRight size={12} className="text-ink-faded" /> : <ChevronDown size={12} className="text-ink-faded" />}
                    </div>

                    {/* Entity rows */}
                    {!typeCollapsed && (
                      <div className="divide-y divide-line-soft/50">
                        {Array.from(entityMap.entries()).map(([entityId, entityChanges]) => {
                          const entityLabel = entityChanges[0].entityLabel;
                          const entitySelected = entityChanges.every((c) => accepted.has(c.id));
                          const entityKey = `${type}:${entityId}`;
                          const entityCollapsed = collapsed.has(entityKey);

                          return (
                            <div key={entityId}>
                              {/* Entity header */}
                              <div
                                className="flex items-center gap-2 px-3 py-1.5 bg-paper-tinted/60 cursor-pointer select-none"
                                onClick={() => toggleCollapse(entityKey)}
                              >
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleEntity(entityId, entityChanges); }}
                                  className="text-ink-faded hover:text-accent transition-colors shrink-0"
                                >
                                  {entitySelected ? <CheckSquare size={12} className="text-accent" /> : <Square size={12} />}
                                </button>
                                <span className="text-xs font-medium text-ink flex-1 truncate">{entityLabel}</span>
                                <span className="text-[11px] text-ink-faded">{entityChanges.length}</span>
                                {entityCollapsed ? <ChevronRight size={11} className="text-ink-faded" /> : <ChevronDown size={11} className="text-ink-faded" />}
                              </div>

                              {/* Field rows */}
                              {!entityCollapsed && (
                                <div className="divide-y divide-line-soft/30">
                                  {entityChanges.map((ch) => (
                                    <label
                                      key={ch.id}
                                      className="flex items-start gap-2.5 px-3 py-2 cursor-pointer hover:bg-paper-tinted/30 transition-colors"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={accepted.has(ch.id)}
                                        onChange={() => toggleChange(ch.id)}
                                        className="mt-0.5 w-3.5 h-3.5 accent-accent shrink-0"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <FieldLabel field={ch.field} />
                                        <div className="flex items-baseline gap-1.5 mt-0.5 flex-wrap">
                                          <span className="text-[11px] text-red-400/80 line-through truncate max-w-[200px]">{ch.oldValue}</span>
                                          <span className="text-[11px] text-ink-faded">→</span>
                                          <span className="text-[11px] text-green-600 truncate max-w-[200px]">{ch.newValue}</span>
                                        </div>
                                      </div>
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-line shrink-0">
          <button onClick={onCancel} className="btn text-xs">Cancel</button>
          <div className="flex-1" />
          {changes.length > 0 && (
            <button
              onClick={() => onApply(acceptedList)}
              disabled={accepted.size === 0}
              className="btn btn-accent text-xs disabled:opacity-40"
            >
              Apply {accepted.size} change{accepted.size !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
