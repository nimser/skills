// Shared helper for routing the browser (and curl) through an HTTP(S) proxy
// exposed via the AGENT_HTTPS_PROXY env var.
//
// AGENT_HTTPS_PROXY is expected to be a full proxy URL with inline
// credentials, e.g. "https://user:pass@host:port" — the same string you'd
// pass to curl -x directly. Set it in your own environment however you
// manage secrets; these scripts only read it, never source it themselves.

export function getProxyConfig() {
	const raw = process.env.AGENT_HTTPS_PROXY;
	if (!raw) return null;

	let url;
	try {
		url = new URL(raw);
	} catch {
		console.error("✗ AGENT_HTTPS_PROXY is set but not a valid URL:", raw);
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
