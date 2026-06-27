import type { Project, Scene } from '../types';

// ── OpenAI streaming ──────────────────────────────────────────────────────────

async function callOpenAIStreaming(
  openaiKey: string,
  prompt: string,
  imageDataUrl: string | null,
  signal: AbortSignal,
  onToken: (text: string) => void,
  modelId = 'gpt-4o',
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const userContent: unknown[] = [];
  if (imageDataUrl) {
    userContent.push({ type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } });
  }
  userContent.push({ type: 'text', text: prompt });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 1500,
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    if (response.status === 401) throw new Error('Invalid OpenAI API key (401).');
    if (response.status === 429) throw new Error('Rate limit reached (429). Try again shortly.');
    throw new Error(`GPT request failed: ${response.status} — ${errText.slice(0, 200)}`);
  }

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
        const delta = obj.choices?.[0]?.delta?.content;
        if (delta) { fullText += delta; onToken(delta); }
        if (obj.usage) {
          tokensIn  = obj.usage.prompt_tokens     ?? tokensIn;
          tokensOut = obj.usage.completion_tokens ?? tokensOut;
        }
      } catch { /* skip */ }
    }
  }

  return { text: fullText, tokensIn, tokensOut };
}

// ── Unified router ────────────────────────────────────────────────────────────

export async function callAiStreaming(
  provider: 'claude' | 'gpt',
  apiKey: string,
  prompt: string,
  imageDataUrl: string | null,
  signal: AbortSignal,
  onToken: (text: string) => void,
  modelId?: string,
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  if (provider === 'gpt') {
    return callOpenAIStreaming(apiKey, prompt, imageDataUrl, signal, onToken, modelId);
  }
  return callAnthropicStreaming(apiKey, prompt, imageDataUrl, signal, onToken, modelId);
}

export type ContentStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'scene-start'; sceneSlug: string; sceneIndex: number; total: number }
  | { type: 'token'; text: string }
  | { type: 'scene-done'; sceneSlug: string; result: SceneContentResult }
  | { type: 'complete' };

export interface GenerateOptions {
  scope: 'all' | 'empty' | 'selected';
  selectedIds: Set<string>;
  generateTitles: boolean;
  generateDescriptions: boolean;
  generateAltText: boolean;
  langs: string[];
  fillMode: 'empty-only' | 'translate-default' | 'overwrite';
  tone: string;
  audience: string;
  theme: string;
  length: string;
  customInstructions?: string;
  imageQuality: 'low' | 'medium' | 'high';
  autoBackup: boolean;
}

export interface SceneContentResult {
  sceneId: string;
  sceneSlug: string;
  title?: Record<string, string>;
  description?: Record<string, string>;
  altText?: Record<string, string>;
}

const IMAGE_WIDTHS: Record<GenerateOptions['imageQuality'], number> = {
  low: 384,
  medium: 768,
  high: 1024,
};

function buildContentPrompt(
  scene: Scene,
  project: Project,
  options: GenerateOptions,
): string {
  const defaultLang = project.languages.default || 'en';
  const langs = options.langs;
  const categoryNames = (scene.categoryIds ?? [])
    .map((id) => project.categories.find((c) => c.id === id)?.name?.[defaultLang])
    .filter(Boolean)
    .join(', ');
  const gps = scene.geo?.lat ? `GPS: ${scene.geo.lat.toFixed(5)}, ${scene.geo.lng.toFixed(5)}` : '';

  const lengthMap: Record<string, string> = {
    short: '1 sentence',
    medium: '2-3 sentences',
    long: '4-5 sentences',
  };
  const lengthDesc = lengthMap[options.length] || '2-3 sentences';

  const fieldsNeeded = [
    options.generateTitles && 'title',
    options.generateDescriptions && 'description',
    options.generateAltText && 'altText',
  ].filter(Boolean).join(', ');

  let systemContext = `Theme: ${options.theme}. Tone: ${options.tone}. Target audience: ${options.audience}. Length: ${lengthDesc}.`;
  if (options.customInstructions?.trim()) {
    systemContext += ` Additional instructions: ${options.customInstructions.trim()}`;
  }

  const projectContext = project.aiContext?.projectContext?.trim() ?? '';

  // Build existing content section for context
  const existingTitles = langs
    .filter((l) => scene.title?.[l]?.trim())
    .map((l) => `  "${l}": "${scene.title[l]}"`)
    .join(',\n');
  const existingDescs = langs
    .filter((l) => scene.description?.[l]?.trim())
    .map((l) => `  "${l}": "${scene.description[l]}"`)
    .join(',\n');

  const hasExistingContent = existingTitles || existingDescs;

  return `You are writing professional content for a 360° virtual tour scene.

${systemContext}
${projectContext ? `\nProject editorial context: "${projectContext}"` : ''}

Scene info:
- Slug: ${scene.slug}
${categoryNames ? `- Category: ${categoryNames}` : ''}
${gps}

${hasExistingContent ? `EXISTING CONTENT (improve and expand on this — don't start from scratch):
${existingTitles ? `Existing titles:\n{\n${existingTitles}\n}` : ''}
${existingDescs ? `Existing descriptions:\n{\n${existingDescs}\n}` : ''}
` : ''}
Generate the following fields: ${fieldsNeeded}
Languages required: ${langs.join(', ')}

${options.fillMode === 'empty-only' ? 'Only fill fields that are empty — do not overwrite existing content.' : ''}
${options.fillMode === 'translate-default' ? `Write content in ${defaultLang} first, then translate to other languages.` : ''}
${options.fillMode === 'overwrite' && hasExistingContent ? 'Improve and rewrite all content, using the existing content as a starting point.' : ''}

Return ONLY valid JSON with this exact shape (no markdown, no explanation):
{
  ${options.generateTitles ? `"title": { ${langs.map((l) => `"${l}": "..."`).join(', ')} },` : ''}
  ${options.generateDescriptions ? `"description": { ${langs.map((l) => `"${l}": "..."`).join(', ')} },` : ''}
  ${options.generateAltText ? `"altText": { ${langs.map((l) => `"${l}": "..."`).join(', ')} }` : '"_placeholder": null'}
}`;
}

function parseContentResponse(
  text: string,
  scene: Scene,
  options: GenerateOptions,
): SceneContentResult {
  const clean = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let parsed: Record<string, Record<string, string>> = {};
  try { parsed = JSON.parse(clean); }
  catch { parsed = {}; }

  const result: SceneContentResult = {
    sceneId: scene.id,
    sceneSlug: scene.slug,
  };

  const langs = options.langs;
  const defaultLang = langs[0] || 'en';

  if (options.generateTitles && parsed.title) {
    const base = options.fillMode === 'empty-only'
      ? { ...scene.title }
      : {};
    result.title = { ...base };
    for (const l of langs) {
      if (options.fillMode === 'empty-only' && scene.title?.[l]?.trim()) continue;
      if (parsed.title[l]) result.title[l] = parsed.title[l];
    }
  }

  if (options.generateDescriptions && parsed.description) {
    const base = options.fillMode === 'empty-only'
      ? { ...scene.description }
      : {};
    result.description = { ...base };
    for (const l of langs) {
      if (options.fillMode === 'empty-only' && scene.description?.[l]?.trim()) continue;
      if (parsed.description[l]) result.description[l] = parsed.description[l];
    }
  }

  if (options.generateAltText && parsed.altText) {
    const base = options.fillMode === 'empty-only'
      ? { ...scene.altText }
      : {};
    result.altText = { ...base };
    for (const l of langs) {
      if (options.fillMode === 'empty-only' && scene.altText?.[l]?.trim()) continue;
      if (parsed.altText[l]) result.altText[l] = parsed.altText[l];
    }
  }

  return result;
}

async function callAnthropicStreaming(
  anthropicKey: string,
  prompt: string,
  imageDataUrl: string | null,
  signal: AbortSignal,
  onToken: (text: string) => void,
  modelId = 'claude-sonnet-4-6',
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const content: unknown[] = [];

  if (imageDataUrl) {
    const base64 = imageDataUrl.replace(/^data:image\/jpeg;base64,/, '');
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } });
  }
  content.push({ type: 'text', text: prompt });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 1500,
      stream: true,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    if (response.status === 401) throw new Error('Invalid Anthropic API key (401).');
    if (response.status === 429) throw new Error('Rate limit reached (429). Try again shortly.');
    throw new Error(`AI request failed: ${response.status} — ${errText.slice(0, 200)}`);
  }

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
          onToken(obj.delta.text);
        }
        if (obj.type === 'message_delta' && obj.usage) tokensOut = obj.usage.output_tokens ?? tokensOut;
        if (obj.type === 'message_start' && obj.message?.usage) tokensIn = obj.message.usage.input_tokens ?? 0;
      } catch { /* skip */ }
    }
  }

  return { text: fullText, tokensIn, tokensOut };
}

export async function generateContent(
  project: Project,
  apiKeys: { provider: 'claude' | 'gpt'; anthropic?: string; openai?: string; modelId?: string },
  options: GenerateOptions,
  onEvent: (ev: ContentStreamEvent) => void,
  signal: AbortSignal,
): Promise<{ results: SceneContentResult[]; tokensIn: number; tokensOut: number }> {
  const apiKey = apiKeys.provider === 'gpt' ? (apiKeys.openai ?? '') : (apiKeys.anthropic ?? '');
  const scenes = project.scenes.filter((s) => {
    if (options.scope === 'selected') return options.selectedIds.has(s.id);
    if (options.scope === 'empty') {
      const langs = options.langs;
      const defaultLang = project.languages.default || 'en';
      const hasTitle = langs.some((l) => s.title?.[l]?.trim());
      const hasDesc = langs.some((l) => s.description?.[l]?.trim());
      return !hasTitle || !hasDesc;
    }
    return true;
  });

  const results: SceneContentResult[] = [];
  let totalIn = 0;
  let totalOut = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    onEvent({ type: 'scene-start', sceneSlug: scene.slug, sceneIndex: i, total: scenes.length });

    let imageDataUrl: string | null = null;
    if (scene.media?.sourcePath) {
      onEvent({ type: 'status', message: `Compressing image for ${scene.slug}…` });
      try {
        const res = await window.conchitect.compressForAi({
          sourcePath: scene.media.sourcePath,
          targetWidth: IMAGE_WIDTHS[options.imageQuality],
          quality: 60,
        });
        if (res.ok && res.dataUrl) imageDataUrl = res.dataUrl;
      } catch { /* proceed without image */ }
    }

    onEvent({ type: 'status', message: `Generating content for ${scene.slug} (${i + 1}/${scenes.length})…` });
    const prompt = buildContentPrompt(scene, project, options);

    let sceneText = '';
    const { text, tokensIn, tokensOut } = await callAiStreaming(
      apiKeys.provider, apiKey, prompt, imageDataUrl, signal,
      (t) => { sceneText += t; onEvent({ type: 'token', text: t }); },
      apiKeys.modelId,
    );

    totalIn += tokensIn;
    totalOut += tokensOut;

    const result = parseContentResponse(text, scene, options);
    results.push(result);
    onEvent({ type: 'scene-done', sceneSlug: scene.slug, result });
  }

  onEvent({ type: 'complete' });
  return { results, tokensIn: totalIn, tokensOut: totalOut };
}

export function estimateCost(sceneCount: number, quality: GenerateOptions['imageQuality']): string {
  const perScene: Record<GenerateOptions['imageQuality'], number> = {
    low: 0.05,
    medium: 0.12,
    high: 0.25,
  };
  return (sceneCount * perScene[quality]).toFixed(2);
}
