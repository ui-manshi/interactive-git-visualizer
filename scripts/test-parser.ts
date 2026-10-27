/**
 * Manual test harness for gitObjectParser.ts.
 * Run with: npm run test:parser -- <path-to-repo>
 */
import {
  parseObject,
  resolveRef,
  verifyObjectHash,
  listBranchRefs,
  ParsedCommit,
} from "../lib/gitObjectParser";

const repoPath = process.argv[2] || process.cwd();

console.log(`\n=== Testing Git object parser against: ${repoPath} ===\n`);
console.log("(Objects may be loose or packed — both are read transparently.)\n");

// 1. List branches
console.log("Branches found:");
for (const ref of listBranchRefs(repoPath)) {
  console.log(`  - ${ref.name} -> ${ref.hash}`);
}

// 2. Resolve HEAD of the default branch and walk commit history
const branches = listBranchRefs(repoPath);
const startHash = branches.length > 0 ? branches[0].hash : resolveRef(repoPath);

console.log(`\nWalking commit history from: ${startHash}\n`);

const visited = new Set<string>();
const queue: string[] = [startHash];
let commitCount = 0;
let mergeCount = 0;
let allHashesValid = true;

while (queue.length > 0) {
  const hash = queue.shift()!;
  if (visited.has(hash)) continue;
  visited.add(hash);

  const obj = parseObject(repoPath, hash) as ParsedCommit;
  if (obj.type !== "commit") continue;

  commitCount++;
  const isMerge = obj.parents.length > 1;
  if (isMerge) mergeCount++;

  const valid = verifyObjectHash(repoPath, hash);
  if (!valid) allHashesValid = false;

  console.log(
    `[${valid ? "OK" : "HASH MISMATCH"}] ${hash.slice(0, 7)} ${isMerge ? "(merge) " : ""}"${obj.message.split("\n")[0]}" ` +
      `by ${obj.author.name} | tree=${obj.tree.slice(0, 7)} | parents=${obj.parents.map((p) => p.slice(0, 7)).join(", ") || "none"}`
  );

  for (const parent of obj.parents) {
    queue.push(parent);
  }
}

// 3. Spot-check tree and blob parsing on the tip commit
const tip = parseObject(repoPath, startHash) as ParsedCommit;
const tree = parseObject(repoPath, tip.tree);
console.log(`\nTree at tip commit (${tip.tree.slice(0, 7)}):`);
if (tree.type === "tree") {
  for (const entry of tree.entries) {
    console.log(`  ${entry.isDirectory ? "dir " : "file"}  ${entry.mode}  ${entry.name}  -> ${entry.hash.slice(0, 7)}`);
  }
}

console.log(`\n=== Summary ===`);
console.log(`Commits parsed: ${commitCount}`);
console.log(`Merge commits detected: ${mergeCount}`);
console.log(`All SHA-1 hashes verified: ${allHashesValid ? "YES" : "NO"}`);
