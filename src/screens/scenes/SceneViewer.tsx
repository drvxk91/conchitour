import { useRef, useState, useEffect } from 'react';
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
import type { Hotspot, LinkHotspot, Project } from '@/types';

type Props = {
  mode: EditorMode;
  onAddHotspot: (xPct: number, yPct: number) => void;
  northDraft?: number;
  onNorthDraftChange?: (heading: number) => void;
  pannellumGetYaw?: React.MutableRefObject<() => number>;
  pannellumGetPitch?: React.MutableRefObject<() => number>;
  pannellumGetFov?: React.MutableRefObject<() => number>;
  pannellumSetYaw?: React.MutableRefObject<(yaw: number) => void>;
};

function HotspotIcon({ hotspot }: { hotspot: Hotspot }) {
  const cls = 'w-4 h-4';
  if (hotspot.type === 'link')     return <ArrowRight className={cls} />;
  if (hotspot.type === 'video')    return <Video className={cls} />;
  if (hotspot.type === 'text')     return <Type className={cls} />;
  if (hotspot.type === 'external') return <ExternalLink className={cls} />;
  return <ClipboardList className={cls} />;
}

function categoryColor(sceneId: string, hotspot: Hotspot, project: Project) {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return '#6b6b68';
  const catId = hotspot.type === 'link'
    ? project.scenes.find((s) => s.id === (hotspot as LinkHotspot).targetSceneId)?.categoryIds[0]
    : scene.categoryIds[0];
  return project.categories.find((c) => c.id === catId)?.color ?? '#6b6b68';
}

export function SceneViewer({ mode, onAddHotspot, northDraft, pannellumGetYaw, pannellumGetPitch, pannellumGetFov, pannellumSetYaw }: Props) {
  const { project, activeSceneId, activeHotspotId, setActiveHotspot, updateHotspot } = useProject();
  const containerRef = useRef<HTMLDivElement>(null);

  // Ref exposed from PanoViewer for coordinate conversion during drag
  const pannellumGetMouseCoordsRef = useRef<((e: MouseEvent) => [number, number]) | null>(null);

  // Drag state for hotspot repositioning
  const draggingRef = useRef<string | null>(null);
  const draggedRef  = useRef(false);
  const livePosRef  = useRef<{ id: string; ath: number; atv: number } | null>(null);
  const [livePos, setLivePos] = useState<{ id: string; ath: number; atv: number } | null>(null);
  // Capture overlay active in navigate mode while dragging
  const [dragCapture, setDragCapture] = useState(false);

  // Navigate/north mode: current viewer orientation (updated via rAF) for hotspot overlay
  const [navView, setNavView] = useState({ yaw: 0, pitch: 0, fov: 75 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (mode !== 'navigate' && mode !== 'north') {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      return;
    }
    let alive = true;
    function tick() {
      if (!alive) return;
      const yaw   = pannellumGetYaw?.current?.()   ?? 0;
      const pitch = pannellumGetPitch?.current?.() ?? 0;
      const fov   = pannellumGetFov?.current?.()   ?? 75;
      setNavView(v => (v.yaw !== yaw || v.pitch !== pitch || v.fov !== fov) ? { yaw, pitch, fov } : v);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { alive = false; if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const scene = project.scenes.find((s) => s.id === activeSceneId) ?? null;

  // Flat mode = equirectangular image overlay; navigate + north = Pannellum sphere
  const isFlat = mode === 'hotspot';

  function getXY(e: React.MouseEvent): { x: number; y: number } {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top)  / rect.height) * 100,
    };
  }

  function handleClick() {
    setActiveHotspot(null);
  }

  function handleDoubleClick(e: React.MouseEvent) {
    const { x, y } = getXY(e);
    onAddHotspot(x, y);
  }

  // Flat-mode mouse handlers (hotspot drag on equirectangular image)
  function handleContainerMouseMove(e: React.MouseEvent) {
    if (!draggingRef.current || !containerRef.current) return;
    draggedRef.current = true;
    const { x, y } = getXY(e);
    const pos = { id: draggingRef.current, ...fromPercent(x, y) };
    livePosRef.current = pos;
    setLivePos(pos);
  }

  function handleContainerMouseUp() {
    const pos = livePosRef.current;
    if (draggingRef.current && pos && scene && draggedRef.current) {
      updateHotspot(scene.id, pos.id, { ath: pos.ath, atv: pos.atv });
    }
    draggingRef.current = null;
    livePosRef.current = null;
    setLivePos(null);
  }

  // Navigate-mode drag capture handlers (runs on the transparent overlay)
  function handleCaptureMouseMove(e: React.MouseEvent) {
    if (!draggingRef.current) return;
    draggedRef.current = true;
    const coords = pannellumGetMouseCoordsRef.current?.(e.nativeEvent);
    if (coords) {
      const [pitch, yaw] = coords;
      const pos = { id: draggingRef.current, ath: yaw, atv: pitch };
      livePosRef.current = pos;
      setLivePos(pos);
    }
  }

  function handleCaptureMouseUp() {
    const pos = livePosRef.current;
    if (draggingRef.current && pos && scene && draggedRef.current) {
      updateHotspot(scene.id, pos.id, { ath: pos.ath, atv: pos.atv });
    }
    draggingRef.current = null;
    draggedRef.current = false;
    livePosRef.current = null;
    setLivePos(null);
    setDragCapture(false);
  }

  if (!scene) {
    return (
      <div className="flex-1 flex items-center justify-center bg-paper-tinted text-ink-faded text-sm">
        No scene selected — click one in the left panel.
      </div>
    );
  }

  // Cardinal positions for the persistent N badge (flat mode only)
  const activeHeading = (mode === 'north' && northDraft !== undefined) ? northDraft : scene.heading;
  const northAth = ((0 - activeHeading + 180 + 3600) % 360) - 180;
  const northX = toPercent(northAth, 0).x;

  // Pre-compute hotspot category colors
  const hotspotColors = Object.fromEntries(
    scene.hotspots.map((h) => [h.id, categoryColor(scene.id, h, project)])
  );

  return (
    <div
      ref={containerRef}
      className={clsx(
        'flex-1 relative overflow-hidden bg-zinc-900 select-none',
        livePos && isFlat ? 'cursor-grabbing'
          : mode === 'hotspot' ? 'cursor-crosshair'
          : 'cursor-default'
      )}
      onClick={isFlat ? handleClick : undefined}
      onDoubleClick={isFlat ? handleDoubleClick : undefined}
      onMouseMove={isFlat ? handleContainerMouseMove : undefined}
      onMouseUp={isFlat ? handleContainerMouseUp : undefined}
      onMouseLeave={isFlat ? handleContainerMouseUp : undefined}
      data-testid="scene-viewer"
    >
      {/* ── Navigate / North mode: real 360° Pannellum viewer ── */}
      {!isFlat && (
        <PanoViewer
          imageUrl={toLocalUrl(scene.media.sourcePath)}
          heading={scene.heading}
          getYaw={pannellumGetYaw}
          getPitch={pannellumGetPitch}
          getFov={pannellumGetFov}
          setYaw={pannellumSetYaw}
          getMouseCoords={pannellumGetMouseCoordsRef}
          onDoubleClick={(ath, atv) => {
            const { x, y } = toPercent(ath, atv);
            onAddHotspot(x, y);
          }}
        />
      )}

      {/* ── Flat mode: equirectangular image ── */}
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

      {/* Horizon line (flat mode only) */}
      {isFlat && (
        <div
          className="absolute inset-x-0 border-t border-white/20 pointer-events-none"
          style={{ top: '50%' }}
        />
      )}

      {/* 360° hint (navigate mode, no hotspots) */}
      {mode === 'navigate' && !scene.hotspots.length && (
        <div className="absolute bottom-3 left-3 text-[10px] text-white/50 pointer-events-none select-none bg-black/30 px-2 py-1 rounded">
          360° view — switch to Hotspot mode (H) to place hotspots
        </div>
      )}

      {/* ── North mode overlay (on top of Pannellum) ── */}
      {mode === 'north' && (
        <div className="absolute inset-0 pointer-events-none z-10 bg-black/20">
          {/* Center target crosshair with N marker */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative w-8 h-8">
              <div className="absolute top-1/2 w-full h-px bg-red-500 -translate-y-1/2" />
              <div className="absolute left-1/2 h-full w-px bg-red-500 -translate-x-1/2" />
              <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
                N
              </div>
            </div>
          </div>
          {/* Instruction */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 text-white text-[11px] px-3 py-1.5 rounded-full backdrop-blur-sm whitespace-nowrap">
            Pan until the N crosshair points True North · {(northDraft ?? navView.yaw).toFixed(1)}°
          </div>
        </div>
      )}

      {/* Compass (top-right) */}
      <div className="absolute top-3 right-3 pointer-events-none flex items-center gap-1 bg-black/40 text-white text-[10px] rounded px-2 py-1 backdrop-blur-sm z-10">
        <Crosshair size={11} />
        <span>{Math.round(mode === 'north' ? (northDraft ?? navView.yaw) : activeHeading)}° N</span>
      </div>

      {/* Persistent N badge (flat mode only, when heading is set) */}
      {isFlat && scene.heading !== 0 && (
        <div
          className="absolute top-0 -translate-x-1/2 pointer-events-none"
          style={{ left: `${northX}%` }}
        >
          <div className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-b shadow">
            N
          </div>
        </div>
      )}

      {/* ── Flat mode hotspot overlays ── */}
      {isFlat && scene.hotspots.map((h) => {
        const posAth = livePos?.id === h.id ? livePos.ath : h.ath;
        const posAtv = livePos?.id === h.id ? livePos.atv : h.atv;
        const { x, y } = toPercent(posAth, posAtv);
        const isSelected    = h.id === activeHotspotId;
        const isDraggingThis = livePos?.id === h.id;
        const color = hotspotColors[h.id] ?? '#6b6b68';

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
              'absolute flex flex-col items-center pointer-events-auto group',
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
              <span className={clsx(
                'mt-0.5 text-[9px] text-white bg-black/50 px-1.5 py-0.5 rounded whitespace-nowrap max-w-[90px] truncate pointer-events-none select-none transition-opacity',
                isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}>
                {label}
              </span>
            )}
          </div>
        );
      })}

      {/* ── Navigate mode hotspot overlay (projected onto Pannellum sphere) ── */}
      {!isFlat && scene.hotspots.map((h) => {
        const posAth = livePos?.id === h.id ? livePos.ath : h.ath;
        const posAtv = livePos?.id === h.id ? livePos.atv : h.atv;
        const dy = ((posAth - navView.yaw + 540) % 360) - 180;
        const dp = posAtv - navView.pitch;
        const fovH = navView.fov;
        const rect = containerRef.current?.getBoundingClientRect();
        const aspect = rect ? rect.width / rect.height : 16 / 9;
        const fovV = fovH / aspect;
        if (Math.abs(dy) > fovH / 2 + 5 || Math.abs(dp) > fovV / 2 + 5) return null;
        const x = 50 + (dy / fovH) * 100;
        const y = 50 - (dp / fovV) * 100;
        const isSelected = h.id === activeHotspotId;
        const isDraggingThis = livePos?.id === h.id;
        const color = hotspotColors[h.id] ?? '#6b6b68';
        const isLink = h.type === 'link';
        const targetScene = isLink ? project.scenes.find((s) => s.id === (h as LinkHotspot).targetSceneId) : null;

        let label: string | null = null;
        const t = h.title?.en ?? null;
        if (t) { label = t; }
        else if (h.type === 'link') {
          label = targetScene ? (targetScene.title.en || targetScene.slug) : null;
        } else if (h.type === 'video' || h.type === 'text') {
          label = h.title.en || null;
        } else if (h.type === 'external') {
          label = (h as import('@/types').ExternalHotspot).label.en || null;
        } else if (h.type === 'form') {
          label = (h as import('@/types').FormHotspot).subject.en || null;
        }

        return (
          <div
            key={h.id}
            className={clsx(
              'absolute flex flex-col items-center pointer-events-auto group',
              !isDraggingThis && 'transition-transform hover:scale-110',
            )}
            style={{
              left: `${x}%`,
              top: `${y}%`,
              transform: 'translate(-50%, -50%)',
              zIndex: dragCapture ? 0 : 10,
              cursor: isDraggingThis ? 'grabbing' : 'grab',
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              draggingRef.current = h.id;
              draggedRef.current = false;
              setDragCapture(true);
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (draggedRef.current) { draggedRef.current = false; return; }
              setActiveHotspot(isSelected ? null : h.id);
            }}
          >
            <div
              className={clsx(
                'flex items-center justify-center rounded-full text-white shadow-lg',
                isSelected ? 'w-9 h-9' : 'w-8 h-8'
              )}
              style={{
                backgroundColor: color + 'cc',
                boxShadow: isSelected ? `0 0 0 3px ${color}, 0 0 0 5px white` : undefined,
              }}
            >
              <HotspotIcon hotspot={h} />
            </div>

            {/* Link hotspot hover preview (120x70) */}
            {isLink && targetScene && (
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center pointer-events-none z-20">
                <div className="bg-zinc-900 rounded-lg overflow-hidden shadow-xl border border-white/10" style={{ width: 120 }}>
                  <img
                    src={toLocalUrl(targetScene.media.sourcePath)}
                    alt={targetScene.title.en || targetScene.slug}
                    className="w-full object-cover"
                    style={{ height: 70 }}
                    draggable={false}
                  />
                  <div className="px-2 py-1 text-[9px] text-white/80 truncate font-medium">
                    {targetScene.title.en || targetScene.slug}
                  </div>
                </div>
                <div className="w-2 h-2 bg-zinc-900 rotate-45 -mt-1 border-r border-b border-white/10" />
              </div>
            )}

            {label && !isLink && (
              <span className="mt-0.5 text-[9px] text-white bg-black/50 px-1.5 py-0.5 rounded whitespace-nowrap max-w-[90px] truncate pointer-events-none select-none opacity-0 group-hover:opacity-100">
                {label}
              </span>
            )}
          </div>
        );
      })}

      {/* Transparent drag capture overlay (navigate mode only, active while dragging) */}
      {!isFlat && dragCapture && (
        <div
          className="absolute inset-0 z-20 cursor-grabbing"
          onMouseMove={handleCaptureMouseMove}
          onMouseUp={handleCaptureMouseUp}
          onMouseLeave={handleCaptureMouseUp}
        />
      )}

      {/* Hint — hotspot mode only */}
      {mode === 'hotspot' && (
        <div className="absolute bottom-3 right-3 text-[10px] text-white/50 pointer-events-none select-none">
          Double-click to add a hotspot
        </div>
      )}
    </div>
  );
}
