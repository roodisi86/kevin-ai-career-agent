import { getAppContext, NotAllowedError, type AppContext } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n";
import { signOut } from "@/app/login/actions";
import { NavLinks } from "./nav-links";

const t = getDictionary();

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ctx: AppContext;
  try {
    ctx = await getAppContext();
  } catch (error) {
    if (error instanceof NotAllowedError) {
      return (
        <main className="flex min-h-screen items-center justify-center px-4">
          <div className="card max-w-md">
            <h1 className="mb-2 text-xl font-semibold">{t.notAllowed.title}</h1>
            <p className="mb-4 text-sm text-navy-600">{t.notAllowed.body}</p>
            <form action={signOut}>
              <button type="submit" className="btn-secondary">
                {t.nav.signOut}
              </button>
            </form>
          </div>
        </main>
      );
    }
    throw error;
  }

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 btn-primary">
        {t.app.skipToContent}
      </a>
      {ctx.isDemoTenant && (
        <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-800">
          {t.app.demoBanner}
        </div>
      )}
      <header className="border-b border-sand-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-navy-900">{t.app.name}</p>
            <p className="text-xs text-navy-600">{t.app.tagline}</p>
          </div>
          <nav aria-label={t.nav.mainNav} className="flex flex-wrap items-center gap-2">
            <NavLinks />
            <form action={signOut}>
              <button type="submit" className="btn-secondary">
                {t.nav.signOut}
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
