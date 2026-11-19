/**
 * Database types for the Supabase client. Kept in sync with
 * supabase/migrations (compare with `generate_typescript_types` output when
 * the schema changes). Compact form: Insert = required columns + optional rest.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

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
  document_kind: "cv" | "linkedin_profile";
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
    };
    Views: { [_ in never]: never };
    Functions: {
      bootstrap_tenant: { Args: never; Returns: string };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
