import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_CV_BYTES, sanitizeFileName, validateCvUpload } from "./validate";
import { excerptOccursIn, isSensitiveClaim } from "./text";
import { extractCvText } from "./extract";

const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "tests", "fixtures", name)));

describe("CV upload validation", () => {
  it("accepts a real PDF and DOCX by signature", () => {
    expect(validateCvUpload("cv.pdf", fixture("demo-cv.pdf"))).toMatchObject({ ok: true, fileType: "pdf" });
    expect(validateCvUpload("cv.docx", fixture("demo-cv.docx"))).toMatchObject({ ok: true, fileType: "docx" });
  });

  it("rejects a text file renamed to .pdf", () => {
    expect(validateCvUpload("cv.pdf", fixture("not-a-cv.pdf"))).toEqual({ ok: false, error: "content_mismatch" });
  });

  it("rejects a PDF renamed to .docx", () => {
    expect(validateCvUpload("cv.docx", fixture("demo-cv.pdf"))).toEqual({ ok: false, error: "content_mismatch" });
  });

  it("rejects unsupported extensions, empty and oversized files", () => {
    expect(validateCvUpload("cv.exe", fixture("demo-cv.pdf"))).toEqual({ ok: false, error: "unsupported_type" });
    expect(validateCvUpload("cv.pdf", new Uint8Array())).toEqual({ ok: false, error: "empty" });
    expect(validateCvUpload("cv.pdf", new Uint8Array(MAX_CV_BYTES + 1))).toEqual({ ok: false, error: "too_large" });
  });

  it("strips paths and odd characters from file names", () => {
    expect(sanitizeFileName("../../etc/passwd<script>.pdf")).toBe("passwd_script_.pdf");
    expect(sanitizeFileName("C:\\Users\\kevin\\CV 2027.pdf")).toBe("CV 2027.pdf");
  });
});

describe("CV text extraction", () => {
  it("extracts text from the synthetic PDF", async () => {
    const result = await extractCvText(fixture("demo-cv.pdf"), "pdf");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain("Commercial Director Benelux");
  });

  it("extracts text from the synthetic DOCX", async () => {
    const result = await extractCvText(fixture("demo-cv.docx"), "docx");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain("team of 12 people");
  });

  it("fails gracefully on garbage", async () => {
    const result = await extractCvText(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]), "pdf");
    expect(result.ok).toBe(false);
  });
});

describe("sensitive claims and evidence", () => {
  it.each([
    "Full P&L responsibility for Benelux",
    "Managed a budget of €2M",
    "Grew revenue by 40%",
    "Led a team of 200 employees",
    "Eindverantwoordelijk voor 35 medewerkers",
    "Closed a EUR 3 million deal",
  ])("flags quantified or high-stakes claim: %s", (statement) => {
    expect(isSensitiveClaim(statement)).toBe(true);
  });

  it.each(["Speaks Dutch, English, French and Spanish", "MSc International Business", "Built partnerships"])(
    "does not flag plain claim: %s",
    (statement) => {
      expect(isSensitiveClaim(statement)).toBe(false);
    },
  );

  it("matches excerpts despite whitespace, quotes and dash differences", () => {
    const source = "Commercial Director Benelux, Demo Beverages B.V. (2021 – present)\nLed a   team";
    expect(excerptOccursIn("Demo Beverages B.V. (2021 - present) Led a team", source)).toBe(true);
    expect(excerptOccursIn("Demo Beverages managed full P&L", source)).toBe(false);
    expect(excerptOccursIn("short", source)).toBe(false);
  });
});
