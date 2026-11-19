import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  allowOwner,
  asRole,
  asUser,
  createAuthUser,
  createTestDb,
  expectPgError,
  type TestDb,
} from "./harness";

let db: TestDb;
let userA: string;
let userB: string;
let tenantA: string;
let tenantB: string;
let candidateA: string;
let candidateB: string;

async function bootstrap(userId: string): Promise<string> {
  return asUser(
    db.pool,
    userId,
    async (c) => {
      const { rows } = await c.query<{ bootstrap_tenant: string }>("select public.bootstrap_tenant()");
      return rows[0].bootstrap_tenant;
    },
    { commit: true },
  );
}

async function candidateFor(userId: string): Promise<string> {
  return asUser(db.pool, userId, async (c) => {
    const { rows } = await c.query<{ id: string }>("select id from public.candidate_profiles");
    return rows[0].id;
  });
}

beforeAll(async () => {
  db = await createTestDb();
  userA = await createAuthUser(db.pool, "demo-a@example.invalid");
  userB = await createAuthUser(db.pool, "demo-b@example.invalid");
  await allowOwner(db.pool, "demo-a@example.invalid", "demo-a");
  await allowOwner(db.pool, "demo-b@example.invalid", "demo-b");
  tenantA = await bootstrap(userA);
  tenantB = await bootstrap(userB);
  candidateA = await candidateFor(userA);
  candidateB = await candidateFor(userB);

  // Seed one confirmed fact, one document and preferences for tenant A.
  await asUser(
    db.pool,
    userA,
    async (c) => {
      const doc = await c.query<{ id: string }>(
        `insert into public.candidate_documents
           (tenant_id, candidate_id, storage_path, original_filename, file_type, size_bytes, checksum)
         values ($1, $2, $3, 'demo-cv.pdf', 'pdf', 1000, repeat('a', 64)) returning id`,
        [tenantA, candidateA, `${tenantA}/doc-1.pdf`],
      );
      await c.query(
        `insert into public.candidate_facts (tenant_id, candidate_id, category, statement, status, origin, source_document_id)
         values ($1, $2, 'role', 'DEMO: led a commercial team', 'confirmed', 'user', $3)`,
        [tenantA, candidateA, doc.rows[0].id],
      );
      await c.query(
        `insert into public.candidate_preferences (tenant_id, candidate_id, preferences_json)
         values ($1, $2, '{"demo": true}')`,
        [tenantA, candidateA],
      );
      await c.query(
        "insert into storage.objects (bucket_id, name, owner) values ('cv-documents', $1, $2)",
        [`${tenantA}/doc-1.pdf`, userA],
      );
    },
    { commit: true },
  );
}, 60_000);

afterAll(async () => {
  await db?.drop();
});

describe("tenant bootstrap", () => {
  it("creates exactly one tenant per allow-listed user and is idempotent", async () => {
    expect(tenantA).not.toEqual(tenantB);
    expect(await bootstrap(userA)).toEqual(tenantA);
  });

  it("refuses users that are not on the allow-list", async () => {
    const stranger = await createAuthUser(db.pool, "stranger@example.invalid");
    const code = await expectPgError(
      asUser(db.pool, stranger, (c) => c.query("select public.bootstrap_tenant()")),
    );
    expect(code).toBe("42501");
  });

  it("never lets clients read the allow-list", async () => {
    const code = await expectPgError(
      asUser(db.pool, userA, (c) => c.query("select * from public.allowed_owners")),
    );
    expect(code).toBe("42501");
  });
});

describe("cross-tenant isolation", () => {
  const privateTables = [
    "tenants",
    "memberships",
    "candidate_profiles",
    "candidate_documents",
    "candidate_facts",
    "candidate_preferences",
    "audit_events",
  ];

  it.each(privateTables)("user B cannot read tenant A rows in %s", async (table) => {
    const column = table === "tenants" ? "id" : "tenant_id";
    const rows = await asUser(db.pool, userB, async (c) => {
      const result = await c.query(`select 1 from public.${table} where ${column} = $1`, [tenantA]);
      return result.rowCount;
    });
    expect(rows).toBe(0);
  });

  it("user A can read its own rows", async () => {
    const count = await asUser(db.pool, userA, async (c) => {
      const result = await c.query("select 1 from public.candidate_facts where tenant_id = $1", [tenantA]);
      return result.rowCount;
    });
    expect(count).toBe(1);
  });

  it("user B cannot insert a fact into tenant A", async () => {
    const code = await expectPgError(
      asUser(db.pool, userB, (c) =>
        c.query(
          `insert into public.candidate_facts (tenant_id, candidate_id, category, statement, origin)
           values ($1, $2, 'other', 'injected', 'user')`,
          [tenantA, candidateA],
        ),
      ),
    );
    expect(code).toBe("42501");
  });

  it("user B cannot attach its row to tenant A's candidate", async () => {
    const code = await expectPgError(
      asUser(db.pool, userB, (c) =>
        c.query(
          `insert into public.candidate_facts (tenant_id, candidate_id, category, statement, origin)
           values ($1, $2, 'other', 'cross-link', 'user')`,
          [tenantB, candidateA],
        ),
      ),
    );
    expect(code).toBe("42501");
  });

  it("user B cannot update or delete tenant A rows", async () => {
    const affected = await asUser(db.pool, userB, async (c) => {
      const upd = await c.query("update public.candidate_facts set statement = 'x' where tenant_id = $1", [tenantA]);
      const del = await c.query("delete from public.candidate_documents where tenant_id = $1", [tenantA]);
      const prof = await c.query("update public.candidate_profiles set headline = 'x' where id = $1", [candidateA]);
      return (upd.rowCount ?? 0) + (del.rowCount ?? 0) + (prof.rowCount ?? 0);
    });
    expect(affected).toBe(0);
  });

  it("tenant_id cannot be re-pointed by an update", async () => {
    const code = await expectPgError(
      asUser(db.pool, userA, (c) =>
        c.query("update public.candidate_facts set tenant_id = $1 where tenant_id = $2", [tenantB, tenantA]),
      ),
    );
    expect(code).toBe("42501");
  });

  it("anonymous requests get no access at all", async () => {
    const code = await expectPgError(
      asRole(db.pool, "anon", null, (c) => c.query("select * from public.candidate_profiles")),
    );
    expect(code).toBe("42501");
  });
});

describe("storage isolation", () => {
  it("user B cannot see tenant A CV files", async () => {
    const count = await asUser(db.pool, userB, async (c) => {
      const result = await c.query("select 1 from storage.objects where bucket_id = 'cv-documents'");
      return result.rowCount;
    });
    expect(count).toBe(0);
  });

  it("user B cannot upload into tenant A's folder", async () => {
    const code = await expectPgError(
      asUser(db.pool, userB, (c) =>
        c.query("insert into storage.objects (bucket_id, name) values ('cv-documents', $1)", [
          `${tenantA}/evil.pdf`,
        ]),
      ),
    );
    expect(code).toBe("42501");
  });

  it("uploads outside a tenant folder are refused", async () => {
    const code = await expectPgError(
      asUser(db.pool, userA, (c) =>
        c.query("insert into storage.objects (bucket_id, name) values ('cv-documents', 'loose.pdf')"),
      ),
    );
    expect(code).toBe("42501");
  });

  it("user A can upload into its own folder", async () => {
    const inserted = await asUser(db.pool, userA, async (c) => {
      const result = await c.query("insert into storage.objects (bucket_id, name) values ('cv-documents', $1)", [
        `${tenantA}/ok.pdf`,
      ]);
      return result.rowCount;
    });
    expect(inserted).toBe(1);
  });
});

describe("fact confirmation rules", () => {
  it("AI suggestions cannot be inserted as confirmed", async () => {
    const code = await expectPgError(
      asUser(db.pool, userA, (c) =>
        c.query(
          `insert into public.candidate_facts (tenant_id, candidate_id, category, statement, status, origin)
           values ($1, $2, 'achievement', 'DEMO: managed full P&L', 'confirmed', 'ai_suggestion')`,
          [tenantA, candidateA],
        ),
      ),
    );
    expect(code).toBe("42501");
  });

  it("confirming a suggestion records the current user and bumps the profile version", async () => {
    const result = await asUser(db.pool, userA, async (c) => {
      const before = await c.query<{ profile_version: number }>(
        "select profile_version from public.candidate_profiles where id = $1",
        [candidateA],
      );
      const fact = await c.query<{ id: string }>(
        `insert into public.candidate_facts (tenant_id, candidate_id, category, statement, origin)
         values ($1, $2, 'skill', 'DEMO: partnerships', 'ai_suggestion') returning id`,
        [tenantA, candidateA],
      );
      const confirmed = await c.query<{ confirmed_by: string; status: string }>(
        "update public.candidate_facts set status = 'confirmed' where id = $1 returning confirmed_by, status",
        [fact.rows[0].id],
      );
      const after = await c.query<{ profile_version: number }>(
        "select profile_version from public.candidate_profiles where id = $1",
        [candidateA],
      );
      return {
        before: before.rows[0].profile_version,
        after: after.rows[0].profile_version,
        confirmedBy: confirmed.rows[0].confirmed_by,
      };
    });
    expect(result.confirmedBy).toBe(userA);
    expect(result.after).toBe(result.before + 1);
  });

  it("users cannot set profile_version themselves", async () => {
    const code = await expectPgError(
      asUser(db.pool, userA, (c) =>
        c.query("update public.candidate_profiles set profile_version = 999 where id = $1", [candidateA]),
      ),
    );
    expect(code).toBe("42501");
  });

  it("audit events cannot be forged for another actor", async () => {
    const code = await expectPgError(
      asUser(db.pool, userA, (c) =>
        c.query(
          `insert into public.audit_events (tenant_id, actor_id, action, resource_type)
           values ($1, $2, 'profile.updated', 'candidate_profile')`,
          [tenantA, userB],
        ),
      ),
    );
    expect(code).toBe("42501");
  });

  it("other users' candidates are unaffected (sanity)", () => {
    expect(candidateB).toBeTruthy();
  });
});

describe("job scanner isolation", () => {
  it("user B cannot see, add or link to tenant A's companies, sources and jobs", async () => {
    const ids = await asUser(
      db.pool,
      userA,
      async (c) => {
        const target = await c.query<{ id: string }>(
          `insert into public.company_targets (tenant_id, company_name, company_key) values ($1, 'DEMO Co', 'demo co') returning id`,
          [tenantA],
        );
        const source = await c.query<{ id: string }>(
          `insert into public.job_sources (tenant_id, company_target_id, provider, identifier) values ($1, $2, 'greenhouse', 'democo') returning id`,
          [tenantA, target.rows[0].id],
        );
        const job = await c.query<{ id: string }>(
          `insert into public.jobs (tenant_id, source_id, provider, external_job_id, company_name, title, canonical_url, raw_hash, dedupe_key)
           values ($1, $2, 'greenhouse', '1', 'DEMO Co', 'DEMO Country Manager', 'https://example.invalid/1', repeat('b', 64), 'demo co|demo country manager|nl')
           returning id`,
          [tenantA, source.rows[0].id],
        );
        return { target: target.rows[0].id, source: source.rows[0].id, job: job.rows[0].id };
      },
      { commit: true },
    );

    const visible = await asUser(db.pool, userB, async (c) => {
      const counts = await Promise.all(
        ["company_targets", "job_sources", "jobs"].map((t) =>
          c.query(`select 1 from public.${t} where tenant_id = $1`, [tenantA]).then((r) => r.rowCount ?? 0),
        ),
      );
      return counts.reduce((a, b) => a + b, 0);
    });
    expect(visible).toBe(0);

    // B cannot point its own rows at A's source/target/job.
    for (const sql of [
      `insert into public.job_sources (tenant_id, company_target_id, provider, identifier) values ($1, '${ids.target}', 'lever', 'x')`,
      `insert into public.jobs (tenant_id, source_id, provider, external_job_id, company_name, title, canonical_url, raw_hash, dedupe_key)
       values ($1, '${ids.source}', 'greenhouse', '2', 'X', 'X', 'https://example.invalid/2', repeat('c', 64), 'x')`,
      `insert into public.jobs (tenant_id, provider, external_job_id, company_name, title, canonical_url, raw_hash, dedupe_key, duplicate_of)
       values ($1, 'manual', '3', 'X', 'X', 'https://example.invalid/3', repeat('d', 64), 'x', '${ids.job}')`,
    ]) {
      const code = await expectPgError(asUser(db.pool, userB, (c) => c.query(sql, [tenantB])));
      expect(code).toBe("42501");
    }
  });

  it("source identifiers are restricted to safe characters", async () => {
    const code = await expectPgError(
      asUser(db.pool, userA, (c) =>
        c.query(`insert into public.job_sources (tenant_id, provider, identifier) values ($1, 'greenhouse', '../../etc')`, [
          tenantA,
        ]),
      ),
    );
    expect(code).toBe("23514");
  });
});
