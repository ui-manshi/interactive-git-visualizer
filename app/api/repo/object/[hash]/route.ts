import { NextRequest, NextResponse } from "next/server";
import { parseObject } from "@/lib/gitObjectParser";
import { resolveRepoPath } from "@/lib/repoResolver";

/**
 * GET /api/repo/object/:hash?path=<local-path-or-repo-url>
 * Returns the parsed type/size/content for a single Git object.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { hash: string } }
) {
  const repoPath = request.nextUrl.searchParams.get("path");
  const { hash } = params;

  if (!repoPath) {
    return NextResponse.json(
      { error: "Missing required query param: path" },
      { status: 400 }
    );
  }

  try {
    const resolvedPath = resolveRepoPath(repoPath);
    const obj = parseObject(resolvedPath, hash);

    // Blob content is a Buffer; make it JSON-safe.
    if (obj.type === "blob") {
      return NextResponse.json({
        ...obj,
        content: obj.content.toString("utf8"),
      });
    }

    return NextResponse.json(obj);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
