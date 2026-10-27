"use client";

import { useEffect, useState } from "react";

interface HexRow {
  offset: number;
  hex: string;
  ascii: string;
}

interface TreeEntry {
  mode: string;
  name: string;
  hash: string;
  isDirectory: boolean;
}

interface PackStep {
  hash: string | null;
  offset: number;
  entryType: "commit" | "tree" | "blob" | "tag" | "ofs_delta" | "ref_delta";
  storedBytes: number | null;
}

interface PackInfo {
  packFile: string;
  offset: number;
  entryType: PackStep["entryType"];
  inflatedSize: number;
  storedBytes: number | null;
  chain: PackStep[];
  depth: number;
  truncated: boolean;
}

interface Inspection {
  hash: string;
  type: "blob" | "tree" | "commit" | "tag";
  size: number;
  storage: "loose" | "packed";
  storedBytes: number | null;
  pack: PackInfo | null;
  header: string;
  hexRows: HexRow[];
  hexBytesShown: number;
  hexTotalBytes: number;
  recomputedHash: string;
  verified: boolean;
  text: string | null;
  textTruncated: boolean;
  entries: TreeEntry[] | null;
  tree: string | null;
  parents: string[] | null;
}

interface Props {
  repoPath: string;
  /** The object to start from (the selected commit). */
  rootHash: string;
}

const linkBtn = "font-mono text-xs text-accent hover:underline text-left break-all";

export default function ObjectInspector({ repoPath, rootHash }: Props) {
  // Clicking a tree, parent or blob hash walks deeper; `stack` lets you step back.
  const [stack, setStack] = useState<string[]>([rootHash]);
  const [data, setData] = useState<Inspection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStack([rootHash]);
  }, [rootHash]);

  const current = stack[stack.length - 1];

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/repo/inspect/${current}?path=${encodeURIComponent(repoPath)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [current, repoPath]);

  const open = (hash: string) => setStack((s) => [...s, hash]);

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setStack((s) => s.slice(0, -1))}
          disabled={stack.length < 2}
          className="text-xs px-2.5 py-1 rounded-md btn text-fg disabled:opacity-40"
        >
          ← Back
        </button>
        <span className="text-xs text-muted">
          Object {stack.length > 1 ? `${stack.length} levels deep` : "(the commit itself)"}
        </span>
        {stack.length > 1 && (
          <button onClick={() => setStack([rootHash])} className="text-xs text-accent hover:underline ml-auto">
            Back to commit
          </button>
        )}
      </div>

      {error && <p className="text-del">{error}</p>}
      {!data && !error && <p className="text-muted">Reading object…</p>}

      {data && (
        <>
          <p className="font-mono text-xs break-all text-fg">{data.hash}</p>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 m-0">
            <Item label="Type">{data.type}</Item>
            <Item label="Payload size">{data.size.toLocaleString()} bytes</Item>
            <Item label="Storage">
              {data.storage === "loose"
                ? `Loose file, ${data.storedBytes?.toLocaleString()} bytes zlib-compressed`
                : "Inside a packfile"}
            </Item>
            <Item label="SHA-1 check">
              {data.verified ? (
                <span className="text-add">Recomputed hash matches</span>
              ) : (
                <span className="text-del">Mismatch: {data.recomputedHash}</span>
              )}
            </Item>
          </dl>

          {data.pack && <PackSection pack={data.pack} size={data.size} onOpen={open} />}

          <section className="rounded-lg inset p-3">
            <p className="text-xs text-muted mb-1.5">How this ID is made</p>
            <p className="font-mono text-xs leading-relaxed m-0 break-words">
              sha1(<span className="text-accent">&quot;{data.header}&quot;</span> + <span className="text-warn">NUL</span> +{" "}
              <span className="text-fg">{data.type} content</span>)
            </p>
            <p className="text-2xs text-muted mt-1.5 m-0">
              Git hashes the header and the content together, so the same content always gets the same ID.
            </p>
          </section>

          {data.type === "commit" && (
            <section className="space-y-2">
              <p className="text-xs text-muted">Links to other objects</p>
              {data.tree && (
                <div>
                  <span className="text-xs text-muted">tree </span>
                  <button className={linkBtn} onClick={() => open(data.tree!)}>
                    {data.tree}
                  </button>
                </div>
              )}
              {data.parents?.map((p) => (
                <div key={p}>
                  <span className="text-xs text-muted">parent </span>
                  <button className={linkBtn} onClick={() => open(p)}>
                    {p}
                  </button>
                </div>
              ))}
              {data.parents?.length === 0 && <p className="text-xs text-muted m-0">No parent: this is a root commit.</p>}
            </section>
          )}

          {data.type === "tree" && data.entries && (
            <section>
              <p className="text-xs text-muted mb-1.5">{data.entries.length} entries</p>
              <div className="rounded-lg inset overflow-hidden">
                <table className="w-full text-xs font-mono border-collapse">
                  <tbody>
                    {data.entries.map((e) => (
                      <tr key={e.name} className="border-b border-line last:border-b-0">
                        <td className="px-2 py-1.5 text-faint w-14">{e.mode}</td>
                        <td className="px-2 py-1.5 text-fg break-all">
                          {e.name}
                          {e.isDirectory ? "/" : ""}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <button className={linkBtn} onClick={() => open(e.hash)} title={e.hash}>
                            {e.hash.slice(0, 10)}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {data.type !== "tree" && (
            <section>
              <p className="text-xs text-muted mb-1.5">
                {data.type === "blob" ? "File content" : "Decoded content"}
              </p>
              {data.text !== null ? (
                <pre className="m-0 rounded-lg code-surface p-3 text-xs font-mono text-fg whitespace-pre-wrap break-words max-h-64 overflow-auto">
                  {data.text}
                  {data.textTruncated && "\n… (truncated)"}
                </pre>
              ) : (
                <p className="text-xs text-muted m-0">Binary content, so there is no text preview.</p>
              )}
            </section>
          )}

          <section>
            <p className="text-xs text-muted mb-1.5">
              Raw bytes that get hashed (first {data.hexBytesShown} of {data.hexTotalBytes.toLocaleString()})
            </p>
            <div className="rounded-lg code-surface p-3 overflow-x-auto">
              <table className="text-2xs font-mono border-collapse">
                <tbody>
                  {data.hexRows.map((r) => (
                    <tr key={r.offset}>
                      <td className="pr-3 text-faint select-none">{r.offset.toString(16).padStart(4, "0")}</td>
                      <td className="pr-4 text-fg whitespace-pre">{r.hex.padEnd(47, " ")}</td>
                      <td className="text-accent whitespace-pre">{r.ascii}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-2xs text-muted mt-1.5 m-0">
              The header is followed by a zero byte (00), then the content.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted mb-0.5">{label}</dt>
      <dd className="m-0 text-fg break-words">{children}</dd>
    </div>
  );
}

const ENTRY_LABEL: Record<PackStep["entryType"], string> = {
  commit: "stored whole (commit)",
  tree: "stored whole (tree)",
  blob: "stored whole (blob)",
  tag: "stored whole (tag)",
  ofs_delta: "delta (OFS_DELTA)",
  ref_delta: "delta (REF_DELTA)",
};

function PackSection({ pack, size, onOpen }: { pack: PackInfo; size: number; onOpen: (hash: string) => void }) {
  const isDelta = pack.entryType === "ofs_delta" || pack.entryType === "ref_delta";
  const saved = pack.storedBytes !== null && size > 0 ? Math.round((1 - pack.storedBytes / size) * 100) : null;

  return (
    <section className="rounded-lg inset p-3 space-y-2">
      <p className="text-xs text-muted m-0">Where it lives in the packfile</p>
      <p className="font-mono text-xs m-0 break-all">
        {pack.packFile} <span className="text-muted">at byte</span> {pack.offset.toLocaleString()}
      </p>
      <p className="text-xs text-fg/90 m-0 leading-relaxed">
        {isDelta
          ? `Stored as a delta: only the differences from another object are kept, ${pack.storedBytes?.toLocaleString() ?? "?"} bytes on disk for a ${size.toLocaleString()}-byte object${saved !== null && saved > 0 ? ` (${saved}% smaller)` : ""}. Git rebuilds it by applying ${pack.depth} delta${pack.depth === 1 ? "" : "s"} to a full object.`
          : `Stored whole, ${pack.storedBytes?.toLocaleString() ?? "?"} bytes compressed.`}
      </p>

      {isDelta && (
        <ol className="m-0 p-0 list-none text-2xs font-mono space-y-1">
          {pack.chain.map((step, i) => {
            const last = i === pack.chain.length - 1;
            return (
              <li key={`${step.offset}-${i}`} className="flex items-center gap-2" style={{ paddingLeft: Math.min(i, 8) * 8 }}>
                <span className="text-faint">{i === 0 ? "this object" : last ? "base" : "via"}</span>
                <span className={last ? "text-add" : "text-warn"}>{ENTRY_LABEL[step.entryType]}</span>
                {step.hash ? (
                  <button className="text-accent hover:underline" onClick={() => onOpen(step.hash!)} title={step.hash}>
                    {step.hash.slice(0, 8)}
                  </button>
                ) : (
                  <span className="text-faint">byte {step.offset}</span>
                )}
                {step.storedBytes !== null && <span className="text-muted">{step.storedBytes} B</span>}
              </li>
            );
          })}
        </ol>
      )}
      {pack.truncated && <p className="text-2xs text-warn m-0">A delta base could not be found in any pack.</p>}
    </section>
  );
}
