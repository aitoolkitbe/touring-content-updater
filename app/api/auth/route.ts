import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/auth
 * Body: { password: string }
 * Zet een signed cookie "tcu_auth" geldig voor 7 dagen.
 *
 * De handtekening wordt door middleware.ts geverifieerd.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  const expected = process.env.APP_PASSWORD;
  const secret = process.env.AUTH_SECRET;

  if (!expected) {
    return NextResponse.json(
      { error: "APP_PASSWORD niet ingesteld op de server." },
      { status: 500 }
    );
  }
  if (!secret) {
    return NextResponse.json(
      { error: "AUTH_SECRET niet ingesteld op de server." },
      { status: 500 }
    );
  }

  if (!body.password || body.password !== expected) {
    return NextResponse.json(
      { error: "Fout wachtwoord." },
      { status: 401 }
    );
  }

  const expMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = btoa(JSON.stringify({ ok: true, exp: expMs }));
  const sig = await hmacHex(payload, secret);
  const token = `${payload}.${sig}`;

  const res = NextResponse.json({ ok: true });
  res.cookies.set("tcu_auth", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return res;
}

/**
 * DELETE /api/auth — uitloggen.
 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("tcu_auth");
  return res;
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
