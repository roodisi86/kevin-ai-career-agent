import { canonicalWords } from "@/lib/cv/text";

/** Lowercase place names → ISO country code. Deliberately small and explicit. */
const PLACES: Record<string, string> = {
  netherlands: "nl", nederland: "nl", "the netherlands": "nl", holland: "nl", amsterdam: "nl", rotterdam: "nl",
  utrecht: "nl", "den haag": "nl", "the hague": "nl", "s gravenhage": "nl", eindhoven: "nl", hoofddorp: "nl",
  schiphol: "nl", amstelveen: "nl", nieuwegein: "nl", rijswijk: "nl", vianen: "nl", breda: "nl", arnhem: "nl",
  zwolle: "nl", groningen: "nl", leiden: "nl", haarlem: "nl", "s hertogenbosch": "nl", "den bosch": "nl",
  tilburg: "nl", nijmegen: "nl", apeldoorn: "nl", venlo: "nl", zaandam: "nl", almere: "nl", delft: "nl",
  diemen: "nl", hilversum: "nl", amersfoort: "nl", maastricht: "nl", heerlen: "nl", enschede: "nl", zeist: "nl",
  belgium: "be", belgie: "be", belgique: "be", brussels: "be", brussel: "be", bruxelles: "be", antwerp: "be",
  antwerpen: "be", ghent: "be", gent: "be", mechelen: "be", leuven: "be", liege: "be", luik: "be", zaventem: "be",
  luxembourg: "lu", luxemburg: "lu",
  germany: "de", deutschland: "de", berlin: "de", munich: "de", munchen: "de", hamburg: "de", dusseldorf: "de",
  frankfurt: "de", cologne: "de", koln: "de", stuttgart: "de",
  spain: "es", espana: "es", madrid: "es", barcelona: "es", valencia: "es", malaga: "es", sevilla: "es",
  "united kingdom": "gb", uk: "gb", england: "gb", london: "gb", manchester: "gb",
  france: "fr", paris: "fr", lyon: "fr",
  ireland: "ie", dublin: "ie",
  italy: "it", milan: "it", milano: "it", rome: "it",
  "united states": "us", usa: "us", "new york": "us", "san francisco": "us",
  switzerland: "ch", zurich: "ch", geneva: "ch",
  denmark: "dk", copenhagen: "dk", sweden: "se", stockholm: "se", norway: "no", oslo: "no",
  poland: "pl", warsaw: "pl", portugal: "pt", lisbon: "pt",
};

const REGION_WORDS = /\b(europe|european|emea|eu|benelux|worldwide|anywhere|global)\b/i;

/** Best-effort country from free-text location; null when unknown or multi-country. */
export function countryFromLocation(location: string | null | undefined): string | null {
  if (!location) return null;
  const words = canonicalWords(location.replace(/'/g, " "));
  const found = new Set<string>();
  for (const [place, code] of Object.entries(PLACES)) {
    if (words.includes(` ${place} `)) found.add(code);
  }
  return found.size === 1 ? [...found][0] : null;
}

export function mentionsWiderRegion(location: string | null | undefined): boolean {
  return Boolean(location && REGION_WORDS.test(location));
}

export function normalizeCountryCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(v)) return v === "uk" ? "gb" : v;
  if (v === "netherlands" || v === "the netherlands") return "nl";
  return countryFromLocation(v);
}
