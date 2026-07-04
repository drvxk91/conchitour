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

  // Rich scene context: title + description snippet
  const sceneDetails = scenes
    .map((s) => {
      const title = s.title?.[metaLang] || s.title?.[defaultLang] || s.slug;
      const desc  = s.description?.[metaLang] || s.description?.[defaultLang] || '';
      return desc ? `  • ${title}: ${desc.slice(0, 80)}` : `  • ${title}`;
    })
    .join('\n');

  const cats = project.categories
    .filter((c) => !c.builtIn)
    .map((c) => c.name?.[metaLang] || c.name?.[defaultLang] || c.slug)
    .filter(Boolean)
    .join(', ');

  const gpsScenes = project.scenes.filter((s) => s.geo?.lat && s.geo.lat !== 0);
  const gpsHints  = gpsScenes
    .slice(0, 3)
    .map((s) => {
      const title = s.title?.[defaultLang] || s.slug;
      return `${title} (${s.geo!.lat.toFixed(4)}, ${s.geo!.lng.toFixed(4)})`;
    })
    .join('; ');

  const ctx            = project.aiContext;
  const projectContext = ctx?.projectContext?.trim() ?? '';
  const audience       = ctx?.audience?.trim() ?? '';
  const tone           = ctx?.tone?.trim() ?? '';

  const existingSeo    = project.seo;
  const hasExistingMeta = fillMode === 'empty' && (existingSeo?.metaTitle || existingSeo?.metaDescription);

  // Build scene list for alt text
  const sceneListForAlt = genAltTexts
    ? scenes.map((s) => {
        const title = s.title?.[defaultLang] || s.slug;
        const desc  = s.description?.[defaultLang] || '';
        return `- ${s.slug}: "${title}"${desc ? ` — ${desc.slice(0, 60)}` : ''}`;
      }).join('\n')
    : null;

  const altTextShape = genAltTexts && sceneListForAlt
    ? `{\n${langs.map((l) => `  "${l}": { "<scene-slug>": "<alt text in ${l}>", ... }`).join(',\n')}\n}`
    : null;

  // Determine language hint for CTAs
  const ctaHint = metaLang.startsWith('fr') ? '"Découvrez", "Explorez", "Visitez"'
    : metaLang.startsWith('es') ? '"Explore", "Descubra", "Visite"'
    : metaLang.startsWith('de') ? '"Entdecken Sie", "Erkunden Sie"'
    : '"Explore", "Discover", "Step inside"';

  return `You are a world-class SEO specialist for 360° virtual tours and location experiences.
Your task: generate SEO metadata that scores 95+/100 in this scoring system AND reflects the actual content of this tour.

━━━ SCORING RULES (internalize these — they determine your score) ━━━
• Meta title   → GOOD if 50–60 chars. Problem if <30 or >70. Aim for exactly 55–60.
• Focus keyword → MUST appear in title (ideally first 3 words) AND in description.
• Meta description → GOOD if 120–160 chars. Aim for exactly 145–155.
• Keywords → GOOD if 5–15 total. Aim for 10–12. First keyword = focus keyword.
• schemaType → any valid value scores full points.

━━━ PROJECT CONTEXT ━━━
Name: ${project.meta.name || 'Virtual tour'}
Short description: ${project.meta.shortDescription || '(none)'}
Creator: ${project.meta.creator || '(none)'}
Website: ${project.meta.publicationUrl || '(none)'}
Language to write in: ${metaLang}
${audience ? `Target audience: ${audience}` : ''}
${tone ? `Tone: ${tone}` : ''}
${projectContext ? `\nEditorial context (written by the author — use this extensively):\n"${projectContext}"` : ''}

Scenes (${project.scenes.length} total):
${sceneDetails || '(no scene titles yet)'}

Categories: ${cats || '(none)'}
GPS / location: ${gpsHints || '(no GPS data)'}
${hasExistingMeta ? `\n━━━ FILL-EMPTY MODE — keep existing non-empty values ━━━\nCurrent metaTitle: "${existingSeo.metaTitle || '(empty)'}"\nCurrent metaDescription: "${existingSeo.metaDescription || '(empty)'}"\n` : ''}
━━━ REQUIREMENTS ━━━
1. FOCUS KEYWORD (keywords[0]):
   - Choose the single most searched phrase for this tour (2-4 words, includes location or type if known)
   - It MUST appear verbatim in the meta title, ideally within the first 3 words
   - It MUST appear verbatim in the meta description

2. META TITLE — target exactly 55–60 characters (count carefully):
   - Start with or near the focus keyword
   - Add location or unique differentiator (use "360°" or equivalent in ${metaLang})
   - Write in ${metaLang}
   - DO NOT exceed 60 characters

3. META DESCRIPTION — target exactly 145–155 characters (count carefully):
   - Include focus keyword naturally in the first half
   - Use an action-oriented opener: ${ctaHint}
   - Mention 2 secondary keywords naturally
   - End with an implicit or explicit CTA
   - Write in ${metaLang}
   - DO NOT exceed 160 characters

4. KEYWORDS — exactly 10–12, all in ${metaLang}:
   - keywords[0] = focus keyword (same as used in title/description)
   - keywords[1–3] = close variants (singular/plural, synonyms)
   - keywords[4–7] = secondary topics from the scene list above
   - keywords[8–11] = long-tail phrases (4-6 words, location or intent specific)

5. SCHEMA TYPE — pick exactly one: TouristAttraction | Hotel | Museum | Place

${genAltTexts && sceneListForAlt ? `6. ALT TEXTS — one per scene per language (${langs.join(', ')}):
   - 1 concise sentence per scene, describe what the panorama shows
   - Use scene title and description as context
   - Write each alt text in its target language
   - Scenes:\n${sceneListForAlt}` : ''}

━━━ OUTPUT ━━━
Return ONLY valid JSON, no markdown, no explanation, no comments:
{
  "metaTitle": "...",
  "metaDescription": "...",
  "keywords": ["focus kw", "variant", ...],
  "schemaType": "TouristAttraction"${genAltTexts && altTextShape ? `,\n  "altTexts": ${altTextShape}` : ''}
}

Before finalising, silently verify:
- title length is between 55 and 60 chars
- description length is between 145 and 155 chars
- keywords[0] appears verbatim in both title and description
- keywords count is between 10 and 12`;
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

  // Extract the outermost {...} rather than only stripping a leading/trailing
  // markdown fence — models sometimes add a preamble or explanation the fence
  // regex alone doesn't account for.
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  const clean = firstBrace !== -1 && lastBrace > firstBrace
    ? text.slice(firstBrace, lastBrace + 1)
    : text.trim();

  let parsed: Partial<SeoGenerateResult & { altTexts: Record<string, string> }>;
  try {
    parsed = JSON.parse(clean);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[ai-seo] failed to parse AI response. Reason:', reason, '\nFull response:', text);
    throw new Error(`AI returned malformed JSON (${reason}). Response: "${text.slice(0, 120).replace(/\s+/g, ' ')}${text.length > 120 ? '…' : ''}"`);
  }

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
