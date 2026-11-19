// Bundles the server into one ESM file. Only the optional native keyring module stays external,
// so the bundle runs anywhere with Node >= 20.10 (the MCPB package ships it without node_modules).
import { build } from "esbuild";
import { chmodSync, readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const outfile = "dist/awardwallet-mcp.mjs";
const remoteOutfile = "dist/awardwallet-mcp-remote.mjs";

for (const [entry, out] of [
  ["src/index.ts", outfile],
  ["src/remote/node.ts", remoteOutfile],
]) {
  await build({
  entryPoints: [entry],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["@napi-rs/keyring"],
  legalComments: "none",
  // Some bundled CommonJS dependencies call require(); give them one.
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __awCreateRequire } from 'node:module';",
      "const require = __awCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "info",
  });
}
chmodSync(outfile, 0o755);
console.log(`Built ${outfile} and ${remoteOutfile} (v${pkg.version})`);
