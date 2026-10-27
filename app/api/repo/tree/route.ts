import { NextRequest, NextResponse } from "next/server";
import { listFilesAtCommit } from "@/lib/fileTree";
import { resolveRepoPath } from "@/lib/repoResolver";

/**
 * GET /api/repo/tree?path=<repo>&commit=<hash>
 * Returns every file in the repository as of that commit.
 */
export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("path");
  const commit = request.nextUrl.searchParams.get("commit");

  if (!repoPath || !commit) {
    return NextResponse.json({ error: "Missing required query params: path, commit" }, { status: 400 });
  }

  try {
    const { files, truncated } = listFilesAtCommit(resolveRepoPath(repoPath), commit);
    return NextResponse.json({ commit, files, truncated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
