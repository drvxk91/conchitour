export const flagFor: Record<string, string> = {
  en: '🇬🇧', fr: '🇫🇷', es: '🇪🇸', de: '🇩🇪', it: '🇮🇹',
  pt: '🇵🇹', nl: '🇳🇱', pl: '🇵🇱', ru: '🇷🇺', ja: '🇯🇵',
  zh: '🇨🇳', ko: '🇰🇷', ar: '🇸🇦', tr: '🇹🇷', hi: '🇮🇳',
  sv: '🇸🇪', da: '🇩🇰', fi: '🇫🇮', nb: '🇳🇴', uk: '🇺🇦',
  no: '🇳🇴',
};

export function flagLabel(code: string): string {
  const flag = flagFor[code] ?? '🌐';
  return `${flag}  ${code.toUpperCase()}`;
}
