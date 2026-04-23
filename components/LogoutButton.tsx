"use client";

export function LogoutButton() {
  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.href = "/login";
  }
  return (
    <button
      onClick={handleLogout}
      className="text-xs text-touring-muted hover:text-touring-blue"
      type="button"
    >
      Uitloggen
    </button>
  );
}
