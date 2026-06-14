import { useState, DragEvent } from 'react';
import { Upload, Check, X, ArrowRight, Loader2, Image } from 'lucide-react';
import clsx from 'clsx';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { useProject } from '@/store/project';
import { newScene } from '@/lib/scene-factory';

// Converts an OS path to a local:// URL served by the custom Electron protocol.
// Uses three slashes (local:///) so the Windows drive letter (e.g. C:) stays in
// the URL path, not in the authority component (where Chromium would mangle it).
function toLocalUrl(p: string): string {
  return 'local:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
}

export function ImportScreen() {
  const {
    project,
    addScene,
    setActiveScreen,
    isProcessing,
    processingMessage,
    setProcessing,
  } = useProject();

  const [isDragging, setIsDragging] = useState(false);

  async function handleFiles(filePaths: string[]) {
    if (!filePaths.length || isProcessing) return;

    setProcessing(true, 'Reading EXIF...');
    try {
      const meta = await window.conchitect.readPhotosMeta(filePaths);

      const existingSlugs = new Set(project.scenes.map((s) => s.slug));
      const scenes = meta.map((m) => {
        const scene = newScene(m.path, {
          width: m.width,
          height: m.height,
          fileSize: m.fileSize,
          exif: m.exif,
        }, existingSlugs);
        existingSlugs.add(scene.slug);
        return scene;
      });

      setProcessing(true, 'Generating tiles...');
      for (const scene of scenes) {
        addScene(scene);
        await window.conchitect.generateTiles(scene.media.sourcePath);
      }

      setProcessing(false, 'Done');
    } catch (err) {
      console.error('Import error:', err);
      setProcessing(false, '');
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      /\.(jpe?g|png)$/i.test(f.name)
    );
    // Use webUtils.getPathForFile — the correct Electron 32+ API when
    // contextIsolation is enabled (file.path is not available in that context).
    const paths = files
      .map((f) => window.conchitect.getPathForFile(f))
      .filter((p) => p !== '');
    if (paths.length) handleFiles(paths);
  }

  async function handleChooseFiles() {
    const paths = await window.conchitect.openFiles();
    if (paths.length) handleFiles(paths);
  }

  const scenes = project.scenes;
  const gpsCount = scenes.filter(
    (s) => s.geo.lat !== 0 || s.geo.lng !== 0
  ).length;
  const isDone = !isProcessing && processingMessage === 'Done';

  return (
    <ScreenShell
      title="Import"
      subtitle="Drag & drop your 360° equirectangular photos. EXIF GPS is read automatically."
    >
      {/* Counter */}
      {scenes.length > 0 && (
        <div data-testid="import-counter" className="flex items-center gap-3 mb-4 text-sm text-ink-soft">
          <span>
            <span className="font-medium text-ink">{scenes.length}</span>{' '}
            photo{scenes.length !== 1 ? 's' : ''} imported
          </span>
          <span>·</span>
          <span>
            <span className={clsx('font-medium', gpsCount > 0 ? 'text-green-600' : 'text-ink')}>
              {gpsCount}
            </span>{' '}
            with GPS
          </span>
          {isDone && (
            <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
              <Check size={12} />
              Done
            </span>
          )}
        </div>
      )}

      {/* Processing status */}
      {isProcessing && (
        <div data-testid="import-status" className="flex items-center gap-2 mb-4 text-sm text-ink-soft">
          <Loader2 size={14} className="animate-spin" />
          <span>{processingMessage}</span>
        </div>
      )}

      {/* Drop zone */}
      <div
        data-testid="import-dropzone"
        role="button"
        tabIndex={0}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDragLeave={(e) => {
          // Only leave if exiting the zone itself, not a child element
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragging(false);
          }
        }}
        onDrop={handleDrop}
        onClick={handleChooseFiles}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleChooseFiles(); }}
        className={clsx(
          'border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center gap-4',
          'cursor-pointer select-none transition-colors',
          isDragging
            ? 'border-cat-hotel bg-blue-50/50'
            : 'border-line-strong hover:border-ink-faded hover:bg-paper-tinted',
          isProcessing && 'pointer-events-none opacity-60'
        )}
      >
        <div
          className={clsx(
            'w-14 h-14 rounded-full flex items-center justify-center transition-colors',
            isDragging ? 'bg-cat-hotel/10 text-cat-hotel' : 'bg-paper-tinted text-ink-soft'
          )}
        >
          <Upload size={28} />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-ink">
            Drop photos here or click to browse
          </p>
          <p className="text-xs text-ink-faded mt-1">
            JPEG and PNG · equirectangular 360°
          </p>
        </div>
      </div>

      {/* Thumbnail grid */}
      {scenes.length > 0 && (
        <div data-testid="import-grid" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {scenes.map((scene) => {
            const hasGps = scene.geo.lat !== 0 || scene.geo.lng !== 0;
            return (
              <div
                key={scene.id}
                className="rounded-lg overflow-hidden border border-line bg-paper group"
              >
                <div className="aspect-video overflow-hidden bg-paper-tinted relative">
                  <img
                    src={toLocalUrl(scene.media.sourcePath)}
                    alt={scene.title.en}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      const img = e.currentTarget;
                      img.style.display = 'none';
                      const fallback = img.nextElementSibling as HTMLElement | null;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                  <div className="absolute inset-0 hidden items-center justify-center">
                    <Image size={24} className="text-line-strong" />
                  </div>
                </div>
                <div className="p-2">
                  <p className="text-xs text-ink truncate font-medium" title={scene.title.en}>
                    {scene.title.en}
                  </p>
                  <div className="mt-1">
                    {hasGps ? (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">
                        <Check size={9} />
                        GPS
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                        <X size={9} />
                        No GPS
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Continue button */}
      {scenes.length > 0 && !isProcessing && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={() => setActiveScreen('scenes')}
            className="btn btn-primary"
          >
            Continue to Scenes
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </ScreenShell>
  );
}
