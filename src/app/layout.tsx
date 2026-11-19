import type { Metadata } from "next";
import "./globals.css";
import { getDictionary } from "@/lib/i18n";

const t = getDictionary();

export const metadata: Metadata = {
  title: t.app.name,
  description: t.app.tagline,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nl">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
