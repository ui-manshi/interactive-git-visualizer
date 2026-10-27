import { NextRequest, NextResponse } from "next/server";
import { packStats, looseStats, objectDirsFor } from "@/lib/packParser";
import { resolveRepoPath } from "@/lib/repoResolver";

/** GET /api/repo/storage?path=<repo> : how the repository's objects are stored (loose vs packfiles). */
export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("path");
  if (!repoPath) {
    return NextResponse.json({ error: "Missing required query param: path" }, { status: 400 });
  }
  try {
    const resolved = resolveRepoPath(repoPath);
    return NextResponse.json({
      packs: packStats(resolved),
      loose: looseStats(resolved),
      alternates: objectDirsFor(resolved).slice(1),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
