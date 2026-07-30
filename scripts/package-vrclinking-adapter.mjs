// Package the VRCLinking proof adapter for AWS Lambda.
//
// Produces `artifacts/vrclinking-adapter.zip`, which the Terraform stack in
// `infra/terraform/vrclinking-adapter` uploads. The handler path baked into
// that stack is `workers/vrclinking-adapter/src/lambda.handler`, so the zip
// keeps the repository layout rather than flattening it.
//
// `npm ci`, not `npm install`: the checked-in lockfile pins the one runtime
// dependency, and `install` would re-resolve its caret range so two builds of
// the same source could ship different AWS SDK versions.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapterDir = path.join(repoRoot, "workers", "vrclinking-adapter");
const stageRoot = path.join(repoRoot, "artifacts", "vrclinking-adapter-stage");
const stagedAdapter = path.join(stageRoot, "workers", "vrclinking-adapter");
const outputZip = path.join(repoRoot, "artifacts", "vrclinking-adapter.zip");

function run(command, args, cwd, options = {}) {
  execFileSync(command, args, { cwd, stdio: "inherit", ...options });
}

rmSync(stageRoot, { force: true, recursive: true });
mkdirSync(stagedAdapter, { recursive: true });

// Sources and the manifest only. Tests would ship dev-time fixtures — including
// a capability key — into a deployed artifact.
for (const entry of ["package.json", "package-lock.json"]) {
  cpSync(path.join(adapterDir, entry), path.join(stagedAdapter, entry));
}

cpSync(path.join(adapterDir, "src"), path.join(stagedAdapter, "src"), {
  recursive: true,
  filter: (source) => !source.endsWith(".test.mjs"),
});

// On Windows npm is a `.cmd` shim, which needs a shell: the extensionless name
// does not resolve, and Node refuses to spawn `.cmd` directly.
run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], stagedAdapter, {
  shell: process.platform === "win32",
});

rmSync(outputZip, { force: true });

// `zip` on POSIX, Windows' bundled bsdtar otherwise. Both write the
// `workers/vrclinking-adapter/src/lambda.mjs` path the handler string names.
//
// Not PowerShell's Compress-Archive: on Windows PowerShell 5.1 it writes zip
// entries with backslash separators, so Lambda's Linux extraction produces one
// file literally named `workers\vrclinking-adapter\src\lambda.mjs` and the
// handler cannot be found.
if (process.platform === "win32") {
  run(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), [
    "--format",
    "zip",
    "-cf",
    outputZip,
    "workers",
  ], stageRoot);
} else {
  run("zip", ["-qr", outputZip, "."], stageRoot);
}

rmSync(stageRoot, { force: true, recursive: true });

process.stdout.write(`Packaged ${path.relative(repoRoot, outputZip)}\n`);
