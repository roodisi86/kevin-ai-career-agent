"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getDictionary } from "@/lib/i18n";

const t = getDictionary();

const links = [
  { href: "/dashboard", label: t.nav.dashboard },
  { href: "/vacatures", label: t.nav.jobs },
  { href: "/bedrijven", label: t.nav.companies },
  { href: "/profiel", label: t.nav.profile },
  { href: "/voorkeuren", label: t.nav.preferences },
  { href: "/instellingen", label: t.nav.settings },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="flex flex-wrap gap-1">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                active ? "bg-navy-800 text-white" : "text-navy-800 hover:bg-sand-100"
              }`}
            >
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
