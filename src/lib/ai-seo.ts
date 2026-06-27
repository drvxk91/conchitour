import type { Project, ProjectSeo } from '../types';
import { callAiStreaming } from './ai-content';

export interface SeoGenerateResult {
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  schemaType: ProjectSeo['schemaType'];
  /** lang → sceneSlug → altText */
  altTexts?: Record<string, Record<string, string>>;
}

function buildSeoPrompt(
  project: Project,
  metaLang: string,
  langs: string[],
  fillMode: 'all' | 'empty',
  genAltTexts: boolean,
): string {
  const defaultLang = project.languages.default || 'en';
  const scenes = project.scenes.slice(0, 20);
  const sceneNames = scenes
    .map((s) => s.title?.[metaLang] || s.title?.[defaultLang] || s.slug)
    .filter(Boolean)
    .join(', ');

  const cats = project.categories
    .filter((c) => !c.builtIn)
    .map((c) => c.name?.[metaLang] || c.name?.[defaultLang] || c.slug)
    .filter(Boolean)
    .join(', ');

  const gpsHints = project.scenes
    .filter((s) => s.geo?.lat && s.geo.lat !== 0)
    .map((s) => `${s.geo!.lat.toFixed(4)},${s.geo!.lng.toFixed(4)}`)
    .slice(0, 3)
    .join(' / ');

  const ctx = project.aiContext;
  const projectContext = ctx?.projectContext?.trim() ?? '';

  const existingSeo = project.seo;
  const hasExistingMeta = fillMode === 'empty' && (existingSeo?.metaTitle || existingSeo?.metaDescription);

  const sceneListForAlt = genAltTexts
    ? scenes.map((s) => `- ${s.slug}: "${s.title?.[defaultLang] || s.slug}"`).join('\n')
    : null;

  const altLangsNote = genAltTexts && langs.length > 1
    ? `Languages for alt text: ${langs.join(', ')} — write each alt text in the correct language.`
    : genAltTexts
      ? `Language for alt text: ${langs[0] || metaLang}.`
      : '';

  const altTextShape = genAltTexts && sceneListForAlt
    ? `{\n${langs.map((l) => `  "${l}": { "scene-slug": "alt text in ${l} for this scene", ... }`).join(',\n')}\n}`
    : null;

  return `You are a world-class SEO expert specializing in tourism, hospitality, and location-based experiences.

PROJECT INFORMATION:
- Tour name: ${project.meta.name || 'Virtual tour'}
- Description: ${project.meta.shortDescription || '(none)'}
- Creator: ${project.meta.creator || '(none)'}
- Primary language for meta tags: ${metaLang}
- Scenes (${project.scenes.length}): ${sceneNames || '(no titles yet)'}
- Categories: ${cats || '(none)'}
- GPS hints: ${gpsHints || '(no GPS)'}
${projectContext ? `\nEditorial context provided by the author:\n"${projectContext}"` : ''}
${hasExistingMeta ? `\nEXISTING VALUES (only fill empty ones):\n- metaTitle: "${existingSeo.metaTitle || '(empty)'}"\n- metaDescription: "${existingSeo.metaDescription || '(empty)'}"` : ''}

TASK:
Generate the best possible SEO metadata to maximize organic search ranking and click-through rate.
${fillMode === 'empty' ? 'Only generate values for fields that are currently empty (marked as "(empty)" above). Keep existing values as-is.' : ''}

RULES (follow strictly):
1. Meta title: 50–60 characters, must include the primary keyword, location if known, and a unique value proposition (include "360°" or "visite virtuelle" depending on language). No keyword stuffing. Write in language: ${metaLang}.
2. Meta description: 120–160 characters. Must be compelling, include a CTA ("Explore…", "Découvrez…"), and mention 2-3 secondary keywords naturally. Write in language: ${metaLang}.
3. Keywords: 10-15 keywords, mix of short-tail high-volume (2-3 words), long-tail high-intent (4-6 words), location-specific if GPS available. All in language: ${metaLang}.
4. schemaType: pick the best fit from: TouristAttraction | Hotel | Museum | Place
${genAltTexts && sceneListForAlt ? `5. altTexts: write a short descriptive alt text (1-2 sentences, plain language) for each scene image. ${altLangsNote}
Scenes:\n${sceneListForAlt}` : ''}

Return ONLY valid JSON — no markdown, no preamble, no explanation:
{
  "metaTitle": "...",
  "metaDescription": "...",
  "keywords": ["kw1", "kw2", ...],
  "schemaType": "TouristAttraction"${genAltTexts && altTextShape ? `,\n  "altTexts": ${altTextShape}` : ''}
}`;
}

export async function generateSeoWithAi(
  project: Project,
  provider: 'claude' | 'gpt',
  apiKey: string,
  metaLang: string,
  langs: string[],
  fillMode: 'all' | 'empty',
  genAltTexts: boolean,
  onToken: (t: string) => void,
  signal: AbortSignal,
): Promise<SeoGenerateResult> {
  const prompt = buildSeoPrompt(project, metaLang, langs, fillMode, genAltTexts);

  const { text } = await callAiStreaming(provider, apiKey, prompt, null, signal, onToken);

  const clean = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let parsed: Partial<SeoGenerateResult & { altTexts: Record<string, string> }> = {};
  try { parsed = JSON.parse(clean); } catch { /* ignore parse error */ }

  const validSchemaTypes: ProjectSeo['schemaType'][] = ['TouristAttraction', 'Hotel', 'Museum', 'Place'];
  const schemaType = validSchemaTypes.includes(parsed.schemaType as ProjectSeo['schemaType'])
    ? (parsed.schemaType as ProjectSeo['schemaType'])
    : 'TouristAttraction';

  // For "empty" fill mode, preserve existing non-empty values
  const existingSeo = project.seo;
  const metaTitle = fillMode === 'empty' && existingSeo?.metaTitle
    ? existingSeo.metaTitle
    : (parsed.metaTitle ?? '');
  const metaDescription = fillMode === 'empty' && existingSeo?.metaDescription
    ? existingSeo.metaDescription
    : (parsed.metaDescription ?? '');
  const keywords = fillMode === 'empty' && existingSeo?.keywords?.length
    ? existingSeo.keywords
    : (Array.isArray(parsed.keywords) ? parsed.keywords.filter((k) => typeof k === 'string') : []);

  let altTexts: Record<string, Record<string, string>> | undefined;
  if (genAltTexts && parsed.altTexts) {
    // Accept both flat (legacy) and nested (lang → slug → text) shapes
    const raw = parsed.altTexts as Record<string, unknown>;
    const firstVal = Object.values(raw)[0];
    if (typeof firstVal === 'string') {
      // Flat shape: { slug: text } — wrap into the single metaLang bucket
      altTexts = { [metaLang]: raw as Record<string, string> };
    } else {
      altTexts = raw as Record<string, Record<string, string>>;
    }
  }

  return { metaTitle, metaDescription, keywords, schemaType, altTexts };
}

// ── Page content generation ───────────────────────────────────────────────────

const PAGE_TYPE_PROMPTS: Record<string, string> = {
  privacy: 'GDPR-compliant privacy policy',
  legal: 'legal notice (mentions légales)',
  terms: 'terms of use / terms of service',
  about: 'about us / presentation page',
  contact: 'contact page',
};

export async function generatePageWithAi(
  project: Project,
  pageSlug: string,
  pageTitle: string,
  lang: string,
  provider: 'claude' | 'gpt',
  apiKey: string,
  existingContent: string,
  onToken: (t: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const ctx = project.aiContext;
  const projectContext = ctx?.projectContext?.trim() ?? '';
  const pageType = PAGE_TYPE_PROMPTS[pageSlug] ?? `static page titled "${pageTitle}"`;
  const hasExisting = existingContent.trim().length > 0;

  const prompt = `You are a professional copywriter and legal content specialist.

CONTEXT:
- Tour/website name: ${project.meta.name || 'Virtual tour'}
- Creator/company: ${project.meta.creator || '(not specified)'}
- Contact email: ${project.meta.contactEmail || '(not specified)'}
- Publication URL: ${project.meta.publicationUrl || '(not specified)'}
- Language: ${lang}
${projectContext ? `- Editorial context: "${projectContext}"` : ''}

${hasExisting ? `EXISTING CONTENT TO IMPROVE:
${existingContent}

TASK:
Rewrite and improve this ${pageType} in language "${lang}". Keep the structure but enhance the language, completeness, and legal accuracy. Incorporate all project context above.` : `TASK:
Write a complete, professional ${pageType} in language "${lang}".`}

RULES:
- Write in Markdown format (use # for h1, ## for h2, **bold**, etc.)
- Adapt the tone to the context (${ctx?.tone ?? 'professional'} tone, ${ctx?.audience ?? 'general'} audience)
- For legal pages (privacy, legal, terms): include all legally required sections for EU/French regulations (GDPR, LCEN)
- For about/contact: write engaging, human content that reflects the project's editorial context
- Keep it concise but complete
- Use real section headers
- DO NOT include placeholders like [YOUR NAME] — use the provided info or skip the section if info is missing
- Return ONLY the Markdown content, no extra commentary`;

  const { text } = await callAiStreaming(provider, apiKey, prompt, null, signal, onToken);
  return text.trim();
}
