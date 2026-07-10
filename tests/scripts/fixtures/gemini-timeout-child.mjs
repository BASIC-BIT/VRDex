import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
  windowsHide: true,
});
const pidFile = process.argv[2];

if (pidFile !== undefined) {
  writeFileSync(pidFile, JSON.stringify({ parent: process.pid, grandchild: grandchild.pid }));
}

setInterval(() => {}, 1_000);
