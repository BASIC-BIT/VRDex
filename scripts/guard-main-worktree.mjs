import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const isTruthyEnv = (value) => {
  if (!value) return false;
  return !["0", "false", "no"].includes(value.toLowerCase());
};

if (
  isTruthyEnv(process.env.CI) ||
  isTruthyEnv(process.env.GITHUB_ACTIONS) ||
  isTruthyEnv(process.env.VERCEL)
) {
  process.exit(0);
}

if (process.env.VRDEX_ALLOW_PROTECTED_WORKTREE === "1") {
  console.warn(
    "[guard] Protected-main guard bypassed via VRDEX_ALLOW_PROTECTED_WORKTREE=1.",
  );
  process.exit(0);
}

const runGit = (args) =>
  execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

let branchName = "";

try {
  branchName = runGit(["branch", "--show-current"]);
} catch {
  process.exit(0);
}

if (branchName !== "main") {
  process.exit(0);
}

const lifecycleEvent = process.env.npm_lifecycle_event ?? "local workflow";
const currentDir = process.cwd();

console.error(`Protected main worktree guard blocked \`${lifecycleEvent}\`.`);
console.error(`Current branch: ${branchName}`);
console.error(`Working directory: ${currentDir}`);
console.error("");
console.error("VRDex keeps the local main checkout as a clean mirror.");
console.error("Create a feature worktree under D:/bench/VRDex-wt instead:");
console.error(
  "  git worktree add -b codex/<branch-name> D:/bench/VRDex-wt/<name> origin/main",
);
console.error("");
console.error(
  "If this is intentional mirror maintenance or an emergency on main, rerun with VRDEX_ALLOW_PROTECTED_WORKTREE=1.",
);

process.exit(1);
