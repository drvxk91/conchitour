import type { Project } from '@/types';
import type { ImportChange } from '../../electron/preload';

function applyField(
  patch: Record<string, unknown>,
  field: string,
  value: unknown,
  currentEntity: Record<string, unknown> | null | undefined,
) {
  const dot = field.indexOf('.');
  if (dot === -1) {
    patch[field] = value;
  } else {
    const parent = field.slice(0, dot);
    const sub = field.slice(dot + 1);
    if (patch[parent] === undefined) {
      patch[parent] = { ...(currentEntity?.[parent] as Record<string, unknown> ?? {}) };
    }
    (patch[parent] as Record<string, unknown>)[sub] = value;
  }
}

export function buildPatchesFromChanges(changes: ImportChange[], project: Project) {
  const scenePatch: Record<string, Record<string, unknown>> = {};
  const catPatch: Record<string, Record<string, unknown>> = {};
  const pagePatch: Record<string, Record<string, unknown>> = {};
  const analyticsPatch: Record<string, unknown> = {};
  const hotspotPatch: Record<string, { sceneId: string; patch: Record<string, unknown> }> = {};
  const metaPatch: Record<string, unknown> = {};
  const modulesPatch: Record<string, unknown> = {};
  const aiContextPatch: Record<string, unknown> = {};

  const sceneById   = new Map(project.scenes.map((s) => [s.id, s as unknown as Record<string, unknown>]));
  const catById     = new Map(project.categories.map((c) => [c.id, c as unknown as Record<string, unknown>]));
  const pageById    = new Map((project.pages ?? []).map((p) => [p.id, p as unknown as Record<string, unknown>]));
  const hotspotById = new Map<string, Record<string, unknown>>();
  for (const sc of project.scenes) {
    for (const h of sc.hotspots) hotspotById.set(h.id, h as unknown as Record<string, unknown>);
  }

  for (const ch of changes) {
    if (ch.entityType === 'scene') {
      if (!scenePatch[ch.entityId]) scenePatch[ch.entityId] = {};
      applyField(scenePatch[ch.entityId], ch.field, ch.patchValue, sceneById.get(ch.entityId));
    } else if (ch.entityType === 'hotspot') {
      const sceneId = ch.parentId ?? '';
      if (!hotspotPatch[ch.entityId]) hotspotPatch[ch.entityId] = { sceneId, patch: {} };
      applyField(hotspotPatch[ch.entityId].patch, ch.field, ch.patchValue, hotspotById.get(ch.entityId));
    } else if (ch.entityType === 'category') {
      if (!catPatch[ch.entityId]) catPatch[ch.entityId] = {};
      applyField(catPatch[ch.entityId], ch.field, ch.patchValue, catById.get(ch.entityId));
    } else if (ch.entityType === 'page') {
      if (!pagePatch[ch.entityId]) pagePatch[ch.entityId] = {};
      applyField(pagePatch[ch.entityId], ch.field, ch.patchValue, pageById.get(ch.entityId));
    } else if (ch.entityType === 'analytics') {
      applyField(analyticsPatch, ch.field, ch.patchValue, project.analytics as unknown as Record<string, unknown>);
    } else if (ch.entityType === 'project') {
      metaPatch[ch.field] = ch.patchValue;
    } else if (ch.entityType === 'modules') {
      modulesPatch[ch.field] = ch.patchValue;
    } else if (ch.entityType === 'ai_context') {
      aiContextPatch[ch.field] = ch.patchValue;
    }
  }

  return {
    scenePatch, catPatch, pagePatch,
    analyticsPatch: Object.keys(analyticsPatch).length ? analyticsPatch : undefined,
    hotspotPatch:   Object.keys(hotspotPatch).length   ? hotspotPatch   : undefined,
    metaPatch:      Object.keys(metaPatch).length       ? metaPatch      : undefined,
    modulesPatch:   Object.keys(modulesPatch).length    ? modulesPatch   : undefined,
    aiContextPatch: Object.keys(aiContextPatch).length  ? aiContextPatch : undefined,
  };
}
