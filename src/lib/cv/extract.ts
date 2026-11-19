import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import type { CvFileType } from "@/lib/cv/validate";
import { MAX_EXTRACTED_CHARS, normalizeWhitespace } from "@/lib/cv/text";

export type ExtractionResult =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; error: "no_text" | "parse_failed" };

/** Extracts plain text from a validated PDF or DOCX. The text is untrusted data. */
export async function extractCvText(bytes: Uint8Array, fileType: CvFileType): Promise<ExtractionResult> {
  try {
    let raw: string;
    if (fileType === "pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const result = await extractText(pdf, { mergePages: true });
      raw = Array.isArray(result.text) ? result.text.join("\n") : result.text;
    } else {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      raw = result.value;
    }

    const text = normalizeWhitespace(raw);
    if (text.length < 20) return { ok: false, error: "no_text" };

    const truncated = text.length > MAX_EXTRACTED_CHARS;
    return { ok: true, text: truncated ? text.slice(0, MAX_EXTRACTED_CHARS) : text, truncated };
  } catch {
    return { ok: false, error: "parse_failed" };
  }
}
