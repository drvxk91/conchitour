import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { Check, X, MapPin, Globe } from 'lucide-react';
import { useProject } from '@/store/project';
import { isValidSlug } from '@/lib/slug';
import { normalizeHeading } from '@/lib/heading';
import type { Scene } from '@/types';

export function MetaTab({ scene }: { scene: Scene }) {
  const { project, updateScene } = useProject();

  const langs = project.languages.available.length ? project.languages.available : ['en'];
  const defaultLang = project.languages.default || 'en';
  const [lang, setLang] = useState(langs.includes(defaultLang) ? defaultLang : langs[0]);

  const [slug, setSlug]   = useState(scene.slug);
  const [title, setTitle] = useState(scene.title[lang] ?? '');
  const [desc, setDesc]   = useState(scene.description[lang] ?? '');

  // Sync when active scene or editing language changes
  useEffect(() => {
    setSlug(scene.slug);
    setTitle(scene.title[lang] ?? '');
    setDesc(scene.description[lang] ?? '');
  }, [scene.id, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const otherSlugs = project.scenes.filter((s) => s.id !== scene.id).map((s) => s.slug);
  const slugValid  = isValidSlug(slug);
  const slugTaken  = otherSlugs.includes(slug);
  const slugOk     = slugValid && !slugTaken;

  function saveSlug() {
    if (slugOk) updateScene(scene.id, { slug });
    else setSlug(scene.slug); // revert
  }

  function saveTitle() {
    updateScene(scene.id, { title: { ...scene.title, [lang]: title } });
  }

  function saveDesc() {
    updateScene(scene.id, { description: { ...scene.description, [lang]: desc } });
  }

  function toggleCategory(catId: string) {
    const ids = scene.categoryIds.includes(catId)
      ? scene.categoryIds.filter((id) => id !== catId)
      : [...scene.categoryIds, catId];
    updateScene(scene.id, { categoryIds: ids });
  }

  return (
    <div className="p-4 space-y-4 text-sm">
      {/* Slug */}
      <div>
        <label className="label-sm">Slug</label>
        <div className="flex items-center gap-1.5">
          <input
            data-testid="slug-input"
            className={clsx(
              'input flex-1',
              !slugOk && slug !== scene.slug && 'border-red-400 focus:outline-red-400'
            )}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            onBlur={saveSlug}
            spellCheck={false}
          />
        </div>
        {slug !== scene.slug && (
          <p className={clsx('text-[11px] mt-0.5 flex items-center gap-1', slugOk ? 'text-green-600' : 'text-red-500')}>
            {slugOk
              ? <><Check size={10} /> available</>
              : slugTaken
                ? <><X size={10} /> <span data-testid="slug-error">already used</span></>
                : <><X size={10} /> <span data-testid="slug-error">invalid — lowercase letters, digits, _ and - only (2–50 chars)</span></>
            }
          </p>
        )}
        {slug === scene.slug && slugOk && (
          <p className="text-[11px] mt-0.5 flex items-center gap-1 text-green-600">
            <Check size={10} /> available
          </p>
        )}
      </div>

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

      {/* Title */}
      <div>
        <label className="label-sm">Title [{lang.toUpperCase()}]</label>
        <input
          data-testid="title-input"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
        />
      </div>

      {/* Description */}
      <div>
        <label className="label-sm">Description [{lang.toUpperCase()}]</label>
        <textarea
          className="input resize-none h-20"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={saveDesc}
        />
      </div>

      {/* Categories */}
      {project.categories.length > 0 && (
        <div>
          <label className="label-sm">Categories</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {project.categories.map((cat) => {
              const active = scene.categoryIds.includes(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => toggleCategory(cat.id)}
                  className="text-[11px] px-2 py-0.5 rounded border transition-colors"
                  style={
                    active
                      ? { backgroundColor: cat.color, borderColor: cat.color, color: '#fff' }
                      : { borderColor: '#d4d3cd', color: '#6b6b68' }
                  }
                >
                  {cat.name.en ?? cat.slug}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* GPS (read-only) */}
      <div>
        <label className="label-sm flex items-center gap-1">
          <MapPin size={11} /> GPS
        </label>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="label-sm">Lat</label>
            <input className="input" value={scene.geo.lat.toFixed(6)} readOnly />
          </div>
          <div className="flex-1">
            <label className="label-sm">Lng</label>
            <input className="input" value={scene.geo.lng.toFixed(6)} readOnly />
          </div>
        </div>
        <p className="help-sm">Edit coordinates via the Map screen.</p>
      </div>

      {/* Heading + Capture height */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="label-sm">Heading (°)</label>
          <input
            data-testid="heading-input"
            type="number"
            className="input"
            value={scene.heading}
            onChange={(e) => updateScene(scene.id, { heading: normalizeHeading(Number(e.target.value)) })}
          />
          <p className="help-sm">Or use the Set North tool in the toolbar (N).</p>
        </div>
        <div className="flex-1">
          <label className="label-sm">Camera height (m)</label>
          <input
            type="number"
            step="0.1"
            className="input"
            value={scene.captureHeightMeters}
            onChange={(e) => updateScene(scene.id, { captureHeightMeters: Number(e.target.value) })}
          />
        </div>
      </div>
    </div>
  );
}
