import type { Metadata } from "next";
import "./globals.css";
import { LogoutButton } from "@/components/LogoutButton";

export const metadata: Metadata = {
  title: "Touring Content Updater",
  description:
    "Analyseert en werkt oude Touring-blogartikelen bij volgens 2026 SEO- en GEO-best-practices.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl-BE">
      <body className="min-h-screen bg-touring-surface text-touring-ink">
        <header className="border-b border-touring-border bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <span className="inline-block h-8 w-8 rounded bg-touring-blue" aria-hidden />
              <div>
                <h1 className="text-lg font-semibold text-touring-blue">
                  Touring Content Updater
                </h1>
                <p className="text-xs text-touring-muted">
                  Analyse · aanbevelingen · herschrijving · eindredactie
                </p>
              </div>
            </div>
            <div className="hidden md:block">
              <LogoutButton />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-6 py-8 text-center text-xs text-touring-muted">
          Intern werkinstrument · niet voor externe distributie
        </footer>
      </body>
    </html>
  );
}
