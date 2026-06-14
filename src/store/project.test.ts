import { describe, it, expect, beforeEach } from 'vitest';
import { useProject } from './project';
import type { Scene, LinkHotspot } from '@/types';
import { v4 as uuid } from 'uuid';

// Helper: build a minimal scene for testing
function fakeScene(slug = 'lobby'): Scene {
  return {
    id: uuid(),
    slug,
    title: { en: slug },
    description: { en: '' },
    altText: { en: '' },
    categoryIds: [],
    geo: { lat: 0, lng: 0 },
    heading: 0,
    captureHeightMeters: 1.6,
    hotspots: [],
    media: {
      sourcePath: `/photos/${slug}.jpg`,
      width: 0,
      height: 0,
      fileSizeBytes: 0,
      tilesGenerated: false,
    },
  };
}

function fakeHotspot(): LinkHotspot {
  return { id: uuid(), type: 'link', ath: 0, atv: 0, targetSceneId: '' };
}

// Reset the store before each test
beforeEach(() => {
  useProject.getState().reset();
});

// ─── addScene ─────────────────────────────────────────────────────────────────
describe('addScene', () => {
  it('adds a scene to the project', () => {
    const sc = fakeScene();
    useProject.getState().addScene(sc);
    expect(useProject.getState().project.scenes).toHaveLength(1);
    expect(useProject.getState().project.scenes[0].id).toBe(sc.id);
  });

  it('pushes to history', () => {
    const sc = fakeScene();
    useProject.getState().addScene(sc);
    const { history, historyIndex } = useProject.getState();
    expect(history.length).toBe(2);
    expect(historyIndex).toBe(1);
  });
});

// ─── addHotspot ───────────────────────────────────────────────────────────────
describe('addHotspot', () => {
  it('adds a hotspot to the correct scene', () => {
    const sc = fakeScene();
    useProject.getState().addScene(sc);
    const h = fakeHotspot();
    useProject.getState().addHotspot(sc.id, h);
    const scenes = useProject.getState().project.scenes;
    expect(scenes[0].hotspots).toHaveLength(1);
    expect(scenes[0].hotspots[0].id).toBe(h.id);
  });

  it('does not mutate other scenes', () => {
    const a = fakeScene('a');
    const b = fakeScene('b');
    useProject.getState().addScene(a);
    useProject.getState().addScene(b);
    useProject.getState().addHotspot(a.id, fakeHotspot());
    const scenes = useProject.getState().project.scenes;
    expect(scenes.find((s) => s.id === b.id)!.hotspots).toHaveLength(0);
  });
});

// ─── deleteHotspot ────────────────────────────────────────────────────────────
describe('deleteHotspot', () => {
  it('removes the hotspot from the scene', () => {
    const sc = fakeScene();
    useProject.getState().addScene(sc);
    const h = fakeHotspot();
    useProject.getState().addHotspot(sc.id, h);
    useProject.getState().deleteHotspot(sc.id, h.id);
    expect(useProject.getState().project.scenes[0].hotspots).toHaveLength(0);
  });

  it('clears activeHotspotId', () => {
    const sc = fakeScene();
    useProject.getState().addScene(sc);
    const h = fakeHotspot();
    useProject.getState().addHotspot(sc.id, h);
    useProject.getState().setActiveHotspot(h.id);
    useProject.getState().deleteHotspot(sc.id, h.id);
    expect(useProject.getState().activeHotspotId).toBeNull();
  });
});

// ─── undo / redo ──────────────────────────────────────────────────────────────
describe('undo', () => {
  it('restores the previous project state', () => {
    const sc = fakeScene();
    useProject.getState().addScene(sc);
    expect(useProject.getState().project.scenes).toHaveLength(1);
    useProject.getState().undo();
    expect(useProject.getState().project.scenes).toHaveLength(0);
  });

  it('does nothing at the beginning of history', () => {
    useProject.getState().undo(); // should not throw
    expect(useProject.getState().historyIndex).toBe(0);
  });

  it('decrements historyIndex', () => {
    useProject.getState().addScene(fakeScene('a'));
    useProject.getState().addScene(fakeScene('b'));
    const before = useProject.getState().historyIndex;
    useProject.getState().undo();
    expect(useProject.getState().historyIndex).toBe(before - 1);
  });
});

describe('redo', () => {
  it('restores the undone state', () => {
    const sc = fakeScene();
    useProject.getState().addScene(sc);
    useProject.getState().undo();
    expect(useProject.getState().project.scenes).toHaveLength(0);
    useProject.getState().redo();
    expect(useProject.getState().project.scenes).toHaveLength(1);
  });

  it('does nothing when at the latest state', () => {
    const before = useProject.getState().historyIndex;
    useProject.getState().redo(); // should not throw
    expect(useProject.getState().historyIndex).toBe(before);
  });

  it('redo is cleared after a new action', () => {
    useProject.getState().addScene(fakeScene('a'));
    useProject.getState().undo();
    // new action wipes the redo stack
    useProject.getState().addScene(fakeScene('b'));
    const { history, historyIndex } = useProject.getState();
    // there should be no "b then a" future
    expect(historyIndex).toBe(history.length - 1);
  });

  it('undo then hotspot add then redo clears future', () => {
    const sc = fakeScene();
    useProject.getState().addScene(sc);
    useProject.getState().addHotspot(sc.id, fakeHotspot());
    useProject.getState().undo(); // back to 1 scene, no hotspot
    useProject.getState().addHotspot(sc.id, fakeHotspot()); // new action
    useProject.getState().redo(); // should be no-op (future was cleared)
    const state = useProject.getState();
    expect(state.historyIndex).toBe(state.history.length - 1);
  });
});

describe('history cap', () => {
  it('keeps at most 50 snapshots', () => {
    // Push 60 scenes sequentially — history should cap at 50
    for (let i = 0; i < 60; i++) {
      useProject.getState().addScene(fakeScene(`scene_${i}`));
    }
    expect(useProject.getState().history.length).toBeLessThanOrEqual(50);
  });
});

// ─── setActiveScene clears hotspot ────────────────────────────────────────────
describe('setActiveScene', () => {
  it('clears activeHotspotId when switching scenes', () => {
    const sc = fakeScene();
    useProject.getState().addScene(sc);
    useProject.getState().setActiveHotspot('some-id');
    useProject.getState().setActiveScene(sc.id);
    expect(useProject.getState().activeHotspotId).toBeNull();
  });
});

// ─── updateScene pushes history ───────────────────────────────────────────────
describe('updateScene', () => {
  it('records changes in history', () => {
    const sc = fakeScene();
    useProject.getState().addScene(sc);
    useProject.getState().updateScene(sc.id, { heading: 45 });
    useProject.getState().undo();
    expect(useProject.getState().project.scenes[0].heading).toBe(0);
  });
});
