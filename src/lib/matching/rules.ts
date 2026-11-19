import { canonicalWords } from "@/lib/cv/text";
import { classify, computeScore, DEFAULT_WEIGHTS, type DimensionKey, type MatchResult, type PromptFact, type VerifiedDimension } from "@/lib/ai/match";
import type { ActivityId, AssessmentAnswers } from "@/lib/assessment/schema";
import type { Preferences } from "@/lib/preferences/schema";
import { titleLevel } from "@/lib/scanner/relevance";

/**
 * Free, private, deterministic assessment (no AI). Rates the same six
 * dimensions as the Claude matcher from explicit signals in the vacancy text,
 * the candidate's assessment, preferences and thumbs up/down. Every piece of
 * evidence is a literal passage from the vacancy or a confirmed fact; the
 * rules never claim experience on the candidate's behalf.
 */

export const RULES_VERSION = "rules-v2";

/** True for any version of the rules scorer (older rows keep their old version until rescored). */
export const isRulesModel = (model: string) => model.startsWith("rules-");

const DIMENSION_NL: Record<DimensionKey, string> = {
  responsibility_seniority: "verantwoordelijkheid en niveau",
  strategic_content: "strategische inhoud",
  transferable_results: "overdraagbare ervaring",
  contract_location_travel: "contract en locatie",
  sector_international: "sector en internationale fit",
  salary_practical: "salaris en praktische fit",
};

type Lang = string[];

/** Keywords per assessment activity (English + Dutch). */
const ACTIVITY_KEYWORDS: Record<ActivityId, Lang> = {
  set_strategy: ["strategy", "strategic", "strategie", "strategisch"],
  build_teams: ["build a team", "build the team", "team opbouwen", "coach", "coaching", "people leader", "leidinggeven"],
  build_partnerships: ["partnership", "partnerships", "alliance", "alliances", "ecosystem", "allianties", "partners"],
  long_relationships: ["key account", "relationship management", "relatiebeheer", "langdurige relaties", "trusted advisor", "account management"],
  open_markets: ["market entry", "new markets", "nieuwe markten", "expansion", "expansie", "market development", "marktontwikkeling"],
  own_results: ["p and l", "profit and loss", "eindverantwoordelijk", "resultaatverantwoordelijk", "general management"],
  design_gtm: ["go to market", "gtm", "commercial strategy", "commerciele strategie", "sales strategy", "route to market"],
  lead_change: ["transformation", "transformatie", "change management", "verandertraject", "turnaround"],
  negotiate_deals: ["negotiate", "negotiation", "onderhandel", "complex deals", "enterprise deals"],
  cold_prospecting: ["cold calling", "cold call", "koude acquisitie", "prospecting", "lead generation", "hunter", "new business acquisition"],
  daily_operations: ["day to day operations", "dagelijkse operatie", "operationeel", "operational management", "shift planning", "store operations"],
  analysis_reporting: ["reporting", "rapportage", "forecasting", "forecast", "analysis", "analyse"],
  represent_external: ["trade shows", "beurzen", "events", "evenementen", "represent the company", "ambassador"],
  travel_international: ["international travel", "internationaal reizen", "travel", "reizen"],
};

const SENIORITY_PLUS: Lang = [
  "p and l", "profit and loss", "eindverantwoordelijk", "management team", "leadership team", "mt lid", "directieteam",
  "reports to the ceo", "reporting to the ceo", "rapporteert aan de ceo", "rapporteert aan de algemeen directeur",
  "board", "general management", "country leadership",
];
const SENIORITY_MINUS: Lang = ["junior", "trainee", "assistant", "assistent", "werkstudent", "entry level", "starter"];
const STRATEGIC_PLUS: Lang = [
  "partnership", "partnerships", "alliances", "ecosystem", "market development", "marktontwikkeling", "go to market",
  "strategy", "strategie", "transformation", "transformatie", "long term", "lange termijn", "channel", "distributors",
  "distributeurs", "key accounts",
];
const HUNTER_MINUS: Lang = [
  "quota", "quotum", "commission", "commissie", "ote", "100 percent new business", "hunter", "cold calling", "cold call",
  "koude acquisitie", "target driven", "targetgedreven", "prospecting",
];
const OPERATIONAL_MINUS: Lang = ["operationeel", "day to day operations", "shift", "store", "winkel", "filiaal", "warehouse", "magazijn"];
const SMALL_COMPANY: Lang = ["mkb", "klein team", "small team", "kleine organisatie", "familiebedrijf", "start up", "startup", "eenmanszaak"];
/** Title words for functions outside commercial leadership (finance, HR, legal, tech…). */
const NON_COMMERCIAL_TITLE: Lang = [
  "finance", "financial", "financieel", "controller", "cfo", "accounting", "accountant", "tax", "audit", "treasury",
  "hr", "hrbp", "human resources", "people partner", "people director", "talent", "recruitment", "recruiter", "legal", "counsel",
  "lawyer", "jurist", "compliance", "engineering", "engineer", "developer", "software", "data", "it", "security", "product manager",
  "product owner", "designer", "procurement", "purchasing", "inkoop", "supply chain", "logistics", "logistiek", "quality",
  "research", "scientist", "medical", "clinical", "pharmacist",
];
/** Head nouns that make a title commercial even next to such a word ("Head of Sales Engineering"). */
const COMMERCIAL_HEAD: Lang = [
  "sales", "business development", "partnerships", "partnership", "country manager", "general manager", "managing director",
  "chief commercial", "cco", "commercial director", "director commercial", "head of commercial", "revenue", "go to market",
  "account", "wholesale", "growth",
];

/** A non-commercial function in the title without a commercial head noun. */
export function functionMismatch(title: string): string | null {
  const words = canonicalWords(title);
  const off = find(words, NON_COMMERCIAL_TITLE);
  if (off.length === 0 || find(words, COMMERCIAL_HEAD).length > 0) return null;
  return off[0];
}

const INTERNATIONAL_PLUS: Lang = ["international", "internationaal", "global", "globaal", "emea", "europe", "europa", "benelux", "multinational"];

const STOPWORDS = new Set(
  (
    "about above after again against their there these those which while where would could should other others being " +
    "within without between through during before under years jaren ervaring experience with voor naar onze jouw jullie " +
    "wordt worden hebben heeft binnen tussen zoals waarbij hierbij daarnaast samen samenwerking company bedrijf organisatie " +
    "organisation organization manager director management functie vacature werken working looking role rollen"
  ).split(" "),
);

function find(words: string, phrases: Lang): string[] {
  return phrases.filter((p) => words.includes(` ${canonicalWords(p).trim()} `));
}

/** A literal passage (≤ 160 chars) from `text` around the first occurrence of `phrase`. */
export function passage(text: string, phrase: string): string | null {
  const pattern = canonicalWords(phrase).trim().split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\p{L}\\p{N}]+");
  const match = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "iu").exec(text);
  if (!match) return null;
  // Sentence around the match, cut at word boundaries.
  const before = text.slice(0, match.index);
  const start = Math.max(before.lastIndexOf(". ") + 2, before.lastIndexOf("\n") + 1, match.index - 70, 0);
  const afterIdx = text.slice(match.index).search(/[.\n]/);
  const end = Math.min(afterIdx === -1 ? text.length : match.index + afterIdx, match.index + match[0].length + 90);
  let snippet = text.slice(start, end);
  // Only cut a word that was split by the window, never a whole word.
  if (start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1] ?? "")) snippet = snippet.replace(/^\S*\s/, "");
  if (end < text.length && /[\p{L}\p{N}]/u.test(text[end] ?? "")) snippet = snippet.replace(/\s\S*$/, "");
  snippet = snippet.replace(/\s+/g, " ").trim();
  return snippet.length >= 8 ? snippet : null;
}

const clamp = (n: number, min = 0, max = 5) => Math.max(min, Math.min(max, Math.round(n)));

function tokens(text: string): Set<string> {
  return new Set(canonicalWords(text).trim().split(" ").filter((w) => w.length >= 5 && !STOPWORDS.has(w) && !/^\d+$/.test(w)));
}

export interface RulesJob {
  title: string;
  company: string;
  location: string | null;
  countryCode: string | null;
  workplaceType: string;
  description: string | null;
  sector: string | null;
  signals: { companyCar: string; dutchContract: string; remoteHybrid: string; multinational: string };
  salaryAnnualEur: number | null;
  gate: "pass" | "fail" | "review_required" | null;
  limitedEvidence: boolean;
}

export interface RulesFeedback {
  label: "good" | "bad";
  reasons: string[];
  title: string;
}

export interface RulesInput {
  job: RulesJob;
  facts: PromptFact[];
  prefs: Preferences;
  assessment: AssessmentAnswers;
  feedback: RulesFeedback[];
}

export interface RulesResult extends MatchResult {
  feedbackAdjustment: number;
}

export function scoreWithRules({ job, facts, prefs, assessment, feedback }: RulesInput): RulesResult {
  const text = [job.title, job.company, job.location ?? "", job.description ?? ""].join("\n");
  const words = canonicalWords(text);
  const titleWords = canonicalWords(job.title);
  const quotes = (phrases: string[]) => [...new Set(phrases.map((p) => passage(text, p)).filter((q): q is string => Boolean(q)))].slice(0, 3);
  const gaps: string[] = [];
  const unknowns: string[] = [];
  const notes: Partial<Record<DimensionKey, string>> = {};
  const evidence: Partial<Record<DimensionKey, { quotes: string[]; facts: { id: string; statement: string }[] }>> = {};

  // Feedback calibration: reasons the candidate gave on rejected jobs weigh heavier.
  const badReasons = feedback.filter((f) => f.label === "bad").flatMap((f) => f.reasons);
  const weight = (reason: string) => Math.min(2, 1 + 0.5 * badReasons.filter((r) => r === reason).length);

  // Activities that give or cost the candidate energy, found in the vacancy.
  const energyHits: string[] = [];
  const drainHits: string[] = [];
  for (const [id, value] of Object.entries(assessment.activities) as [ActivityId, string][]) {
    const hits = find(words, ACTIVITY_KEYWORDS[id]);
    if (hits.length === 0) continue;
    if (value === "energy") energyHits.push(hits[0]);
    if (value === "drain") drainHits.push(hits[0]);
  }

  // 1. Responsibility & seniority
  const level = titleLevel(job.title);
  let seniority = level === "executive" ? 5 : level === "director" ? 4 : level === "manager" ? 2 : 1;
  const seniorPlus = find(words, SENIORITY_PLUS);
  const seniorMinus = find(titleWords, SENIORITY_MINUS);
  const small = find(words, SMALL_COMPANY);
  if (seniorPlus.length) seniority += 1;
  if (seniorMinus.length) seniority -= 2;
  if (small.length) seniority -= weight("small_company");
  if (assessment.resultsResponsibility === "must" && !find(words, ACTIVITY_KEYWORDS.own_results).length) {
    unknowns.push("Eindverantwoordelijkheid (P&L) wordt niet genoemd; jij wilt dat graag.");
  }
  const offFunction = functionMismatch(job.title);
  if (offFunction) {
    seniority = Math.min(seniority, 2);
    gaps.push(`De functie lijkt niet commercieel (titel noemt "${offFunction}").`);
  }
  notes.responsibility_seniority = `${offFunction ? `Andere functie dan commercieel leiderschap (${offFunction}). ` : ""}Titelniveau: ${level ?? "onduidelijk"}.${seniorPlus.length ? " Vacature noemt brede verantwoordelijkheid." : ""}${small.length ? " Signalen van een kleine organisatie." : ""}`;
  evidence.responsibility_seniority = { quotes: quotes([...seniorPlus, ...small]), facts: [] };

  // 2. Strategic / management content
  const strategic = find(words, STRATEGIC_PLUS);
  const hunter = find(words, HUNTER_MINUS);
  const operational = find(words, OPERATIONAL_MINUS);
  let content = 3 + Math.min(2, strategic.length * 0.5) + Math.min(1.5, energyHits.length * 0.5);
  content -= Math.min(3, hunter.length * weight("hunter_quota"));
  content -= Math.min(2, operational.length * 0.5 * weight("too_operational"));
  content -= Math.min(2, drainHits.length * 0.75);
  if (offFunction) content = Math.min(content, 2);
  const hunterNegative = prefs.negativeRoleSignals.length > 0 || assessment.quotaPreference === "no_personal_quota";
  if (hunter.length && hunterNegative) gaps.push("De vacature bevat signalen van een hunter- of quotumrol.");
  if (drainHits.length) gaps.push(`Bevat werk dat jou energie kost: ${drainHits.join(", ")}.`);
  notes.strategic_content = [
    strategic.length ? `Strategische signalen: ${strategic.slice(0, 4).join(", ")}.` : "Weinig strategische signalen in de tekst.",
    energyHits.length ? `Bevat werk dat jou energie geeft: ${energyHits.join(", ")}.` : "",
    hunter.length ? `Hunter/quotum-signalen: ${hunter.slice(0, 3).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  evidence.strategic_content = { quotes: quotes([...hunter, ...strategic, ...energyHits]), facts: [] };

  // 3. Transferable experience: confirmed facts that share specific words with the vacancy.
  const jobTokens = tokens(text);
  const related = facts
    .map((f) => ({ f, shared: [...tokens(f.statement)].filter((t) => jobTokens.has(t)) }))
    .filter((x) => x.shared.length >= 2)
    .sort((a, b) => b.shared.length - a.shared.length);
  let transferable = related.length === 0 ? 1 : related.length === 1 ? 2 : related.length <= 3 ? 3 : related.length <= 5 ? 4 : 5;
  // Shared words with a finance/HR/tech vacancy say little about fit.
  if (offFunction) transferable = Math.min(transferable, 3);
  notes.transferable_results = related.length
    ? `${related.length} bevestigde feiten raken aan wat de vacature vraagt (op basis van gedeelde termen, niet inhoudelijk beoordeeld).`
    : "Geen bevestigde feiten met duidelijke overlap gevonden.";
  evidence.transferable_results = { quotes: [], facts: related.slice(0, 5).map(({ f }) => ({ id: f.id, statement: f.statement })) };

  // 4. Contract, location & travel
  const country = job.countryCode;
  let contract = country === "nl" ? 4 : country ? 2 : 3;
  if (job.signals.dutchContract === "yes") contract += 1;
  if (job.signals.dutchContract === "no") contract -= 2;
  if (job.signals.dutchContract === "unknown") unknowns.push("Nederlands arbeidscontract: onbekend.");
  if (prefs.constraints.remoteHybrid !== "ignore") {
    if (job.signals.remoteHybrid === "yes") contract += 1;
    else if (job.signals.remoteHybrid === "unknown") unknowns.push("Hybride/remote werken: onbekend.");
  }
  const travelHeavy = /\b(50|60|70|75|80)\s?%\s?(travel|reizen)|\bextensive travel\b|\bveel reizen\b/i.test(text);
  if (travelHeavy && (assessment.travelMax === "travel_none" || assessment.travelMax === "travel_10" || assessment.travelMax === "travel_25")) {
    contract -= 1;
    gaps.push("Veel reizen gevraagd, meer dan je opgaf.");
  }
  notes.contract_location_travel = `Standplaats: ${job.location ?? "onbekend"}. Contract: ${job.signals.dutchContract === "yes" ? "Nederlands" : job.signals.dutchContract === "no" ? "niet Nederlands" : "onbekend"}.`;
  evidence.contract_location_travel = { quotes: [], facts: [] };

  // 5. Sector & international fit
  // The company's own sector is reliable; a sector word somewhere in the vacancy
  // text ("food delivery", "FMCG clients") is not, so it counts less.
  const companySector = job.sector ? canonicalWords(`${job.sector} ${job.title}`) : null;
  const occurrences = (phrase: string) => words.split(` ${phrase} `).length - 1;
  const sectorHit = prefs.sectors.find((s) => {
    const name = canonicalWords(s.name).trim();
    if (!name) return false;
    if (companySector) return companySector.includes(` ${name} `);
    return titleWords.includes(` ${name} `) || occurrences(name) >= 2;
  });
  const fromText = Boolean(sectorHit && !companySector);
  let sector = sectorHit ? { boost: fromText ? 4 : 5, neutral: 3, lower: 2, exclude: 0 }[sectorHit.priority] : 3;
  const international = find(words, INTERNATIONAL_PLUS);
  if (job.signals.multinational === "yes" || international.length >= 2) sector += 1;
  if (small.length) sector -= 1;
  const avoided = (Object.entries(assessment.employerTypes) as [string, string][]).filter(([, v]) => v === "avoid").map(([k]) => k);
  if (avoided.includes("startup") && find(words, ["start up", "startup"]).length) sector -= 1;
  if (avoided.includes("family_owned") && find(words, ["familiebedrijf", "family owned", "family business"]).length) sector -= 1;
  if (sectorHit?.priority === "lower") gaps.push(`Sector met lagere prioriteit voor jou: ${sectorHit.name}.`);
  notes.sector_international = `${sectorHit ? `Sector: ${sectorHit.name} (${sectorHit.priority}${fromText ? ", afgeleid uit de vacaturetekst" : ""}).` : "Sector niet herkend uit je lijst."}${international.length ? " Internationale context." : ""}`;
  evidence.sector_international = { quotes: quotes(international.slice(0, 2)), facts: [] };

  // 6. Salary & practical fit
  let practical = 3;
  const minimum = prefs.salary.minimumAnnualBase;
  if (job.salaryAnnualEur && minimum) practical = job.salaryAnnualEur >= minimum ? 5 : 1;
  else unknowns.push("Salaris: niet gepubliceerd.");
  if (prefs.constraints.companyCar !== "ignore") {
    if (job.signals.companyCar === "yes") practical += 1;
    else if (job.signals.companyCar === "no") practical -= 1;
    else unknowns.push("Leaseauto: onbekend.");
  }
  notes.salary_practical = job.salaryAnnualEur ? `Gepubliceerd salaris: EUR ${job.salaryAnnualEur} per jaar.` : "Geen salaris gepubliceerd.";
  evidence.salary_practical = { quotes: [], facts: [] };

  const ratings: Record<DimensionKey, number> = {
    responsibility_seniority: clamp(seniority),
    strategic_content: clamp(content),
    transferable_results: clamp(transferable),
    contract_location_travel: clamp(contract),
    sector_international: clamp(sector),
    salary_practical: clamp(practical),
  };
  const dimensions: VerifiedDimension[] = (Object.keys(DEFAULT_WEIGHTS) as DimensionKey[]).map((key) => ({
    key,
    weight: DEFAULT_WEIGHTS[key],
    rating: ratings[key],
    jobQuotes: evidence[key]?.quotes ?? [],
    facts: evidence[key]?.facts ?? [],
    note: notes[key] ?? "",
  }));

  // Thumbs up/down: title words of earlier rated jobs nudge the score (max ±8).
  const feedbackAdjustment = titleFeedbackAdjustment(job.title, feedback);
  const score = Math.max(0, Math.min(100, computeScore(dimensions) + feedbackAdjustment));
  const strongest = [...dimensions].sort((a, b) => b.rating - a.rating)[0];
  const weakest = [...dimensions].sort((a, b) => a.rating - b.rating)[0];

  return {
    score,
    classification: classify(score, { gate: job.gate, limitedEvidence: job.limitedEvidence, unknowns: unknowns.length }),
    limitedEvidence: job.limitedEvidence,
    dimensions,
    fitSummary: `Automatische beoordeling op signalen in de vacaturetekst (zonder AI). Sterkst op ${DIMENSION_NL[strongest.key]}, zwakst op ${DIMENSION_NL[weakest.key]}.`,
    confirmedFit: [],
    transferable: [],
    gaps: [...new Set(gaps)].slice(0, 6),
    unknowns: [...new Set(unknowns)].slice(0, 6),
    recruiterDoubts: [],
    pitchAngle: null,
    dropped: { quotes: 0, factRefs: 0, claims: 0, texts: 0, cappedRatings: 0 },
    feedbackAdjustment,
  };
}

export function titleFeedbackAdjustment(title: string, feedback: RulesFeedback[]): number {
  if (feedback.length === 0) return 0;
  const weights = new Map<string, number>();
  for (const f of feedback) {
    for (const t of tokens(f.title)) weights.set(t, (weights.get(t) ?? 0) + (f.label === "good" ? 1 : -1));
  }
  const own = [...tokens(title)];
  if (own.length === 0) return 0;
  const sum = own.reduce((acc, t) => acc + (weights.get(t) ?? 0), 0);
  return Math.max(-8, Math.min(8, Math.round((sum / own.length) * 4)));
}
