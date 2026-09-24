/** Player-facing number formatting (English conventions: comma thousands, decimal point). */

export const fmt = (n: number): string => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return Math.round(n).toLocaleString('en-US');
};

/** Mult values keep 2 decimals while small, fewer as they grow. */
export const fmtMult = (m: number): string =>
  m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : m.toFixed(2);

/** Level timer: whole seconds, tenths during the last 10 s. */
export const fmtTime = (s: number): string => {
  const t = Math.max(0, s);
  return t < 10 ? t.toFixed(1) : String(Math.ceil(t));
};

export const fmtMoney = (n: number): string => `$${Math.round(n)}`;
