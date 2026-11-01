import { gzipSync } from "zlib";
import { NextRequest, NextResponse } from "next/server";

/** Below this size the CPU cost of gzip is not worth the bytes saved. */
const MIN_BYTES = 2048;

/**
 * JSON response that is gzip-compressed when the browser accepts it. Route-handler responses were
 * going out uncompressed; a 500-commit graph is ~74 KB raw and ~12 KB gzipped, which is a large
 * part of the wait on a slow mobile connection.
 */
export function jsonResponse(request: NextRequest, data: unknown): NextResponse {
  const body = JSON.stringify(data);
  const accepts = /\bgzip\b/.test(request.headers.get("accept-encoding") ?? "");
  if (!accepts || body.length < MIN_BYTES) {
    return new NextResponse(body, { headers: { "Content-Type": "application/json" } });
  }
  return new NextResponse(gzipSync(body, { level: 6 }), {
    headers: {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
      Vary: "Accept-Encoding",
    },
  });
}
