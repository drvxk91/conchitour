import { LICENSE_CONFIG } from '../license-config';
export async function validateLicense(args) {
    const res = await fetch(`${LICENSE_CONFIG.serverBase}/licenses/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
    });
    const data = await res.json();
    return { httpStatus: res.status, ...data };
}
export async function deactivateMachine(args) {
    const res = await fetch(`${LICENSE_CONFIG.serverBase}/licenses/${args.key}/activations/${args.fingerprint}`, { method: 'DELETE' });
    return await res.json();
}
export async function getLicenseStatus(key) {
    const res = await fetch(`${LICENSE_CONFIG.serverBase}/licenses/${key}/status`);
    return await res.json();
}
