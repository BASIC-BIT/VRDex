import { runLocalProof } from "./local";
import { parseProofArgs } from "../../../../scripts/media-relay-proof";
const raw = JSON.parse(process.argv[2] ?? "null");
const options = parseProofArgs(
  Object.entries(raw).flatMap(([k, v]) => [`--${k}`, String(v)]),
);
if (options.target !== "local") throw Error("Local proof only");
await runLocalProof(options);
