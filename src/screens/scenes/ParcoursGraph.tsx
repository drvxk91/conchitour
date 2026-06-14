import clsx from 'clsx';
import { useProject } from '@/store/project';
import type { Scene } from '@/types';

export function ParcoursGraph() {
  const { project, activeSceneId, setActiveScene } = useProject();
  const { scenes, categories } = project;

  if (scenes.length === 0) return null;

  // Build a set of connected scene-id pairs (undirected)
  const edges = new Set<string>();
  for (const sc of scenes) {
    for (const h of sc.hotspots) {
      if (h.type === 'link' && h.targetSceneId) {
        const [a, b] = [sc.id, h.targetSceneId].sort();
        edges.add(`${a}__${b}`);
      }
    }
  }

  function isConnected(a: Scene, b: Scene) {
    const [x, y] = [a.id, b.id].sort();
    return edges.has(`${x}__${y}`);
  }

  function primaryColor(scene: Scene) {
    const catId = scene.categoryIds[0];
    return categories.find((c) => c.id === catId)?.color ?? '#9a9a96';
  }

  // Count incoming links to detect orphans
  const incomingMap: Record<string, number> = {};
  for (const sc of scenes) {
    for (const h of sc.hotspots) {
      if (h.type === 'link' && h.targetSceneId) {
        incomingMap[h.targetSceneId] = (incomingMap[h.targetSceneId] ?? 0) + 1;
      }
    }
  }

  return (
    <footer
      className="h-[100px] border-t border-line bg-paper flex-shrink-0 overflow-x-auto"
      data-testid="parcours-graph"
    >
      <div className="h-full flex items-center gap-0 px-4 min-w-max">
        {scenes.map((scene, i) => {
          const isActive  = scene.id === activeSceneId;
          const isOrphan  = !incomingMap[scene.id] && scenes.length > 1;
          const color     = primaryColor(scene);
          const connected = i < scenes.length - 1 && isConnected(scene, scenes[i + 1]);

          return (
            <div key={scene.id} className="flex items-center">
              {/* Scene node */}
              <button
                data-testid={`graph-node-${scene.id}`}
                onClick={() => setActiveScene(scene.id)}
                className="flex flex-col items-center gap-1 group px-2"
                title={scene.title.en || scene.slug}
              >
                <div
                  className={clsx(
                    'w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all',
                    isActive ? 'scale-110 shadow-md' : 'group-hover:scale-105',
                    isOrphan && 'border-dashed'
                  )}
                  style={{
                    borderColor: color,
                    backgroundColor: isActive ? color : 'transparent',
                  }}
                >
                  {isActive && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
                <span
                  className={clsx(
                    'text-[9px] max-w-[64px] truncate text-center',
                    isActive ? 'text-ink font-semibold' : 'text-ink-soft'
                  )}
                >
                  {scene.title.en || scene.slug}
                </span>
              </button>

              {/* Edge to next node */}
              {i < scenes.length - 1 && (
                <div
                  className={clsx(
                    'w-8 h-px',
                    connected ? 'bg-ink-faded' : 'bg-transparent'
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </footer>
  );
}
