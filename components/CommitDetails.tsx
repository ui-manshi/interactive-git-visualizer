"use client";

import { ReactNode, useState } from "react";

/** Compact icon-only copy action. Quiet until hovered, so metadata does not read as a row of buttons. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          })
          .catch(() => {});
      }}
      className="flex-none w-6 h-6 rounded inline-flex items-center justify-center text-faint hover:text-fg hover:bg-raised"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="rgb(var(--accent))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m3.5 8.5 3 3 6-7" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 5.5v-1a1.5 1.5 0 0 0-1.5-1.5H4.5A1.5 1.5 0 0 0 3 4.5V9a1.5 1.5 0 0 0 1.5 1.5h1" />
        </svg>
      )}
    </button>
  );
}

/** Label/value grid. The value column can shrink, so long emails, hashes and paths wrap instead of clipping. */
export function MetaGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-body m-0">{children}</dl>;
}

export function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-faint pt-px">{label}</dt>
      <dd className="m-0 min-w-0 text-fg break-words">{children}</dd>
    </>
  );
}

/** Full hash in monospace with a trailing copy action. */
export function HashValue({ value, copyLabel = "Copy full hash" }: { value: string; copyLabel?: string }) {
  return (
    <span className="flex items-start gap-1 min-w-0">
      <span className="font-mono text-body leading-5 break-all min-w-0 select-all">{value}</span>
      <CopyButton text={value} label={copyLabel} />
    </span>
  );
}
