/** Text utilities shared by extraction, evidence checks and AI filtering. */

export const MAX_EXTRACTED_CHARS = 100_000;

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Aggressive normalisation for comparing an excerpt with its source. */
export function normalizeForComparison(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/[•·▪●◦]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when `excerpt` literally occurs in `source` (after normalisation).
 * Used to drop AI suggestions whose "evidence" is not actually in the CV.
 */
export function excerptOccursIn(excerpt: string, source: string): boolean {
  const e = normalizeForComparison(excerpt);
  if (e.length < 8) return false;
  return normalizeForComparison(source).includes(e);
}

const SENSITIVE_PATTERNS: RegExp[] = [
  /[€$£]\s?\d/,
  /\d[\d.,]*\s?(k|m|mln|mio|million|miljoen|bn|billion|miljard)\b/i,
  /\b(eur|euro|usd|gbp)\b/i,
  /\d+(?:[.,]\d+)?\s?%/,
  /\bp\s?&\s?l\b/i,
  /\b(budget|omzet|revenue|turnover|arr|mrr|ebitda|margin|marge|winst|profit)\b/i,
  /\b(team|teams|organisation|organization|organisatie)\s+(of|van)\s+\d+/i,
  /\b\d+\s?(fte|people|employees|medewerkers|direct reports|reports|staff|personen)\b/i,
  /\b(headcount|eindverantwoordelijk|full responsibility)\b/i,
];

/**
 * Flags quantified or high-stakes claims (money, percentages, P&L, team
 * size). Such facts need explicit confirmation and are highlighted in the UI.
 */
export function isSensitiveClaim(statement: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(statement));
}
