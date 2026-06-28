export interface LocalLicense {
  key: string;
  fingerprint: string;
  email: string;
  activatedAt: number;
  expiresAt: number | null;
  validatedAt: number;
  status: 'active' | 'trial' | 'expired' | 'invalid';
  trialStartedAt?: number;
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
