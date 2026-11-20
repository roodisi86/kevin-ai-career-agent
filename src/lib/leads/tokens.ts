import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

/** Personal import keys: "kca_" + 32 random bytes (base64url). Only the SHA-256 is stored. */
export function generateImportToken(): { token: string; hash: string; prefix: string } {
  const token = `kca_${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashImportToken(token), prefix: token.slice(0, 8) };
}

export function hashImportToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function bearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer\s+(kca_[A-Za-z0-9_-]{20,200})$/);
  return match ? match[1] : null;
}

const text = (max: number) => z.string().trim().max(max).optional().nullable();

/** What Grok Bot may send. Everything is untrusted data. */
export const LeadSchema = z.object({
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(200),
  url: z.string().trim().max(2000).regex(/^https?:\/\/\S+$/),
  location: text(200),
  posted: text(60),
  salary: text(200),
  contract: text(200),
  reason: text(500),
  description: z.string().max(20000).optional().nullable(),
});

export const LeadBatchSchema = z.object({ jobs: z.array(LeadSchema).min(1).max(25) });
export type LeadBatch = z.infer<typeof LeadBatchSchema>;
