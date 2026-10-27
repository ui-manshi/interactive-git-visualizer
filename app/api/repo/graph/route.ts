import { NextRequest, NextResponse } from "next/server";
import { buildCommitGraph } from "@/lib/graphBuilder";
import { resolveRepoPath } from "@/lib/repoResolver";

const MAX_COMMITS = 5000;

/**
 * GET /api/repo/graph?path=<local-path-or-repo-url>&max=500
 * Returns { nodes, edges, truncated } ready to feed straight into React Flow.
 */
export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("path");
  const maxParam = request.nextUrl.searchParams.get("max");

  if (!repoPath) {
    return NextResponse.json(
      { error: "Missing required query param: path" },
      { status: 400 }
    );
  }

  try {
    const resolvedPath = resolveRepoPath(repoPath);
    // Clamp so a crafted URL cannot ask for an unbounded layout.
    const parsed = maxParam ? parseInt(maxParam, 10) : NaN;
    const max = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_COMMITS) : undefined;
    const graph = buildCommitGraph(resolvedPath, max);
    return NextResponse.json(graph);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
