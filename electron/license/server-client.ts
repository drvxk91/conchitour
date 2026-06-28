import { LICENSE_CONFIG } from '../license-config';

export async function validateLicense(args: {
  key: string;
  fingerprint: string;
  platform: string;
  hostname: string;
}): Promise<Record<string, unknown>> {
  const res = await fetch(`${LICENSE_CONFIG.serverBase}/licenses/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await res.json() as Record<string, unknown>;
  return { httpStatus: res.status, ...data };
}

export async function deactivateMachine(args: {
  key: string;
  fingerprint: string;
}): Promise<Record<string, unknown>> {
  const res = await fetch(
    `${LICENSE_CONFIG.serverBase}/licenses/${args.key}/activations/${args.fingerprint}`,
    { method: 'DELETE' },
  );
  return await res.json() as Record<string, unknown>;
}

export async function getLicenseStatus(key: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${LICENSE_CONFIG.serverBase}/licenses/${key}/status`);
  return await res.json() as Record<string, unknown>;
}
