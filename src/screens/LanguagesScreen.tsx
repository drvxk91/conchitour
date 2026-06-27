import { useState } from 'react';
import { Plus, Trash2, Star } from 'lucide-react';
import { useProject } from '@/store/project';
import { ScreenShell } from '@/components/shell/ScreenShell';
import { flagFor } from '@/lib/language-flags';

// Common language codes with display names
const COMMON_LANGS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'ko', label: 'Korean' },
  { code: 'sv', label: 'Swedish' },
  { code: 'da', label: 'Danish' },
  { code: 'fi', label: 'Finnish' },
  { code: 'nb', label: 'Norwegian' },
];

function langLabel(code: string): string {
  return COMMON_LANGS.find((l) => l.code === code)?.label ?? code.toUpperCase();
}

function langFlag(code: string): string {
  return flagFor[code] ?? '🌐';
}

export function LanguagesScreen() {
  const { project, updateLanguages, updateModules } = useProject();
  const { languages, modules } = project;

  const [addInput, setAddInput] = useState('');
  const [addError, setAddError] = useState('');
  function handleAdd() {
    const code = addInput.trim().toLowerCase().replace(/[^a-z]/g, '');
    if (!code) { setAddError('Enter a language code (e.g. fr)'); return; }
    if (code.length < 2 || code.length > 5) { setAddError('Code must be 2–5 letters'); return; }
    if (languages.available.includes(code)) { setAddError('Already added'); return; }
    updateLanguages({ available: [...languages.available, code] });
    setAddInput('');
    setAddError('');
  }

  function handleRemove(code: string) {
    if (code === languages.default) {
      alert('Cannot remove the default language. Set another language as default first.');
      return;
    }
    if (!window.confirm(`Remove language "${langLabel(code)}"? All translations in this language will remain in the data but will no longer appear in the viewer.`)) return;
    updateLanguages({ available: languages.available.filter((l) => l !== code) });
  }

  function handleSetDefault(code: string) {
    updateLanguages({ default: code });
  }

  const available = languages.available.length ? languages.available : ['en'];

  return (
    <ScreenShell title="Languages" subtitle="Add interface languages for the compiled tour.">
      <div className="max-w-xl space-y-6">

        {/* ── Active languages ─── */}
        <div>
          <h2 className="text-sm font-semibold text-ink-strong mb-3">Active languages</h2>
          <div className="space-y-2">
            {available.map((code) => {
              const isDefault = code === languages.default;
              return (
                <div
                  key={code}
                  className="flex items-center gap-3 bg-paper border border-line-soft rounded-lg px-4 py-2.5"
                >
                  <span className="text-xl flex-shrink-0 select-none" role="img" aria-label={langLabel(code)}>{langFlag(code)}</span>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-ink">{langLabel(code)}</span>
                    <span className="ml-2 text-xs text-ink-faded font-mono">{code}</span>
                  </div>
                  {isDefault ? (
                    <span className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                      <Star size={9} />
                      default
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSetDefault(code)}
                      className="text-[10px] text-ink-faded hover:text-ink px-2 py-0.5 rounded border border-line-soft hover:border-line-strong transition-colors"
                    >
                      Set default
                    </button>
                  )}
                  {!isDefault && (
                    <button
                      onClick={() => handleRemove(code)}
                      className="text-ink-faded hover:text-red-500 transition-colors ml-1"
                      title="Remove language"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Add language ─── */}
        <div>
          <h2 className="text-sm font-semibold text-ink-strong mb-3">Add a language</h2>
          <div className="flex gap-2">
            <div className="flex-1">
              <select
                className="w-full bg-paper-strong border border-line-soft rounded px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-accent"
                value={addInput}
                onChange={(e) => { setAddInput(e.target.value); setAddError(''); }}
              >
                <option value="">Select from list…</option>
                {COMMON_LANGS.filter((l) => !available.includes(l.code)).map((l) => (
                  <option key={l.code} value={l.code}>{langFlag(l.code)}  {l.label} ({l.code})</option>
                ))}
              </select>
            </div>
            <span className="flex items-center text-xs text-ink-faded px-1">or</span>
            <input
              className="w-20 bg-paper-strong border border-line-soft rounded px-3 py-1.5 text-sm text-ink font-mono focus:outline-none focus:border-accent"
              placeholder="code"
              value={addInput}
              onChange={(e) => { setAddInput(e.target.value); setAddError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <button onClick={handleAdd} className="btn btn-primary text-sm gap-1">
              <Plus size={14} />
              Add
            </button>
          </div>
          {addError && <p className="text-[11px] text-red-500 mt-1">{addError}</p>}
        </div>

      </div>
    </ScreenShell>
  );
}
