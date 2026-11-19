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
  watch_signals: boolean;
  signals_checked_at: string | null;
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
  suggested_answers_json: Json | null;
  suggestion_source: "claude" | "rules" | null;
  suggestion_created_at: string | null;
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

export type AiMatchRequestRow = {
  id: string;
  tenant_id: string;
  job_id: string;
  input_hash: string;
  priority: number;
  prompt_text: string;
  status: "pending" | "answered" | "processed" | "rejected" | "stale";
  output_json: Json | null;
  error: string | null;
  answered_at: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OutreachState = "draft" | "reviewed" | "approved" | "sent" | "replied" | "no_reply" | "closed";

export type OutreachRequestRow = {
  id: string;
  tenant_id: string;
  job_id: string;
  prompt_text: string;
  fact_refs_json: Json;
  status: "pending" | "answered" | "processed" | "rejected";
  output_json: Json | null;
  brief_json: Json | null;
  error: string | null;
  requested_by: string | null;
  answered_at: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactRow = {
  id: string;
  tenant_id: string;
  job_id: string | null;
  name: string;
  role: string | null;
  organisation: string | null;
  source_url: string | null;
  source_type: "company_site" | "press_release" | "news" | "registry" | "other" | "user";
  email: string | null;
  verification_status: "unverified" | "source_checked" | "source_mismatch" | "user_confirmed";
  lawful_basis_note: string | null;
  origin: "ai_research" | "user";
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OutreachDraftRow = {
  id: string;
  tenant_id: string;
  candidate_id: string;
  job_id: string | null;
  contact_id: string | null;
  kind: "recruiter" | "hiring_manager" | "follow_up";
  language: "nl" | "en" | "fr" | "es" | "de";
  subject: string;
  body: string;
  state: OutreachState;
  version: number;
  approved_hash: string | null;
  approved_version: number | null;
  approved_at: string | null;
  reviewer_user_id: string | null;
  sent_at: string | null;
  evidence_json: Json;
  warnings: string[];
  origin: "ai_research" | "user";
  created_at: string;
  updated_at: string;
};

export type OutreachEventRow = {
  id: string;
  tenant_id: string;
  outreach_draft_id: string;
  event_type: string;
  actor_id: string | null;
  metadata_json: Json;
  event_time: string;
};

export type SignalRequestRow = {
  id: string;
  tenant_id: string;
  batch_key: string;
  prompt_text: string;
  target_refs_json: Json;
  status: "pending" | "answered" | "processed" | "rejected";
  output_json: Json | null;
  result_counts: Json;
  error: string | null;
  answered_at: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SignalType =
  | "leadership_change"
  | "expansion"
  | "market_entry"
  | "acquisition"
  | "funding"
  | "restructuring"
  | "partnership"
  | "hiring"
  | "other";

export type CompanySignalRow = {
  id: string;
  tenant_id: string;
  company_target_id: string;
  request_id: string | null;
  signal_type: SignalType;
  headline: string;
  summary: string | null;
  relevance: string | null;
  suggested_action: string | null;
  source_url: string;
  source_title: string | null;
  published_on: string | null;
  verification_status: "unverified" | "source_checked" | "source_mismatch";
  user_state: "new" | "useful" | "dismissed";
  dedupe_key: string;
  created_at: string;
  updated_at: string;
};

export type ApplicationStage =
  | "prospect"
  | "applied"
  | "screening"
  | "interviewing"
  | "final_round"
  | "offer"
  | "accepted"
  | "rejected"
  | "withdrawn"
  | "on_hold";

export type ApplicationChannel = "direct" | "recruiter" | "referral" | "reverse_recruiting" | "agency" | "other" | "unknown";

export type ApplicationRow = {
  id: string;
  tenant_id: string;
  candidate_id: string;
  job_id: string | null;
  company_target_id: string | null;
  signal_id: string | null;
  company_name: string;
  role_title: string;
  stage: ApplicationStage;
  channel: ApplicationChannel;
  contact_name: string | null;
  job_url: string | null;
  applied_on: string | null;
  next_action: string | null;
  next_action_due: string | null;
  notes: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ApplicationEventRow = {
  id: string;
  tenant_id: string;
  application_id: string;
  event_type: string;
  actor_id: string | null;
  metadata_json: Json;
  event_time: string;
};

export type DailyDigestRow = {
  id: string;
  tenant_id: string;
  digest_date: string;
  content_json: Json;
  push_text: string;
  generated_by: "scheduled" | "manual";
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
      ai_match_requests: TableDef<AiMatchRequestRow, "tenant_id" | "job_id" | "input_hash" | "prompt_text">;
      outreach_requests: TableDef<OutreachRequestRow, "tenant_id" | "job_id" | "prompt_text">;
      contacts: TableDef<ContactRow, "tenant_id" | "name" | "source_type" | "origin">;
      outreach_drafts: TableDef<OutreachDraftRow, "tenant_id" | "candidate_id" | "kind" | "language" | "body">;
      outreach_events: TableDef<OutreachEventRow, "tenant_id" | "outreach_draft_id" | "event_type">;
      signal_requests: TableDef<SignalRequestRow, "tenant_id" | "batch_key" | "prompt_text">;
      company_signals: TableDef<
        CompanySignalRow,
        "tenant_id" | "company_target_id" | "signal_type" | "headline" | "source_url" | "dedupe_key"
      >;
      applications: TableDef<ApplicationRow, "tenant_id" | "candidate_id" | "company_name" | "role_title">;
      application_events: TableDef<ApplicationEventRow, "tenant_id" | "application_id" | "event_type">;
      daily_digests: TableDef<DailyDigestRow, "tenant_id" | "digest_date" | "push_text">;
    };
    Views: { [_ in never]: never };
    Functions: {
      bootstrap_tenant: { Args: never; Returns: string };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
