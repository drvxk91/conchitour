import { Facebook, Twitter, MessageCircle, Linkedin, Mail, Camera } from 'lucide-react';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import type { ProjectShare } from '@/types';

const SOCIAL_OPTIONS: {
  key: keyof ProjectShare;
  label: string;
  description: string;
  Icon: React.ElementType;
  color: string;
}[] = [
  { key: 'facebook',  label: 'Facebook',  description: 'Share button linking to the tour URL',          Icon: Facebook,       color: '#1877F2' },
  { key: 'twitter',   label: 'X / Twitter', description: 'Tweet the tour with title and URL',           Icon: Twitter,        color: '#000000' },
  { key: 'whatsapp',  label: 'WhatsApp',  description: 'Share via WhatsApp message',                    Icon: MessageCircle,  color: '#25D366' },
  { key: 'linkedin',  label: 'LinkedIn',  description: 'Post to LinkedIn feed',                         Icon: Linkedin,       color: '#0A66C2' },
  { key: 'email',     label: 'Email',     description: 'Open default mail client with tour link',       Icon: Mail,           color: '#6b7280' },
  { key: 'captureView', label: 'Screenshot', description: 'Let the visitor capture + share the current 360° view', Icon: Camera, color: '#7c3aed' },
];

export function ShareScreen() {
  const { project, updateShare } = useProject();
  const share = project.share;
  const pubUrl = project.meta.publicationUrl;

  const activeCount = Object.values(share).filter(Boolean).length;

  return (
    <ScreenShell title="Share" subtitle="Configure the social sharing bar displayed in the compiled tour.">
      <div className="max-w-xl space-y-6">

        {/* Social toggles */}
        <div className="space-y-2">
          {SOCIAL_OPTIONS.map(({ key, label, description, Icon, color }) => {
            const enabled = !!share[key];
            return (
              <label
                key={key}
                className={`flex items-center gap-4 p-3.5 rounded-xl border cursor-pointer select-none transition-colors ${
                  enabled
                    ? 'border-line-strong bg-paper'
                    : 'border-line-soft bg-paper-tinted opacity-60 hover:opacity-80'
                }`}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: color + '18', color }}
                >
                  <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink">{label}</p>
                  <p className="text-xs text-ink-faded">{description}</p>
                </div>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => updateShare({ [key]: e.target.checked } as Partial<ProjectShare>)}
                  className="w-4 h-4 accent-accent flex-shrink-0"
                />
              </label>
            );
          })}
        </div>

        {/* Preview bar */}
        <div className="border-t border-line pt-6">
          <p className="text-xs font-medium text-ink-faded uppercase tracking-wide mb-3">Preview</p>
          <div className="bg-zinc-900 rounded-xl p-4 flex items-center justify-center gap-3">
            {SOCIAL_OPTIONS.filter(({ key }) => share[key]).map(({ key, label, Icon, color }) => (
              <div
                key={key}
                className="w-10 h-10 rounded-full flex items-center justify-center text-white shadow-md"
                style={{ backgroundColor: color }}
                title={label}
              >
                <Icon size={18} />
              </div>
            ))}
            {activeCount === 0 && (
              <span className="text-zinc-500 text-xs">No share buttons active</span>
            )}
          </div>
          <p className="text-[11px] text-ink-faded mt-2 text-center">
            This is how the share bar will look in the compiled tour.
          </p>
        </div>

        {/* Publication URL reminder */}
        {!pubUrl && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
            Set your <strong>Publication URL</strong> in the Project screen so share links point to the right address.
          </div>
        )}
        {pubUrl && (
          <div className="bg-paper-strong border border-line-soft rounded-lg p-3 text-xs text-ink-faded">
            Share links will point to: <span className="font-mono text-ink">{pubUrl}</span>
          </div>
        )}
      </div>
    </ScreenShell>
  );
}
