import { useState } from 'react';
import clsx from 'clsx';
import { Plus, Trash2, ChevronDown, Link, Video, Type, ExternalLink, ClipboardList } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { useProject } from '@/store/project';
import type { Scene, Hotspot } from '@/types';

const TYPE_ICONS: Record<Hotspot['type'], typeof Link> = {
  link: Link, video: Video, text: Type, external: ExternalLink, form: ClipboardList,
};

function targetLabel(h: Hotspot, scenes: { id: string; title: { en?: string }; slug: string }[]): string {
  if (h.type === 'link') {
    const t = scenes.find((s) => s.id === h.targetSceneId);
    return t ? (t.title.en || t.slug) : '(unset)';
  }
  if (h.type === 'video' || h.type === 'external') return h.url || '—';
  if (h.type === 'text')   return h.title || '—';
  if (h.type === 'form')   return h.mailto || '—';
  return '—';
}

export function HotspotsTab({ scene }: { scene: Scene }) {
  const { project, addHotspot, updateHotspot, deleteHotspot, activeHotspotId, setActiveHotspot } = useProject();
  const [addOpen, setAddOpen] = useState(false);

  const TYPES: Hotspot['type'][] = ['link', 'video', 'text', 'external', 'form'];

  function createHotspot(type: Hotspot['type']) {
    const base = { id: uuid(), ath: 0, atv: 0 };
    let h: Hotspot;
    if (type === 'link')     h = { ...base, type: 'link', targetSceneId: '' };
    else if (type === 'video')    h = { ...base, type: 'video', url: '', title: '' };
    else if (type === 'text')     h = { ...base, type: 'text', title: '', body: '' };
    else if (type === 'external') h = { ...base, type: 'external', url: '', label: '' };
    else                          h = { ...base, type: 'form', mailto: '', subject: '', fields: [] };
    addHotspot(scene.id, h);
    setActiveHotspot(h.id);
    setAddOpen(false);
  }

  return (
    <div className="p-3 text-sm space-y-2" data-testid="hotspots-tab">
      {scene.hotspots.length === 0 && (
        <p className="text-xs text-ink-faded py-4 text-center">
          No hotspots — double-click the viewer to add one.
        </p>
      )}

      {scene.hotspots.length > 0 && (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-ink-faded">
              <th className="text-left pb-1 font-medium">Type</th>
              <th className="text-left pb-1 font-medium">Target</th>
              <th className="text-right pb-1 font-medium">ath</th>
              <th className="text-right pb-1 font-medium">atv</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {scene.hotspots.map((h) => {
              const Icon = TYPE_ICONS[h.type];
              const isSelected = h.id === activeHotspotId;
              return (
                <tr
                  key={h.id}
                  data-testid={`hotspot-row-${h.id}`}
                  onClick={() => setActiveHotspot(isSelected ? null : h.id)}
                  className={clsx(
                    'cursor-pointer rounded border-b border-line last:border-0',
                    isSelected ? 'bg-ink/5' : 'hover:bg-paper-tinted'
                  )}
                >
                  <td className="py-1 pr-1">
                    <Icon size={11} className="text-ink-soft" />
                  </td>
                  <td className="py-1 pr-1 max-w-[80px] truncate text-ink">
                    {h.type === 'link' ? (
                      <select
                        className="text-xs bg-transparent w-full outline-none"
                        value={(h as import('@/types').LinkHotspot).targetSceneId}
                        onChange={(e) => {
                          e.stopPropagation();
                          updateHotspot(scene.id, h.id, { targetSceneId: e.target.value } as Partial<Hotspot>);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <option value="">(unset)</option>
                        {project.scenes
                          .filter((s) => s.id !== scene.id)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.title.en || s.slug}
                            </option>
                          ))}
                      </select>
                    ) : (
                      targetLabel(h, project.scenes)
                    )}
                  </td>
                  <td className="py-1 pr-1 text-right text-ink-soft w-10">
                    <input
                      type="number"
                      className="w-12 text-xs text-right bg-transparent outline-none"
                      value={Math.round(h.ath)}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateHotspot(scene.id, h.id, { ath: Number(e.target.value) });
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="py-1 pr-1 text-right text-ink-soft w-10">
                    <input
                      type="number"
                      className="w-12 text-xs text-right bg-transparent outline-none"
                      value={Math.round(h.atv)}
                      onChange={(e) => {
                        e.stopPropagation();
                        updateHotspot(scene.id, h.id, { atv: Number(e.target.value) });
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="py-1 text-right">
                    <button
                      className="text-ink-faded hover:text-red-500"
                      onClick={(e) => { e.stopPropagation(); deleteHotspot(scene.id, h.id); }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Add hotspot */}
      <div className="relative">
        <button
          className="btn text-xs w-full justify-center gap-1"
          onClick={() => setAddOpen((o) => !o)}
          data-testid="add-hotspot-btn"
        >
          <Plus size={12} /> Add hotspot <ChevronDown size={11} />
        </button>
        {addOpen && (
          <div className="absolute bottom-full left-0 mb-1 bg-paper border border-line-strong rounded-lg shadow-lg z-50 w-full py-1">
            {TYPES.map((t) => {
              const Icon = TYPE_ICONS[t];
              return (
                <button
                  key={t}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-ink hover:bg-paper-tinted"
                  onClick={() => createHotspot(t)}
                >
                  <Icon size={12} className="text-ink-soft" />
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
