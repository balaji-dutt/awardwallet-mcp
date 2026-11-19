import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAwardWalletServer } from "../server.js";
import type { RemoteSettings } from "./config.js";

export const SHARED_SECRET_HEADER = "x-proxy-secret";

const digest = (value: string) => createHash("sha256").update(value).digest();

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
}

const rpcError = (message: string) => ({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });

/**
 * Serves MCP over stateless Streamable HTTP at /mcp. This server does no user authentication of its
 * own: the only caller it accepts is the proxy that holds the shared secret.
 */
export function createRemoteHandler(settings: RemoteSettings): (req: IncomingMessage, res: ServerResponse) => void {
  const expected = digest(settings.sharedSecret);

  const authorized = (req: IncomingMessage) => {
    const given = req.headers[SHARED_SECRET_HEADER];
    return typeof given === "string" && timingSafeEqual(digest(given), expected);
  };

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Stateless mode: a server and transport per request, so concurrent requests can't share JSON-RPC ids.
    const { server } = createAwardWalletServer(settings.config);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  return (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    if (path === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      return;
    }
    if (path !== "/mcp") {
      sendJson(res, 404, rpcError("Not found."));
      return;
    }
    if (!authorized(req)) {
      sendJson(res, 401, rpcError("Unauthorized."));
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, rpcError("Method not allowed."), { allow: "POST" });
      return;
    }

    handleMcp(req, res).catch((error: unknown) => {
      console.error(`[awardwallet-mcp] request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) sendJson(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error." }, id: null });
      else res.end();
    });
  };
}
