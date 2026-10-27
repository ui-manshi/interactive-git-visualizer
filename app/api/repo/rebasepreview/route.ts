import { NextRequest, NextResponse } from "next/server";
import { rebasePreview } from "@/lib/replay";
import { resolveRepoPath } from "@/lib/repoResolver";

/** GET /api/repo/rebasepreview?path=<repo>&onto=<hash>&head=<hash> : simulate rebasing head onto onto. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const repoPath = sp.get("path");
  const onto = sp.get("onto");
  const head = sp.get("head");
  if (!repoPath || !onto || !head) {
    return NextResponse.json({ error: "Missing required query params: path, onto, head" }, { status: 400 });
  }
  try {
    return NextResponse.json(rebasePreview(resolveRepoPath(repoPath), onto, head));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
