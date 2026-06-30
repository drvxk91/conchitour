import os from 'node:os';
import { LICENSE_CONFIG } from '../license-config';
import { getMachineFingerprint } from './fingerprint';
import { loadLicense, saveLicense, clearLicense } from './store';
import { validateLicense, deactivateMachine } from './server-client';
export async function checkLicenseStatus() {
    const local = await loadLicense();
    if (!local)
        return 'none';
    const fp = await getMachineFingerprint();
    if (fp !== local.fingerprint)
        return 'invalid';
    if (local.status === 'trial') {
        const trialDays = (Date.now() - (local.trialStartedAt ?? local.activatedAt)) / 86_400_000;
        if (trialDays > LICENSE_CONFIG.trialDurationDays) {
            await saveLicense({ ...local, status: 'expired' });
            return 'expired';
        }
        return 'trial';
    }
    if (local.expiresAt && Date.now() > local.expiresAt) {
        await saveLicense({ ...local, status: 'expired' });
        return 'expired';
    }
    if (local.status === 'expired')
        return 'expired';
    const daysSinceCheck = (Date.now() - local.validatedAt) / 86_400_000;
    if (daysSinceCheck > LICENSE_CONFIG.heartbeatIntervalDays) {
        try {
            const result = await validateLicense({
                key: local.key,
                fingerprint: fp,
                platform: process.platform,
                hostname: os.hostname(),
            });
            if (result['ok']) {
                await saveLicense({ ...local, validatedAt: Date.now() });
            }
            else {
                const code = result['code'];
                if (code === 'EXPIRED' || code === 'REVOKED') {
                    await saveLicense({ ...local, status: 'expired' });
                    return 'expired';
                }
            }
        }
        catch {
            // Network error: apply grace period
            const graceDays = daysSinceCheck;
            if (graceDays > LICENSE_CONFIG.heartbeatIntervalDays + LICENSE_CONFIG.gracePeriodDays) {
                return 'expired';
            }
        }
    }
    return 'valid';
}
export async function activateLicense(key) {
    const fp = await getMachineFingerprint();
    let result;
    try {
        result = await validateLicense({
            key,
            fingerprint: fp,
            platform: process.platform,
            hostname: os.hostname(),
        });
    }
    catch {
        return { ok: false, error: 'Network error — check your connection and try again.' };
    }
    if (!result['ok']) {
        const code = result['code'];
        const msg = result['message'];
        const errorMap = {
            NOT_FOUND: 'License key not found. Check for typos.',
            EXPIRED: 'This license has expired. Please renew at conchitour.com.',
            REVOKED: 'This license has been revoked. Contact help@conchitour.com.',
            MACHINE_LIMIT: `This key is already activated on the maximum number of machines. Deactivate one at conchitour.com.`,
            INVALID_FORMAT: 'Invalid key format. Keys look like CONCH-XXXX-XXXX-XXXX-XXXX.',
        };
        return { ok: false, error: (code && errorMap[code]) ?? msg ?? 'Activation failed.' };
    }
    const plan = result['plan'] ?? 'standard';
    const isTrial = plan === 'trial';
    const now = Date.now();
    const license = {
        key,
        fingerprint: fp,
        email: result['email'] ?? '',
        activatedAt: result['activatedAt'] ?? now,
        expiresAt: result['expiresAt'] ?? null,
        validatedAt: now,
        plan,
        status: isTrial ? 'trial' : 'active',
        ...(isTrial ? { trialStartedAt: now } : {}),
    };
    await saveLicense(license);
    return { ok: true, license };
}
export async function startTrial() {
    const fp = await getMachineFingerprint();
    const now = Date.now();
    const license = {
        key: 'TRIAL',
        fingerprint: fp,
        email: '',
        activatedAt: now,
        expiresAt: now + LICENSE_CONFIG.trialDurationDays * 86_400_000,
        validatedAt: now,
        status: 'trial',
        trialStartedAt: now,
    };
    await saveLicense(license);
    return { ok: true, license };
}
export async function deactivateThisMachine() {
    const local = await loadLicense();
    if (!local || local.status === 'trial') {
        await clearLicense();
        return { ok: true };
    }
    try {
        await deactivateMachine({ key: local.key, fingerprint: local.fingerprint });
    }
    catch {
        // Proceed with local clear even if server call fails
    }
    await clearLicense();
    return { ok: true };
}
export async function getLocalLicense() {
    return loadLicense();
}
