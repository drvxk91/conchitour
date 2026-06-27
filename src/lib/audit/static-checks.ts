import type { Project, AuditIssue, AuditCategory, AuditSeverity, LinkHotspot } from '../../types';

type PushFn = (i: Omit<AuditIssue, 'id'>) => void;

function hashIssue(i: Omit<AuditIssue, 'id'>): string {
  const key = [i.category, i.severity, i.title, i.targetEntityId || ''].join('|');
  let h = 5381;
  for (let j = 0; j < key.length; j++) {
    h = ((h << 5) + h) ^ key.charCodeAt(j);
  }
  return (h >>> 0).toString(16);
}

function issue(
  severity: AuditSeverity,
  category: AuditCategory,
  title: string,
  description: string,
  extra?: Partial<Omit<AuditIssue, 'id' | 'severity' | 'category' | 'title' | 'description'>>
): Omit<AuditIssue, 'id'> {
  return { severity, category, title, description, ...extra };
}

// ── Scenes ────────────────────────────────────────────────────────────────────

function checkScenes(project: Project, push: PushFn) {
  const defaultLang = project.languages.default || 'en';

  if (project.scenes.length === 0) {
    push(issue('error', 'content', 'No scenes in the tour',
      'Import at least one panorama in the Import screen.', { targetScreen: 'import' }));
    return;
  }

  // Build inbound-link set for orphan detection
  const linkedTargetIds = new Set<string>();
  for (const s of project.scenes) {
    for (const h of s.hotspots ?? []) {
      if (h.type === 'link') linkedTargetIds.add((h as LinkHotspot).targetSceneId);
    }
  }
  const startSceneId = project.branding?.startSceneId ?? project.scenes[0]?.id;

  for (const scene of project.scenes) {
    // Missing title
    if (!scene.title?.[defaultLang]?.trim()) {
      push(issue('warning', 'content',
        `Scene "${scene.slug}" has no title in ${defaultLang}`,
        'Visitors will see no header title. Add a localized title in the Scenes screen.',
        { targetScreen: 'scenes', targetEntityId: scene.id, targetEntityType: 'scene' }));
    }

    // Slug looks auto-generated (common camera filename patterns)
    if (/^(img|dsc|p\d|insta|gpro|x\d|dji)[_-]?\d/i.test(scene.slug)) {
      push(issue('warning', 'content',
        `Scene slug "${scene.slug}" looks auto-generated`,
        'Replace with a meaningful slug (e.g. lobby, terrace, rooftop).',
        { targetScreen: 'scenes', targetEntityId: scene.id, targetEntityType: 'scene' }));
    }

    // Missing GPS when map mode is on
    if (project.modules?.mapMode?.enabled) {
      const hasGps = scene.geo?.lat !== 0 || scene.geo?.lng !== 0;
      if (!hasGps) {
        push(issue('error', 'media',
          `Scene "${scene.slug}" has no GPS coordinates`,
          'Map mode is enabled but this scene has no position. It will not appear on the map.',
          { targetScreen: 'map', targetEntityId: scene.id, targetEntityType: 'scene' }));
      }
    }

    // Missing description
    if (!scene.description?.[defaultLang]?.trim()) {
      push(issue('suggestion', 'content',
        `Scene "${scene.slug}" has no description`,
        'A short description improves SEO and visitor engagement.',
        { targetScreen: 'scenes', targetEntityId: scene.id, targetEntityType: 'scene' }));
    }

    // No SEO alt text
    if (!scene.altText?.[defaultLang]?.trim()) {
      push(issue('suggestion', 'seo',
        `Scene "${scene.slug}" has no alt text`,
        'Image alt text improves SEO and accessibility.',
        { targetScreen: 'seo', targetEntityId: scene.id, targetEntityType: 'scene' }));
    }

    // Orphan scene (no inbound link, not the start)
    if (scene.id !== startSceneId && !linkedTargetIds.has(scene.id)) {
      push(issue('warning', 'navigation',
        `Scene "${scene.slug}" is unreachable`,
        'No hotspot from any other scene leads here. Visitors will never see it.',
        { targetScreen: 'map', targetEntityId: scene.id, targetEntityType: 'scene' }));
    }
  }
}

// ── Hotspots ──────────────────────────────────────────────────────────────────

function checkHotspots(project: Project, push: PushFn) {
  const sceneIds = new Set(project.scenes.map((s) => s.id));
  const defaultLang = project.languages.default || 'en';

  for (const scene of project.scenes) {
    for (const h of scene.hotspots ?? []) {
      // Broken link hotspot
      if (h.type === 'link') {
        const lh = h as LinkHotspot;
        if (lh.targetSceneId && !sceneIds.has(lh.targetSceneId)) {
          push(issue('error', 'navigation',
            `Broken hotspot in "${scene.slug}"`,
            `Points to a scene that no longer exists.`,
            { targetScreen: 'scenes', targetEntityId: scene.id, targetEntityType: 'hotspot' }));
        }
      }

      // Invalid external URL
      if (h.type === 'external') {
        const url = (h as any).url || '';
        if (url) {
          try { new URL(url); }
          catch {
            push(issue('error', 'navigation',
              `Invalid external URL in "${scene.slug}"`,
              `"${url}" is not a valid URL.`,
              { targetScreen: 'scenes', targetEntityId: scene.id, targetEntityType: 'hotspot' }));
          }
        }
      }

      // Text or video hotspot with no title
      if ((h.type === 'text' || h.type === 'video') && !(h as any).title?.[defaultLang]?.trim()) {
        push(issue('suggestion', 'content',
          `A ${h.type} hotspot in "${scene.slug}" has no title`,
          'Visitors will see an empty title on the popup.',
          { targetScreen: 'scenes', targetEntityId: scene.id, targetEntityType: 'hotspot' }));
      }
    }
  }
}

// ── Categories ────────────────────────────────────────────────────────────────

function checkCategories(project: Project, push: PushFn) {
  const defaultLang = project.languages.default || 'en';
  const usedCatIds = new Set<string>();
  for (const s of project.scenes) {
    for (const id of s.categoryIds ?? []) usedCatIds.add(id);
  }

  for (const cat of project.categories) {
    if (cat.builtIn) continue;
    if (!cat.name?.[defaultLang]?.trim()) {
      push(issue('warning', 'content',
        `Category "${cat.slug}" has no name in ${defaultLang}`,
        'Add a localized name in the Categories screen.',
        { targetScreen: 'categories', targetEntityId: cat.id, targetEntityType: 'category' }));
    }
    if (!usedCatIds.has(cat.id)) {
      push(issue('suggestion', 'content',
        `Category "${cat.name?.[defaultLang] || cat.slug}" is unused`,
        'No scenes reference this category. Consider removing it to keep things tidy.',
        { targetScreen: 'categories', targetEntityId: cat.id, targetEntityType: 'category' }));
    }
  }
}

// ── Languages ─────────────────────────────────────────────────────────────────

function checkLanguages(project: Project, push: PushFn) {
  const defaultLang = project.languages.default || 'en';
  const available = project.languages.available ?? [];

  if (!available.includes(defaultLang)) {
    push(issue('error', 'i18n',
      `Default language "${defaultLang}" is not in the languages list`,
      'Add it in the Languages screen or change the default.',
      { targetScreen: 'languages' }));
  }

  const total = project.scenes.length;
  if (total === 0) return;

  for (const lang of available) {
    if (lang === defaultLang) continue;
    const translated = project.scenes.filter((s) => s.title?.[lang]?.trim()).length;
    const pct = Math.round((translated / total) * 100);
    if (pct < 20) {
      push(issue('warning', 'i18n',
        `${lang.toUpperCase()} has very low translation coverage`,
        `${translated} of ${total} scene titles are translated (${pct}%). Add translations in the Languages screen.`,
        { targetScreen: 'languages' }));
    }
  }
}

// ── Branding ──────────────────────────────────────────────────────────────────

function checkBranding(project: Project, push: PushFn) {
  const b = project.branding;
  const name = project.meta?.name;

  if (!name || name === 'Untitled tour') {
    push(issue('warning', 'branding',
      'Tour has no name',
      'Set a project name in the Project screen.',
      { targetScreen: 'project' }));
  }

  if (!b?.logoPath) {
    push(issue('suggestion', 'branding',
      'No logo uploaded',
      'A logo in the header improves brand recognition.',
      { targetScreen: 'branding' }));
  }

  if (!b?.faviconPath) {
    push(issue('suggestion', 'branding',
      'No favicon set',
      'A favicon makes the browser tab recognizable.',
      { targetScreen: 'branding' }));
  }

  if (!b?.startSceneId) {
    push(issue('info', 'branding',
      'No opening scene selected',
      'The first imported scene will be used. Set it explicitly in Branding for predictable results.',
      { targetScreen: 'branding' }));
  }
}

// ── SEO ───────────────────────────────────────────────────────────────────────

function checkSeo(project: Project, push: PushFn) {
  const seo = project.seo;

  if (!seo?.metaDescription?.trim()) {
    push(issue('warning', 'seo',
      'No meta description',
      'A meta description is shown in search engine results. Add one in the SEO screen.',
      { targetScreen: 'seo' }));
  }

  if (!seo?.keywords?.length) {
    push(issue('suggestion', 'seo',
      'No SEO keywords set',
      'Keywords help search engines categorize your tour.',
      { targetScreen: 'seo' }));
  }

  if (!project.meta?.publicationUrl?.trim()) {
    push(issue('warning', 'seo',
      'No publication URL set',
      'OG meta tags, canonical URLs and the sitemap require the public URL. Set it in Project → Publication URL.',
      { targetScreen: 'project' }));
  }
}

// ── Modules ───────────────────────────────────────────────────────────────────

function checkModules(project: Project, push: PushFn) {
  const m = project.modules;

  if (typeof m?.feedbackMailto === 'string' && !m.feedbackMailto.trim()) {
    push(issue('error', 'modules',
      'Feedback button has no email address',
      'The feedback button is enabled but the email is empty. Add one in the Modules screen.',
      { targetScreen: 'modules' }));
  }
}

// ── Pages ─────────────────────────────────────────────────────────────────────

function checkPages(project: Project, push: PushFn) {
  const defaultLang = project.languages.default || 'en';

  for (const page of project.pages ?? []) {
    if (!page.enabled) continue;

    const content = page.content?.[defaultLang] || '';
    if (!content.trim()) {
      push(issue('warning', 'pages',
        `Page "${page.slug}" has no content in ${defaultLang}`,
        'Enable and fill in the page content in the Pages screen.',
        { targetScreen: 'pages', targetEntityId: page.id, targetEntityType: 'page' }));
      continue;
    }

    const placeholders = content.match(/\{\{[^}]+\}\}/g);
    if (placeholders) {
      const unique = [...new Set(placeholders)];
      for (const ph of unique) {
        push(issue('error', 'pages',
          `Page "${page.slug}" has unfilled placeholder ${ph}`,
          'Replace this placeholder with your actual content in the Pages screen before publishing.',
          { targetScreen: 'pages', targetEntityId: page.id, targetEntityType: 'page' }));
      }
    }
  }
}

// ── Analytics ─────────────────────────────────────────────────────────────────

function checkAnalytics(project: Project, push: PushFn) {
  const a = project.analytics;
  if (!a?.enabled) return;

  if (!a.measurementId?.trim()) {
    push(issue('error', 'analytics',
      'Analytics enabled but Measurement ID is empty',
      'Add your GA4 Measurement ID (G-XXXXXXXXXX) in the Analytics screen.',
      { targetScreen: 'analytics' }));
  } else if (!/^G-[A-Z0-9]{9,12}$/.test(a.measurementId)) {
    push(issue('error', 'analytics',
      'Analytics Measurement ID format is invalid',
      `"${a.measurementId}" does not match the G-XXXXXXXXXX format.`,
      { targetScreen: 'analytics' }));
  }

  const hasPrivacyPage = (project.pages ?? []).some((p) => p.builtIn === 'privacy' && p.enabled);
  if (!hasPrivacyPage) {
    push(issue('suggestion', 'analytics',
      'Privacy Policy page not published',
      'Visitors are tracked by GA4 but there is no published Privacy Policy. Enable it in the Pages screen.',
      { targetScreen: 'pages' }));
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function runStaticAudit(project: Project): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const push: PushFn = (i) => issues.push({ id: hashIssue(i), ...i });

  checkScenes(project, push);
  checkHotspots(project, push);
  checkCategories(project, push);
  checkLanguages(project, push);
  checkBranding(project, push);
  checkSeo(project, push);
  checkModules(project, push);
  checkPages(project, push);
  checkAnalytics(project, push);

  return issues;
}
