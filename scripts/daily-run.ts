/**
 * Daily automation: scan all approved sources and let Claude assess new or
 * changed vacancies, for every tenant the automation account is a member of.
 *
 * Runs in GitHub Actions (.github/workflows/daily-run.yml):
 *   node --conditions=react-server --import tsx scripts/daily-run.ts
 *
 * Security model: there is no service-role key. The automation signs in as
 * its own Supabase user, which is a plain 'member' of the tenant, so every
 * query still goes through Row-Level Security. It never sends, applies or
 * contacts anyone: it only reads job feeds and writes scans, jobs and matches.
 *
 * Logs contain counts only — never CV text, facts or vacancy content.
 */
import { createClient } from "@supabase/supabase-js";
import type { AppContext } from "@/lib/dal";
import type { Database } from "@/lib/supabase/database.types";
import { isAiConfigured } from "@/lib/env";
import { finishScan, runSourceInScan, startScan } from "@/lib/scanner/service";
import { pendingMatchJobIds, scoreJob } from "@/lib/matching/service";

const MAX_MATCHES_PER_RUN = 120;
const STOP = new Set(["not_configured", "cap_reached", "no_facts"]);

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

async function main(): Promise<number> {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const email = env("AUTOMATION_EMAIL");
  const password = env("AUTOMATION_PASSWORD");
  const missing = Object.entries({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key, AUTOMATION_EMAIL: email, AUTOMATION_PASSWORD: password })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    // Degrade gracefully: not configured is not an error.
    console.log(`daily run skipped: not configured (${missing.join(", ")})`);
    return 0;
  }

  const db = createClient<Database>(url!, key!, { auth: { persistSession: false, autoRefreshToken: true } });
  const { data: auth, error: authError } = await db.auth.signInWithPassword({ email: email!, password: password! });
  if (authError || !auth.user) {
    console.error(`daily run: sign-in failed (${authError?.code ?? "unknown"})`);
    return 1;
  }
  const userId = auth.user.id;

  try {
    const { data: memberships, error } = await db.from("memberships").select("tenant_id, role").eq("user_id", userId);
    if (error) throw new Error(`memberships ${error.code}`);
    if (!memberships?.length) {
      console.log("daily run: the automation account is not a member of any workspace");
      return 0;
    }

    let failures = 0;
    for (const membership of memberships) {
      const [{ data: tenant }, { data: candidate }] = await Promise.all([
        db.from("tenants").select("id, name, is_demo").eq("id", membership.tenant_id).single(),
        db
          .from("candidate_profiles")
          .select("id, profile_version")
          .eq("tenant_id", membership.tenant_id)
          .order("created_at")
          .limit(1)
          .maybeSingle(),
      ]);
      if (!tenant || !candidate) {
        console.log("daily run: workspace incomplete, skipped");
        continue;
      }
      const ctx: AppContext = {
        userId,
        email: null,
        tenantId: tenant.id,
        tenantName: tenant.name,
        isDemoTenant: tenant.is_demo,
        candidateId: candidate.id,
        profileVersion: candidate.profile_version,
        db,
      };
      const label = tenant.is_demo ? "demo workspace" : "workspace";

      // 1. Scan every approved source, one at a time (polite to the APIs).
      const plan = await startScan(ctx, { trigger: "scheduled" });
      let ok = 0;
      let failed = 0;
      let relevant = 0;
      let fresh = 0;
      for (const source of plan.sources) {
        try {
          const result = await runSourceInScan(ctx, plan.scanId, source.id);
          if (result.ok) {
            ok++;
            relevant += result.counts.relevant;
            fresh += result.counts.new;
          } else failed++;
        } catch {
          failed++;
        }
      }
      const finished = await finishScan(ctx, plan.scanId);
      console.log(
        `${label}: scan ${finished.status} — ${ok} sources ok, ${failed} failed, ${relevant} relevant, ${fresh} new, ${finished.duplicates} duplicates`,
      );

      // 2. AI assessment of new or changed vacancies (cached otherwise).
      if (!isAiConfigured()) {
        console.log(`${label}: AI assessment skipped (no ANTHROPIC_API_KEY)`);
        continue;
      }
      const { pending } = await pendingMatchJobIds(ctx);
      const queue = pending.slice(0, MAX_MATCHES_PER_RUN);
      const tally: Record<string, number> = {};
      let stopReason: string | null = null;
      const worker = async () => {
        while (queue.length && !stopReason) {
          const id = queue.shift()!;
          try {
            const outcome = await scoreJob(ctx, id);
            const key = outcome.status === "failed" ? `failed_${outcome.reason}` : outcome.status;
            tally[key] = (tally[key] ?? 0) + 1;
            if (STOP.has(outcome.status)) stopReason = outcome.status;
          } catch {
            tally.error = (tally.error ?? 0) + 1;
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      console.log(
        `${label}: AI assessment — ${pending.length} pending; ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(", ") || "nothing to do"}${stopReason ? ` (stopped: ${stopReason})` : ""}`,
      );
      if (finished.status === "failed") failures++;
    }
    return failures > 0 ? 1 : 0;
  } finally {
    await db.auth.signOut();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`daily run failed: ${(error as Error).message?.slice(0, 120)}`);
    process.exit(1);
  });
