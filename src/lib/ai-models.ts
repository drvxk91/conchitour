// Pricing last verified: 2026-06-27. Sources:
//   https://www.anthropic.com/pricing
//   https://openai.com/api/pricing
// Review annually or when Anthropic/OpenAI announce pricing changes.

export interface AiModel {
  id: string;
  label: string;
  provider: 'anthropic' | 'openai';
  contextWindow: number;
  inputPricePerMTok: number;   // USD per 1M input tokens
  outputPricePerMTok: number;  // USD per 1M output tokens
  visionCapable: boolean;
  recommended?: boolean;
}

export const AI_MODELS: AiModel[] = [
  // ── Anthropic Claude ──────────────────────────────────────────────────────
  {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8 (most powerful)',
    provider: 'anthropic',
    contextWindow: 200_000,
    inputPricePerMTok: 15.00,
    outputPricePerMTok: 75.00,
    visionCapable: true,
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    contextWindow: 200_000,
    inputPricePerMTok: 3.00,
    outputPricePerMTok: 15.00,
    visionCapable: true,
    recommended: true,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5 (fast & cheap)',
    provider: 'anthropic',
    contextWindow: 200_000,
    inputPricePerMTok: 0.80,
    outputPricePerMTok: 4.00,
    visionCapable: true,
  },

  // ── OpenAI GPT ────────────────────────────────────────────────────────────
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128_000,
    inputPricePerMTok: 2.50,
    outputPricePerMTok: 10.00,
    visionCapable: true,
    recommended: true,
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini (fast & cheap)',
    provider: 'openai',
    contextWindow: 128_000,
    inputPricePerMTok: 0.15,
    outputPricePerMTok: 0.60,
    visionCapable: true,
  },
  {
    id: 'gpt-4-turbo',
    label: 'GPT-4 Turbo',
    provider: 'openai',
    contextWindow: 128_000,
    inputPricePerMTok: 10.00,
    outputPricePerMTok: 30.00,
    visionCapable: true,
  },
];

export function modelById(id: string): AiModel | undefined {
  return AI_MODELS.find((m) => m.id === id);
}

export function getDefaultModel(provider: 'anthropic' | 'openai'): AiModel {
  return AI_MODELS.find((m) => m.provider === provider && m.recommended)!;
}

export function modelsForProvider(provider: 'anthropic' | 'openai'): AiModel[] {
  return AI_MODELS.filter((m) => m.provider === provider);
}
