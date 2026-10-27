import { NextRequest, NextResponse } from "next/server";
import { verifyObjectHash } from "@/lib/gitObjectParser";
import { resolveRepoPath } from "@/lib/repoResolver";

/**
 * GET /api/repo/verify/:hash?path=<local-path-or-repo-url>
 * Recomputes the SHA-1 hash of the object and confirms it matches
 * the requested hash. Used for debugging/testing the parser.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { hash: string } }
) {
  const repoPath = request.nextUrl.searchParams.get("path");
  const { hash } = params;

  if (!repoPath) {
    return NextResponse.json(
      { error: "Missing required query param: path" },
      { status: 400 }
    );
  }

  try {
    const resolvedPath = resolveRepoPath(repoPath);
    const valid = verifyObjectHash(resolvedPath, hash);
    return NextResponse.json({ hash, valid });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
