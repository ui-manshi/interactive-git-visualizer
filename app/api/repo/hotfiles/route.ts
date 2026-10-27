import { NextRequest, NextResponse } from "next/server";
import { hotFiles } from "@/lib/hotFiles";
import { resolveRepoPath } from "@/lib/repoResolver";

/** GET /api/repo/hotfiles?path=<repo> : files changed by the most recent commits. */
export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("path");
  if (!repoPath) {
    return NextResponse.json({ error: "Missing required query param: path" }, { status: 400 });
  }
  try {
    return NextResponse.json(hotFiles(resolveRepoPath(repoPath)));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
