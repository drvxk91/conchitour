import { Glasses, Smartphone, Maximize, MessageSquare, ClipboardList, Key } from 'lucide-react';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';

const inputCls =
  'w-full bg-paper-strong border border-line-soft rounded px-3 py-1.5 text-sm text-ink placeholder-ink-faded font-mono focus:outline-none focus:border-accent';

interface ModuleToggleProps {
  Icon: React.ElementType;
  label: string;
  description: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
}

function ModuleToggle({ Icon, label, description, enabled, onChange, children }: ModuleToggleProps) {
  return (
    <div className={`rounded-xl border p-4 transition-colors ${enabled ? 'border-line-strong bg-paper' : 'border-line-soft bg-paper-tinted'}`}>
      <label className="flex items-start gap-3 cursor-pointer select-none">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
          enabled ? 'bg-ink/10 text-ink' : 'bg-paper-strong text-ink-faded'
        }`}>
          <Icon size={18} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-ink">{label}</p>
          <p className="text-xs text-ink-faded mt-0.5">{description}</p>
          {enabled && children && (
            <div className="mt-3" onClick={(e) => e.stopPropagation()}>
              {children}
            </div>
          )}
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 accent-accent flex-shrink-0 mt-1"
        />
      </label>
    </div>
  );
}

export function ModulesScreen() {
  const { project, updateModules } = useProject();
  const m = project.modules;

  return (
    <ScreenShell title="Modules" subtitle="Enable optional viewer features and integrations.">
      <div className="max-w-xl space-y-3">

        <ModuleToggle
          Icon={Glasses}
          label="VR / Cardboard mode"
          description="Adds a VR button that splits the view for Google Cardboard headsets."
          enabled={m.vr}
          onChange={(v) => updateModules({ vr: v })}
        />

        <ModuleToggle
          Icon={Smartphone}
          label="Gyroscope navigation"
          description="On mobile, tilting the device rotates the panorama. Requires device motion permission."
          enabled={m.gyroscope}
          onChange={(v) => updateModules({ gyroscope: v })}
        />

        <ModuleToggle
          Icon={Maximize}
          label="Fullscreen button"
          description="Adds a fullscreen toggle in the viewer controls."
          enabled={m.fullscreen}
          onChange={(v) => updateModules({ fullscreen: v })}
        />

        <ModuleToggle
          Icon={MessageSquare}
          label="Feedback button"
          description="Shows a feedback/contact button that opens a mailto: link."
          enabled={m.feedbackMailto !== undefined}
          onChange={(v) => updateModules({ feedbackMailto: v ? (m.feedbackMailto ?? '') : undefined })}
        >
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium">Email address</label>
            <input
              className={inputCls}
              defaultValue={m.feedbackMailto ?? ''}
              placeholder="feedback@example.com"
              onBlur={(e) => updateModules({ feedbackMailto: e.target.value || undefined })}
            />
          </div>
        </ModuleToggle>

        <ModuleToggle
          Icon={ClipboardList}
          label="Contact forms"
          description="Enables Form-type hotspots in the viewer. Submissions are sent by mailto."
          enabled={m.formsEnabled}
          onChange={(v) => updateModules({ formsEnabled: v })}
        />

        {/* DeepL key (also editable from Languages screen) */}
        <div className="rounded-xl border border-line-soft bg-paper-tinted p-4 mt-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-paper-strong text-ink-faded">
              <Key size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">DeepL API key</p>
              <p className="text-xs text-ink-faded mt-0.5 mb-3">
                Used for auto-translation in the Languages screen and the Scenes editor.
              </p>
              <input
                type="password"
                className={inputCls}
                defaultValue={m.deeplApiKey ?? ''}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
                onBlur={(e) => updateModules({ deeplApiKey: e.target.value || undefined })}
              />
              {m.deeplApiKey && (
                <p className="text-[11px] text-green-600 mt-1">API key stored.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </ScreenShell>
  );
}
