import clsx from 'clsx';
import { Sidebar } from '@/components/shell/Sidebar';
import { TitleBar } from '@/components/shell/TitleBar';
import { ScreenRouter } from '@/components/shell/ScreenRouter';
import { PanoViewer } from '@/components/PanoViewer';
import { toLocalUrl } from '@/lib/local-url';
import { useProject } from '@/store/project';

// Standalone 360° preview — rendered in a separate BrowserWindow opened by Preview button
function PreviewMode({ sourcePath, heading }: { sourcePath: string; heading: number }) {
  return (
    <div className="w-screen h-screen bg-black">
      <PanoViewer
        imageUrl={toLocalUrl(sourcePath)}
        heading={heading}
        onDoubleClick={() => {}}
      />
    </div>
  );
}

export default function App() {
  const { activeScreen } = useProject();
  const needsFullHeight = activeScreen === 'scenes' || activeScreen === 'map';

  // Preview mode: opened as a separate BrowserWindow by main process
  const params = new URLSearchParams(window.location.search);
  const previewPath = params.get('preview');
  if (previewPath) {
    const heading = Number(params.get('heading') ?? 0);
    return <PreviewMode sourcePath={previewPath} heading={heading} />;
  }
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
