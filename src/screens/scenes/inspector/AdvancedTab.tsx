import { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { useProject } from '@/store/project';
import type { Scene } from '@/types';

export function AdvancedTab({ scene, onDelete }: { scene: Scene; onDelete: () => void }) {
  const { updateScene } = useProject();

  const dv = scene.defaultView ?? { hlookat: 0, vlookat: 0, fov: 90 };
  const [hlookat, setHlookat] = useState(String(dv.hlookat));
  const [vlookat, setVlookat] = useState(String(dv.vlookat));
  const [fov,     setFov]     = useState(String(dv.fov));
  const [altText, setAltText] = useState(scene.altText.en ?? '');

  useEffect(() => {
    const v = scene.defaultView ?? { hlookat: 0, vlookat: 0, fov: 90 };
    setHlookat(String(v.hlookat));
    setVlookat(String(v.vlookat));
    setFov(String(v.fov));
    setAltText(scene.altText.en ?? '');
  }, [scene.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function saveView() {
    updateScene(scene.id, {
      defaultView: {
        hlookat: Number(hlookat),
        vlookat: Number(vlookat),
        fov:     Number(fov),
      },
    });
  }

  return (
    <div className="p-4 space-y-5 text-sm">
      {/* Default view */}
      <div>
        <label className="label-sm">Default view</label>
        <div className="flex gap-2 mt-1">
          {[
            { label: 'H look', value: hlookat, set: setHlookat },
            { label: 'V look', value: vlookat, set: setVlookat },
            { label: 'FOV',    value: fov,     set: setFov },
          ].map(({ label, value, set }) => (
            <div key={label} className="flex-1">
              <label className="label-sm">{label}</label>
              <input
                type="number"
                className="input"
                value={value}
                onChange={(e) => set(e.target.value)}
                onBlur={saveView}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Alt text (SEO) */}
      <div>
        <label className="label-sm">Alt text (SEO)</label>
        <textarea
          className="input resize-none h-16"
          value={altText}
          onChange={(e) => setAltText(e.target.value)}
          onBlur={() => updateScene(scene.id, { altText: { ...scene.altText, en: altText } })}
        />
        <p className="help-sm">Used in the image sitemap and OG tags.</p>
      </div>

      {/* Slug (read-only here) */}
      <div>
        <label className="label-sm">URL slug</label>
        <input className="input bg-paper-tinted" value={scene.slug} readOnly />
        <p className="help-sm">Edit in the Meta tab.</p>
      </div>

      {/* Danger zone */}
      <div className="border border-red-200 rounded-lg p-3 space-y-2">
        <p className="text-xs font-medium text-red-700">Danger zone</p>
        <button
          onClick={onDelete}
          className="btn btn-danger text-xs w-full justify-center gap-1"
        >
          <Trash2 size={12} />
          Delete this scene
        </button>
      </div>
    </div>
  );
}
