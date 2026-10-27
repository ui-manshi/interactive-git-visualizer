import { NextRequest, NextResponse } from "next/server";
import { readBlob, isBinary } from "@/lib/fileTree";
import { resolveRepoPath } from "@/lib/repoResolver";

const MAX_BYTES = 1024 * 1024; // don't ship more than 1 MB of text to the browser

/**
 * GET /api/repo/blob?path=<repo>&hash=<blob hash>
 * Returns a file's text content, or a binary flag (never raw binary bytes).
 */
export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("path");
  const hash = request.nextUrl.searchParams.get("hash");

  if (!repoPath || !hash) {
    return NextResponse.json({ error: "Missing required query params: path, hash" }, { status: 400 });
  }

  try {
    const buf = readBlob(resolveRepoPath(repoPath), hash);
    if (isBinary(buf)) {
      return NextResponse.json({ hash, size: buf.length, binary: true, truncated: false, content: "" });
    }
    const truncated = buf.length > MAX_BYTES;
    const content = (truncated ? buf.subarray(0, MAX_BYTES) : buf).toString("utf8");
    return NextResponse.json({ hash, size: buf.length, binary: false, truncated, content });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
