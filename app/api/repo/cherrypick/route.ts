import { NextRequest, NextResponse } from "next/server";
import { cherryPickPreview } from "@/lib/replay";
import { resolveRepoPath } from "@/lib/repoResolver";

/** GET /api/repo/cherrypick?path=<repo>&commit=<hash>&onto=<hash> : simulate cherry-picking commit onto onto. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const repoPath = sp.get("path");
  const commit = sp.get("commit");
  const onto = sp.get("onto");
  if (!repoPath || !commit || !onto) {
    return NextResponse.json({ error: "Missing required query params: path, commit, onto" }, { status: 400 });
  }
  try {
    return NextResponse.json(cherryPickPreview(resolveRepoPath(repoPath), commit, onto));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 400 });
  }
}
