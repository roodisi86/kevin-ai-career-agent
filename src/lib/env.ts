import { z } from "zod";

/**
 * Environment configuration. Public Supabase values are required for the app
 * to run; everything else is optional and the related feature degrades
 * gracefully (and says so in the UI) when it is missing.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

const serverSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(10).optional(),
  ANTHROPIC_MODEL: z.string().min(3).default("claude-sonnet-5-5"),
  AI_DAILY_REQUEST_CAP: z.coerce.number().int().positive().default(50),
  // Separate cap for job matching: one request per vacancy.
  AI_DAILY_MATCH_CAP: z.coerce.number().int().positive().default(150),
  // "subscription" (default, free): rules + queue answered by a scheduled Claude
  // task under the user's own subscription. "api": paid Anthropic API calls.
  AI_MATCH_MODE: z.enum(["subscription", "api"]).default("subscription"),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

export function getPublicEnv(): PublicEnv {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!parsed.success) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example).",
    );
  }
  return parsed.data;
}

export function getServerEnv(): ServerEnv {
  return serverSchema.parse({
    ANTHROPIC_API_KEY: emptyToUndefined(process.env.ANTHROPIC_API_KEY),
    ANTHROPIC_MODEL: emptyToUndefined(process.env.ANTHROPIC_MODEL),
    AI_DAILY_REQUEST_CAP: emptyToUndefined(process.env.AI_DAILY_REQUEST_CAP),
    AI_DAILY_MATCH_CAP: emptyToUndefined(process.env.AI_DAILY_MATCH_CAP),
    AI_MATCH_MODE: emptyToUndefined(process.env.AI_MATCH_MODE),
  });
}

export function isAiConfigured(): boolean {
  return Boolean(getServerEnv().ANTHROPIC_API_KEY);
}

/** True only when paid API matching is explicitly switched on and a key is set. */
export function isApiMatchingEnabled(): boolean {
  const env = getServerEnv();
  return env.AI_MATCH_MODE === "api" && Boolean(env.ANTHROPIC_API_KEY);
}
