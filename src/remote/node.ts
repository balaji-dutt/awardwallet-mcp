import { createServer } from "node:http";
import { VERSION } from "../server.js";
import { loadRemoteSettings } from "./config.js";
import { createRemoteHandler } from "./handler.js";

function main(): void {
  const settings = loadRemoteSettings();
  const httpServer = createServer(createRemoteHandler(settings));

  const shutdown = () => {
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  httpServer.listen(settings.port, "0.0.0.0", () => {
    console.error(
      `[awardwallet-mcp] v${VERSION} ready on http port ${settings.port} (${settings.config.mockMode ? "demo mode" : "live"}, read-only)`,
    );
  });
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
