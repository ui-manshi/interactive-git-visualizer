import { NextRequest, NextResponse } from "next/server";
import { inspectObject } from "@/lib/gitObjectParser";
import { resolveRepoPath } from "@/lib/repoResolver";

/**
 * GET /api/repo/inspect/:hash?path=<local-path-or-repo-url>
 * Returns the raw view of one Git object: header, storage form, hex dump of the
 * bytes that get hashed, and a recomputed SHA-1 check.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { hash: string } }
) {
  const repoPath = request.nextUrl.searchParams.get("path");
  if (!repoPath) {
    return NextResponse.json({ error: "Missing required query param: path" }, { status: 400 });
  }

  try {
    const resolved = resolveRepoPath(repoPath);
    return NextResponse.json(inspectObject(resolved, params.hash));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
