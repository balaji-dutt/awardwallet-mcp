import type { AppConfig } from "../config.js";

export const MIN_SHARED_SECRET_LENGTH = 32;
const DEFAULT_PORT = 8080;

export interface RemoteSettings {
  config: AppConfig;
  /** Value the fronting proxy must send in the shared-secret header on every /mcp request. */
  sharedSecret: string;
  port: number;
}

const flag = (value: string | undefined) => /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
const text = (value: string | undefined) => value?.trim() || undefined;

/**
 * Settings for the hosted server. Credentials come only from the environment, and the server is
 * always read-only: the write and setup tools need a page on the user's own computer.
 */
export function loadRemoteSettings(env: NodeJS.ProcessEnv = process.env): RemoteSettings {
  const mockMode = flag(env.AW_MOCK_MODE);
  const apiKey = text(env.AW_API_KEY);
  if (!mockMode && !apiKey) throw new Error("AW_API_KEY is not set.");

  const sharedSecret = text(env.PROXY_SHARED_SECRET);
  if (!sharedSecret || sharedSecret.length < MIN_SHARED_SECRET_LENGTH) {
    throw new Error(`PROXY_SHARED_SECRET must be set to at least ${MIN_SHARED_SECRET_LENGTH} characters.`);
  }

  const port = Number(text(env.PORT) ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535.");

  return {
    config: {
      mockMode,
      readOnly: true,
      connectLinks: false,
      emailRegion: "us",
      credentials: { accountAccess: mockMode ? "demo" : apiKey },
      credentialSources: { accountAccess: mockMode ? "demo" : "environment" },
      settingsFile: "",
      secureInput: { port: 0 },
    },
    sharedSecret,
    port,
  };
}
