import { machineId } from 'node-machine-id';
import { createHash } from 'node:crypto';
let cached = null;
export async function getMachineFingerprint() {
    if (cached)
        return cached;
    const raw = await machineId(false);
    cached = createHash('sha256')
        .update('conchitour-v1:' + raw)
        .digest('hex')
        .slice(0, 32);
    return cached;
}
