import type { Project } from '@/types';

const MIN_CONTEXT_LENGTH = 40;

export function isContextSufficient(project: Project): boolean {
  const ctx = project.aiContext?.projectContext?.trim() ?? '';
  return ctx.length >= MIN_CONTEXT_LENGTH;
}

export type ContextGateTrigger = 'audit' | 'generate' | 'branding' | 'pages' | 'seo';

let _showWizard: ((trigger: ContextGateTrigger) => Promise<boolean>) | null = null;

export function registerContextWizard(
  fn: (trigger: ContextGateTrigger) => Promise<boolean>,
) {
  _showWizard = fn;
}

export async function withContextGate<T>(
  project: Project,
  action: () => Promise<T>,
  trigger: ContextGateTrigger = 'generate',
): Promise<T | null> {
  if (isContextSufficient(project)) return action();
  if (!_showWizard) return action();

  const completed = await _showWizard(trigger);
  if (!completed) return null;

  return action();
}
