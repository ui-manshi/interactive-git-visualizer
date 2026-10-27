import { NextRequest, NextResponse } from "next/server";
import { diffCommits, diffFile } from "@/lib/commitDiff";
import { resolveRepoPath } from "@/lib/repoResolver";

/**
 * GET /api/repo/diff?path=<repo>&from=<hash|empty>&to=<hash>[&file=<path>]
 *
 *  - without `file`: summary of every changed file (status, +/- counts)
 *  - with `file`:    full line-by-line hunks for that one file
 *
 * An empty `from` diffs against the empty tree (used for root commits).
 */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const repoPath = p.get("path");
  const from = p.get("from") || null;
  const to = p.get("to");
  const file = p.get("file");

  if (!repoPath || !to) {
    return NextResponse.json({ error: "Missing required query params: path, to" }, { status: 400 });
  }

  try {
    const resolved = resolveRepoPath(repoPath);
    if (file) {
      return NextResponse.json(diffFile(resolved, from, to, file));
    }
    return NextResponse.json(diffCommits(resolved, from, to));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
