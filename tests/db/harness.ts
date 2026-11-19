import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

/**
 * Local database harness: creates a throw-away database on a plain Postgres
 * server, loads a minimal Supabase stub (auth/storage schemas and roles) and
 * applies every migration in supabase/migrations in order.
 *
 * Connection: DATABASE_TEST_URL, e.g. postgres://postgres@localhost:5432/postgres
 */
const ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

export function adminUrl(): string {
  const url = process.env.DATABASE_TEST_URL;
  if (!url) {
    throw new Error(
      "DATABASE_TEST_URL is not set. Point it at a disposable Postgres server (see README › Tests).",
    );
  }
  return url;
}

export interface TestDb {
  pool: pg.Pool;
  name: string;
  drop: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const name = `kaca_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });

  const stub = readFileSync(join(__dirname, "supabase-stub.sql"), "utf8");
  await pool.query(stub);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await pool.query(sql);
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }

  return {
    pool,
    name,
    drop: async () => {
      await pool.end();
      const cleanup = new pg.Client({ connectionString: adminUrl() });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${name} with (force)`);
      await cleanup.end();
    },
  };
}

/** Creates an auth user (as superuser) and returns its id. */
export async function createAuthUser(pool: pg.Pool, email: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  return rows[0].id;
}

export async function allowOwner(
  pool: pg.Pool,
  email: string,
  slug: string,
  isDemo = true,
): Promise<void> {
  await pool.query(
    "insert into public.allowed_owners (email, tenant_slug, tenant_name, is_demo) values ($1, $2, $3, $4)",
    [email.toLowerCase(), slug, `DEMO ${slug}`, isDemo],
  );
}

/**
 * Runs `fn` inside a transaction as the given Supabase role, with the JWT
 * claims Supabase would set for that request. Always rolls back unless
 * `commit` is true.
 */
export async function asRole<T>(
  pool: pg.Pool,
  role: "authenticated" | "anon",
  userId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
  { commit = false }: { commit?: boolean } = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const claims = userId ? JSON.stringify({ sub: userId, role }) : JSON.stringify({ role });
    await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    await client.query(`set local role ${role}`);
    const result = await fn(client);
    await client.query(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const asUser = <T>(
  pool: pg.Pool,
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
  options?: { commit?: boolean },
) => asRole(pool, "authenticated", userId, fn, options);

export async function expectPgError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
  throw new Error("Expected a database error, but the statement succeeded");
}
