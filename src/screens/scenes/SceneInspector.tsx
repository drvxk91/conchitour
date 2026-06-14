import { useState } from 'react';
import clsx from 'clsx';
import { useProject } from '@/store/project';
import { MetaTab }      from './inspector/MetaTab';
import { HotspotsTab }  from './inspector/HotspotsTab';
import { MediaTab }     from './inspector/MediaTab';
import { AdvancedTab }  from './inspector/AdvancedTab';

const TABS = ['Meta', 'Hotspots', 'Media', 'Advanced'] as const;
type Tab = typeof TABS[number];

interface Props { onDeleteScene: (id: string) => void }

export function SceneInspector({ onDeleteScene }: Props) {
  const { project, activeSceneId } = useProject();
  const [tab, setTab] = useState<Tab>('Meta');
  const scene = project.scenes.find((s) => s.id === activeSceneId) ?? null;

  return (
    <aside
      className="w-[300px] flex-shrink-0 border-l border-line bg-paper flex flex-col overflow-hidden"
      data-testid="scene-inspector"
    >
      {/* Tab bar */}
      <div className="flex border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            data-testid={`inspector-tab-${t.toLowerCase()}`}
            onClick={() => setTab(t)}
            className={clsx(
              'flex-1 text-xs py-2 transition-colors',
              tab === t
                ? 'text-ink font-semibold border-b-2 border-ink'
                : 'text-ink-soft hover:text-ink'
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {!scene ? (
          <p className="text-xs text-ink-faded p-4 text-center">Select a scene</p>
        ) : (
          <>
            {tab === 'Meta'      && <MetaTab scene={scene} />}
            {tab === 'Hotspots'  && <HotspotsTab scene={scene} />}
            {tab === 'Media'     && <MediaTab scene={scene} />}
            {tab === 'Advanced'  && <AdvancedTab scene={scene} onDelete={() => onDeleteScene(scene.id)} />}
          </>
        )}
      </div>
    </aside>
  );
}
