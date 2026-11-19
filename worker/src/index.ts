import { env } from "cloudflare:workers";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { GitHubHandler } from "./github-handler";
import { isAllowedLogin, type Props } from "./utils";

const SHARED_SECRET_HEADER = "x-proxy-secret";

// Forwards an authenticated MCP request to the server that holds the AwardWallet key. The client's
// bearer token stops here; the upstream only trusts the shared secret.
const apiHandler = {
	async fetch(request: Request, bindings: Env, ctx: ExecutionContext) {
		const props = ctx.props as Props | undefined;
		if (!props || !isAllowedLogin(props.login, bindings.ALLOWED_GITHUB_LOGIN)) {
			return new Response("Forbidden", { status: 403 });
		}

		const headers = new Headers(request.headers);
		headers.delete("authorization");
		headers.delete("cookie");
		headers.set(SHARED_SECRET_HEADER, bindings.PROXY_SHARED_SECRET);

		return fetch(bindings.UPSTREAM_MCP_URL, {
			body: request.body,
			headers,
			method: request.method,
			redirect: "manual",
		});
	},
} satisfies ExportedHandler<Env>;

export default new OAuthProvider<Env>({
	apiHandler,
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GitHubHandler as any,
	tokenEndpoint: "/token",
	resourceMetadata: { resource: env.MCP_RESOURCE },
});
