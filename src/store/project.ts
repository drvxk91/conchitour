import { create } from 'zustand';
import type { Project, Scene, Category, UUID, Hotspot, StaticPage, AnalyticsConfig, AiContext, AiUsage, AiUsageRecord } from '@/types';
import { newProject, BUILTIN_CATEGORIES, DEFAULT_ANALYTICS } from '@/lib/factory';
import { DEFAULT_BUILTIN_PAGES } from '@/lib/builtin-pages';
import { detectDefaultCurrency } from '@/lib/currency';

const EMPTY_AI_USAGE: AiUsage = {
  records: [],
  totals: { anthropic: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, openai: { inputTokens: 0, outputTokens: 0, costUsd: 0 } },
};

/** Ensure all built-in categories are present (migration for pre-v2 project files). */
function ensureBuiltins(project: Project): Project {
  const existingIds = new Set(project.categories.map((c) => c.id));
  const missing = BUILTIN_CATEGORIES.filter((b) => !existingIds.has(b.id));
  if (missing.length === 0) return project;
  return { ...project, categories: [...missing, ...project.categories] };
}

/** Ensure all built-in pages are present and pages array exists. */
function ensureBuiltinPages(project: Project): Project {
  const existingIds = new Set((project.pages ?? []).map((p) => p.id));
  const missing = DEFAULT_BUILTIN_PAGES.filter((p) => !existingIds.has(p.id));
  if (missing.length === 0 && project.pages != null) return project;
  return { ...project, pages: [...missing, ...(project.pages ?? [])] };
}

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

  // Pages
  addPage: (page: StaticPage) => void;
  updatePage: (id: string, patch: Partial<StaticPage>) => void;
  deletePage: (id: string) => void;

  // Analytics
  updateAnalytics: (patch: Partial<AnalyticsConfig>) => void;

  // AI context
  updateAiContext: (patch: Partial<AiContext>) => void;
  addAiTokens: (provider: 'claude' | 'gpt', input: number, output: number) => void;
  recordAiUsage: (record: Omit<AiUsageRecord, 'timestamp'>) => void;
  resetAiUsage: () => void;
  updateUiPreferences: (patch: Partial<NonNullable<Project['uiPreferences']>>) => void;

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

  // Bulk import (single history step so one Ctrl-Z undoes the whole import)
  applyImport: (
    scenePatch: Record<string, Record<string, unknown>>,
    catPatch: Record<string, Record<string, unknown>>,
    pagePatch: Record<string, Record<string, unknown>>,
    analyticsPatch?: Record<string, unknown>,
    hotspotPatch?: Record<string, { sceneId: string; patch: Record<string, unknown> }>,
    metaPatch?: Record<string, unknown>,
    modulesPatch?: Record<string, unknown>,
    aiContextPatch?: Record<string, unknown>,
  ) => void;

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
  | 'content'
  | 'project'
  | 'seo'
  | 'languages'
  | 'pages'
  | 'branding'
  | 'share'
  | 'modules'
  | 'analytics'
  | 'ai'
  | 'audit'
  | 'compile'
  | 'license';

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
    const migrated = ensureBuiltinPages(ensureBuiltins(project));
    set({
      project: migrated,
      projectDir,
      isDirty: false,
      activeSceneId: null,
      activeHotspotId: null,
      activeScreen: 'scenes',
      history: [migrated],
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

  addPage: (page) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        pages: [...(s.project.pages ?? []), page],
      })
    ),

  updatePage: (id, patch) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        pages: (s.project.pages ?? []).map((p) =>
          p.id === id ? { ...p, ...patch } : p
        ),
      })
    ),

  deletePage: (id) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        pages: (s.project.pages ?? []).filter((p) => p.id !== id),
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

  updateAnalytics: (patch) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        analytics: { ...(s.project.analytics ?? DEFAULT_ANALYTICS), ...patch },
      })
    ),

  applyImport: (scenePatch, catPatch, pagePatch, analyticsPatch, hotspotPatch, metaPatch, modulesPatch, aiContextPatch) =>
    set((s) => {
      const p = s.project;
      const scenes = p.scenes.map((sc) => {
        let updated = scenePatch[sc.id] ? { ...sc, ...scenePatch[sc.id] } : sc;
        if (hotspotPatch) {
          const hasHotspotChanges = sc.hotspots.some((h) => hotspotPatch[h.id]);
          if (hasHotspotChanges) {
            updated = {
              ...updated,
              hotspots: (updated.hotspots ?? []).map((h) => {
                const hp = hotspotPatch[h.id];
                return hp ? ({ ...h, ...hp.patch } as Hotspot) : h;
              }),
            };
          }
        }
        return updated;
      });
      const categories = p.categories.map((cat) =>
        catPatch[cat.id] ? { ...cat, ...catPatch[cat.id] } : cat
      );
      const pages = (p.pages ?? []).map((pg) =>
        pagePatch[pg.id] ? { ...pg, ...pagePatch[pg.id] } : pg
      );
      const analytics = analyticsPatch
        ? { ...(p.analytics ?? DEFAULT_ANALYTICS), ...analyticsPatch }
        : p.analytics;
      const meta = metaPatch ? { ...p.meta, ...metaPatch } : p.meta;
      const modules = modulesPatch ? { ...p.modules, ...modulesPatch } : p.modules;
      const aiContext = aiContextPatch
        ? { ...(p.aiContext ?? { tone: 'marketing', audience: 'general', theme: 'Tourism', length: 'medium' }), ...aiContextPatch }
        : p.aiContext;
      return withHistory(s, { ...p, scenes, categories, pages, analytics, meta, modules, aiContext });
    }),

  updateAiContext: (patch) =>
    set((s) =>
      withHistory(s, {
        ...s.project,
        aiContext: { ...(s.project.aiContext ?? { tone: 'marketing', audience: 'general', theme: 'Tourism', length: 'medium' }), ...patch },
      })
    ),

  addAiTokens: (provider, input, output) =>
    set((s) => {
      const prev = s.project.aiContext ?? { tone: 'marketing' as const, audience: 'general' as const, theme: 'Tourism', length: 'medium' as const };
      const used = prev.tokensUsed ?? { claude: { in: 0, out: 0 }, gpt: { in: 0, out: 0 } };
      const updated = {
        ...used,
        [provider]: { in: (used[provider]?.in ?? 0) + input, out: (used[provider]?.out ?? 0) + output },
      };
      return withHistory(s, { ...s.project, aiContext: { ...prev, tokensUsed: updated } });
    }),

  recordAiUsage: (record) =>
    set((s) => {
      const full: AiUsageRecord = { ...record, timestamp: Date.now() };
      const prev = s.project.aiUsage ?? EMPTY_AI_USAGE;
      const prevTotals = prev.totals[record.provider] ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
      const totals = {
        ...prev.totals,
        [record.provider]: {
          inputTokens: prevTotals.inputTokens + record.inputTokens,
          outputTokens: prevTotals.outputTokens + record.outputTokens,
          costUsd: prevTotals.costUsd + record.costUsd,
        },
      };
      let records = [...prev.records, full];
      if (records.length > 500) records = records.slice(-500);
      return { project: { ...s.project, aiUsage: { records, totals } }, isDirty: true };
    }),

  resetAiUsage: () =>
    set((s) => ({
      project: { ...s.project, aiUsage: structuredClone(EMPTY_AI_USAGE) },
      isDirty: true,
    })),

  updateUiPreferences: (patch) =>
    set((s) => ({
      project: {
        ...s.project,
        uiPreferences: { ...(s.project.uiPreferences ?? { currency: detectDefaultCurrency() }), ...patch },
      },
      isDirty: true,
    })),

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
