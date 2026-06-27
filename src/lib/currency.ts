// Static fallback conversion rates (USD base).
// Last verified: 2026-06-27. Source: https://www.ecb.europa.eu/stats/eurofxref/
// Update when rates drift significantly or when adding more currencies.
const RATES: Record<string, number> = {
  USD: 1.00,
  EUR: 0.92,
  GBP: 0.79,
  CHF: 0.88,
};

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export function detectDefaultCurrency(): Currency {
  const lang = (typeof navigator !== 'undefined' ? navigator.language : '') ?? '';
  if (lang === 'en-GB') return 'GBP';
  if (lang.startsWith('fr-CH') || lang.startsWith('de-CH')) return 'CHF';
  if (
    lang.startsWith('fr') || lang.startsWith('de') || lang.startsWith('es') ||
    lang.startsWith('it') || lang.startsWith('nl') || lang.startsWith('pt')
  ) return 'EUR';
  return 'USD';
}

export function formatCurrency(amountUsd: number, currency: Currency): string {
  const amount = amountUsd * (RATES[currency] ?? 1);
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: amount < 0.01 ? 4 : 2,
    maximumFractionDigits: amount < 0.01 ? 4 : 2,
  }).format(amount);
}
