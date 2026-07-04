import { useProject } from '@/store/project';
import type { GitPublishConfig } from '../../electron/preload';

/** Reads the current project's git-publish config, or null if git isn't configured yet. */
export async function getGitPublishConfig(): Promise<GitPublishConfig | null> {
  const dir = await window.conchitour.getProjectDir();
  if (!dir) return null;
  return window.conchitour.getGitConfig(dir);
}

/**
 * Called after a save completes (trigger 'save') or a compile completes
 * (trigger 'compile'). No-ops silently unless the project's configured
 * pushTrigger exactly matches — each hook only acts on its own trigger value,
 * so saving right after a manual compile never double-publishes.
 *
 * The 'save' trigger implies a fresh compile first (there's nothing to push
 * otherwise) — this is the "heavy" option surfaced in the AI & API screen.
 */
export async function maybeAutoPublish(
  trigger: 'save' | 'compile',
  onStatus: (msg: string) => void,
  outputDirHint?: string,
): Promise<void> {
  const cfg = await getGitPublishConfig();
  if (!cfg || !cfg.remote || cfg.pushTrigger !== trigger) return;

  let outputDir = outputDirHint;
  if (!outputDir) {
    const settings = await window.conchitour.settingsGet();
    outputDir = settings.lastOutputDir || undefined;
  }
  if (!outputDir) {
    onStatus('Auto-publish skipped — no output folder configured yet. Compile once manually first.');
    return;
  }

  if (trigger === 'save') {
    onStatus('Auto-publish: compiling…');
    const project = useProject.getState().project;
    const compileRes = await window.conchitour.compileRun(project, outputDir);
    if (!compileRes.ok) {
      onStatus(`Auto-publish: compile failed — ${compileRes.error}`);
      return;
    }
  }

  onStatus('Auto-publish: pushing to git…');
  const res = await window.conchitour.gitPublish(outputDir, cfg.remote, cfg.branch, cfg.token);
  onStatus(res.ok ? 'Auto-publish: pushed successfully.' : `Auto-publish failed: ${res.error}`);
}
