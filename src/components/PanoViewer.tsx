// Side-effect imports: set window.pannellum + load its CSS
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no type declarations for pannellum
import 'pannellum/build/pannellum.js';
import 'pannellum/build/pannellum.css';
import { useEffect, useRef } from 'react';

// Minimal types for pannellum viewer (not published by upstream)
interface PanViewer {
  destroy: () => void;
  getYaw: () => number;
  getPitch: () => number;
  getHfov: () => number;
  setYaw: (yaw: number, animated?: boolean) => void;
  setPitch: (pitch: number, animated?: boolean) => void;
  setHfov: (fov: number, animated?: boolean) => void;
  mouseEventToCoords: (e: MouseEvent) => [number, number]; // [pitch, yaw]
  on: (event: string, cb: (...a: unknown[]) => void) => PanViewer;
}

interface Props {
  imageUrl: string;
  heading: number;
  onDoubleClick: (ath: number, atv: number) => void;
  /** When provided, will be set to a function that returns the current yaw (0 while viewer is not ready) */
  getYaw?: React.MutableRefObject<() => number>;
  getPitch?: React.MutableRefObject<() => number>;
  getFov?: React.MutableRefObject<() => number>;
  /** Exposed to allow callers to programmatically pan/tilt/zoom the viewer */
  setYaw?: React.MutableRefObject<(yaw: number) => void>;
  setPitch?: React.MutableRefObject<(pitch: number) => void>;
  setFov?: React.MutableRefObject<(fov: number) => void>;
  /** Initial camera position applied at load time (used when switching scenes with a saved defaultView) */
  initialView?: { yaw: number; pitch: number; hfov: number };
  /** CSS class for the container div — default "w-full h-full" */
  className?: string;
  /** Exposed to allow callers to get 360° coords from a native MouseEvent */
  getMouseCoords?: React.MutableRefObject<((e: MouseEvent) => [number, number]) | null>;
}

export function PanoViewer({ imageUrl, heading, onDoubleClick, getYaw, getPitch, getFov, setYaw, setPitch, setFov, initialView, className, getMouseCoords }: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const viewerRef     = useRef<PanViewer | null>(null);
  const lastClickRef  = useRef<{ t: number; pitch: number; yaw: number } | null>(null);

  const onDoubleClickRef = useRef(onDoubleClick);
  onDoubleClickRef.current = onDoubleClick;

  // Init / re-init when imageUrl changes
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    if (viewerRef.current) {
      try { viewerRef.current.destroy(); } catch { /* ignore */ }
      viewerRef.current = null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pan = (window as any).pannellum as {
      viewer: (el: HTMLElement, cfg: Record<string, unknown>) => PanViewer;
    } | undefined;

    if (!pan) {
      console.warn('[PanoViewer] window.pannellum not available');
      return;
    }

    let viewer: PanViewer;
    try {
      viewer = pan.viewer(el, {
        type: 'equirectangular',
        panorama: imageUrl,
        autoLoad: true,
        showControls: false,
        compass: false,
        northOffset: heading,
        mouseZoom: true,
        keyboardZoom: false,
        disableKeyboardCtrl: true,
        yaw: initialView?.yaw ?? 0,
        pitch: initialView?.pitch ?? 0,
        hfov: initialView?.hfov ?? 75,
      });
    } catch (err) {
      console.warn('[PanoViewer] PANOVIEWER_INIT_GUARD pannellum init threw:', err);
      return;
    }
    viewerRef.current = viewer;

    if (getYaw) {
      getYaw.current = () => { try { return viewerRef.current?.getYaw() ?? 0; } catch { return 0; } };
    }
    if (getPitch) {
      getPitch.current = () => { try { return viewerRef.current?.getPitch() ?? 0; } catch { return 0; } };
    }
    if (getFov) {
      getFov.current = () => { try { return viewerRef.current?.getHfov() ?? 75; } catch { return 75; } };
    }
    if (setYaw) {
      setYaw.current = (yaw: number) => { try { viewerRef.current?.setYaw(yaw, false); } catch { /* ignore */ } };
    }
    if (setPitch) {
      setPitch.current = (pitch: number) => { try { viewerRef.current?.setPitch(pitch, false); } catch { /* ignore */ } };
    }
    if (setFov) {
      setFov.current = (fov: number) => { try { viewerRef.current?.setHfov(fov, false); } catch { /* ignore */ } };
    }
    if (getMouseCoords) {
      getMouseCoords.current = (e: MouseEvent) => { try { return viewer.mouseEventToCoords(e); } catch { return [0, 0]; } };
    }

    // Double-click detection (Pannellum swallows native dblclick)
    function handleClick(e: MouseEvent) {
      try {
        const [pitch, yaw] = viewer.mouseEventToCoords(e);
        const now = Date.now();
        const prev = lastClickRef.current;
        if (prev && now - prev.t < 350 &&
            Math.abs(pitch - prev.pitch) < 3 &&
            Math.abs(yaw - prev.yaw) < 3) {
          lastClickRef.current = null;
          onDoubleClickRef.current(yaw, pitch); // yaw=ath, pitch=atv
        } else {
          lastClickRef.current = { t: now, pitch, yaw };
        }
      } catch { /* coords unavailable before image loads */ }
    }
    el.addEventListener('click', handleClick);

    return () => {
      el.removeEventListener('click', handleClick);
      if (getMouseCoords) getMouseCoords.current = null;
      try { viewer.destroy(); } catch { /* ignore */ }
      viewerRef.current = null;
    };
  }, [imageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      className={className ?? 'w-full h-full'}
      data-testid="pano-viewer"
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
