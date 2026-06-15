import { useRef, useState } from 'react';
import clsx from 'clsx';
import {
  ArrowRight, Video, Type, ExternalLink, ClipboardList, Crosshair,
} from 'lucide-react';
import { useProject } from '@/store/project';
import { toPercent, fromPercent } from '@/lib/projection';
import { toLocalUrl } from '@/lib/local-url';
import { normalizeHeading } from '@/lib/heading';
import { PanoViewer } from '@/components/PanoViewer';
import type { EditorMode } from './ScenesScreen';
import type { Hotspot } from '@/types';

type Props = {
  mode: EditorMode;
  onAddHotspot: (xPct: number, yPct: number) => void;
  northDraft?: number;
  onNorthDraftChange?: (heading: number) => void;
  pannellumGetYaw?: React.MutableRefObject<() => number>;
};

function HotspotIcon({ hotspot }: { hotspot: Hotspot }) {
  const cls = 'w-4 h-4';
  if (hotspot.type === 'link')     return <ArrowRight className={cls} />;
  if (hotspot.type === 'video')    return <Video className={cls} />;
  if (hotspot.type === 'text')     return <Type className={cls} />;
  if (hotspot.type === 'external') return <ExternalLink className={cls} />;
  return <ClipboardList className={cls} />;
}

function categoryColor(sceneId: string, hotspot: Hotspot, project: ReturnType<typeof useProject>['project']) {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return '#6b6b68';
  const catId = hotspot.type === 'link'
    ? project.scenes.find((s) => s.id === (hotspot as import('@/types').LinkHotspot).targetSceneId)?.categoryIds[0]
    : scene.categoryIds[0];
  return project.categories.find((c) => c.id === catId)?.color ?? '#6b6b68';
}

export function SceneViewer({ mode, onAddHotspot, northDraft, onNorthDraftChange, pannellumGetYaw }: Props) {
  const { project, activeSceneId, activeHotspotId, setActiveHotspot, updateHotspot } = useProject();
  const containerRef = useRef<HTMLDivElement>(null);
  const justCreatedRef = useRef(false);

  // Drag state for hotspot repositioning
  const draggingRef = useRef<string | null>(null);   // id of hotspot being dragged
  const draggedRef  = useRef(false);                  // true once mouse actually moves
  const livePosRef  = useRef<{ id: string; ath: number; atv: number } | null>(null);
  const [livePos, setLivePos] = useState<{ id: string; ath: number; atv: number } | null>(null);

  // Drag state for north mode
  const northDragStartX   = useRef<number | null>(null);
  const northDragStartHdg = useRef<number>(0);

  const scene = project.scenes.find((s) => s.id === activeSceneId) ?? null;

  function getXY(e: React.MouseEvent): { x: number; y: number } {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top)  / rect.height) * 100,
    };
  }

  function handleClick(e: React.MouseEvent) {
    if (mode === 'hotspot') {
      const { x, y } = getXY(e);
      onAddHotspot(x, y);
      justCreatedRef.current = true;
      setTimeout(() => { justCreatedRef.current = false; }, 100);
    } else {
      setActiveHotspot(null);
    }
  }

  function handleDoubleClick(e: React.MouseEvent) {
    if (justCreatedRef.current) return;
    const { x, y } = getXY(e);
    onAddHotspot(x, y);
  }

  function handleContainerMouseMove(e: React.MouseEvent) {
    // North mode: horizontal drag rotates the heading
    if (mode === 'north' && northDragStartX.current !== null && containerRef.current) {
      const dx = e.clientX - northDragStartX.current;
      const degsPerPx = 360 / containerRef.current.getBoundingClientRect().width;
      const newHeading = normalizeHeading(northDragStartHdg.current + dx * degsPerPx);
      onNorthDraftChange?.(newHeading);
      return;
    }
    if (!draggingRef.current || !containerRef.current) return;
    draggedRef.current = true;
    const { x, y } = getXY(e);
    const pos = { id: draggingRef.current, ...fromPercent(x, y) };
    livePosRef.current = pos;
    setLivePos(pos);
  }

  function handleContainerMouseDown(e: React.MouseEvent) {
    if (mode === 'north') {
      northDragStartX.current   = e.clientX;
      northDragStartHdg.current = northDraft ?? scene?.heading ?? 0;
    }
  }

  function handleContainerMouseUp() {
    // Reset north drag state
    northDragStartX.current = null;

    const pos = livePosRef.current;
    if (draggingRef.current && pos && scene && draggedRef.current) {
      updateHotspot(scene.id, pos.id, { ath: pos.ath, atv: pos.atv });
    }
    draggingRef.current = null;
    livePosRef.current = null;
    setLivePos(null);
    // draggedRef is reset at the start of the next drag (mousedown on hotspot),
    // or in the hotspot onClick handler if the click fires after a drag.
  }

  if (!scene) {
    return (
      <div className="flex-1 flex items-center justify-center bg-paper-tinted text-ink-faded text-sm">
        No scene selected — click one in the left panel.
      </div>
    );
  }

  // Compass positions for north mode overlay and N badge
  const activeHeading = (mode === 'north' && northDraft !== undefined) ? northDraft : scene.heading;
  const cardinals = [
    { label: 'N', world: 0 },
    { label: 'E', world: 90 },
    { label: 'S', world: 180 },
    { label: 'W', world: 270 },
  ].map(({ label, world }) => {
    const ath = ((world - activeHeading + 180 + 3600) % 360) - 180;
    return { label, x: toPercent(ath, 0).x };
  });

  // Pre-compute hotspot category colors for overlay rendering
  const hotspotColors = Object.fromEntries(
    scene.hotspots.map((h) => [h.id, categoryColor(scene.id, h, project)])
  );

  // In flat mode (hotspot or north), we show the equirectangular image with overlays.
  // In navigate mode we hand off to Pannellum for real 360° viewing.
  const isFlat = mode === 'hotspot' || mode === 'north';

  return (
    <div
      ref={containerRef}
      className={clsx(
        'flex-1 relative overflow-hidden bg-zinc-900 select-none',
        mode === 'north' ? 'cursor-ew-resize'
          : livePos ? 'cursor-grabbing'
          : mode === 'hotspot' ? 'cursor-crosshair'
          : 'cursor-default'
      )}
      // Click/dblclick only create hotspots in flat modes.
      // Move/up/leave are always attached so hotspot drag works in navigate mode too.
      onClick={isFlat ? handleClick : undefined}
      onDoubleClick={isFlat ? handleDoubleClick : undefined}
      onMouseDown={handleContainerMouseDown}
      onMouseMove={handleContainerMouseMove}
      onMouseUp={handleContainerMouseUp}
      onMouseLeave={handleContainerMouseUp}
      data-testid="scene-viewer"
    >
      {/* ── Navigate mode: real 360° Pannellum viewer ── */}
      {!isFlat && (
        <PanoViewer
          imageUrl={toLocalUrl(scene.media.sourcePath)}
          heading={scene.heading}
          getYaw={pannellumGetYaw}
          onDoubleClick={(ath, atv) => {
            const { x, y } = toPercent(ath, atv);
            onAddHotspot(x, y);
          }}
        />
      )}

      {/* ── Flat mode: equirectangular image + overlays ── */}
      {isFlat && (
        <>
          <img
            src={toLocalUrl(scene.media.sourcePath)}
            alt={scene.title.en}
            className="w-full h-full object-cover pointer-events-none"
            draggable={false}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
              if (fb) fb.style.display = 'flex';
            }}
          />
          <div className="absolute inset-0 hidden items-center justify-center bg-zinc-800 pointer-events-none">
            <span className="text-white/30 text-sm select-none">Image unavailable</span>
          </div>
        </>
      )}

      {/* Horizon line (flat modes only) */}
      {isFlat && (
        <div
          className="absolute inset-x-0 border-t border-white/20 pointer-events-none"
          style={{ top: '50%' }}
        />
      )}

      {/* 360° hint shown in navigate mode */}
      {!isFlat && !scene.hotspots.length && (
        <div className="absolute bottom-3 left-3 text-[10px] text-white/50 pointer-events-none select-none bg-black/30 px-2 py-1 rounded">
          360° view — switch to Hotspot mode (H) to place hotspots
        </div>
      )}

      {/* North mode overlay */}
      {mode === 'north' && (
        <div className="absolute inset-0 bg-black/30 pointer-events-none">
          {/* Cardinal direction markers */}
          {cardinals.map(({ label, x }) => (
            <div
              key={label}
              className="absolute top-0 -translate-x-1/2 flex flex-col items-center pointer-events-none"
              style={{ left: `${x}%` }}
            >
              <div className={clsx(
                'px-2 py-0.5 rounded-b text-xs font-bold shadow',
                label === 'N'
                  ? 'bg-red-500 text-white'
                  : 'bg-white/80 text-zinc-800'
              )}>
                {label}
              </div>
              <div className="w-px h-8 bg-white/50" />
            </div>
          ))}
          {/* Center crosshair */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-8 h-px bg-white/60" />
            <div className="absolute w-px h-8 bg-white/60" />
          </div>
          {/* Drag hint */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 text-white text-[11px] px-3 py-1.5 rounded-full backdrop-blur-sm pointer-events-none">
            Drag left/right to rotate · {activeHeading.toFixed(1)}°
          </div>
        </div>
      )}

      {/* Compass (top-right) — shows heading; highlights when non-zero */}
      <div className="absolute top-3 right-3 pointer-events-none flex items-center gap-1 bg-black/40 text-white text-[10px] rounded px-2 py-1 backdrop-blur-sm">
        <Crosshair size={11} />
        <span>{Math.round(activeHeading)}° N</span>
      </div>

      {/* Persistent N badge — shown outside north mode when heading is set */}
      {mode !== 'north' && scene.heading !== 0 && (
        <div
          className="absolute top-0 -translate-x-1/2 pointer-events-none"
          style={{ left: `${cardinals[0].x}%` }}
        >
          <div className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-b shadow">
            N
          </div>
        </div>
      )}

      {/* Hotspot overlays — flat modes only (hotspot + north); navigate mode uses Pannellum */}
      {isFlat && scene.hotspots.map((h) => {
        const posAth = livePos?.id === h.id ? livePos.ath : h.ath;
        const posAtv = livePos?.id === h.id ? livePos.atv : h.atv;
        const { x, y } = toPercent(posAth, posAtv);
        const isSelected    = h.id === activeHotspotId;
        const isDraggingThis = livePos?.id === h.id;
        const color = hotspotColors[h.id] ?? '#6b6b68';

        // Compute display label: use title override, type-specific field, or target scene title
        let label: string | null = null;
        const t = h.title?.en ?? null;
        if (t) {
          label = t;
        } else if (h.type === 'link') {
          const target = project.scenes.find((s) => s.id === h.targetSceneId);
          label = target ? (target.title.en || target.slug) : null;
        } else if (h.type === 'video' || h.type === 'text') {
          label = h.title.en || null;
        } else if (h.type === 'external') {
          label = h.label.en || null;
        } else if (h.type === 'form') {
          label = h.subject.en || null;
        }

        return (
          <div
            key={h.id}
            data-testid={`hotspot-${h.id}`}
            className={clsx(
              'absolute flex flex-col items-center pointer-events-auto',
              !isDraggingThis && 'transition-transform hover:scale-110',
            )}
            style={{
              left: `${x}%`,
              top:  `${y}%`,
              transform: 'translate(-50%, -50%)',
              cursor: isDraggingThis ? 'grabbing' : 'grab',
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              draggingRef.current = h.id;
              draggedRef.current  = false;
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (draggedRef.current) { draggedRef.current = false; return; }
              setActiveHotspot(isSelected ? null : h.id);
            }}
          >
            <div
              className={clsx(
                'flex items-center justify-center rounded-full text-white',
                isSelected ? 'w-9 h-9 shadow-lg' : 'w-8 h-8'
              )}
              style={{
                backgroundColor: color + 'cc',
                boxShadow: isSelected ? `0 0 0 3px ${color}, 0 0 0 5px white` : undefined,
              }}
            >
              <HotspotIcon hotspot={h} />
            </div>
            {label && (
              <span className="mt-0.5 text-[9px] text-white bg-black/50 px-1.5 py-0.5 rounded whitespace-nowrap max-w-[90px] truncate pointer-events-none select-none">
                {label}
              </span>
            )}
          </div>
        );
      })}

      {/* Hint — hotspot mode only */}
      {mode === 'hotspot' && (
        <div className="absolute bottom-3 right-3 text-[10px] text-white/50 pointer-events-none select-none">
          Double-click to add a hotspot
        </div>
      )}
    </div>
  );
}
