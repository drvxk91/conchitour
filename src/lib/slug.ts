// Slug utilities — keep slugs URL-safe and unique.

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function isValidSlug(s: string): boolean {
  if (s.startsWith('_')) return false; // _ prefix is reserved for built-in categories
  return s.length >= 2 && s.length <= 50 && SLUG_RE.test(s);
}

export function toSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 50);
}

export function uniqueSlug(base: string, taken: Set<string>): string {
  let candidate = toSlug(base) || 'scene';
  if (!taken.has(candidate)) return candidate;
  let i = 2;
  while (taken.has(`${candidate}_${i}`)) i++;
  return `${candidate}_${i}`;
}
