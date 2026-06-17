import { create } from 'zustand';
import type { Project, Scene, Category, UUID, Hotspot } from '@/types';
import { newProject } from '@/lib/factory';

// ─── history helper ───────────────────────────────────────────────────────────

type HistorySlice = Pick<ProjectStore, 'history' | 'historyIndex'>;

function withHistory(s: HistorySlice, newProject: Project) {
  const base = s.history.slice(0, s.historyIndex + 1);
  const capped = base.length >= 50 ? base.slice(1) : base;
  const newHist = [...capped, newProject];
  return {
    project: newProject,
    history: newHist,
    historyIndex: newHist.length - 1,
    isDirty: true,
  };
}

// ─── types ────────────────────────────────────────────────────────────────────

interface ProjectStore {
  project: Project;
  activeSceneId: UUID | null;
  activeHotspotId: UUID | null;
  activeScreen: ScreenId;
  isProcessing: boolean;
  processingMessage: string;
  isCompiling: boolean;
  isDirty: boolean;
  projectDir: string | null;
  history: Project[];
  historyIndex: number;

  // Navigation
  setActiveScreen: (id: ScreenId) => void;
  setActiveScene: (id: UUID | null) => void;
  setActiveHotspot: (id: UUID | null) => void;
  setProcessing: (isProcessing: boolean, message?: string) => void;
  setIsCompiling: (v: boolean) => void;
  clearDirty: () => void;
  setProjectDir: (dir: string | null) => void;
  loadProjectData: (project: Project, projectDir: string) => void;

  // Scenes
  addScene: (scene: Scene) => void;
  updateScene: (id: UUID, patch: Partial<Scene>) => void;
  deleteScene: (id: UUID) => void;
  duplicateScene: (id: UUID, newScene: Scene) => void;

  // Categories
  addCategory: (c: Category) => void;
  updateCategory: (id: UUID, patch: Partial<Category>) => void;
  deleteCategory: (id: UUID) => void;

  // Hotspots
  addHotspot: (sceneId: UUID, hotspot: Hotspot) => void;
  updateHotspot: (sceneId: UUID, hotspotId: UUID, patch: Partial<Hotspot>) => void;
  deleteHotspot: (sceneId: UUID, hotspotId: UUID) => void;

  // Project-level fields
  updateMeta: (patch: Partial<Project['meta']>) => void;
  updateLanguages: (patch: Partial<Project['languages']>) => void;
  updateSeo: (patch: Partial<Project['seo']>) => void;
  updateBranding: (patch: Partial<Project['branding']>) => void;
  updateShare: (patch: Partial<Project['share']>) => void;
  updateModules: (patch: Partial<Project['modules']>) => void;

  // History
  undo: () => void;
  redo: () => void;

  // Test helper — resets the entire store to a fresh initial state
  reset: () => void;
}

export type ScreenId =
  | 'welcome'
  | 'import'
  | 'scenes'
  | 'map'
  | 'categories'
  | 'project'
  | 'seo'
  | 'languages'
  | 'branding'
  | 'share'
  | 'modules'
  | 'compile';

// ─── store ────────────────────────────────────────────────────────────────────

const _initial = newProject();

export const useProject = create<ProjectStore>((set) => ({
  project: _initial,
  activeSceneId: null,
  activeHotspotId: null,
  activeScreen: 'welcome',
  isProcessing: false,
  processingMessage: '',
  isCompiling: false,
  isDirty: false,
  projectDir: null,
  history: [_initial],
  historyIndex: 0,

  setActiveScreen: (id) => set({ activeScreen: id }),
  setActiveScene: (id) => set({ activeSceneId: id, activeHotspotId: null }),
  setActiveHotspot: (id) => set({ activeHotspotId: id }),
  setProcessing: (isProcessing, message = '') =>
    set({ isProcessing, processingMessage: message }),
  setIsCompiling: (v) => set({ isCompiling: v }),
  clearDirty: () => set({ isDirty: false }),
  setProjectDir: (dir) => set({ projectDir: dir }),
  loadProjectData: (project, projectDir) => {
    set({
      project,
      projectDir,
      isDirty: false,
      activeSceneId: null,
      activeHotspotId: null,
      activeScreen: 'scenes',
      history: [project],
      historyIndex: 0,
    });
  },

  addScene: (scene) =>
    set((s) =>
      withHistory(s, { ...s.project, scenes: [...s.project.scenes, scene] })
    ),

  updateScene: (id, patch) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        scenes: s.project.scenes.map((sc) =>
          sc.id === id ? { ...sc, ...patch } : sc
        ),
      })
    ),

  deleteScene: (id) =>
    set((s) => ({
      ...withHistory(s, {
        ...s.project,
        scenes: s.project.scenes.filter((sc) => sc.id !== id),
      }),
      activeSceneId: s.activeSceneId === id ? null : s.activeSceneId,
      activeHotspotId: null,
    })),

  duplicateScene: (id, newScene) =>
    set((s) => {
      const idx = s.project.scenes.findIndex((sc) => sc.id === id);
      const scenes = [...s.project.scenes];
      scenes.splice(idx + 1, 0, newScene);
      return withHistory(s, { ...s.project, scenes });
    }),

  addCategory: (c) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        categories: [...s.project.categories, c],
      })
    ),

  updateCategory: (id, patch) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        categories: s.project.categories.map((c) =>
          c.id === id ? { ...c, ...patch } : c
        ),
      })
    ),

  deleteCategory: (id) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        categories: s.project.categories.filter((c) => c.id !== id),
      })
    ),

  addHotspot: (sceneId, hotspot) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        scenes: s.project.scenes.map((sc) =>
          sc.id === sceneId
            ? { ...sc, hotspots: [...sc.hotspots, hotspot] }
            : sc
        ),
      })
    ),

  updateHotspot: (sceneId, hotspotId, patch) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        scenes: s.project.scenes.map((sc) =>
          sc.id === sceneId
            ? {
                ...sc,
                hotspots: sc.hotspots.map((h) =>
                  h.id === hotspotId ? ({ ...h, ...patch } as Hotspot) : h
                ),
              }
            : sc
        ),
      })
    ),

  deleteHotspot: (sceneId, hotspotId) =>
    set((s) => ({
      ...withHistory(s, {
        ...s.project,
        scenes: s.project.scenes.map((sc) =>
          sc.id === sceneId
            ? { ...sc, hotspots: sc.hotspots.filter((h) => h.id !== hotspotId) }
            : sc
        ),
      }),
      activeHotspotId: null,
    })),

  updateMeta: (patch) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        meta: { ...s.project.meta, ...patch },
      })
    ),

  updateLanguages: (patch) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        languages: { ...s.project.languages, ...patch },
      })
    ),

  updateSeo: (patch) =>
    set((s) =>
      withHistory(s, { ...s.project, seo: { ...s.project.seo, ...patch } })
    ),

  updateBranding: (patch) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        branding: { ...s.project.branding, ...patch },
      })
    ),

  updateShare: (patch) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        share: { ...s.project.share, ...patch },
      })
    ),

  updateModules: (patch) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        modules: { ...s.project.modules, ...patch },
      })
    ),

  undo: () =>
    set((s) => {
      if (s.historyIndex === 0) return s;
      const newIndex = s.historyIndex - 1;
      return { project: s.history[newIndex], historyIndex: newIndex };
    }),

  redo: () =>
    set((s) => {
      if (s.historyIndex >= s.history.length - 1) return s;
      const newIndex = s.historyIndex + 1;
      return { project: s.history[newIndex], historyIndex: newIndex };
    }),

  reset: () => {
    const fresh = newProject();
    set({
      project: fresh,
      activeSceneId: null,
      activeHotspotId: null,
      activeScreen: 'import',
      isProcessing: false,
      processingMessage: '',
      isCompiling: false,
      isDirty: false,
      projectDir: null,
      history: [fresh],
      historyIndex: 0,
    });
  },
}));
