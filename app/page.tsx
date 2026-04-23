import { Wizard } from "@/components/Wizard";

export default function HomePage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-touring-blue">Content Updater</h2>
        <p className="mt-1 text-sm text-touring-muted">
          Analyseert oude Touring-blogs volgens 2026 SEO- en GEO-best-practices,
          doet concrete aanbevelingen, en herschrijft met strikte eindredactie.
        </p>
      </div>
      <Wizard />
    </div>
  );
}
