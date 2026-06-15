import clsx from 'clsx';
import { Sidebar } from '@/components/shell/Sidebar';
import { TitleBar } from '@/components/shell/TitleBar';
import { ScreenRouter } from '@/components/shell/ScreenRouter';
import { useProject } from '@/store/project';

export default function App() {
  const { activeScreen } = useProject();
  const needsFullHeight = activeScreen === 'scenes' || activeScreen === 'map';
  return (
    <div className="h-screen flex flex-col">
      <TitleBar />
      <div className="flex-1 flex overflow-hidden min-h-0">
        <Sidebar />
        {/* Scenes + Map own their scroll/overflow; other screens scroll freely */}
        <main
          className={clsx(
            'flex-1 min-h-0',
            needsFullHeight ? 'overflow-hidden' : 'overflow-auto bg-paper-soft'
          )}
        >
          <ScreenRouter />
        </main>
      </div>
    </div>
  );
}
