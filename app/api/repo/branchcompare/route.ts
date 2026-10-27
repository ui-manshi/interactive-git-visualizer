import { NextRequest, NextResponse } from "next/server";
import { compareBranches } from "@/lib/branchCompare";
import { resolveRepoPath } from "@/lib/repoResolver";

/** GET /api/repo/branchcompare?path=<repo>&base=<commit hash>&head=<commit hash> */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const repoPath = sp.get("path");
  const base = sp.get("base");
  const head = sp.get("head");
  if (!repoPath || !base || !head) {
    return NextResponse.json({ error: "Missing required query params: path, base, head" }, { status: 400 });
  }
  try {
    return NextResponse.json(compareBranches(resolveRepoPath(repoPath), base, head));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
