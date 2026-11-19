import { LoginForm } from "./login-form";
import { getDictionary } from "@/lib/i18n";

const t = getDictionary();

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-teal-700">{t.app.name}</p>
        <div className="card">
          <h1 className="mb-1 text-xl font-semibold">{t.login.title}</h1>
          <p className="mb-5 text-sm text-navy-600">{t.login.intro}</p>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
