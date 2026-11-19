import type { CandidateFactRow, FactCategory } from "@/lib/supabase/database.types";

/** Categories matching relies on; a category without confirmed facts is "missing". */
export const KEY_CATEGORIES: FactCategory[] = [
  "role",
  "responsibility",
  "achievement",
  "education",
  "language",
  "sector",
];

export function missingCategories(facts: Pick<CandidateFactRow, "category" | "status">[]): FactCategory[] {
  const confirmed = new Set(facts.filter((f) => f.status === "confirmed").map((f) => f.category));
  return KEY_CATEGORIES.filter((c) => !confirmed.has(c));
}

export function countByStatus(facts: Pick<CandidateFactRow, "status">[]) {
  return {
    confirmed: facts.filter((f) => f.status === "confirmed").length,
    suggested: facts.filter((f) => f.status === "suggested").length,
    rejected: facts.filter((f) => f.status === "rejected").length,
  };
}
