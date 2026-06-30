import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { machineIdSync } from 'node-machine-id';
const storePath = () => path.join(app.getPath('userData'), 'license.json');
function machineSecret() {
    return machineIdSync();
}
function signLicense(data) {
    return createHmac('sha256', 'conchitour-v1:' + machineSecret())
        .update(JSON.stringify(data))
        .digest('hex');
}
export async function loadLicense() {
    try {
        const raw = await fs.readFile(storePath(), 'utf-8');
        const stored = JSON.parse(raw);
        const sig = stored.__sig;
        const { __sig: _omit, ...data } = stored;
        if (sig !== signLicense(data)) {
            console.warn('[license] signature mismatch — file may have been tampered');
            return null;
        }
        return data;
    }
    catch {
        return null;
    }
}
export async function saveLicense(license) {
    const sig = signLicense(license);
    await fs.writeFile(storePath(), JSON.stringify({ ...license, __sig: sig }, null, 2), 'utf-8');
}
export async function clearLicense() {
    try {
        await fs.unlink(storePath());
    }
    catch { /* already gone */ }
}
