import type { Project } from '../types';

export type SeoCheckStatus = 'good' | 'improvement' | 'problem';

export interface SeoCheck {
  id: string;
  status: SeoCheckStatus;
  label: string;
  detail: string;
  weight: number;
}

export interface SeoAuditResult {
  score: number;
  grade: 'good' | 'ok' | 'poor';
  checks: SeoCheck[];
}

function c(
  id: string, label: string, weight: number,
  status: SeoCheckStatus, detail: string,
): SeoCheck {
  return { id, label, weight, status, detail };
}

export function runSeoAudit(project: Project): SeoAuditResult {
  const checks: SeoCheck[] = [];
  const seo = project.seo;
  const langs = project.languages.available.length ? project.languages.available : ['en'];
  const keywords = seo.keywords ?? [];
  const primaryKw = keywords[0]?.toLowerCase() ?? '';
  const scenes = project.scenes;
  const n = scenes.length;

  // ── Meta title ────────────────────────────────────────────────────────────
  const tl = seo.metaTitle?.length ?? 0;
  if (tl === 0) {
    checks.push(c('title-empty', 'Meta title', 10, 'problem', 'No meta title defined.'));
  } else if (tl < 30) {
    checks.push(c('title-len', 'Meta title length', 8, 'problem', `Too short (${tl} chars) — will be ignored by search engines. Aim for 50–60.`));
  } else if (tl < 50) {
    checks.push(c('title-len', 'Meta title length', 8, 'improvement', `A bit short (${tl} chars). Aim for 50–60 for best CTR.`));
  } else if (tl <= 60) {
    checks.push(c('title-len', 'Meta title length', 8, 'good', `Good length (${tl} chars — optimal range 50–60).`));
  } else if (tl <= 70) {
    checks.push(c('title-len', 'Meta title length', 8, 'improvement', `A bit long (${tl} chars). Google may truncate it at ~60.`));
  } else {
    checks.push(c('title-len', 'Meta title length', 8, 'problem', `Too long (${tl} chars) — will be cut off in search results.`));
  }

  if (primaryKw && tl > 0) {
    const found = seo.metaTitle.toLowerCase().includes(primaryKw);
    checks.push(c('kw-title', 'Focus keyword in title', 8,
      found ? 'good' : 'improvement',
      found
        ? `"${primaryKw}" is present in the meta title.`
        : `"${primaryKw}" not found in meta title — add it near the beginning.`));
  }

  // ── Meta description ──────────────────────────────────────────────────────
  const dl = seo.metaDescription?.length ?? 0;
  if (dl === 0) {
    checks.push(c('desc-empty', 'Meta description', 10, 'problem', 'No meta description defined. This is the snippet shown in search results.'));
  } else if (dl < 80) {
    checks.push(c('desc-len', 'Description length', 8, 'problem', `Too short (${dl} chars). Aim for 120–160.`));
  } else if (dl < 120) {
    checks.push(c('desc-len', 'Description length', 8, 'improvement', `A bit short (${dl} chars). Aim for 120–160 to fill the Google snippet.`));
  } else if (dl <= 160) {
    checks.push(c('desc-len', 'Description length', 8, 'good', `Good length (${dl} chars — optimal range 120–160).`));
  } else if (dl <= 180) {
    checks.push(c('desc-len', 'Description length', 8, 'improvement', `A bit long (${dl} chars). Google may truncate at ~160.`));
  } else {
    checks.push(c('desc-len', 'Description length', 8, 'problem', `Too long (${dl} chars) — will be truncated in search results.`));
  }

  if (primaryKw && dl > 0) {
    const found = seo.metaDescription.toLowerCase().includes(primaryKw);
    checks.push(c('kw-desc', 'Focus keyword in description', 5,
      found ? 'good' : 'improvement',
      found
        ? `"${primaryKw}" is present in the meta description.`
        : `"${primaryKw}" not found in description — add it naturally.`));
  }

  // ── Keywords ──────────────────────────────────────────────────────────────
  const kn = keywords.length;
  if (kn === 0) {
    checks.push(c('kw-count', 'Keywords', 8, 'problem', 'No keywords defined. Add 5–15 targeted keywords to guide indexing.'));
  } else if (kn < 5) {
    checks.push(c('kw-count', 'Keywords', 8, 'improvement', `Only ${kn} keyword${kn > 1 ? 's' : ''} — aim for 5–15 (mix short-tail and long-tail).`));
  } else if (kn <= 15) {
    checks.push(c('kw-count', 'Keywords', 8, 'good', `${kn} keywords defined — good range.`));
  } else {
    checks.push(c('kw-count', 'Keywords', 5, 'improvement', `${kn} keywords is a lot. Focus on 5–15 to avoid keyword dilution.`));
  }

  // ── Schema.org type ───────────────────────────────────────────────────────
  checks.push(c('schema', 'Schema.org type', 4, 'good',
    `"${seo.schemaType}" — JSON-LD structured data will be injected in the compiled tour.`));

  // ── Image sitemap ─────────────────────────────────────────────────────────
  checks.push(c('sitemap', 'Image sitemap', 4,
    seo.imageSitemap ? 'good' : 'improvement',
    seo.imageSitemap
      ? 'Image sitemap enabled — Google can index your 360° panoramas.'
      : 'Enable image sitemap to help search engines discover and index your panoramas.'));

  // ── Content depth ─────────────────────────────────────────────────────────
  if (n === 0) {
    checks.push(c('scenes', 'Content depth', 6, 'problem', 'No scenes yet — the tour has no content to index.'));
  } else if (n < 3) {
    checks.push(c('scenes', 'Content depth', 6, 'improvement', `${n} scene${n > 1 ? 's' : ''} — more scenes create a richer experience and more indexable content.`));
  } else {
    checks.push(c('scenes', 'Content depth', 6, 'good', `${n} scenes — good content depth for search engines.`));
  }

  // ── Per-language checks ───────────────────────────────────────────────────
  if (n > 0) {
    for (const lang of langs) {
      const L = lang.toUpperCase();

      const missingTitles = scenes.filter((s) => !s.title?.[lang]?.trim()).length;
      checks.push(c(`title-${lang}`, `Scene titles · ${L}`, 7,
        missingTitles === 0 ? 'good' : missingTitles === n ? 'problem' : 'improvement',
        missingTitles === 0
          ? `All ${n} scenes have a title in ${L}.`
          : `${missingTitles}/${n} scenes missing title in ${L} — titles are used as anchor text in internal links.`));

      const missingDescs = scenes.filter((s) => !s.description?.[lang]?.trim()).length;
      checks.push(c(`desc-${lang}`, `Scene descriptions · ${L}`, 6,
        missingDescs === 0 ? 'good' : missingDescs > n * 0.5 ? 'problem' : 'improvement',
        missingDescs === 0
          ? `All ${n} scenes have a description in ${L}.`
          : `${missingDescs}/${n} scenes missing description in ${L} — rich descriptions improve indexing.`));

      const missingAlt = scenes.filter((s) => !s.altText?.[lang]?.trim()).length;
      checks.push(c(`alt-${lang}`, `Image alt text · ${L}`, 7,
        missingAlt === 0 ? 'good' : 'improvement',
        missingAlt === 0
          ? `All ${n} scenes have alt text in ${L} — good for image search.`
          : `${missingAlt}/${n} scenes missing alt text in ${L} — alt text boosts image search visibility.`));
    }
  }

  // ── GPS / local SEO ───────────────────────────────────────────────────────
  if (n > 0) {
    const withGps = scenes.filter((s) => s.geo?.lat && s.geo.lat !== 0).length;
    checks.push(c('gps', 'GPS coordinates', 5,
      withGps === n ? 'good' : withGps > 0 ? 'improvement' : 'improvement',
      withGps === n
        ? 'All scenes have GPS coordinates — great for local SEO and Maps integration.'
        : withGps > 0
          ? `${withGps}/${n} scenes have GPS. Full coverage improves local ranking.`
          : 'No GPS coordinates detected. Adding them boosts local search ranking.'));
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  const totalW = checks.reduce((s, ch) => s + ch.weight, 0);
  const earned = checks.reduce((s, ch) => {
    if (ch.status === 'good') return s + ch.weight;
    if (ch.status === 'improvement') return s + ch.weight * 0.5;
    return s;
  }, 0);
  const score = totalW > 0 ? Math.round((earned / totalW) * 100) : 0;
  const grade: SeoAuditResult['grade'] = score >= 80 ? 'good' : score >= 50 ? 'ok' : 'poor';

  return { score, grade, checks };
}
