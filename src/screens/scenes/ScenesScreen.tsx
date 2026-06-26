import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useProject } from '@/store/project';
import { fromPercent } from '@/lib/projection';
import { normalizeHeading } from '@/lib/heading';
import { SceneToolbar } from './SceneToolbar';
import { SceneSidebar } from './SceneSidebar';
import { SceneViewer } from './SceneViewer';
import { SceneInspector } from './SceneInspector';
import { ParcoursGraph } from './ParcoursGraph';
import { NorthRadarMap } from './NorthRadarMap';
import type { Hotspot, LinkHotspot } from '@/types';

export type EditorMode = 'navigate' | 'hotspot' | 'north';

function makeHotspot(type: Hotspot['type'], ath = 0, atv = 0): Hotspot {
  const base = { id: uuid(), ath, atv };
  if (type === 'link')     return { ...base, type: 'link', targetSceneId: '' };
  if (type === 'video')    return { ...base, type: 'video', url: '', title: { en: '' } };
  if (type === 'text')     return { ...base, type: 'text', title: { en: '' }, body: { en: '' } };
  if (type === 'external') return { ...base, type: 'external', url: '', label: { en: '' } };
  return { ...base, type: 'form', mailto: '', subject: { en: '' }, fields: [] };
}

export function ScenesScreen() {
  const {
    project,
    activeSceneId,
    activeHotspotId,
    setActiveScene,
    setActiveHotspot,
    addHotspot,
    deleteHotspot,
    deleteScene,
    duplicateScene,
    updateScene,
    undo,
    redo,
  } = useProject();

  const [mode, setMode] = useState<EditorMode>('navigate');
  // northDraft is the live Pannellum yaw polled during north mode (shown in toolbar)
  const [northDraft, setNorthDraft] = useState<number | undefined>(undefined);
  const [defaultViewToast, setDefaultViewToast] = useState<string | null>(null);
  const activeScene = project.scenes.find((s) => s.id === activeSceneId) ?? null;

  const pannellumGetYaw    = useRef<() => number>(() => 0);
  const pannellumGetPitch  = useRef<() => number>(() => 0);
  const pannellumGetFov    = useRef<() => number>(() => 75);
  const pannellumSetYaw    = useRef<(yaw: number) => void>(() => {});
  const pannellumSetPitch  = useRef<(pitch: number) => void>(() => {});
  const pannellumSetFov    = useRef<(fov: number) => void>(() => {});
  // Entry snapshot for north mode: restore yaw on Cancel
  const northEntryYaw = useRef<number>(0);

  // Capture entry yaw when entering north mode (northDraft is now pushed by SceneViewer)
  useEffect(() => {
    if (mode !== 'north') return;
    northEntryYaw.current = pannellumGetYaw.current();
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply defaultView to Pannellum when the active scene changes
  useEffect(() => {
    const dv = activeScene?.defaultView;
    if (!dv) return;
    pannellumSetYaw.current(dv.hlookat);
    pannellumSetPitch.current(-dv.vlookat); // krpano +down → Pannellum +up → negate
    pannellumSetFov.current(dv.fov);
  }, [activeSceneId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select first scene
  useEffect(() => {
    if (!activeSceneId && project.scenes.length > 0) {
      setActiveScene(project.scenes[0].id);
    }
  }, [project.scenes, activeSceneId, setActiveScene]);

  const handleSetDefaultView = useCallback(() => {
    if (!activeScene) return;
    const hlookat = Math.round(pannellumGetYaw.current()    * 10) / 10;
    const vlookat = Math.round(-pannellumGetPitch.current() * 10) / 10; // Pannellum +up → krpano +down → negate
    const fov     = Math.round(pannellumGetFov.current()    * 10) / 10;
    updateScene(activeScene.id, { defaultView: { hlookat, vlookat, fov } });
    const msg = `Default view saved: ${hlookat}° / ${vlookat}° / fov ${fov}°`;
    setDefaultViewToast(msg);
    setTimeout(() => setDefaultViewToast(null), 3000);
  }, [activeScene, updateScene]);

  const handleNorthConfirm = useCallback((heading: number) => {
    if (activeScene) {
      updateScene(activeScene.id, { heading: normalizeHeading(heading) });
    }
    setMode('navigate');
  }, [activeScene, updateScene]);

  const handleNorthCancel = useCallback(() => {
    pannellumSetYaw.current(northEntryYaw.current);
    setMode('navigate');
  }, []);

  const handleCaptureThumbnail = useCallback(async () => {
    if (!activeScene) return;
    try {
      const el = document.querySelector('[data-testid="pano-viewer"]');
      if (!el) return;
      const r = el.getBoundingClientRect();
      const rect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      const ok = await window.conchitect.captureSceneThumbnail(activeScene.slug, rect);
      if (ok) updateScene(activeScene.id, { thumbnailMode: 'custom' });
    } catch (e) {
      console.warn('[thumb] capture failed:', e);
    }
  }, [activeScene, updateScene]);

  // Stale refs for keyboard handler
  const sceneRef = useRef(activeScene);
  const hotspotRef = useRef(activeHotspotId);
  sceneRef.current = activeScene;
  hotspotRef.current = activeHotspotId;

  // ─── keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement)?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'v' || e.key === 'V') { setMode('navigate'); return; }
      if (e.key === 'h' || e.key === 'H') { setMode('hotspot');  return; }
      if (e.key === 'n' || e.key === 'N') { setMode((m) => m === 'north' ? 'navigate' : 'north'); return; }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sc = sceneRef.current;
        const hid = hotspotRef.current;
        if (sc && hid) { deleteHotspot(sc.id, hid); return; }
      }
      if (e.ctrlKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault(); undo(); return;
      }
      if ((e.ctrlKey && e.shiftKey && e.key === 'Z') || (e.ctrlKey && (e.key === 'y' || e.key === 'Y'))) {
        e.preventDefault(); redo(); return;
      }
      if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        const sc = sceneRef.current;
        if (sc) handleDuplicate(sc.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteHotspot, undo, redo]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDuplicate(sceneId: string) {
    const sc = project.scenes.find((s) => s.id === sceneId);
    if (!sc) return;
    const taken = new Set(project.scenes.map((s) => s.slug));
    let candidate = sc.slug + '_copy';
    let i = 2;
    while (taken.has(candidate)) candidate = sc.slug + '_copy_' + i++;
    const copy = { ...sc, id: uuid(), slug: candidate, hotspots: [] };
    duplicateScene(sceneId, copy);
    setActiveScene(copy.id);
  }

  function handleAddHotspotAt(xPct: number, yPct: number) {
    if (!activeScene) return;
    const { ath, atv } = fromPercent(xPct, yPct);
    const h: LinkHotspot = { id: uuid(), type: 'link', ath, atv, targetSceneId: '' };
    addHotspot(activeScene.id, h);
    setActiveHotspot(h.id);
  }

  function handleDeleteScene(id: string) {
    if (window.confirm('Delete this scene?')) deleteScene(id);
  }

  return (
    <div className="h-full flex flex-col bg-paper-soft" data-testid="scenes-screen">
      <SceneToolbar
        mode={mode}
        onModeChange={setMode}
        onUndo={undo}
        onRedo={redo}
        onDuplicate={() => activeScene && handleDuplicate(activeScene.id)}
        onDelete={() => activeScene && handleDeleteScene(activeScene.id)}
        onAddHotspotType={(type) => {
          if (!activeScene) return;
          const h = makeHotspot(type);
          addHotspot(activeScene.id, h);
          setActiveHotspot(h.id);
        }}
        onNorthConfirm={handleNorthConfirm}
        onNorthCancel={handleNorthCancel}
        northDraftHeading={northDraft}
        onSetDefaultView={handleSetDefaultView}
        onCaptureThumbnail={handleCaptureThumbnail}
        onPreview={() => {
          if (activeScene) {
            window.conchitect.openPreview(
              activeScene.media.sourcePath,
              activeScene.heading,
              { scenes: project.scenes, activeSceneId: activeScene.id }
            );
          }
        }}
      />

      <div className="flex-1 flex min-h-0 relative">
        {/* Default view toast */}
        {defaultViewToast && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
            <div className="bg-zinc-900/90 text-white text-xs px-3 py-1.5 rounded-full shadow-lg backdrop-blur-sm whitespace-nowrap">
              {defaultViewToast}
            </div>
          </div>
        )}
        <SceneSidebar />
        <SceneViewer
          mode={mode}
          onAddHotspot={handleAddHotspotAt}
          northDraft={northDraft}
          onNorthDraftChange={setNorthDraft}
          pannellumGetYaw={pannellumGetYaw}
          pannellumGetPitch={pannellumGetPitch}
          pannellumGetFov={pannellumGetFov}
          pannellumSetYaw={pannellumSetYaw}
          pannellumSetPitch={pannellumSetPitch}
          pannellumSetFov={pannellumSetFov}
        />
        {mode === 'north' && activeScene && (activeScene.geo.lat !== 0 || activeScene.geo.lng !== 0)
          ? <NorthRadarMap
              scene={activeScene}
              viewBearing={northDraft !== undefined
                ? (northDraft + pannellumGetYaw.current() + 360) % 360
                : 0}
              heading={northDraft ?? 0}
            />
          : <SceneInspector onDeleteScene={handleDeleteScene} />
        }
      </div>

      <ParcoursGraph />
    </div>
  );
}
