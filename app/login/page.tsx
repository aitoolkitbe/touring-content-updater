"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginInner() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const next = params.get("next") || "/";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Login mislukt");
      }
      window.location.href = next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto mt-20 max-w-md rounded-lg border border-touring-border bg-white p-8 shadow-sm">
      <h2 className="text-xl font-semibold text-touring-blue">Inloggen</h2>
      <p className="mt-1 text-sm text-touring-muted">
        Voer het gedeelde wachtwoord in om de tool te gebruiken.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Wachtwoord"
          className="w-full rounded border border-touring-border px-3 py-2 text-sm focus:border-touring-blue focus:outline-none"
          autoFocus
        />
        {error && (
          <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full rounded bg-touring-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Even geduld..." : "Inloggen"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
