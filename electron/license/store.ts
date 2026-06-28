import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { machineIdSync } from 'node-machine-id';
import type { LocalLicense } from '../../src/types/license';

const storePath = () => path.join(app.getPath('userData'), 'license.json');

function machineSecret(): string {
  return machineIdSync();
}

function signLicense(data: LocalLicense): string {
  return createHmac('sha256', 'conchitour-v1:' + machineSecret())
    .update(JSON.stringify(data))
    .digest('hex');
}

export async function loadLicense(): Promise<LocalLicense | null> {
  try {
    const raw = await fs.readFile(storePath(), 'utf-8');
    const stored = JSON.parse(raw) as LocalLicense & { __sig?: string };
    const sig = stored.__sig;
    const { __sig: _omit, ...data } = stored;
    if (sig !== signLicense(data as LocalLicense)) {
      console.warn('[license] signature mismatch — file may have been tampered');
      return null;
    }
    return data as LocalLicense;
  } catch {
    return null;
  }
}

export async function saveLicense(license: LocalLicense): Promise<void> {
  const sig = signLicense(license);
  await fs.writeFile(storePath(), JSON.stringify({ ...license, __sig: sig }, null, 2), 'utf-8');
}

export async function clearLicense(): Promise<void> {
  try { await fs.unlink(storePath()); } catch { /* already gone */ }
}
