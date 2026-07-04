import type { Project, AuditIssue } from '../../types';
import { issue, hashIssue } from './static-checks';

const BRANDING_IMAGE_FIELDS = [
  { field: 'logoPath', label: 'Logo' },
  { field: 'faviconPath', label: 'Favicon' },
  { field: 'loaderPath', label: 'Loader image' },
] as const;

/**
 * Actually opens each configured branding image with sharp to catch files that
 * exist on disk but fail to decode (truncated exports, wrong extension, etc.) —
 * fs.copyFile during compile would pass these through silently and the exported
 * site would show a broken-image icon in the header.
 */
export async function runMediaAudit(project: Project): Promise<AuditIssue[]> {
  const b = project.branding;
  if (!b) return [];

  const issues: AuditIssue[] = [];
  for (const { field, label } of BRANDING_IMAGE_FIELDS) {
    const filePath = b[field];
    if (!filePath) continue;
    const result = await window.conchitour.validateImage(filePath);
    if (!result.ok) {
      const i = issue('error', 'branding',
        `${label} file is corrupted or unreadable`,
        `${filePath} could not be decoded (${result.error || 'unknown error'}). It will not display in the compiled tour — replace it in the Branding screen.`,
        { targetScreen: 'branding' });
      issues.push({ id: hashIssue(i), ...i });
    }
  }
  return issues;
}
