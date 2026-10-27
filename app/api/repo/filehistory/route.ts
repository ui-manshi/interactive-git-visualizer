import { NextRequest, NextResponse } from "next/server";
import { fileHistory } from "@/lib/fileInsights";
import { resolveRepoPath } from "@/lib/repoResolver";

/** GET /api/repo/filehistory?path=<repo>&commit=<hash>&file=<path in repo> */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const repoPath = sp.get("path");
  const commit = sp.get("commit");
  const file = sp.get("file");
  if (!repoPath || !commit || !file) {
    return NextResponse.json({ error: "Missing required query params: path, commit, file" }, { status: 400 });
  }
  try {
    return NextResponse.json(fileHistory(resolveRepoPath(repoPath), commit, file));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
