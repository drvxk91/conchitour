import clsx from 'clsx';
import { Sidebar } from '@/components/shell/Sidebar';
import { TitleBar } from '@/components/shell/TitleBar';
import { ScreenRouter } from '@/components/shell/ScreenRouter';
import { useProject } from '@/store/project';

export default function App() {
  const { activeScreen } = useProject();
  const isScenes = activeScreen === 'scenes';
  return (
    <div className="h-screen flex flex-col">
      <TitleBar />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        {/* Scenes screen owns its own scroll/overflow; other screens scroll freely */}
        <main
          className={clsx(
            'flex-1',
            isScenes ? 'overflow-hidden' : 'overflow-auto bg-paper-soft'
          )}
        >
          <ScreenRouter />
        </main>
      </div>
    </div>
  );
}
