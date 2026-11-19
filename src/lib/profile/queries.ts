import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AppContext } from "@/lib/dal";
import type {
  CandidateDocumentRow,
  CandidateFactRow,
  CandidateProfileRow,
  CandidatePreferencesRow,
} from "@/lib/supabase/database.types";

export interface ProfileData {
  profile: CandidateProfileRow;
  documents: CandidateDocumentRow[];
  facts: CandidateFactRow[];
  preferences: CandidatePreferencesRow | null;
}

/** Loads everything for the profile pages. RLS scopes every query to the tenant. */
export async function loadProfileData(ctx: AppContext): Promise<ProfileData> {
  const supabase = await createSupabaseServerClient();
  const [profile, documents, facts, preferences] = await Promise.all([
    supabase.from("candidate_profiles").select("*").eq("id", ctx.candidateId).single(),
    supabase
      .from("candidate_documents")
      .select("*")
      .eq("candidate_id", ctx.candidateId)
      .order("created_at", { ascending: false }),
    supabase
      .from("candidate_facts")
      .select("*")
      .eq("candidate_id", ctx.candidateId)
      .order("created_at", { ascending: true }),
    supabase.from("candidate_preferences").select("*").eq("candidate_id", ctx.candidateId).maybeSingle(),
  ]);

  if (profile.error || documents.error || facts.error || preferences.error) {
    throw new Error("Could not load profile data");
  }

  return {
    profile: profile.data,
    documents: documents.data,
    facts: facts.data,
    preferences: preferences.data,
  };
}
