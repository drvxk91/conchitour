// Side-effect imports: set window.pannellum + load its CSS
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no type declarations for pannellum
import 'pannellum/build/pannellum.js';
import 'pannellum/build/pannellum.css';
import { useEffect, useRef } from 'react';
import type { Hotspot } from '@/types';

// Minimal types for pannellum viewer (not published by upstream)
interface PanViewer {
  destroy: () => void;
  getYaw: () => number;
  getPitch: () => number;
  addHotSpot: (hs: Record<string, unknown>) => PanViewer;
  removeHotSpot: (id: string) => boolean;
  mouseEventToCoords: (e: MouseEvent) => [number, number]; // [pitch, yaw]
  on: (event: string, cb: (...a: unknown[]) => void) => PanViewer;
}

// SVG icons for each hotspot type (white on transparent)
const ICONS: Record<string, string> = {
  link:     `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`,
  video:    `<svg viewBox="0 0 24 24" width="14" height="14" fill="white"><polygon points="5 3 19 12 5 21"/></svg>`,
  text:     `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="2.5"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="13" y2="18"/></svg>`,
  external: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  form:     `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`,
};

interface Props {
  imageUrl: string;
  hotspots: Hotspot[];
  hotspotColors: Record<string, string>;
  activeHotspotId: string | null;
  heading: number;
  onHotspotClick: (id: string) => void;
  onDoubleClick: (ath: number, atv: number) => void;
}

export function PanoViewer({
  imageUrl,
  hotspots,
  hotspotColors,
  activeHotspotId,
  heading,
  onHotspotClick,
  onDoubleClick,
}: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const viewerRef     = useRef<PanViewer | null>(null);
  const trackedHsIds  = useRef<Set<string>>(new Set());
  const lastClickRef  = useRef<{ t: number; pitch: number; yaw: number } | null>(null);

  const onHotspotClickRef = useRef(onHotspotClick);
  onHotspotClickRef.current = onHotspotClick;
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
    trackedHsIds.current = new Set();

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
      });
    } catch (err) {
      console.warn('[PanoViewer] PANOVIEWER_INIT_GUARD pannellum init threw:', err);
      return;
    }
    viewerRef.current = viewer;

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
      try { viewer.destroy(); } catch { /* ignore */ }
      viewerRef.current = null;
      trackedHsIds.current = new Set();
    };
  }, [imageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync hotspots whenever the list or active selection changes
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const currentIds = new Set(hotspots.map((h) => h.id));

    for (const id of trackedHsIds.current) {
      if (!currentIds.has(id)) {
        try { viewer.removeHotSpot(id); } catch { /* ignore */ }
        trackedHsIds.current.delete(id);
      }
    }

    for (const h of hotspots) {
      const wasTracked = trackedHsIds.current.has(h.id);
      const isActive = h.id === activeHotspotId;
      if (wasTracked && (isActive || !currentIds.has(h.id))) {
        try { viewer.removeHotSpot(h.id); } catch { /* ignore */ }
        trackedHsIds.current.delete(h.id);
      }
    }

    for (const h of hotspots) {
      if (trackedHsIds.current.has(h.id)) continue;
      const color = hotspotColors[h.id] ?? '#6b6b68';
      const isActive = h.id === activeHotspotId;
      const hId = h.id;
      try {
        viewer.addHotSpot({
          pitch: h.atv,
          yaw: h.ath,
          id: hId,
          type: 'custom',
          cssClass: 'pnlm-hotspot-conchitect',
          createTooltipFunc: (el: HTMLElement, _args: unknown) => {
            el.style.cssText = [
              'width:32px;height:32px;border-radius:50%;',
              `background-color:${color}cc;`,
              'display:flex;align-items:center;justify-content:center;',
              'cursor:pointer;',
              isActive ? `outline:3px solid ${color};outline-offset:2px;` : '',
            ].join('');
            el.innerHTML = ICONS[h.type] ?? ICONS.form;
          },
          clickHandlerFunc: (_e: MouseEvent, _args: unknown) => {
            onHotspotClickRef.current(hId);
          },
        });
        trackedHsIds.current.add(hId);
      } catch { /* ignore if viewer not ready */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotspots, hotspotColors, activeHotspotId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      data-testid="pano-viewer"
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
