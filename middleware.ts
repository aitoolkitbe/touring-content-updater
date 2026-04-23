import { NextResponse, type NextRequest } from "next/server";

/**
 * Simple password-protection via signed cookie.
 * Flow:
 *   1. User hits a protected path without auth cookie → redirect naar /login.
 *   2. /login POST met juist wachtwoord → zet `tcu_auth` cookie.
 *   3. Middleware checkt cookie op volgende requests.
 *
 * Deze middleware draait ook op Vercel Edge.
 */

const PUBLIC_PATHS = ["/login", "/api/auth"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Sta statische assets en de login-route altijd toe.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get("tcu_auth")?.value;
  const secret = process.env.AUTH_SECRET;

  if (!secret || !cookie || !(await verifyToken(cookie, secret))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

async function verifyToken(token: string, secret: string): Promise<boolean> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;

  const expected = await hmacHex(payload, secret);
  if (expected !== sig) return false;

  try {
    const decoded = JSON.parse(atob(payload));
    if (typeof decoded.exp !== "number") return false;
    if (decoded.exp < Date.now()) return false;
    return decoded.ok === true;
  } catch {
    return false;
  }
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
