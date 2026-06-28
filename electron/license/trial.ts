import { loadLicense, saveLicense } from './store';
import { TRIAL_LIMITS } from '../../src/types/license';
import type { TrialState } from '../../src/types/license';

export async function getTrialState(sceneCount = 0, languageCount = 0): Promise<TrialState | null> {
  const license = await loadLicense();
  if (!license || license.status !== 'trial') return null;

  const elapsed = Date.now() - (license.trialStartedAt ?? license.activatedAt);
  const totalMs = TRIAL_LIMITS.durationDays * 86_400_000;
  const remainingMs = Math.max(0, totalMs - elapsed);
  const aiCallsUsed = license.trialAiCallsUsed ?? 0;

  return {
    isTrial: true,
    daysRemaining: Math.floor(remainingMs / 86_400_000),
    hoursRemaining: Math.floor(remainingMs / 3_600_000),
    aiCallsUsed,
    aiCallsRemaining: Math.max(0, TRIAL_LIMITS.maxAiCalls - aiCallsUsed),
    scenesUsed: sceneCount,
    scenesRemaining: Math.max(0, TRIAL_LIMITS.maxScenes - sceneCount),
    languagesUsed: languageCount,
    languagesRemaining: Math.max(0, TRIAL_LIMITS.maxLanguages - languageCount),
    isExpired: remainingMs === 0,
    limits: TRIAL_LIMITS,
  };
}

/** Returns true if allowed, throws 'TRIAL_AI_LIMIT_REACHED' if capped. */
export async function consumeTrialAiCall(): Promise<boolean> {
  const license = await loadLicense();
  if (!license || license.status !== 'trial') return true; // not a trial — always allowed

  const used = license.trialAiCallsUsed ?? 0;
  if (used >= TRIAL_LIMITS.maxAiCalls) {
    throw new Error('TRIAL_AI_LIMIT_REACHED');
  }
  await saveLicense({ ...license, trialAiCallsUsed: used + 1 });
  return true;
}
