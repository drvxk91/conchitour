import { useState, useMemo } from 'react';
import clsx from 'clsx';
import { Search, Plus } from 'lucide-react';
import { useProject } from '@/store/project';
import { toLocalUrl } from '@/lib/local-url';

export function SceneSidebar() {
  const { project, activeSceneId, setActiveScene } = useProject();
  const [query, setQuery] = useState('');
  const [filterCat, setFilterCat] = useState<string | null>(null);

  // Count incoming link hotspots per scene
  const incomingCount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const sc of project.scenes) {
      for (const h of sc.hotspots) {
        if (h.type === 'link' && h.targetSceneId) {
          map[h.targetSceneId] = (map[h.targetSceneId] ?? 0) + 1;
        }
      }
    }
    return map;
  }, [project.scenes]);

  const visible = project.scenes.filter((sc) => {
    if (filterCat && !sc.categoryIds.includes(filterCat)) return false;
    if (query && !sc.title.en.toLowerCase().includes(query.toLowerCase()) &&
        !sc.slug.includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <aside
      className="w-[220px] flex-shrink-0 border-r border-line bg-paper flex flex-col overflow-hidden"
      data-testid="scene-sidebar"
    >
      {/* Search */}
      <div className="p-2 border-b border-line">
        <div className="flex items-center gap-1.5 bg-paper-tinted border border-line-strong rounded px-2 py-1">
          <Search size={12} className="text-ink-faded flex-shrink-0" />
          <input
            className="flex-1 text-xs bg-transparent outline-none placeholder:text-ink-faded"
            placeholder="Search scenes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Category filter chips */}
      {project.categories.length > 0 && (
        <div className="flex gap-1 px-2 py-1.5 flex-wrap border-b border-line">
          <button
            onClick={() => setFilterCat(null)}
            className={clsx(
              'text-[10px] px-2 py-0.5 rounded border',
              filterCat === null
                ? 'bg-ink text-paper border-ink'
                : 'border-line-strong text-ink-soft hover:bg-paper-tinted'
            )}
          >
            All
          </button>
          {project.categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setFilterCat(filterCat === cat.id ? null : cat.id)}
              className={clsx(
                'text-[10px] px-2 py-0.5 rounded border',
                filterCat === cat.id
                  ? 'text-paper border-transparent'
                  : 'border-line-strong text-ink-soft hover:bg-paper-tinted'
              )}
              style={filterCat === cat.id ? { backgroundColor: cat.color, borderColor: cat.color } : {}}
            >
              {cat.name.en ?? Object.values(cat.name)[0] ?? cat.slug}
            </button>
          ))}
        </div>
      )}

      {/* Scene list */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <p className="text-xs text-ink-faded p-4 text-center">No scenes</p>
        )}
        {visible.map((scene) => {
          const isActive = scene.id === activeSceneId;
          const isOrphan = !incomingCount[scene.id] && project.scenes.length > 1;
          const catName = project.categories.find(
            (c) => scene.categoryIds[0] === c.id
          )?.name.en ?? '';

          return (
            <button
              key={scene.id}
              data-testid={`scene-item-${scene.id}`}
              onClick={() => setActiveScene(scene.id)}
              className={clsx(
                'w-full flex items-center gap-2 px-2 py-2 text-left transition-colors border-b border-line',
                isActive ? 'bg-ink/5' : 'hover:bg-paper-tinted'
              )}
            >
              {/* Thumbnail */}
              <div className="w-11 h-7 rounded overflow-hidden flex-shrink-0 bg-line">
                <img
                  src={toLocalUrl(scene.media.sourcePath)}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  {isOrphan && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0"
                      title="Orphan — no incoming links"
                    />
                  )}
                  <p
                    className={clsx(
                      'text-xs truncate',
                      isActive ? 'font-semibold text-ink' : 'text-ink'
                    )}
                  >
                    {scene.title.en || scene.slug}
                  </p>
                </div>
                <p className="text-[10px] text-ink-faded truncate">
                  {scene.hotspots.length} hotspot{scene.hotspots.length !== 1 ? 's' : ''}
                  {catName ? ` · ${catName}` : ''}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Add scene placeholder */}
      <div className="p-2 border-t border-line">
        <button
          disabled
          className="btn w-full justify-center text-xs opacity-40 cursor-not-allowed"
          title="Import photos to add scenes"
        >
          <Plus size={12} />
          Add scene
        </button>
      </div>
    </aside>
  );
}
