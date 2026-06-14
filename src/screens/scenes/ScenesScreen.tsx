import { useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useProject } from '@/store/project';
import { fromPercent } from '@/lib/projection';
import { SceneToolbar } from './SceneToolbar';
import { SceneSidebar } from './SceneSidebar';
import { SceneViewer } from './SceneViewer';
import { SceneInspector } from './SceneInspector';
import { ParcoursGraph } from './ParcoursGraph';
import type { Hotspot, LinkHotspot } from '@/types';

export type EditorMode = 'navigate' | 'hotspot';

function makeHotspot(type: Hotspot['type'], ath = 0, atv = 0): Hotspot {
  const base = { id: uuid(), ath, atv };
  if (type === 'link')     return { ...base, type: 'link', targetSceneId: '' };
  if (type === 'video')    return { ...base, type: 'video', url: '', title: '' };
  if (type === 'text')     return { ...base, type: 'text', title: '', body: '' };
  if (type === 'external') return { ...base, type: 'external', url: '', label: '' };
  return { ...base, type: 'form', mailto: '', subject: '', fields: [] };
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
    undo,
    redo,
  } = useProject();

  const [mode, setMode] = useState<EditorMode>('navigate');
  const activeScene = project.scenes.find((s) => s.id === activeSceneId) ?? null;

  // Auto-select first scene
  useEffect(() => {
    if (!activeSceneId && project.scenes.length > 0) {
      setActiveScene(project.scenes[0].id);
    }
  }, [project.scenes, activeSceneId, setActiveScene]);

  // Stale refs for keyboard handler (avoids stale closure)
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
    setMode('navigate');
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
      />

      <div className="flex-1 flex min-h-0">
        <SceneSidebar />
        <SceneViewer mode={mode} onAddHotspot={handleAddHotspotAt} />
        <SceneInspector onDeleteScene={handleDeleteScene} />
      </div>

      <ParcoursGraph />
    </div>
  );
}
