import { NextRequest, NextResponse } from "next/server";
import { listBranchRefs, listTagRefs, readHead } from "@/lib/gitObjectParser";
import { readCommit } from "@/lib/objectCache";
import { resolveRepoPath } from "@/lib/repoResolver";

/**
 * GET /api/repo/refs?path=/absolute/path/to/repo  OR  ?path=https://github.com/user/repo
 * Returns branch refs and tags, with the commit hash each points to.
 */
export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("path");

  if (!repoPath) {
    return NextResponse.json(
      { error: "Missing required query param: path" },
      { status: 400 }
    );
  }

  try {
    const resolvedPath = resolveRepoPath(repoPath);
    const refs = listBranchRefs(resolvedPath);
    // Newest tag first, so release markers read like a changelog.
    const tags = listTagRefs(resolvedPath)
      .map((t) => ({ ...t, timestamp: readCommit(resolvedPath, t.hash).author.timestamp }))
      .sort((a, b) => b.timestamp - a.timestamp);
    return NextResponse.json({ refs, tags, head: readHead(resolvedPath) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
