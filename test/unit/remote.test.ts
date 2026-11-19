import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRemoteSettings } from "../../src/remote/config.js";
import { createRemoteHandler, SHARED_SECRET_HEADER } from "../../src/remote/handler.js";

const SECRET = "test-shared-secret-0123456789abcdef";

describe("remote settings", () => {
  it("requires an API key outside demo mode", () => {
    expect(() => loadRemoteSettings({ PROXY_SHARED_SECRET: SECRET })).toThrow(/AW_API_KEY/);
  });

  it("requires a shared secret of at least 32 characters", () => {
    expect(() => loadRemoteSettings({ AW_API_KEY: "k" })).toThrow(/PROXY_SHARED_SECRET/);
    expect(() => loadRemoteSettings({ AW_API_KEY: "k", PROXY_SHARED_SECRET: "too-short" })).toThrow(/PROXY_SHARED_SECRET/);
  });

  it("rejects an invalid port", () => {
    expect(() => loadRemoteSettings({ AW_API_KEY: "k", PROXY_SHARED_SECRET: SECRET, PORT: "http" })).toThrow(/PORT/);
  });

  it("is read-only whatever the environment says", () => {
    const { config, port } = loadRemoteSettings({ AW_API_KEY: "k", PROXY_SHARED_SECRET: SECRET, AW_READ_ONLY: "false", AW_CONNECT_LINKS: "true" });
    expect(config.readOnly).toBe(true);
    expect(config.connectLinks).toBe(false);
    expect(config.credentials).toEqual({ accountAccess: "k" });
    expect(port).toBe(8080);
  });
});

describe("remote handler (demo mode)", () => {
  let httpServer: Server;
  let base: string;

  beforeAll(async () => {
    const settings = loadRemoteSettings({ AW_MOCK_MODE: "true", PROXY_SHARED_SECRET: SECRET });
    httpServer = createServer(createRemoteHandler(settings));
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
  });

  const initialize = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
  });
  const post = (headers: Record<string, string>) =>
    fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: initialize,
    });

  async function connect(): Promise<Client> {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { [SHARED_SECRET_HEADER]: SECRET } } }));
    return client;
  }

  it("answers the health check without the secret and without data", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("rejects /mcp without the shared secret", async () => {
    expect((await post({})).status).toBe(401);
  });

  it("rejects /mcp with a wrong shared secret", async () => {
    expect((await post({ [SHARED_SECRET_HEADER]: `${SECRET}x` })).status).toBe(401);
    expect((await post({ [SHARED_SECRET_HEADER]: SECRET.slice(0, -1) })).status).toBe(401);
  });

  it("allows only POST on /mcp", async () => {
    const res = await fetch(`${base}/mcp`, { headers: { [SHARED_SECRET_HEADER]: SECRET } });
    expect(res.status).toBe(405);
  });

  it("returns 404 elsewhere", async () => {
    expect((await fetch(`${base}/`, { headers: { [SHARED_SECRET_HEADER]: SECRET } })).status).toBe(404);
  });

  it("registers exactly the read tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "call_api_read_operation",
      "get_loyalty_account",
      "get_loyalty_program",
      "get_status",
      "get_travel_timeline",
      "list_loyalty_accounts",
      "list_people",
      "search_api_operations",
      "search_loyalty_programs",
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    await client.close();
  });

  it("answers a balance question over HTTP", async () => {
    const client = await connect();
    const result = (await client.callTool({ name: "list_loyalty_accounts", arguments: { program: "marriott" } })) as CallToolResult;
    const data = JSON.parse((result.content[0] as { text: string }).text);
    expect(data.accounts).toEqual([expect.objectContaining({ program: "Marriott Bonvoy", balance: "212,450" })]);
    await client.close();
  });
});
