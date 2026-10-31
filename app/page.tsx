"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand, Toolbar } from "@/components/shell";
import { BRANCH_PALETTE } from "@/components/branchColors";

const EXAMPLE_REPO = { label: "octocat/Hello-World", url: "https://github.com/octocat/Hello-World" };

export default function HomePage() {
  const [repoPath, setRepoPath] = useState("");
  const [opening, setOpening] = useState(false);
  const router = useRouter();

  // Coming back with the browser's back button can restore this page from the bfcache
  // with the "opening" state still set.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && setOpening(false);
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  function open(path: string) {
    const trimmed = path.trim();
    if (!trimmed || opening) return;
    setOpening(true);
    router.push(`/visualizer?path=${encodeURIComponent(trimmed)}`);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    open(repoPath);
  }

  return (
    // App-shell layout: the navbar keeps its own row and the page content scrolls inside <main>.
    <div className="h-dvh flex flex-col bg-ground text-fg">
      <Toolbar>
        <Brand />
        <span className="flex-1" />
        <Link href="/simulator" className="btn-ghost h-8 px-2.5 rounded-md text-body inline-flex items-center">
          Simulator
        </Link>
      </Toolbar>

      <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto w-full max-w-[70rem] px-4 sm:px-8 min-h-full flex items-center">
          <section className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-10 lg:gap-12 items-center w-full pt-10 pb-12 sm:pt-14 lg:pt-10 lg:pb-24">
            {/* Left: repository opener */}
            <div className="w-full max-w-[36rem]">
              <p className="m-0 mb-3 font-mono text-caption tracking-[0.14em] text-faint">GIT HISTORY, MADE VISIBLE</p>
              <h1 className="m-0 text-[30px] sm:text-[36px] lg:text-[40px] leading-[1.12] font-semibold tracking-[-0.03em] text-balance">
                Understand every commit.
              </h1>
              <p className="text-[15px] text-muted leading-relaxed mt-4 mb-0 max-w-[46ch]">
                Explore branches, follow merges, and inspect your repository&apos;s history.
              </p>

              <form onSubmit={handleSubmit} className="mt-8" aria-busy={opening}>
                <label htmlFor="repo" className="block text-body text-muted mb-2">
                  Repository path or GitHub URL
                </label>
                <div className="field rounded-lg p-1 flex flex-col sm:flex-row gap-1 sm:h-14">
                  <input
                    id="repo"
                    type="text"
                    value={repoPath}
                    onChange={(e) => setRepoPath(e.target.value)}
                    placeholder="/path/to/repo or https://github.com/user/repo"
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    className="w-full flex-none sm:w-auto sm:flex-1 min-w-0 h-12 px-3 rounded-md bg-transparent text-body font-mono text-fg placeholder:text-faint focus-visible:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!repoPath.trim() || opening}
                    className="btn-primary disabled:opacity-60 rounded-md text-body px-5 h-12 whitespace-nowrap inline-flex items-center justify-center gap-2"
                  >
                    {opening && (
                      <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                        <circle cx="7" cy="7" r="5.25" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
                        <path d="M12.25 7A5.25 5.25 0 0 0 7 1.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    )}
                    {opening ? "Opening…" : "Open repository"}
                  </button>
                </div>
                <p role="status" className="sr-only">
                  {opening ? "Opening repository" : ""}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-body">
                  <button
                    type="button"
                    disabled={opening}
                    onClick={() => open(EXAMPLE_REPO.url)}
                    className="text-muted hover:text-fg rounded transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    Open sample repository <span className="font-mono text-caption text-faint">{EXAMPLE_REPO.label}</span>
                  </button>
                  <Link href="/simulator" className="text-muted hover:text-fg rounded transition-colors">
                    Practise in the simulator
                  </Link>
                </div>

                <p className="mt-5 mb-0 text-caption text-faint leading-relaxed max-w-[52ch]">
                  Reads repository Git objects directly rather than running Git commands. GitHub repositories are cloned into
                  a temporary cache first.
                </p>
              </form>
            </div>

            {/* Right: static GitHub mark */}
            <div className="min-w-0 flex flex-col items-center text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/github-mark.svg"
                alt="GitHub Octocat logo"
                width={250}
                height={250}
                className="block w-[160px] sm:w-[200px] lg:w-[250px] h-auto aspect-square"
              />
              <p className="m-0 mt-7 text-title text-fg">Your code. Your history.</p>
              <p className="m-0 mt-1 text-caption text-faint tracking-wide">Branches · Commits · Merges</p>
              <MiniGraph />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

/* Decorative only: a tiny static motif (main branch, one feature branch, one merge). Not repository data. */
function MiniGraph() {
  const main = BRANCH_PALETTE[0];
  const feature = BRANCH_PALETTE[1];
  const dot = (cx: number, cy: number, c: string) => (
    <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.5" fill={c} stroke="rgb(var(--ground))" strokeWidth="2" />
  );
  return (
    <svg viewBox="0 0 200 44" className="block mt-6 w-[160px] sm:w-[180px] h-auto" fill="none" strokeLinecap="round" aria-hidden>
      <path d="M6 12H194" stroke={main} strokeWidth="1.75" opacity="0.8" />
      <path d="M52 12C64 12 64 32 78 32H122C136 32 136 12 148 12" stroke={feature} strokeWidth="1.75" opacity="0.8" />
      {[dot(24, 12, main), dot(52, 12, main), dot(148, 12, main), dot(176, 12, main), dot(88, 32, feature), dot(112, 32, feature)]}
    </svg>
  );
}
