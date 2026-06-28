import { useLicense } from '@/store/license';
import { useProject } from '@/store/project';
import { TRIAL_LIMITS } from '@/types/license';
import type { TrialState } from '@/types/license';

/** Sync trial state computed from store — no IPC round-trip for UI rendering. */
export function useTrialState(): TrialState | null {
  const { status, license } = useLicense();
  const { project } = useProject();

  if (status !== 'trial' || !license) return null;

  const elapsed = Date.now() - (license.trialStartedAt ?? license.activatedAt);
  const totalMs = TRIAL_LIMITS.durationDays * 86_400_000;
  const remainingMs = Math.max(0, totalMs - elapsed);
  const aiCallsUsed = license.trialAiCallsUsed ?? 0;
  const sceneCount = project.scenes.length;
  const langCount = project.languages.available.length;

  return {
    isTrial: true,
    daysRemaining: Math.floor(remainingMs / 86_400_000),
    hoursRemaining: Math.floor(remainingMs / 3_600_000),
    aiCallsUsed,
    aiCallsRemaining: Math.max(0, TRIAL_LIMITS.maxAiCalls - aiCallsUsed),
    scenesUsed: sceneCount,
    scenesRemaining: Math.max(0, TRIAL_LIMITS.maxScenes - sceneCount),
    languagesUsed: langCount,
    languagesRemaining: Math.max(0, TRIAL_LIMITS.maxLanguages - langCount),
    isExpired: remainingMs === 0,
    limits: TRIAL_LIMITS,
  };
}

/**
 * Check AI call cap, increment counter if allowed.
 * Returns null on success, error message if capped.
 */
export async function consumeTrialAiCall(): Promise<string | null> {
  const result = await window.conchitour.trialConsumeAiCall();
  if (!result.ok) return result.error ?? 'Trial AI limit reached.';
  return null;
}
