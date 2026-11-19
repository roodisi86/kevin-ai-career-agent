import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppContext, NotAllowedError } from "@/lib/dal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** GET /api/profile/documents/:id — redirects to a 60-second signed URL for the original file. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAppContext();
  } catch (error) {
    if (error instanceof NotAllowedError) return NextResponse.json({ error: "not_allowed" }, { status: 403 });
    throw error;
  }

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const supabase = await createSupabaseServerClient();
  const { data: doc } = await supabase.from("candidate_documents").select("storage_path").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data, error } = await supabase.storage.from("cv-documents").createSignedUrl(doc.storage_path, 60);
  if (error || !data) return NextResponse.json({ error: "storage" }, { status: 502 });

  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
