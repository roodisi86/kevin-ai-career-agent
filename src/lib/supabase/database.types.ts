/**
 * Database types for the Supabase client. Kept in sync with
 * supabase/migrations (compare with `generate_typescript_types` output when
 * the schema changes). Compact form: Insert = required columns + optional rest.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** Casts a plain serialisable object to the Json type for jsonb columns. */
export const asJson = (value: unknown): Json => value as Json;

type TableDef<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  is_demo: boolean;
  created_at: string;
};

export type MembershipRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  role: string;
  created_at: string;
};

export type CandidateProfileRow = {
  id: string;
  tenant_id: string;
  owner_user_id: string;
  headline: string | null;
  summary: string | null;
  desired_seniority: string | null;
  locale: string;
  profile_version: number;
  suggested_headline: string | null;
  suggested_summary: string | null;
  suggestion_document_id: string | null;
  suggestion_created_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CandidateDocumentRow = {
  id: string;
  tenant_id: string;
  candidate_id: string;
  storage_path: string;
  original_filename: string;
  file_type: "pdf" | "docx";
  document_kind: "cv" | "linkedin_profile" | "assessment";
  size_bytes: number;
  checksum: string;
  processing_status: "uploaded" | "extracted" | "failed";
  extracted_text: string | null;
  extraction_error: string | null;
  ai_status: "not_requested" | "not_configured" | "completed" | "failed";
  created_at: string;
  updated_at: string;
};

export type FactCategory =
  | "role"
  | "responsibility"
  | "achievement"
  | "education"
  | "certification"
  | "skill"
  | "language"
  | "sector"
  | "work_style"
  | "other";

export type FactStatus = "suggested" | "confirmed" | "rejected";
export type FactOrigin = "ai_suggestion" | "user";

export type CandidateFactRow = {
  id: string;
  tenant_id: string;
  candidate_id: string;
  category: FactCategory;
  statement: string;
  status: FactStatus;
  origin: FactOrigin;
  is_sensitive: boolean;
  evidence_excerpt: string | null;
  source_document_id: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CandidatePreferencesRow = {
  id: string;
  tenant_id: string;
  candidate_id: string;
  schema_version: number;
  preferences_json: Json;
  created_at: string;
  updated_at: string;
};

export type AuditEventRow = {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  occurred_at: string;
  safe_metadata_json: Json;
};

export type ConsentRecordRow = {
  id: string;
  tenant_id: string;
  candidate_id: string;
  scope: "cv_processing" | "ai_analysis" | "outreach_drafting";
  status: "granted" | "revoked";
  granted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type CompanyTargetRow = {
  id: string;
  tenant_id: string;
  company_name: string;
  company_key: string;
  sector: string | null;
  website: string | null;
  is_multinational: "yes" | "no" | "unknown";
  origin: "user" | "suggested_list";
  notes: string | null;
  board_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JobSourceProvider = "greenhouse" | "smartrecruiters" | "lever" | "lever_eu" | "ashby" | "jobicy" | "adzuna";

export type JobSourceRow = {
  id: string;
  tenant_id: string;
  company_target_id: string | null;
  provider: JobSourceProvider;
  identifier: string;
  display_name: string | null;
  verification_status: "unverified" | "verified" | "failed";
  verification_detail: string | null;
  verified_at: string | null;
  approved: boolean;
  last_polled_at: string | null;
  last_poll_status: "ok" | "partial" | "error" | null;
  last_poll_error: string | null;
  last_poll_counts: Json;
  created_at: string;
  updated_at: string;
};

export type ScanRow = {
  id: string;
  tenant_id: string;
  trigger: "manual" | "scheduled";
  status: "running" | "completed" | "partial" | "failed";
  started_at: string;
  finished_at: string | null;
  created_by: string | null;
  counts_json: Json;
  errors_json: Json;
};

export type JobRow = {
  id: string;
  tenant_id: string;
  source_id: string | null;
  provider: JobSourceProvider | "manual";
  external_job_id: string;
  company_name: string;
  company_target_id: string | null;
  title: string;
  canonical_url: string;
  description_text: string | null;
  description_is_truncated: boolean;
  location_text: string | null;
  country_code: string | null;
  workplace_type: "onsite" | "hybrid" | "remote" | "unknown";
  employment_type: string | null;
  salary_json: Json;
  signals_json: Json;
  track_hits: string[];
  gate_status: "pass" | "fail" | "review_required" | null;
  gate_json: Json;
  status: "open" | "uncertain" | "closed";
  status_reason: string | null;
  missed_polls: number;
  published_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  status_checked_at: string;
  raw_hash: string;
  dedupe_key: string;
  duplicate_of: string | null;
  user_state: "new" | "interesting" | "later" | "not_relevant";
  filtered_out_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type CandidateAssessmentRow = {
  id: string;
  tenant_id: string;
  candidate_id: string;
  schema_version: number;
  answers_json: Json;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MatchClassification = "top_match" | "stretch" | "research_needed" | "reject";

export type JobMatchRow = {
  id: string;
  tenant_id: string;
  job_id: string;
  score: number;
  classification: MatchClassification;
  hard_gate_status: "pass" | "fail" | "review_required" | null;
  limited_evidence: boolean;
  result_json: Json;
  input_hash: string;
  profile_version: number;
  model: string;
  prompt_version: string;
  scored_at: string;
  created_at: string;
  updated_at: string;
};

export type MatchFeedbackRow = {
  id: string;
  tenant_id: string;
  job_id: string;
  label: "good" | "bad";
  reasons: string[];
  note: string | null;
  match_score: number | null;
  created_at: string;
  updated_at: string;
};

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.18" };
  public: {
    Tables: {
      tenants: TableDef<TenantRow, "slug" | "name">;
      memberships: TableDef<MembershipRow, "tenant_id" | "user_id">;
      candidate_profiles: TableDef<CandidateProfileRow, "tenant_id" | "owner_user_id">;
      candidate_documents: TableDef<
        CandidateDocumentRow,
        "tenant_id" | "candidate_id" | "storage_path" | "original_filename" | "file_type" | "size_bytes" | "checksum"
      >;
      candidate_facts: TableDef<CandidateFactRow, "tenant_id" | "candidate_id" | "category" | "statement" | "origin">;
      candidate_preferences: TableDef<CandidatePreferencesRow, "tenant_id" | "candidate_id">;
      audit_events: TableDef<AuditEventRow, "tenant_id" | "action" | "resource_type">;
      consent_records: TableDef<ConsentRecordRow, "tenant_id" | "candidate_id" | "scope" | "status">;
      company_targets: TableDef<CompanyTargetRow, "tenant_id" | "company_name" | "company_key">;
      job_sources: TableDef<JobSourceRow, "tenant_id" | "provider" | "identifier">;
      scans: TableDef<ScanRow, "tenant_id">;
      jobs: TableDef<
        JobRow,
        "tenant_id" | "provider" | "external_job_id" | "company_name" | "title" | "canonical_url" | "raw_hash" | "dedupe_key"
      >;
      candidate_assessments: TableDef<CandidateAssessmentRow, "tenant_id" | "candidate_id">;
      job_matches: TableDef<
        JobMatchRow,
        "tenant_id" | "job_id" | "score" | "classification" | "result_json" | "input_hash" | "profile_version" | "model" | "prompt_version"
      >;
      match_feedback: TableDef<MatchFeedbackRow, "tenant_id" | "job_id" | "label">;
    };
    Views: { [_ in never]: never };
    Functions: {
      bootstrap_tenant: { Args: never; Returns: string };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
