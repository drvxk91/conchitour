import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Sidebar } from '@/components/shell/Sidebar';
import { TitleBar } from '@/components/shell/TitleBar';
import { ScreenRouter } from '@/components/shell/ScreenRouter';
import { toLocalUrl } from '@/lib/local-url';
import { useProject } from '@/store/project';
import type { Scene, LinkHotspot, ExternalHotspot, FormHotspot } from '@/types';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import 'pannellum/build/pannellum.js';
import 'pannellum/build/pannellum.css';

interface PreviewData {
  scenes: Scene[];
  activeSceneId: string;
}

// Standalone 360° preview with hotspot navigation — rendered in a separate BrowserWindow
function PreviewMode({ initialSourcePath, initialHeading }: { initialSourcePath: string; initialHeading: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<{ destroy: () => void } | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [currentSceneId, setCurrentSceneId] = useState<string | null>(null);
  const [sceneName, setSceneName] = useState('');

  // Stable ref so Pannellum click handlers don't capture stale setCurrentSceneId
  const setCurrentSceneIdRef = useRef(setCurrentSceneId);

  // Fetch preview data from main process once
  useEffect(() => {
    window.conchitect.getPreviewData().then((raw) => {
      if (raw && typeof raw === 'object' && 'scenes' in raw) {
        const data = raw as PreviewData;
        setPreviewData(data);
        setCurrentSceneId(data.activeSceneId);
      }
    }).catch(() => {});
  }, []);

  // (Re)init Pannellum whenever the current scene changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pan = (window as any).pannellum as {
      viewer: (el: HTMLElement, cfg: Record<string, unknown>) => { destroy: () => void };
    } | undefined;
    if (!pan) return;

    let panorama: string;
    let heading: number;
    let hotSpots: Record<string, unknown>[] = [];
    let dv: { hlookat: number; vlookat: number; fov: number } | undefined;

    if (previewData && currentSceneId) {
      const scene = previewData.scenes.find((s) => s.id === currentSceneId);
      if (!scene) return;
      panorama = toLocalUrl(scene.media.sourcePath);
      heading = scene.heading;
      dv = scene.defaultView;
      setSceneName(scene.title?.en || scene.slug || '');

      hotSpots = scene.hotspots.map((h) => {
        const isLink = h.type === 'link';
        const targetScene = isLink
          ? previewData.scenes.find((s) => s.id === (h as LinkHotspot).targetSceneId)
          : null;

        let text = h.title?.en ?? '';
        if (!text) {
          if (isLink && targetScene) text = `→ ${targetScene.title?.en || targetScene.slug}`;
          else if (h.type === 'video') text = `▶ ${h.title?.en || 'Video'}`;
          else if (h.type === 'text') text = h.title?.en || 'Info';
          else if (h.type === 'external') text = (h as ExternalHotspot).label?.en || 'Link';
          else if (h.type === 'form') text = (h as FormHotspot).subject?.en || 'Form';
        }

        const hs: Record<string, unknown> = {
          pitch: h.atv,
          yaw: h.ath,
          type: 'info',
          text,
          cssClass: `preview-hs preview-hs-${h.type}`,
        };

        if (isLink && targetScene) {
          const tid = targetScene.id;
          hs.clickHandlerFunc = (_e: Event, _args: unknown) => {
            setCurrentSceneIdRef.current(tid);
          };
          hs.clickHandlerArgs = {};
        }

        return hs;
      });
    } else {
      // Fallback: no scene data, show initial path from URL params
      panorama = toLocalUrl(initialSourcePath);
      heading = initialHeading;
    }

    // Destroy previous viewer
    if (viewerRef.current) {
      try { viewerRef.current.destroy(); } catch { /* ignore */ }
      viewerRef.current = null;
    }

    let viewer: { destroy: () => void };
    try {
      viewer = pan.viewer(el, {
        type: 'equirectangular',
        panorama,
        autoLoad: true,
        showControls: true,
        showZoomCtrl: true,
        showFullscreenCtrl: true,
        compass: false,
        northOffset: heading,
        mouseZoom: true,
        hotSpots,
        hotSpotDebug: false,
        ...(dv ? { yaw: dv.hlookat, pitch: dv.vlookat, hfov: dv.fov } : {}),
      });
    } catch (err) {
      console.warn('[PreviewMode] pannellum init threw:', err);
      return;
    }
    viewerRef.current = viewer;

    return () => {
      try { viewer.destroy(); } catch { /* ignore */ }
      viewerRef.current = null;
    };
  }, [currentSceneId, previewData, initialSourcePath, initialHeading]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="w-screen h-screen bg-black relative">
      <style>{`
        .preview-hs span.pnlm-hotspot-base {
          background: rgba(255,255,255,0.15) !important;
          border: 2px solid rgba(255,255,255,0.7) !important;
          border-radius: 50%;
          width: 24px !important; height: 24px !important;
          cursor: pointer;
        }
        .preview-hs span.pnlm-hotspot-base:hover { background: rgba(255,255,255,0.35) !important; }
        .preview-hs-link span.pnlm-hotspot-base { border-color: #60a5fa !important; background: rgba(96,165,250,0.25) !important; cursor: pointer; }
        .preview-hs-link span.pnlm-hotspot-base:hover { background: rgba(96,165,250,0.5) !important; }
        .pnlm-tooltip span { white-space: nowrap; font-size: 12px; padding: 4px 8px; border-radius: 4px; }
      `}</style>
      <div ref={containerRef} className="w-full h-full" data-testid="preview-viewer" />

      {/* Scene name overlay */}
      {sceneName && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none z-10">
          <div className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm">
            {sceneName}
          </div>
        </div>
      )}

      {/* Scene navigation dots */}
      {previewData && previewData.scenes.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex gap-1.5 items-center bg-black/40 px-3 py-1.5 rounded-full backdrop-blur-sm">
          {previewData.scenes.map((s) => (
            <button
              key={s.id}
              onClick={() => setCurrentSceneId(s.id)}
              title={s.title?.en || s.slug}
              className={clsx(
                'w-2 h-2 rounded-full transition-all',
                s.id === currentSceneId ? 'bg-white scale-125' : 'bg-white/35 hover:bg-white/65'
              )}
            />
          ))}
        </div>
      )}
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
    return <PreviewMode initialSourcePath={previewPath} initialHeading={heading} />;
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
