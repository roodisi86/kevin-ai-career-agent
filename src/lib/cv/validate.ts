export const MAX_CV_BYTES = 5 * 1024 * 1024;

export type CvFileType = "pdf" | "docx";

export type UploadValidation =
  | { ok: true; fileType: CvFileType; mimeType: string; safeName: string }
  | { ok: false; error: "empty" | "too_large" | "unsupported_type" | "content_mismatch" | "bad_name" };

const MIME: Record<CvFileType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((b, i) => bytes[i] === b);
}

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const n = Array.from(needle, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) {
      if (bytes[i + j] !== n[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** Display-safe file name: no paths, control characters or odd symbols. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._ ()-]/gu, "_")
    .replace(/_+/g, "_")
    .slice(0, 120)
    .trim();
}

/**
 * Validates a CV upload by size, extension AND file signature (magic bytes).
 * The browser-provided MIME type is never trusted on its own.
 */
export function validateCvUpload(name: string, bytes: Uint8Array): UploadValidation {
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > MAX_CV_BYTES) return { ok: false, error: "too_large" };

  const safeName = sanitizeFileName(name);
  if (!safeName) return { ok: false, error: "bad_name" };

  const ext = safeName.toLowerCase().split(".").pop();
  if (ext !== "pdf" && ext !== "docx") return { ok: false, error: "unsupported_type" };

  if (ext === "pdf") {
    // "%PDF-"
    if (!startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { ok: false, error: "content_mismatch" };
    return { ok: true, fileType: "pdf", mimeType: MIME.pdf, safeName };
  }

  // DOCX is a ZIP container ("PK\x03\x04") holding word/document.xml.
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || !containsAscii(bytes, "word/")) {
    return { ok: false, error: "content_mismatch" };
  }
  return { ok: true, fileType: "docx", mimeType: MIME.docx, safeName };
}
