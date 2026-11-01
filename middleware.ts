import { NextRequest, NextResponse } from "next/server";

/**
 * Simple per-IP rate limit for the API (in memory, so per server instance, which is what a single
 * Render service is). Set RATE_LIMIT_PER_MIN=0 to turn it off. Opening one repository makes a
 * handful of requests, so the default leaves plenty of room for normal browsing.
 */
const WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; reset: number }>();

function limit(): number {
  const n = Number(process.env.RATE_LIMIT_PER_MIN);
  return process.env.RATE_LIMIT_PER_MIN !== undefined && process.env.RATE_LIMIT_PER_MIN !== "" && Number.isFinite(n) ? n : 300;
}

export function middleware(req: NextRequest) {
  const max = limit();
  if (max <= 0) return NextResponse.next();

  // Behind Render's proxy the client address is the first entry of x-forwarded-for.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const now = Date.now();

  if (hits.size > 5000) {
    hits.forEach((v, k) => {
      if (v.reset <= now) hits.delete(k);
    });
  }

  const entry = hits.get(ip);
  if (!entry || entry.reset <= now) {
    hits.set(ip, { count: 1, reset: now + WINDOW_MS });
    return NextResponse.next();
  }
  entry.count++;
  if (entry.count > max) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down and try again in a minute." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((entry.reset - now) / 1000)) } }
    );
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/repo/:path*" };
