import { useRef, useState } from 'react';
import clsx from 'clsx';
import {
  ArrowRight, Video, Type, ExternalLink, ClipboardList, Crosshair,
} from 'lucide-react';
import { useProject } from '@/store/project';
import { toPercent, fromPercent } from '@/lib/projection';
import type { EditorMode } from './ScenesScreen';
import type { Hotspot } from '@/types';

interface Props {
  mode: EditorMode;
  onAddHotspot: (xPct: number, yPct: number) => void;
}

// Three slashes (local:///) keep the Windows drive letter in the URL path,
// not in the authority where Chromium would mangle it (C → hostname).
function toLocalUrl(p: string) {
  return 'local:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
}

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

export function SceneViewer({ mode, onAddHotspot }: Props) {
  const { project, activeSceneId, activeHotspotId, setActiveHotspot, updateHotspot } = useProject();
  const containerRef = useRef<HTMLDivElement>(null);
  const justCreatedRef = useRef(false);

  // Drag state for hotspot repositioning
  const draggingRef = useRef<string | null>(null);   // id of hotspot being dragged
  const draggedRef  = useRef(false);                  // true once mouse actually moves
  const livePosRef  = useRef<{ id: string; ath: number; atv: number } | null>(null);
  const [livePos, setLivePos] = useState<{ id: string; ath: number; atv: number } | null>(null);

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

  return (
    <div
      ref={containerRef}
      className={clsx(
        'flex-1 relative overflow-hidden bg-zinc-900 select-none',
        livePos ? 'cursor-grabbing' : (mode === 'hotspot' ? 'cursor-crosshair' : 'cursor-default')
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseMove={handleContainerMouseMove}
      onMouseUp={handleContainerMouseUp}
      onMouseLeave={handleContainerMouseUp}
      data-testid="scene-viewer"
    >
      {/* Scene image */}
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
      {/* Shown only when the image fails to load */}
      <div className="absolute inset-0 hidden items-center justify-center bg-zinc-800 pointer-events-none">
        <span className="text-white/30 text-sm select-none">Image unavailable</span>
      </div>

      {/* Horizon line */}
      <div
        className="absolute inset-x-0 border-t border-white/20 pointer-events-none"
        style={{ top: '50%' }}
      />

      {/* Compass (top-right) */}
      <div className="absolute top-3 right-3 pointer-events-none flex items-center gap-1 bg-black/40 text-white text-[10px] rounded px-2 py-1 backdrop-blur-sm">
        <Crosshair size={11} />
        <span>{Math.round(scene.heading)}° N</span>
      </div>

      {/* Hotspot overlays */}
      {scene.hotspots.map((h) => {
        const posAth = livePos?.id === h.id ? livePos.ath : h.ath;
        const posAtv = livePos?.id === h.id ? livePos.atv : h.atv;
        const { x, y } = toPercent(posAth, posAtv);
        const isSelected    = h.id === activeHotspotId;
        const isDraggingThis = livePos?.id === h.id;
        const color = categoryColor(scene.id, h, project);

        return (
          <div
            key={h.id}
            data-testid={`hotspot-${h.id}`}
            className={clsx(
              'absolute flex items-center justify-center rounded-full text-white',
              !isDraggingThis && 'transition-transform hover:scale-110',
              isSelected ? 'w-9 h-9 shadow-lg' : 'w-8 h-8'
            )}
            style={{
              left: `${x}%`,
              top:  `${y}%`,
              transform: 'translate(-50%, -50%)',
              backgroundColor: color + 'cc',
              boxShadow: isSelected ? `0 0 0 3px ${color}, 0 0 0 5px white` : undefined,
              cursor: isDraggingThis ? 'grabbing' : 'grab',
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              draggingRef.current = h.id;
              draggedRef.current  = false; // reset so a stationary click isn't treated as a drag
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (draggedRef.current) { draggedRef.current = false; return; }
              setActiveHotspot(isSelected ? null : h.id);
            }}
          >
            <HotspotIcon hotspot={h} />
          </div>
        );
      })}

      {/* Hint */}
      <div className="absolute bottom-3 right-3 text-[10px] text-white/50 pointer-events-none select-none">
        Double-click to add a hotspot
      </div>
    </div>
  );
}
