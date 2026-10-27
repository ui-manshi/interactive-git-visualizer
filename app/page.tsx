"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand, Toolbar } from "@/components/shell";

const EXAMPLE_REPOS = [
  { label: "octocat/Hello-World", url: "https://github.com/octocat/Hello-World" },
];

export default function HomePage() {
  const [repoPath, setRepoPath] = useState("");
  const router = useRouter();

  function open(path: string) {
    const trimmed = path.trim();
    if (!trimmed) return;
    router.push(`/visualizer?path=${encodeURIComponent(trimmed)}`);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    open(repoPath);
  }

  return (
    <div className="min-h-dvh flex flex-col bg-ground text-fg">
      <Toolbar>
        <Brand />
        <span className="flex-1" />
        <Link href="/simulator" className="btn-ghost h-8 px-2.5 rounded-md text-[13px] inline-flex items-center">
          Simulator
        </Link>
      </Toolbar>

      <main className="flex-1 px-4 sm:px-8 lg:px-16 py-12 sm:py-20">
        <div className="max-w-[40rem]">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight m-0">Open a Git repository</h1>
          <p className="text-[15px] text-muted leading-relaxed mt-4 mb-0 max-w-[52ch]">
            Follow every branch and merge, browse the files as they were at any commit, and compare any two commits line by
            line. Works with a local folder or a public GitHub URL.
          </p>

          <form onSubmit={handleSubmit} className="mt-8">
            <label htmlFor="repo" className="block text-sm font-medium mb-2">
              Repository path or GitHub URL
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="repo"
                type="text"
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                placeholder="/path/to/repo or https://github.com/user/repo"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                className="field flex-1 min-w-0 rounded-lg px-3.5 h-11 text-sm font-mono placeholder:text-faint"
              />
              <button
                type="submit"
                disabled={!repoPath.trim()}
                className="btn-primary rounded-lg text-sm px-5 h-11 whitespace-nowrap"
              >
                Open repository
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span>No repo handy? Try</span>
              {EXAMPLE_REPOS.map((r) => (
                <button
                  key={r.url}
                  type="button"
                  onClick={() => open(r.url)}
                  className="btn font-mono text-xs px-2.5 h-7 rounded-md hover:text-accent"
                >
                  {r.label}
                </button>
              ))}
            </div>
          </form>

          <div className="mt-12 pt-6 border-t border-line text-sm text-muted space-y-3">
            <p className="m-0">
              New to Git?{" "}
              <Link href="/simulator" className="text-accent hover:underline">
                Practise merge, rebase and cherry-pick in the simulator
              </Link>
              .
            </p>
            <p className="m-0 text-faint">
              Reads the repository&apos;s raw .git objects directly, without the Git command line.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
