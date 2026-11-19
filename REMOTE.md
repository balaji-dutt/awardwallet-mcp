# Hosted, read-only deployment

This fork adds a way to reach the server from Claude.ai on the web and mobile, which only accept
remote MCP servers.

```
Claude.ai --OAuth bearer--> Cloudflare Worker --shared secret--> fly.io app --X-Authentication--> AwardWallet
```

- **fly.io app** (`src/remote/`, `Dockerfile`, `fly.toml`): the MCP server over stateless Streamable
  HTTP at `/mcp`. Always read-only. It accepts only requests carrying `PROXY_SHARED_SECRET` in the
  `x-proxy-secret` header. It runs on fly.io because AwardWallet only answers API calls from the IP
  addresses listed in the Business API settings, and an empty list denies everything; fly.io can
  allocate a static egress address.
- **Cloudflare Worker** (`worker/`): the OAuth authorization server Claude talks to. Sign-in is
  through GitHub and only the login in `ALLOWED_GITHUB_LOGIN` is accepted. It forwards
  authenticated requests to the fly.io app and never calls AwardWallet itself.

Neither part can refresh a balance: the Account Access API has no such endpoint. Results show
AwardWallet's last update of each account.

## 1. fly.io app

Pick an app name and a region, then from the repository root:

```sh
fly launch --no-deploy --copy-config --name <app> --region <region>
fly secrets set --stage AW_API_KEY=<key> PROXY_SHARED_SECRET=<at least 32 random characters>
fly deploy
fly ips allocate-egress --app <app> -r <region>
fly ips list --app <app>
```

Add the egress IPv4 and IPv6 addresses to the allowed list at
<https://business.awardwallet.com/profile/api>.

Check it, once. Repeated authentication failures make AwardWallet lock out the calling address.

```sh
curl -s https://<app>.fly.dev/mcp \
  -H "x-proxy-secret: <secret>" -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_status","arguments":{}}}'
```

`businessAccount` in the result lists counts when the key and the allowlist are right, and an
`error` otherwise. Without the header the same request returns 401.

## 2. Cloudflare Worker

```sh
cd worker
npm install
npx wrangler kv namespace create OAUTH_KV
```

In `worker/wrangler.jsonc` set the KV namespace id and the three `vars`:

- `MCP_RESOURCE`: `https://<worker-host>/mcp`. It must equal the URL entered in Claude exactly.
- `UPSTREAM_MCP_URL`: `https://<app>.fly.dev/mcp`
- `ALLOWED_GITHUB_LOGIN`: the one GitHub login allowed to sign in.

Create a GitHub OAuth app (Settings → Developer settings → OAuth Apps) with homepage
`https://<worker-host>` and callback `https://<worker-host>/callback`, then:

```sh
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY
npx wrangler secret put PROXY_SHARED_SECRET
npx wrangler deploy
```

`COOKIE_ENCRYPTION_KEY` is any 32 random bytes in hex. `PROXY_SHARED_SECRET` is the same value the
fly.io app has.

## 3. Claude

Settings → Connectors → Add custom connector, URL `https://<worker-host>/mcp`. Sign in with the
allowed GitHub account. Any other account gets a 403 at the callback.

## Removing it

Remove the connector in Claude, `npx wrangler delete` in `worker/`, `fly apps destroy <app>`,
`fly ips release-egress <address>`, delete the GitHub OAuth app, and clear the AwardWallet
allowlist. Rotating the AwardWallet API key invalidates anything left behind.

## Third-party code

`worker/src/workers-oauth-utils.ts` is copied unchanged, and `worker/src/github-handler.ts` and
`worker/src/utils.ts` are adapted, from Cloudflare's `remote-mcp-github-oauth` demo
(<https://github.com/cloudflare/ai>), MIT License, Copyright (c) 2025 Cloudflare, Inc.
