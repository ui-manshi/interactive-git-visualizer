import { NextResponse } from "next/server";

/** GET /api/health: used by the hosting platform to check the server is up. */
export function GET() {
  return NextResponse.json({ ok: true });
}
