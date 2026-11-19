import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getServerEnv } from "@/lib/env";
import {
  buildCvFactsUserMessage,
  CV_FACTS_SYSTEM_PROMPT,
  FactSuggestionsSchema,
  parseFactSuggestions,
  type FactSuggestion,
  type ProfileSummary,
} from "@/lib/ai/cv-facts";

export type SuggestFactsResult =
  | { status: "completed"; facts: FactSuggestion[]; profileSummary: ProfileSummary; model: string }
  | { status: "not_configured" }
  | { status: "failed"; reason: "invalid_output" | "api_error" | "quota" | "auth" };

/**
 * Asks Claude for fact suggestions from CV text. Returns "not_configured"
 * when no API key is set, so the app keeps working without AI.
 */
export async function suggestCvFacts(cvText: string): Promise<SuggestFactsResult> {
  const env = getServerEnv();
  if (!env.ANTHROPIC_API_KEY) return { status: "not_configured" };

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 90_000 });

  try {
    const message = await client.messages.parse({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 4000,
      system: CV_FACTS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildCvFactsUserMessage(cvText) }],
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
    if (error instanceof Anthropic.RateLimitError) {
      return { status: "failed", reason: "quota" };
    }
    if (error instanceof SyntaxError) {
      return { status: "failed", reason: "invalid_output" };
    }
    return { status: "failed", reason: "api_error" };
  }
}
