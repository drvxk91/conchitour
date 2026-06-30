export interface LocalLicense {
  key: string;
  fingerprint: string;
  email: string;
  activatedAt: number;
  expiresAt: number | null;
  validatedAt: number;
  status: 'active' | 'trial' | 'expired' | 'invalid';
  /** 'standard' for purchased licenses, 'trial' for server-issued trial keys */
  plan?: string;
  trialStartedAt?: number;
  trialAiCallsUsed?: number;
}

export interface TrialLimits {
  maxScenes: number;
  maxLanguages: number;
  maxAiCalls: number;
  durationDays: number;
  forcedCopyright: string;
  watermarkText: string;
}

export const TRIAL_LIMITS: TrialLimits = {
  maxScenes: 3,
  maxLanguages: 2,
  maxAiCalls: 50,
  durationDays: 14,
  forcedCopyright: '© Conchitour',
  watermarkText: 'Made with Conchitour — conchitour.com',
};

export interface TrialState {
  isTrial: boolean;
  daysRemaining: number;
  hoursRemaining: number;
  aiCallsUsed: number;
  aiCallsRemaining: number;
  scenesUsed: number;
  scenesRemaining: number;
  languagesUsed: number;
  languagesRemaining: number;
  isExpired: boolean;
  limits: TrialLimits;
}

export type LicenseGateStatus =
  | 'valid'     // licensed and in date
  | 'trial'     // within trial period
  | 'expired'   // license or trial expired
  | 'none'      // never activated
  | 'invalid';  // fingerprint mismatch

export interface LicenseActivateResult {
  ok: boolean;
  error?: string;
  license?: LocalLicense;
}

export interface LicenseStatusResult {
  status: LicenseGateStatus;
  license: LocalLicense | null;
}
