import type { Project, AuditIssue } from '../../types';

export type AuditStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'token'; text: string }
  | { type: 'complete'; issueCount: number };

function hashStr(s: string): string {
  let h = 5381;
  for (let j = 0; j < s.length; j++) h = ((h << 5) + h) ^ s.charCodeAt(j);
  return (h >>> 0).toString(16);
}

function summarizeProjectForAi(project: Project): string {
  const defaultLang = project.languages.default || 'en';
  const langs = project.languages.available ?? ['en'];

  const scenes = project.scenes.map((s) => ({
    slug: s.slug,
    titles: langs.reduce<Record<string, string>>((acc, l) => {
      if (s.title?.[l]?.trim()) acc[l] = s.title[l];
      return acc;
    }, {}),
    descriptions: langs.reduce<Record<string, string>>((acc, l) => {
      if (s.description?.[l]?.trim()) acc[l] = s.description[l].slice(0, 120);
      return acc;
    }, {}),
    hotspotCount: s.hotspots?.length ?? 0,
    categories: (s.categoryIds ?? [])
      .map((id) => project.categories.find((c) => c.id === id)?.name?.[defaultLang] ?? id)
      .filter(Boolean),
    hasGps: !!(s.geo?.lat || s.geo?.lng),
  }));

  return JSON.stringify({
    projectName: project.meta?.name ?? 'Untitled tour',
    defaultLang,
    langs,
    sceneCount: scenes.length,
    scenes,
  });
}

function buildAuditPrompt(summary: string): string {
  return `You are reviewing a virtual tour for quality issues.
Below is a JSON summary of the tour project. Identify problems in these categories:

1. CONTENT_QUALITY — titles that are generic, unclear, all-caps, too short (<3 chars), or contain raw technical jargon.
2. TRANSLATION_CONSISTENCY — titles whose meaning diverges significantly across languages.
3. NARRATIVE_COHERENCE — scenes that seem disconnected from the logical flow of the tour.
4. SEO_IMPROVEMENTS — missing or weak descriptions/alt texts that could be stronger.

Return ONLY a JSON object with this exact shape (no markdown, no preamble):
{
  "issues": [
    {
      "category": "ai-content" | "ai-narrative",
      "severity": "warning" | "suggestion" | "info",
      "targetType": "scene" | "tour",
      "targetSlug": "<scene slug or null>",
      "title": "<short issue title under 80 chars>",
      "description": "<what is wrong and why it matters, 1-2 sentences>",
      "suggestion": "<concrete proposed replacement text in the tour default language>",
      "fixField": "title" | "description" | "altText" | null,
      "fixable": true | false
    }
  ]
}

Keep issues to the most impactful ones (max 15). Be specific about which scene slug is affected.

Project data:
${summary}`;
}

interface AiRawIssue {
  category?: string;
  severity?: string;
  targetType?: string;
  targetSlug?: string;
  title?: string;
  description?: string;
  suggestion?: string;
  fixField?: string;
  fixable?: boolean;
}

function parseAiResponse(text: string, project: Project): AuditIssue[] {
  const clean = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let parsed: { issues?: AiRawIssue[] };
  try { parsed = JSON.parse(clean); }
  catch { return []; }

  return (parsed.issues ?? []).map((i) => {
    const targetEntityId = i.targetSlug
      ? project.scenes.find((s) => s.slug === i.targetSlug)?.id
      : undefined;
    const validFixFields = ['title', 'description', 'altText'] as const;
    const fixField = validFixFields.includes(i.fixField as (typeof validFixFields)[number])
      ? (i.fixField as 'title' | 'description' | 'altText')
      : undefined;
    const item: Omit<AuditIssue, 'id'> = {
      severity: (i.severity as AuditIssue['severity']) ?? 'suggestion',
      category: (i.category as AuditIssue['category']) ?? 'ai-content',
      title: i.title ?? 'AI suggestion',
      description: i.description ?? '',
      suggestion: i.suggestion,
      fixField,
      fixable: !!i.fixable && !!fixField && !!targetEntityId,
      targetScreen: 'scenes',
      targetEntityId,
      targetEntityType: (i.targetType as AuditIssue['targetEntityType']) ?? 'scene',
      aiGenerated: true,
    };
    return { id: hashStr(JSON.stringify(item)), ...item };
  });
}

export async function runAiAuditStreaming(
  project: Project,
  anthropicKey: string,
  onEvent: (event: AuditStreamEvent) => void,
  signal?: AbortSignal,
): Promise<{ issues: AuditIssue[]; tokensIn: number; tokensOut: number }> {
  onEvent({ type: 'status', message: 'Preparing project summary…' });
  const summary = summarizeProjectForAi(project);
  const prompt = buildAuditPrompt(summary);

  onEvent({ type: 'status', message: 'Connecting to Claude…' });
  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4000,
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error(`Network error contacting Anthropic: ${String(err)}`);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    if (response.status === 401) throw new Error('Invalid Anthropic API key (401). Check your key in Modules.');
    if (response.status === 429) throw new Error('Anthropic rate limit reached (429). Try again in a moment.');
    throw new Error(`AI audit failed: ${response.status} — ${errText.slice(0, 200)}`);
  }

  onEvent({ type: 'status', message: 'Reading response…' });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let tokensIn = 0;
  let tokensOut = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const obj = JSON.parse(payload);
        if (obj.type === 'content_block_delta' && obj.delta?.text) {
          fullText += obj.delta.text;
          onEvent({ type: 'token', text: obj.delta.text });
        }
        if (obj.type === 'message_delta' && obj.usage) {
          tokensOut = obj.usage.output_tokens ?? tokensOut;
        }
        if (obj.type === 'message_start' && obj.message?.usage) {
          tokensIn = obj.message.usage.input_tokens ?? 0;
        }
      } catch { /* skip malformed */ }
    }
  }

  onEvent({ type: 'status', message: 'Parsing results…' });
  const issues = parseAiResponse(fullText, project);
  onEvent({ type: 'complete', issueCount: issues.length });

  return { issues, tokensIn, tokensOut };
}

export async function testAiConnection(anthropicKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (response.ok) return { ok: true };
    const errText = await response.text().catch(() => '');
    return { ok: false, error: `${response.status}: ${errText.slice(0, 100)}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
