import { NextRequest, NextResponse } from "next/server";
import { mergePreview } from "@/lib/mergePreview";
import { resolveRepoPath } from "@/lib/repoResolver";

/** GET /api/repo/mergepreview?path=<repo>&base=<hash>&head=<hash> : simulate merging head into base. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const repoPath = sp.get("path");
  const base = sp.get("base");
  const head = sp.get("head");
  if (!repoPath || !base || !head) {
    return NextResponse.json({ error: "Missing required query params: path, base, head" }, { status: 400 });
  }
  try {
    return NextResponse.json(mergePreview(resolveRepoPath(repoPath), base, head));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
