import type { Project, ProjectSeo } from '../types';
import { callAiStreaming } from './ai-content';

export interface SeoGenerateResult {
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  schemaType: ProjectSeo['schemaType'];
}

function buildSeoPrompt(project: Project, lang: string): string {
  const defaultLang = project.languages.default || 'en';
  const scenes = project.scenes.slice(0, 20);
  const sceneNames = scenes
    .map((s) => s.title?.[lang] || s.title?.[defaultLang] || s.slug)
    .filter(Boolean)
    .join(', ');

  const cats = project.categories
    .filter((c) => !c.builtIn)
    .map((c) => c.name?.[lang] || c.name?.[defaultLang] || c.slug)
    .filter(Boolean)
    .join(', ');

  const gpsHints = project.scenes
    .filter((s) => s.geo?.lat && s.geo.lat !== 0)
    .map((s) => `${s.geo!.lat.toFixed(4)},${s.geo!.lng.toFixed(4)}`)
    .slice(0, 3)
    .join(' / ');

  const ctx = project.aiContext;
  const projectContext = ctx?.projectContext?.trim() ?? '';

  return `You are a world-class SEO expert specializing in tourism, hospitality, and location-based experiences.

PROJECT INFORMATION:
- Tour name: ${project.meta.name || 'Virtual tour'}
- Description: ${project.meta.shortDescription || '(none)'}
- Creator: ${project.meta.creator || '(none)'}
- Language to optimize for: ${lang}
- Scenes (${project.scenes.length}): ${sceneNames || '(no titles yet)'}
- Categories: ${cats || '(none)'}
- GPS hints: ${gpsHints || '(no GPS)'}
- Scene count: ${project.scenes.length}
${projectContext ? `\nEditorial context provided by the author:\n"${projectContext}"` : ''}

TASK:
Generate the best possible SEO metadata to maximize organic search ranking and click-through rate.

RULES (follow strictly):
1. Meta title: 50–60 characters, must include the primary keyword, location if known, and a unique value proposition (include "360°" or "visite virtuelle" depending on language). No keyword stuffing.
2. Meta description: 120–160 characters. Must be compelling, include a CTA ("Explore…", "Découvrez…"), and mention 2-3 secondary keywords naturally.
3. Keywords: 10-15 keywords, mix of:
   - Short-tail high-volume (2-3 words, e.g. "virtual tour hotel")
   - Long-tail high-intent (4-6 words, e.g. "360 degree hotel tour online")
   - Location-specific if GPS available
   - Include synonyms and related terms
   - All in the target language (${lang})
4. schemaType: pick the best fit from: TouristAttraction | Hotel | Museum | Place

Return ONLY valid JSON — no markdown, no preamble, no explanation:
{
  "metaTitle": "...",
  "metaDescription": "...",
  "keywords": ["kw1", "kw2", "kw3", ...],
  "schemaType": "TouristAttraction"
}`;
}

export async function generateSeoWithAi(
  project: Project,
  provider: 'claude' | 'gpt',
  apiKey: string,
  lang: string,
  onToken: (t: string) => void,
  signal: AbortSignal,
): Promise<SeoGenerateResult> {
  const prompt = buildSeoPrompt(project, lang);

  const { text } = await callAiStreaming(provider, apiKey, prompt, null, signal, onToken);

  const clean = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let parsed: Partial<SeoGenerateResult> = {};
  try { parsed = JSON.parse(clean); } catch { /* ignore parse error */ }

  const validSchemaTypes: ProjectSeo['schemaType'][] = ['TouristAttraction', 'Hotel', 'Museum', 'Place'];
  const schemaType = validSchemaTypes.includes(parsed.schemaType as ProjectSeo['schemaType'])
    ? (parsed.schemaType as ProjectSeo['schemaType'])
    : 'TouristAttraction';

  return {
    metaTitle: parsed.metaTitle ?? '',
    metaDescription: parsed.metaDescription ?? '',
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter((k) => typeof k === 'string') : [],
    schemaType,
  };
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
  onToken: (t: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const ctx = project.aiContext;
  const projectContext = ctx?.projectContext?.trim() ?? '';
  const pageType = PAGE_TYPE_PROMPTS[pageSlug] ?? `static page titled "${pageTitle}"`;

  const prompt = `You are a professional copywriter and legal content specialist.

CONTEXT:
- Tour/website name: ${project.meta.name || 'Virtual tour'}
- Creator/company: ${project.meta.creator || '(not specified)'}
- Contact email: ${project.meta.contactEmail || '(not specified)'}
- Publication URL: ${project.meta.publicationUrl || '(not specified)'}
- Language: ${lang}
${projectContext ? `- Editorial context: "${projectContext}"` : ''}

TASK:
Write a complete, professional ${pageType} in language "${lang}".

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
