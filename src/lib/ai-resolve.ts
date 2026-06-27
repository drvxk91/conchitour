import type { ProjectModules } from '../types';

export function resolveAiProvider(
  modules: ProjectModules,
): { provider: 'claude' | 'gpt'; apiKey: string } | null {
  const preferred = modules.aiProvider ?? 'claude';
  const claudeKey = modules.anthropicApiKey ?? '';
  const gptKey = modules.openaiApiKey ?? '';

  if (preferred === 'gpt' && gptKey) return { provider: 'gpt', apiKey: gptKey };
  if (preferred === 'claude' && claudeKey) return { provider: 'claude', apiKey: claudeKey };
  // Fallback to whichever key is available
  if (gptKey) return { provider: 'gpt', apiKey: gptKey };
  if (claudeKey) return { provider: 'claude', apiKey: claudeKey };
  return null;
}
