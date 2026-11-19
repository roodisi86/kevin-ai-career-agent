import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAppContext, NotAllowedError } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MAX_CV_BYTES, validateCvUpload } from "@/lib/cv/validate";
import { extractCvText } from "@/lib/cv/extract";

export const runtime = "nodejs";

function fail(code: string, status: number) {
  return NextResponse.json({ ok: false, error: code }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/profile/documents — private CV upload + text extraction.
 * Size and type are checked server-side (including magic bytes); the file is
 * stored under the tenant's own folder in a private bucket (RLS-protected).
 */
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await getAppContext();
  } catch (error) {
    if (error instanceof NotAllowedError) return fail("not_allowed", 403);
    throw error;
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_CV_BYTES + 64 * 1024) return fail("too_large", 413);

  let file: File | null = null;
  let documentKind: "cv" | "linkedin_profile" = "cv";
  try {
    const form = await request.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
    if (form.get("kind") === "linkedin_profile") documentKind = "linkedin_profile";
  } catch {
    return fail("generic", 400);
  }
  if (!file) return fail("empty", 400);
  if (file.size > MAX_CV_BYTES) return fail("too_large", 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateCvUpload(file.name, bytes);
  if (!validation.ok) return fail(validation.error, 400);

  const checksum = createHash("sha256").update(bytes).digest("hex");
  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase
    .from("candidate_documents")
    .select("id")
    .eq("candidate_id", ctx.candidateId)
    .eq("checksum", checksum)
    .maybeSingle();
  if (existing) return fail("duplicate", 409);

  const storagePath = `${ctx.tenantId}/${randomUUID()}.${validation.fileType}`;
  const { error: uploadError } = await supabase.storage.from("cv-documents").upload(storagePath, bytes, {
    contentType: validation.mimeType,
    upsert: false,
  });
  if (uploadError) return fail("storage", 502);

  const { data: doc, error: insertError } = await supabase
    .from("candidate_documents")
    .insert({
      tenant_id: ctx.tenantId,
      candidate_id: ctx.candidateId,
      storage_path: storagePath,
      original_filename: validation.safeName,
      file_type: validation.fileType,
      document_kind: documentKind,
      size_bytes: bytes.length,
      checksum,
    })
    .select("id")
    .single();
  if (insertError || !doc) {
    await supabase.storage.from("cv-documents").remove([storagePath]);
    return fail("generic", 500);
  }
  await audit(ctx, "document.uploaded", "candidate_document", doc.id, {
    file_type: validation.fileType,
    document_kind: documentKind,
    size_bytes: bytes.length,
  });

  const extraction = await extractCvText(bytes, validation.fileType);
  if (extraction.ok) {
    await supabase
      .from("candidate_documents")
      .update({ processing_status: "extracted", extracted_text: extraction.text, extraction_error: null })
      .eq("id", doc.id);
    await audit(ctx, "document.extracted", "candidate_document", doc.id, {
      chars: extraction.text.length,
      truncated: extraction.truncated,
    });
  } else {
    await supabase
      .from("candidate_documents")
      .update({ processing_status: "failed", extraction_error: extraction.error })
      .eq("id", doc.id);
  }

  return NextResponse.json(
    { ok: true, documentId: doc.id, extracted: extraction.ok },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
