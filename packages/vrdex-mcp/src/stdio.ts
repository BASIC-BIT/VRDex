import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { buildVrdexMcpServer } from "./server";
import { loadVrdexMcpConfig } from "./config";

function main() {
  const config = loadVrdexMcpConfig();

  serveStdio(() => buildVrdexMcpServer({ config }), {
    onerror(error) {
      console.error(`[vrdex-mcp] ${error.message}`);
    },
  });
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown startup error.";

  console.error(`[vrdex-mcp] ${message}`);
  process.exit(1);
}
