// Shared helper for routing the browser (and curl) through an HTTP(S) proxy
// exposed via the AGENT_HTTPS_PROXY env var.
//
// AGENT_HTTPS_PROXY is expected to be a proxy URL. Set it through your local
// environment-specific builder; these scripts only read it.

export function getProxyConfig() {
	const raw = process.env.AGENT_HTTPS_PROXY;
	if (!raw) return null;

	let url;
	try {
		url = new URL(raw);
	} catch {
		// Never echo the raw value — it contains credentials.
		console.error("✗ AGENT_HTTPS_PROXY is set but not a valid URL (value redacted; rebuild it with the local proxy builder)");
		return null;
	}

	return {
		raw,
		protocol: url.protocol.replace(":", ""),
		host: url.hostname,
		port: url.port,
		username: decodeURIComponent(url.username || ""),
		password: decodeURIComponent(url.password || ""),
		// Chrome's --proxy-server flag doesn't accept inline credentials
		// (auth is handled separately via page.authenticate / CDP Fetch).
		serverFlag: `${url.protocol}//${url.hostname}:${url.port}`,
	};
}

// Call on every puppeteer Page before navigating, so the 407 proxy-auth
// challenge is answered automatically. Safe/idempotent to call repeatedly.
export async function authenticatePage(page) {
	const proxy = getProxyConfig();
	if (!proxy || !proxy.username) return;
	await page.authenticate({ username: proxy.username, password: proxy.password });
}
