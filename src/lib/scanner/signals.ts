import type { TriState } from "@/lib/matching/gates";
import { countryFromLocation } from "./geo";
import { excerptAround } from "./text";
import type { RawPosting, Salary } from "./types";

/**
 * Deterministic signals with evidence. Rule: only an explicit statement or a
 * structured field produces "yes"/"no"; everything else stays "unknown".
 */

export interface Signal {
  value: TriState;
  source: "structured" | "text" | "company" | "location" | "none";
  evidence?: string;
}

export interface JobSignalSet {
  companyCar: Signal;
  dutchContract: Signal;
  remoteHybrid: Signal;
  multinational: Signal;
  salary: (Salary & { annualEur: number | null }) | null;
}

function findText(text: string, patterns: RegExp[]): { evidence: string } | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return { evidence: excerptAround(text, match.index, match[0].length) };
  }
  return null;
}

const CAR_YES = [
  /\blease\s?-?\s?(auto|car)\b/i,
  /\bleaseauto\b/i,
  /\bcompany car\b/i,
  /\bauto van de zaak\b/i,
  /\bbedrijfsauto\b/i,
  /\bcar allowance\b/i,
  /\b(auto|car) (of )?(je|your) (eigen )?keuze\b/i,
];
const CAR_NO = [/\bgeen lease\s?-?auto\b/i, /\bno company car\b/i, /\bwithout (a )?company car\b/i];

const NL_CONTRACT_YES = [
  /\bnederlands(e)? (arbeids)?(contract|arbeidsovereenkomst)\b/i,
  /\bdutch (employment |labou?r )?contract\b/i,
  /\bdutch payroll\b/i,
  /\bpayroll in the netherlands\b/i,
  /\bemployed (by|through) [\w .&-]{2,60} (b\.?v\.?|netherlands)\b/i,
  /\bin dienst (bij|van) [\w .&-]{2,60} (b\.?v\.?|nederland)\b/i,
];

const HYBRID_TEXT = [/\bhybri(d|de)\b/i, /\bthuiswerk/i, /\bwork(ing)? from home\b/i, /\bremote[- ]first\b/i, /\bflexibel werken\b/i];

function salaryFromText(text: string): Salary | null {
  const range =
    /€\s?(\d{2,3})[.,]?(\d{3})\s?(?:-|–|tot|to)\s?€?\s?(\d{2,3})[.,]?(\d{3})/i.exec(text) ??
    /€\s?(\d{2,3})[.,]?(\d{3})(?![\d.,])/i.exec(text);
  if (!range) return null;
  const min = Number(`${range[1]}${range[2]}`);
  const max = range[3] ? Number(`${range[3]}${range[4]}`) : null;
  const around = text.slice(Math.max(0, range.index - 60), range.index + range[0].length + 60);
  const interval = /per (jaar|year|annum)|jaarsalaris|annual|p\.a\.|yearly|bruto per jaar/i.test(around)
    ? "year"
    : /per (maand|month)|maandsalaris|monthly/i.test(around)
      ? "month"
      : "unknown";
  return { min, max, currency: "EUR", interval, source: "text", evidence: excerptAround(text, range.index, range[0].length) };
}

export function extractSignals(posting: RawPosting, company: { isMultinational: TriState } | null): JobSignalSet {
  const text = posting.descriptionText ?? "";

  const carNo = findText(text, CAR_NO);
  const carYes = carNo ? null : findText(text, CAR_YES);
  const companyCar: Signal = carNo
    ? { value: "no", source: "text", evidence: carNo.evidence }
    : carYes
      ? { value: "yes", source: "text", evidence: carYes.evidence }
      : { value: "unknown", source: "none" };

  const country = posting.countryCode ?? countryFromLocation(posting.locationText);
  const contractYes = findText(text, NL_CONTRACT_YES);
  let dutchContract: Signal;
  if (contractYes) {
    dutchContract = { value: "yes", source: "text", evidence: contractYes.evidence };
  } else if (country && country !== "nl" && posting.workplaceType !== "remote") {
    // Based in another country (on-site or hybrid): a Dutch contract is not plausible without an explicit statement.
    dutchContract = { value: "no", source: "location", evidence: `Standplaats ${posting.locationText ?? country.toUpperCase()}` };
  } else {
    // Including NL-based roles: the contract entity is not stated, so it stays unknown.
    dutchContract = { value: "unknown", source: "none" };
  }

  let remoteHybrid: Signal;
  if (posting.workplaceType === "hybrid" || posting.workplaceType === "remote") {
    remoteHybrid = { value: "yes", source: "structured", evidence: posting.workplaceType };
  } else {
    const hybridText = findText(text, HYBRID_TEXT);
    remoteHybrid = hybridText
      ? { value: "yes", source: "text", evidence: hybridText.evidence }
      : posting.workplaceType === "onsite"
        ? { value: "no", source: "structured", evidence: "on-site" }
        : { value: "unknown", source: "none" };
  }

  const multinational: Signal = company
    ? { value: company.isMultinational, source: company.isMultinational === "unknown" ? "none" : "company" }
    : { value: "unknown", source: "none" };

  const rawSalary = posting.salary ?? salaryFromText(text);
  const salary = rawSalary
    ? {
        ...rawSalary,
        // Only an explicit yearly EUR amount feeds the salary gate (the top of the range).
        annualEur:
          rawSalary.currency === "EUR" && rawSalary.interval === "year" ? (rawSalary.max ?? rawSalary.min) : null,
      }
    : null;

  return { companyCar, dutchContract, remoteHybrid, multinational, salary };
}
