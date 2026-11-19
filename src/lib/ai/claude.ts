import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getServerEnv } from "@/lib/env";
import {
  buildCvFactsUserMessage,
  FactSuggestionsSchema,
  parseFactSuggestions,
  systemPromptFor,
  type FactSuggestion,
  type DocumentKind,
  type ProfileSummary,
} from "@/lib/ai/cv-facts";
import { MATCH_SYSTEM_PROMPT, MatchOutputSchema, parseMatchOutput, type MatchOutput } from "@/lib/ai/match";

export type SuggestFactsResult =
  | { status: "completed"; facts: FactSuggestion[]; profileSummary: ProfileSummary; model: string }
  | { status: "not_configured" }
  | { status: "failed"; reason: "invalid_output" | "api_error" | "quota" | "auth" | "timeout" };

/**
 * Asks Claude for fact suggestions from CV text. Returns "not_configured"
 * when no API key is set, so the app keeps working without AI.
 */
export async function suggestCvFacts(
  cvText: string,
  options: { kind?: DocumentKind; knownFacts?: string[] } = {},
): Promise<SuggestFactsResult> {
  const env = getServerEnv();
  if (!env.ANTHROPIC_API_KEY) return { status: "not_configured" };

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 55_000 });

  try {
    const message = await client.messages.parse({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 6000,
      system: systemPromptFor(options.kind),
      messages: [{ role: "user", content: buildCvFactsUserMessage(cvText, options) }],
      output_config: { format: zodOutputFormat(FactSuggestionsSchema) },
    });

    // Validate again ourselves: never trust the shape of model output.
    const parsed = parseFactSuggestions(message.parsed_output ?? null);
    if (!parsed.ok) return { status: "failed", reason: "invalid_output" };
    return {
      status: "completed",
      facts: parsed.facts,
      profileSummary: parsed.profileSummary,
      model: env.ANTHROPIC_MODEL,
    };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return { status: "failed", reason: "auth" };
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return { status: "failed", reason: "timeout" };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { status: "failed", reason: "quota" };
    }
    if (error instanceof SyntaxError) {
      return { status: "failed", reason: "invalid_output" };
    }
    return { status: "failed", reason: "api_error" };
  }
}

// ---------------------------------------------------------------------------
// Job matching
// ---------------------------------------------------------------------------

export type ScoreJobResult =
  | { status: "completed"; output: MatchOutput; model: string }
  | { status: "not_configured" }
  | { status: "failed"; reason: "invalid_output" | "api_error" | "quota" | "auth" | "timeout" };

export async function scoreJobWithClaude(userMessage: string): Promise<ScoreJobResult> {
  const env = getServerEnv();
  if (!env.ANTHROPIC_API_KEY) return { status: "not_configured" };
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 55_000 });
  try {
    const message = await client.messages.parse({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 4000,
      system: MATCH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      output_config: { format: zodOutputFormat(MatchOutputSchema) },
    });
    const parsed = parseMatchOutput(message.parsed_output ?? null);
    if (!parsed.ok) return { status: "failed", reason: "invalid_output" };
    return { status: "completed", output: parsed.output, model: env.ANTHROPIC_MODEL };
  } catch (error) {
    return { status: "failed", reason: failureReason(error) };
  }
}

function failureReason(error: unknown): "invalid_output" | "api_error" | "quota" | "auth" | "timeout" {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return "auth";
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (error instanceof Anthropic.RateLimitError) return "quota";
  if (error instanceof SyntaxError || (error instanceof Error && /zod|parse|schema/i.test(error.name + error.message))) {
    return "invalid_output";
  }
  return "api_error";
}
