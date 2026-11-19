import { getAppContext } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseStoredPreferences } from "@/lib/preferences/schema";
import { formatDateTime } from "@/lib/time";
import { PreferencesForm } from "./preferences-form";

const t = getDictionary();

export default async function PreferencesPage() {
  const ctx = await getAppContext();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("candidate_preferences")
    .select("preferences_json, updated_at")
    .eq("candidate_id", ctx.candidateId)
    .maybeSingle();
  const { preferences, isDefault } = parseStoredPreferences(data?.preferences_json);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.preferences.title}</h1>
        <p className="max-w-3xl text-sm text-navy-600">{t.preferences.intro}</p>
        {isDefault ? (
          <p className="mt-2 inline-block rounded-lg bg-amber-100 px-3 py-1 text-sm text-amber-800">
            {t.preferences.defaultsNotice}
          </p>
        ) : (
          <p className="mt-2 text-xs text-navy-600">
            {t.common.lastUpdated}: {formatDateTime(data?.updated_at)}
          </p>
        )}
      </div>
      <PreferencesForm initial={preferences} />
    </div>
  );
}
