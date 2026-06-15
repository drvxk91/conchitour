import { useState } from 'react';
import clsx from 'clsx';
import { Plus, Trash2, ChevronDown, Link, Video, Type, ExternalLink, ClipboardList, Globe } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { useProject } from '@/store/project';
import type { Scene, Hotspot, LinkHotspot, VideoHotspot, TextHotspot, ExternalHotspot, FormHotspot } from '@/types';

const TYPE_ICONS: Record<Hotspot['type'], typeof Link> = {
  link: Link, video: Video, text: Type, external: ExternalLink, form: ClipboardList,
};

function l(val: Record<string, string> | undefined, lang: string): string {
  if (!val) return '';
  return val[lang] ?? val.en ?? Object.values(val)[0] ?? '';
}

function targetLabel(h: Hotspot, lang: string, scenes: { id: string; title: Record<string, string>; slug: string }[]): string {
  if (h.type === 'link') {
    const t = scenes.find((s) => s.id === h.targetSceneId);
    return t ? (l(t.title, lang) || t.slug) : '(unset)';
  }
  if (h.type === 'video') return h.url || '—';
  if (h.type === 'text')  return l(h.title, lang) || '—';
  if (h.type === 'external') return h.url || '—';
  if (h.type === 'form')  return h.mailto || '—';
  return '—';
}

// ── Per-type editor ────────────────────────────────────────────────────────────

function LinkEditor({ scene, h, lang }: { scene: Scene; h: LinkHotspot; lang: string }) {
  const { project, updateHotspot } = useProject();
  function upd(patch: Partial<LinkHotspot>) { updateHotspot(scene.id, h.id, patch as Partial<Hotspot>); }
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-[10px] text-ink-faded uppercase tracking-wide">Target scene</span>
        <select
          className="mt-0.5 w-full bg-paper-strong border border-line-soft rounded px-2 py-1 text-xs text-ink focus:outline-none"
          value={h.targetSceneId}
          onChange={(e) => upd({ targetSceneId: e.target.value })}
        >
          <option value="">(unset)</option>
          {project.scenes.filter((s) => s.id !== scene.id).map((s) => (
            <option key={s.id} value={s.id}>{l(s.title, lang) || s.slug}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-[10px] text-ink-faded uppercase tracking-wide">Label (optional)</span>
        <input
          className="mt-0.5 w-full bg-paper-strong border border-line-soft rounded px-2 py-1 text-xs text-ink focus:outline-none"
          placeholder="Override label…"
          value={h.title?.[lang] ?? ''}
          onChange={(e) => upd({ title: { ...(h.title ?? {}), [lang]: e.target.value } })}
        />
      </label>
    </div>
  );
}

function VideoEditor({ scene, h, lang }: { scene: Scene; h: VideoHotspot; lang: string }) {
  const { updateHotspot } = useProject();
  function upd(patch: Partial<VideoHotspot>) { updateHotspot(scene.id, h.id, patch as Partial<Hotspot>); }
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-[10px] text-ink-faded uppercase tracking-wide">Video URL</span>
        <input
          className="mt-0.5 w-full bg-paper-strong border border-line-soft rounded px-2 py-1 text-xs text-ink focus:outline-none"
          placeholder="https://youtube.com/…"
          value={h.url}
          onChange={(e) => upd({ url: e.target.value })}
        />
      </label>
      <label className="block">
        <span className="text-[10px] text-ink-faded uppercase tracking-wide">Title [{lang}]</span>
        <input
          className="mt-0.5 w-full bg-paper-strong border border-line-soft rounded px-2 py-1 text-xs text-ink focus:outline-none"
          placeholder="Video title…"
          value={h.title[lang] ?? ''}
          onChange={(e) => upd({ title: { ...h.title, [lang]: e.target.value } })}
        />
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={h.autoplay ?? false} onChange={(e) => upd({ autoplay: e.target.checked })} />
        <span className="text-xs text-ink">Autoplay</span>
      </label>
    </div>
  );
}

function TextEditor({ scene, h, lang }: { scene: Scene; h: TextHotspot; lang: string }) {
  const { updateHotspot } = useProject();
  function upd(patch: Partial<TextHotspot>) { updateHotspot(scene.id, h.id, patch as Partial<Hotspot>); }
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-[10px] text-ink-faded uppercase tracking-wide">Title [{lang}]</span>
        <input
          className="mt-0.5 w-full bg-paper-strong border border-line-soft rounded px-2 py-1 text-xs text-ink focus:outline-none"
          placeholder="Panel title…"
          value={h.title[lang] ?? ''}
          onChange={(e) => upd({ title: { ...h.title, [lang]: e.target.value } })}
        />
      </label>
      <label className="block">
        <span className="text-[10px] text-ink-faded uppercase tracking-wide">Body [{lang}]</span>
        <textarea
          rows={4}
          className="mt-0.5 w-full bg-paper-strong border border-line-soft rounded px-2 py-1 text-xs text-ink focus:outline-none resize-none"
          placeholder="HTML content…"
          value={h.body[lang] ?? ''}
          onChange={(e) => upd({ body: { ...h.body, [lang]: e.target.value } })}
        />
      </label>
    </div>
  );
}

function ExternalEditor({ scene, h, lang }: { scene: Scene; h: ExternalHotspot; lang: string }) {
  const { updateHotspot } = useProject();
  function upd(patch: Partial<ExternalHotspot>) { updateHotspot(scene.id, h.id, patch as Partial<Hotspot>); }
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-[10px] text-ink-faded uppercase tracking-wide">URL</span>
        <input
          className="mt-0.5 w-full bg-paper-strong border border-line-soft rounded px-2 py-1 text-xs text-ink focus:outline-none"
          placeholder="https://…"
          value={h.url}
          onChange={(e) => upd({ url: e.target.value })}
        />
      </label>
      <label className="block">
        <span className="text-[10px] text-ink-faded uppercase tracking-wide">Button label [{lang}]</span>
        <input
          className="mt-0.5 w-full bg-paper-strong border border-line-soft rounded px-2 py-1 text-xs text-ink focus:outline-none"
          placeholder="Visit website…"
          value={h.label[lang] ?? ''}
          onChange={(e) => upd({ label: { ...h.label, [lang]: e.target.value } })}
        />
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={h.openInNewTab ?? true} onChange={(e) => upd({ openInNewTab: e.target.checked })} />
        <span className="text-xs text-ink">Open in new tab</span>
      </label>
    </div>
  );
}

function FormEditor({ scene, h, lang }: { scene: Scene; h: FormHotspot; lang: string }) {
  const { updateHotspot } = useProject();
  function upd(patch: Partial<FormHotspot>) { updateHotspot(scene.id, h.id, patch as Partial<Hotspot>); }
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-[10px] text-ink-faded uppercase tracking-wide">Send to (mailto)</span>
        <input
          className="mt-0.5 w-full bg-paper-strong border border-line-soft rounded px-2 py-1 text-xs text-ink focus:outline-none"
          placeholder="contact@example.com"
          value={h.mailto}
          onChange={(e) => upd({ mailto: e.target.value })}
        />
      </label>
      <label className="block">
        <span className="text-[10px] text-ink-faded uppercase tracking-wide">Subject [{lang}]</span>
        <input
          className="mt-0.5 w-full bg-paper-strong border border-line-soft rounded px-2 py-1 text-xs text-ink focus:outline-none"
          placeholder="Email subject…"
          value={h.subject[lang] ?? ''}
          onChange={(e) => upd({ subject: { ...h.subject, [lang]: e.target.value } })}
        />
      </label>
    </div>
  );
}

function HotspotEditor({ scene, h, lang }: { scene: Scene; h: Hotspot; lang: string }) {
  if (h.type === 'link')     return <LinkEditor     scene={scene} h={h} lang={lang} />;
  if (h.type === 'video')    return <VideoEditor    scene={scene} h={h} lang={lang} />;
  if (h.type === 'text')     return <TextEditor     scene={scene} h={h} lang={lang} />;
  if (h.type === 'external') return <ExternalEditor scene={scene} h={h} lang={lang} />;
  return <FormEditor scene={scene} h={h as FormHotspot} lang={lang} />;
}

// ── Main tab ───────────────────────────────────────────────────────────────────

export function HotspotsTab({ scene }: { scene: Scene }) {
  const { project, addHotspot, updateHotspot, deleteHotspot, activeHotspotId, setActiveHotspot } = useProject();
  const [addOpen, setAddOpen] = useState(false);

  const langs = project.languages.available.length ? project.languages.available : ['en'];
  const [lang, setLang] = useState(project.languages.default || 'en');

  const TYPES: Hotspot['type'][] = ['link', 'video', 'text', 'external', 'form'];

  function createHotspot(type: Hotspot['type']) {
    const base = { id: uuid(), ath: 0, atv: 0 };
    let h: Hotspot;
    if (type === 'link')     h = { ...base, type: 'link', targetSceneId: '' };
    else if (type === 'video')    h = { ...base, type: 'video', url: '', title: { en: '' } };
    else if (type === 'text')     h = { ...base, type: 'text', title: { en: '' }, body: { en: '' } };
    else if (type === 'external') h = { ...base, type: 'external', url: '', label: { en: '' } };
    else                          h = { ...base, type: 'form', mailto: '', subject: { en: '' }, fields: [] };
    addHotspot(scene.id, h);
    setActiveHotspot(h.id);
    setAddOpen(false);
  }

  const activeHotspot = scene.hotspots.find((h) => h.id === activeHotspotId) ?? null;

  return (
    <div className="p-3 text-sm space-y-2" data-testid="hotspots-tab">
      {/* Language selector (only when project has multiple languages) */}
      {langs.length > 1 && (
        <div className="flex items-center gap-1.5 text-xs text-ink-faded">
          <Globe size={11} />
          <span>Editing:</span>
          <select
            className="bg-paper-strong border border-line-soft rounded px-1.5 py-0.5 text-xs focus:outline-none"
            value={lang}
            onChange={(e) => setLang(e.target.value)}
          >
            {langs.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </div>
      )}

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
                    {targetLabel(h, lang, project.scenes)}
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

      {/* Per-type editor for the active hotspot */}
      {activeHotspot && (
        <div className="border border-line-soft rounded-lg p-3 bg-paper-strong space-y-1">
          <p className="text-[10px] font-medium text-ink-faded uppercase tracking-wide mb-2">
            {activeHotspot.type} hotspot
          </p>
          <HotspotEditor scene={scene} h={activeHotspot} lang={lang} />
        </div>
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

