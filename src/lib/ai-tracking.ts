import { modelById } from './ai-models';

export function computeAiCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const model = modelById(modelId);
  if (!model) return 0;
  return (inputTokens / 1_000_000) * model.inputPricePerMTok +
         (outputTokens / 1_000_000) * model.outputPricePerMTok;
}

export function resolvedModelId(
  provider: 'claude' | 'gpt',
  moduleModel?: string,
): string {
  if (moduleModel) return moduleModel;
  return provider === 'gpt' ? 'gpt-4o' : 'claude-sonnet-4-6';
}
