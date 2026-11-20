import { describe, expect, it } from "vitest";
import { bearerToken, generateImportToken, hashImportToken, LeadBatchSchema } from "./tokens";

describe("import keys", () => {
  it("generates unguessable keys and stores only a sha-256 hash", () => {
    const a = generateImportToken();
    const b = generateImportToken();
    expect(a.token).toMatch(/^kca_[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashImportToken(a.token));
    expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(a.prefix).toBe(a.token.slice(0, 8));
  });

  it("only accepts a well-formed Bearer key", () => {
    const { token } = generateImportToken();
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(bearerToken(token)).toBeNull();
    expect(bearerToken("Bearer sk-something")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

describe("lead batches", () => {
  const lead = { title: "DEMO Commercial Director", company: "DEMO Co", url: "https://example.com/jobs/1" };
  it("accepts 1–25 leads with an http(s) URL", () => {
    expect(LeadBatchSchema.safeParse({ jobs: [lead] }).success).toBe(true);
    expect(LeadBatchSchema.safeParse({ jobs: [] }).success).toBe(false);
    expect(LeadBatchSchema.safeParse({ jobs: Array(26).fill(lead) }).success).toBe(false);
    expect(LeadBatchSchema.safeParse({ jobs: [{ ...lead, url: "javascript:alert(1)" }] }).success).toBe(false);
    expect(LeadBatchSchema.safeParse({ jobs: [{ ...lead, company: "" }] }).success).toBe(false);
  });
});
