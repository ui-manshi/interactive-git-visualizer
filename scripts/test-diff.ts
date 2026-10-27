/**
 * Randomized tests for lib/myersDiff.ts.
 * Run with: npm run test:diff
 *
 * For every random pair of line arrays we check:
 *   1. CORRECT  — replaying the ops over A reproduces B exactly.
 *   2. MINIMAL  — #inserts + #deletes equals the true minimum, computed
 *                 independently via an O(n*m) LCS dynamic program.
 *   3. NUMBERED — old/new line numbers are consistent and 1-based.
 *   4. HUNKS    — hunk line counts match the ops they contain.
 */
import { diffLines, buildHunks, diffStats } from "../lib/myersDiff";

function lcsLength(a: string[], b: string[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Small seeded PRNG so failures are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randomLines(rand: () => number, maxLen: number, alphabet: number): string[] {
  const len = Math.floor(rand() * (maxLen + 1));
  return Array.from({ length: len }, () => "L" + Math.floor(rand() * alphabet));
}

let cases = 0;
const rand = rng(12345);

for (let iter = 0; iter < 4000; iter++) {
  // Vary alphabet size: tiny alphabets create many repeated lines (hard cases).
  const alphabet = [2, 3, 5, 10, 50][iter % 5];
  const a = randomLines(rand, 40, alphabet);
  // Half the time derive B from A by mutation (realistic), else fully random.
  let b: string[];
  if (iter % 2 === 0) {
    b = a.slice();
    const edits = Math.floor(rand() * 6);
    for (let e = 0; e < edits; e++) {
      const pos = Math.floor(rand() * (b.length + 1));
      const r = rand();
      if (r < 0.4) b.splice(pos, 0, "N" + Math.floor(rand() * 100));
      else if (r < 0.8) b.splice(pos, 1);
      else if (pos < b.length) b[pos] = "M" + Math.floor(rand() * 100);
    }
  } else {
    b = randomLines(rand, 40, alphabet);
  }

  const { ops, approximate } = diffLines(a, b);
  if (approximate) throw new Error("unexpected approximate result on small input");

  // 1. CORRECT: rebuild B from A + ops, and A from ops alone.
  const rebuiltB: string[] = [];
  const rebuiltA: string[] = [];
  for (const op of ops) {
    if (op.type !== "delete") rebuiltB.push(op.text);
    if (op.type !== "insert") rebuiltA.push(op.text);
  }
  if (JSON.stringify(rebuiltB) !== JSON.stringify(b)) throw new Error(`B mismatch at iter ${iter}`);
  if (JSON.stringify(rebuiltA) !== JSON.stringify(a)) throw new Error(`A mismatch at iter ${iter}`);

  // 2. MINIMAL
  const { additions, deletions } = diffStats(ops);
  const optimal = a.length + b.length - 2 * lcsLength(a, b);
  if (additions + deletions !== optimal) {
    throw new Error(`Not minimal at iter ${iter}: got ${additions + deletions}, optimal ${optimal}`);
  }

  // 3. NUMBERED
  let oldNo = 0;
  let newNo = 0;
  for (const op of ops) {
    if (op.type !== "insert") {
      oldNo++;
      if (op.oldLine !== oldNo) throw new Error(`bad oldLine at iter ${iter}`);
    }
    if (op.type !== "delete") {
      newNo++;
      if (op.newLine !== newNo) throw new Error(`bad newLine at iter ${iter}`);
    }
  }

  // 4. HUNKS
  for (const h of buildHunks(ops, 3)) {
    const o = h.ops.filter((x) => x.type !== "insert").length;
    const n = h.ops.filter((x) => x.type !== "delete").length;
    if (o !== h.oldLines || n !== h.newLines) throw new Error(`hunk count mismatch at iter ${iter}`);
  }

  cases++;
}

// Edge cases
const e1 = diffLines([], []);
const e2 = diffLines([], ["a", "b"]);
const e3 = diffLines(["a", "b"], []);
const e4 = diffLines(["a"], ["a"]);
if (e1.ops.length !== 0 || e2.ops.length !== 2 || e3.ops.length !== 2 || buildHunks(e4.ops).length !== 0) {
  throw new Error("edge case failure");
}

// Large input: 20k lines with a few scattered edits must be fast and exact.
const big = Array.from({ length: 20000 }, (_, i) => `line ${i}`);
const bigB = big.slice();
bigB.splice(5000, 1);
bigB.splice(12000, 0, "inserted");
bigB[17000] = "changed";
const t0 = Date.now();
const bigDiff = diffLines(big, bigB);
const ms = Date.now() - t0;
const bs = diffStats(bigDiff.ops);
if (bs.additions !== 2 || bs.deletions !== 2) throw new Error("large diff stats wrong: " + JSON.stringify(bs));

// A huge pure addition must not blow memory/time (fast-path).
const t1 = Date.now();
const huge = diffLines([], Array.from({ length: 200000 }, (_, i) => "x" + i));
if (diffStats(huge.ops).additions !== 200000) throw new Error("huge add wrong");

// Fully-different large inputs exceed the edit cap -> approximate fallback, still correct.
const x = Array.from({ length: 6000 }, (_, i) => "a" + i);
const y = Array.from({ length: 6000 }, (_, i) => "b" + i);
const approx = diffLines(x, y);
if (!approx.approximate || diffStats(approx.ops).additions !== 6000) throw new Error("approx fallback wrong");

console.log(`PASS: ${cases} random cases (correct + provably minimal + numbered + hunks)`);
console.log(`PASS: edge cases (empty/identical/pure add/pure delete)`);
console.log(`PASS: 20,000-line file with 4 scattered edits diffed in ${ms}ms`);
console.log(`PASS: 200,000-line pure addition in ${Date.now() - t1}ms`);
console.log(`PASS: edit-distance cap falls back to a correct, flagged-approximate diff`);
