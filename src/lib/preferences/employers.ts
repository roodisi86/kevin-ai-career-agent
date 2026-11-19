/**
 * Employer-name normalisation and exclusion matching. Used to hide employers
 * the user excluded, including alternative spellings and acronyms
 * (e.g. "LSEG" vs "London Stock Exchange Group").
 */

const LEGAL_SUFFIXES = new Set([
  "bv",
  "nv",
  "ltd",
  "limited",
  "plc",
  "inc",
  "incorporated",
  "llc",
  "gmbh",
  "ag",
  "sa",
  "sas",
  "srl",
  "sl",
  "spa",
  "co",
  "corp",
  "corporation",
  "company",
  "holding",
  "holdings",
  "international",
  "europe",
  "nederland",
  "netherlands",
]);

const STOP_WORDS = new Set(["of", "and", "the", "de", "het", "van", "en", "&"]);

export function normalizeEmployerName(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    // "B.V." -> "bv", "Moody's" -> "moodys"
    .replace(/[.'\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const words = base.split(/\s+/).filter(Boolean);
  // Strip trailing legal/geo suffixes ("Acme Nederland B.V." -> "acme").
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
}

/** "london stock exchange group" -> "lseg" (stop words ignored). */
export function acronymOf(normalized: string): string {
  const words = normalized.split(" ").filter((w) => w && !STOP_WORDS.has(w));
  if (words.length < 2) return "";
  return words.map((w) => w[0]).join("");
}

function variantsOf(name: string): Set<string> {
  const normalized = normalizeEmployerName(name);
  const variants = new Set<string>();
  if (!normalized) return variants;
  variants.add(normalized);
  variants.add(normalized.replace(/\s+/g, ""));
  const acronym = acronymOf(normalized);
  if (acronym.length >= 2) variants.add(acronym);
  return variants;
}

export interface ExcludedEmployer {
  name: string;
  aliases: string[];
}

/** Returns the exclusion entry that matches `companyName`, or null. */
export function findExcludedEmployer(
  companyName: string,
  excluded: ExcludedEmployer[],
): ExcludedEmployer | null {
  const company = variantsOf(companyName);
  if (company.size === 0) return null;

  for (const entry of excluded) {
    for (const candidate of [entry.name, ...entry.aliases]) {
      const variants = variantsOf(candidate);
      for (const v of variants) {
        if (company.has(v)) return entry;
      }
    }
  }
  return null;
}
