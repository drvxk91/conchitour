import { create } from 'zustand';
import type { LocalLicense, LicenseGateStatus } from '@/types/license';

interface LicenseStore {
  status: LicenseGateStatus;
  license: LocalLicense | null;
  initialized: boolean;

  setStatus: (status: LicenseGateStatus, license?: LocalLicense | null) => void;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useLicense = create<LicenseStore>((set) => ({
  status: 'none',
  license: null,
  initialized: false,

  setStatus: (status, license = null) => set({ status, license }),

  initialize: async () => {
    try {
      const { status } = await window.conchitour.licenseGetInitialStatus();
      const license = await window.conchitour.licenseGetLocal();
      set({ status, license, initialized: true });
    } catch {
      set({ status: 'none', license: null, initialized: true });
    }
  },

  refresh: async () => {
    try {
      const { status, license } = await window.conchitour.licenseCheck();
      set({ status, license });
    } catch { /* keep current state */ }
  },
}));
