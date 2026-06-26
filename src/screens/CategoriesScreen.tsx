import { useState } from 'react';
import { v4 as uuid } from 'uuid';
import {
  Plus, Pencil, Trash2, X, Check,
  Building, Building2, Landmark, ShoppingBag, Music, Leaf,
  Camera, Star, Heart, MapPin, Flag, Home, Info, Eye,
  Download, Upload,
} from 'lucide-react';
import { useProject } from '@/store/project';
import { toSlug, isValidSlug, uniqueSlug } from '@/lib/slug';
import type { Category } from '@/types';
import { ScreenShell } from '@/components/shell/ScreenShell';
import type { ExcelImportResult } from '../../electron/preload';

// ── Built-in icon set ─────────────────────────────────────────────────────────

const BUILT_IN_ICONS: { name: string; Icon: React.ElementType }[] = [
  { name: 'building',    Icon: Building },
  { name: 'skyscraper',  Icon: Building2 },
  { name: 'museum',      Icon: Landmark },
  { name: 'shop',        Icon: ShoppingBag },
  { name: 'music',       Icon: Music },
  { name: 'leaf',        Icon: Leaf },
  { name: 'camera',      Icon: Camera },
  { name: 'star',        Icon: Star },
  { name: 'heart',       Icon: Heart },
  { name: 'mappin',      Icon: MapPin },
  { name: 'flag',        Icon: Flag },
  { name: 'home',        Icon: Home },
  { name: 'info',        Icon: Info },
  { name: 'eye',         Icon: Eye },
];

const BUILTIN_PREFIX = 'builtin:';

function getBuiltinIcon(iconSvg?: string): React.ElementType | null {
  if (!iconSvg?.startsWith(BUILTIN_PREFIX)) return null;
  const name = iconSvg.slice(BUILTIN_PREFIX.length);
  return BUILT_IN_ICONS.find((i) => i.name === name)?.Icon ?? null;
}

function CategoryIcon({ iconSvg, color, size = 20 }: { iconSvg?: string; color: string; size?: number }) {
  const Icon = getBuiltinIcon(iconSvg);
  if (Icon) return <Icon size={size} color={color} />;
  if (iconSvg && !iconSvg.startsWith(BUILTIN_PREFIX)) {
    return <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg)}`} width={size} height={size} alt="" />;
  }
  return <MapPin size={size} color={color} />;
}

function HotspotPinPreview({ iconSvg, color, size = 40 }: { iconSvg?: string; color: string; size?: number }) {
  const height = Math.round(size * 1.2);
  const iconPx = Math.round(size * 0.34);
  const iconTop = Math.round(size * 0.5) - Math.round(iconPx / 2);
  const iconLeft = Math.round(size * 0.5) - Math.round(iconPx / 2);
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height }}>
      <svg
        width={size}
        height={height}
        viewBox="0 0 40 48"
        className="absolute inset-0"
        style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))' }}
      >
        <path
          d="M20,2 C10.06,2 2,10.06 2,20 C2,31 20,46 20,46 C20,46 38,31 38,20 C38,10.06 29.94,2 20,2Z"
          fill={color}
        />
        <circle cx="20" cy="20" r="10" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.65)" strokeWidth="1.5"/>
      </svg>
      <div
        className="absolute flex items-center justify-center"
        style={{ top: iconTop, left: iconLeft, width: iconPx, height: iconPx }}
      >
        <CategoryIcon iconSvg={iconSvg} color="white" size={iconPx} />
      </div>
    </div>
  );
}

// ── Category modal ────────────────────────────────────────────────────────────

interface ModalProps {
  initial?: Category;
  takenSlugs: Set<string>;
  languages: string[];
  defaultLang: string;
  onSave: (data: Omit<Category, 'id'>) => void;
  onClose: () => void;
}

function CategoryModal({ initial, takenSlugs, languages, defaultLang, onSave, onClose }: ModalProps) {
  const langs = languages.length ? languages : ['en'];
  const [lang, setLang] = useState(defaultLang || 'en');
  const [name, setName] = useState<Record<string, string>>(initial?.name ?? { en: '' });
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(!!initial);
  const [color, setColor] = useState(initial?.color ?? '#6b7280');
  const [iconSvg, setIconSvg] = useState(initial?.iconSvg ?? 'builtin:mappin');
  const [useAsPin, setUseAsPin] = useState(initial?.useAsPin ?? true);

  const defaultName = name[defaultLang] || name.en || Object.values(name)[0] || '';

  // Auto-generate slug from default name
  function handleNameChange(value: string) {
    const next = { ...name, [lang]: value };
    setName(next);
    if (!slugTouched) {
      const base = value || '';
      setSlug(toSlug(base));
    }
  }

  const otherSlugs = initial
    ? new Set([...takenSlugs].filter((s) => s !== initial.slug))
    : takenSlugs;

  const slugError = !slug
    ? 'Slug is required'
    : slug.startsWith('_')
    ? 'Slugs starting with _ are reserved for built-in categories'
    : !isValidSlug(slug)
    ? 'Only lowercase letters, numbers, _ and - (min 2 chars)'
    : otherSlugs.has(slug)
    ? 'Slug already in use'
    : null;

  const nameError = !defaultName ? `Name in "${defaultLang || 'en'}" is required` : null;
  const canSave = !slugError && !nameError;

  function handleSave() {
    if (!canSave) return;
    onSave({ slug, name, color, iconSvg, useAsPin });
  }

  async function handleSvgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setIconSvg(text);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-paper rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-sm font-semibold text-ink-strong">
            {initial ? 'Edit category' : 'New category'}
          </h2>
          <button onClick={onClose} className="text-ink-faded hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Pin preview */}
          <div className="flex items-center gap-4">
            <HotspotPinPreview iconSvg={iconSvg} color={color} size={44} />
            <div className="flex-1 text-sm text-ink-faded">
              {defaultName || <span className="italic">No name set</span>}
              <p className="text-[11px] mt-1 text-ink-faded/60">Hotspot pin preview</p>
            </div>
          </div>

          {/* Name (multilingual) */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium">Name</label>
              {langs.length > 1 && (
                <div className="flex gap-1 flex-wrap">
                  {langs.map((l) => (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                        lang === l ? 'bg-ink text-paper' : 'bg-paper-tinted text-ink-soft hover:bg-paper-strong'
                      }`}
                    >
                      {l.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              className="w-full bg-paper-strong border border-line-soft rounded px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-accent"
              placeholder={`Name in ${lang.toUpperCase()}…`}
              value={name[lang] ?? ''}
              onChange={(e) => handleNameChange(e.target.value)}
            />
            {nameError && <p className="text-[10px] text-red-500 mt-0.5">{nameError}</p>}
          </div>

          {/* Slug */}
          <div>
            <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium block mb-1">Slug</label>
            <input
              className="w-full bg-paper-strong border border-line-soft rounded px-3 py-1.5 text-sm text-ink font-mono focus:outline-none focus:border-accent"
              value={slug}
              onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
              placeholder="url-safe-slug"
            />
            {slugError && <p className="text-[10px] text-red-500 mt-0.5">{slugError}</p>}
          </div>

          {/* Color */}
          <div>
            <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium block mb-1">Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-10 h-8 rounded cursor-pointer border border-line-soft bg-transparent p-0.5"
              />
              <input
                className="flex-1 bg-paper-strong border border-line-soft rounded px-3 py-1.5 text-sm text-ink font-mono focus:outline-none focus:border-accent uppercase"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#6b7280"
              />
            </div>
          </div>

          {/* Icon */}
          <div>
            <label className="text-[10px] uppercase tracking-wide text-ink-faded font-medium block mb-1.5">Icon</label>
            <div className="grid grid-cols-7 gap-1.5 mb-2">
              {BUILT_IN_ICONS.map(({ name: n, Icon }) => {
                const val = BUILTIN_PREFIX + n;
                const active = iconSvg === val;
                return (
                  <button
                    key={n}
                    onClick={() => setIconSvg(val)}
                    title={n}
                    className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                      active ? 'bg-ink text-paper' : 'bg-paper-tinted text-ink hover:bg-paper-strong'
                    }`}
                  >
                    <Icon size={15} />
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer hover:text-ink">
              <Upload size={12} />
              Upload custom SVG
              <input type="file" accept=".svg" className="sr-only" onChange={handleSvgUpload} />
            </label>
          </div>

          {/* Use as pin toggle */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useAsPin}
              onChange={(e) => setUseAsPin(e.target.checked)}
              className="accent-accent w-4 h-4"
            />
            <span className="text-sm text-ink">Use as pin on map</span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-line">
          <button onClick={onClose} className="btn text-sm flex-1">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="btn btn-primary text-sm flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check size={13} />
            {initial ? 'Save changes' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export function CategoriesScreen() {
  const { project, addCategory, updateCategory, deleteCategory, updateScene } = useProject();
  const [modalOpen, setModalOpen] = useState<'new' | string | null>(null); // 'new' | category id | null
  const [toast, setToast] = useState<string | null>(null);

  const langs = project.languages.available.length ? project.languages.available : ['en'];
  const defaultLang = project.languages.default || 'en';

  const takenSlugs = new Set(project.categories.map((c) => c.slug));

  function sceneCountFor(catId: string) {
    return project.scenes.filter((s) => s.categoryIds.includes(catId)).length;
  }

  function handleCreate(data: Omit<Category, 'id'>) {
    const slug = uniqueSlug(data.slug || data.name[defaultLang] || 'category', takenSlugs);
    addCategory({ ...data, slug, id: uuid() });
    setModalOpen(null);
    showToast('Category created');
  }

  function handleEdit(id: string, data: Omit<Category, 'id'>) {
    updateCategory(id, data);
    setModalOpen(null);
    showToast('Category saved');
  }

  function handleDelete(cat: Category) {
    const count = sceneCountFor(cat.id);
    const msg = count > 0
      ? `${count} scene${count !== 1 ? 's' : ''} use this category. They will lose it. Delete anyway?`
      : `Delete category "${cat.name[defaultLang] || cat.slug}"?`;
    if (!window.confirm(msg)) return;
    deleteCategory(cat.id);
    showToast('Category deleted');
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function handleExportExcel() {
    try {
      const result = await window.conchitect.exportExcel(project);
      if (result.canceled) return;
      if (result.error) showToast('Export failed: ' + result.error);
      else showToast('Exported ✓ ' + result.path);
    } catch (err) {
      showToast('Export failed: ' + String(err));
    }
  }

  async function handleDownloadTemplate() {
    try {
      const result = await window.conchitect.downloadExcelTemplate(project);
      if (result.canceled) return;
      if (result.error) showToast('Template error: ' + result.error);
      else showToast('Template saved ✓ ' + result.path);
    } catch (err) {
      showToast('Template error: ' + String(err));
    }
  }

  async function handleImportExcel() {
    const result: ExcelImportResult = await window.conchitect.importExcel(project);
    if (result.canceled) return;

    // Apply scene patches to store
    if (result.scenePatch) {
      for (const [sceneId, patch] of Object.entries(result.scenePatch)) {
        updateScene(sceneId, patch as Parameters<typeof updateScene>[1]);
      }
    }
    // Apply category patches to store
    if (result.catPatch) {
      for (const [catId, patch] of Object.entries(result.catPatch)) {
        updateCategory(catId, patch as Parameters<typeof updateCategory>[1]);
      }
    }

    const summary = `Import done — ${result.updated ?? 0} updated, ${result.skipped ?? 0} skipped` +
      (result.errors?.length ? `, ${result.errors.length} error(s)` : '');
    showToast(summary);
  }

  const editingCategory = typeof modalOpen === 'string' && modalOpen !== 'new'
    ? project.categories.find((c) => c.id === modalOpen) ?? null
    : null;

  return (
    <ScreenShell title="Categories" subtitle="Create and customize scene categories: colors, icons, map pins.">
      {/* Action bar */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-ink-faded">
          {project.categories.length === 0
            ? 'No categories yet — create one to organize your scenes.'
            : `${project.categories.length} categor${project.categories.length === 1 ? 'y' : 'ies'}`}
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleDownloadTemplate}
            className="btn text-xs gap-1.5"
            title="Download a blank Excel template"
            data-testid="template-excel-btn"
          >
            <Download size={12} />
            Template
          </button>
          <button
            onClick={handleExportExcel}
            className="btn text-xs gap-1.5"
            title="Export current project to Excel"
            data-testid="export-excel-btn"
          >
            <Download size={12} />
            Export
          </button>
          <button
            onClick={handleImportExcel}
            className="btn text-xs gap-1.5"
            title="Import scenes/categories from Excel"
            data-testid="import-excel-btn"
          >
            <Upload size={12} />
            Import
          </button>
          <button
            onClick={() => setModalOpen('new')}
            className="btn btn-primary text-sm gap-1.5"
            data-testid="new-category-btn"
          >
            <Plus size={14} />
            New category
          </button>
        </div>
      </div>

      {/* Category grid */}
      {project.categories.length > 0 && (
        <div className="grid grid-cols-2 gap-4" data-testid="categories-grid">
          {project.categories.map((cat) => {
            const count = sceneCountFor(cat.id);
            const displayName = cat.name[defaultLang] || cat.name.en || Object.values(cat.name)[0] || cat.slug;

            return (
              <div
                key={cat.id}
                data-testid={`category-card-${cat.id}`}
                className="bg-paper border border-line rounded-xl p-4 flex items-start gap-3 hover:border-line-strong transition-colors"
              >
                {/* Hotspot pin preview */}
                <HotspotPinPreview iconSvg={cat.iconSvg} color={cat.color} size={36} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-strong truncate">{displayName}</p>
                  <p className="text-[11px] text-ink-faded mt-0.5">
                    {count} scene{count !== 1 ? 's' : ''}
                    <span className="mx-1.5 opacity-40">·</span>
                    <span className="font-mono">{cat.color}</span>
                  </p>
                  <p className="text-[10px] text-ink-faded/60 mt-0.5 font-mono">{cat.slug}</p>
                </div>

                {/* Actions */}
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => setModalOpen(cat.id)}
                    className="btn text-xs p-1.5"
                    title="Edit category"
                    data-testid={`edit-category-${cat.id}`}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => handleDelete(cat)}
                    className="btn btn-danger text-xs p-1.5"
                    title="Delete category"
                    data-testid={`delete-category-${cat.id}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {project.categories.length === 0 && (
        <div className="border border-dashed border-line-strong rounded-xl p-12 text-center">
          <MapPin size={32} className="mx-auto text-ink-faded/40 mb-3" />
          <p className="text-sm text-ink-soft">No categories yet</p>
          <p className="text-xs text-ink-faded mt-1">Categories let you group scenes and style them with colors and icons.</p>
          <button
            onClick={() => setModalOpen('new')}
            className="btn btn-primary text-sm mt-4 gap-1.5"
          >
            <Plus size={14} />
            Create first category
          </button>
        </div>
      )}

      {/* Modal */}
      {modalOpen === 'new' && (
        <CategoryModal
          takenSlugs={takenSlugs}
          languages={langs}
          defaultLang={defaultLang}
          onSave={handleCreate}
          onClose={() => setModalOpen(null)}
        />
      )}
      {editingCategory && (
        <CategoryModal
          initial={editingCategory}
          takenSlugs={takenSlugs}
          languages={langs}
          defaultLang={defaultLang}
          onSave={(data) => handleEdit(editingCategory.id, data)}
          onClose={() => setModalOpen(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-xs px-4 py-2 rounded-full shadow-lg z-50 pointer-events-none">
          {toast}
        </div>
      )}
    </ScreenShell>
  );
}
