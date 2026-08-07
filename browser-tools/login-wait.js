// Login-wall detection and manual-login wait for browser-tools helpers.
//
// Policy: login is ALWAYS manual. Helpers pause on a login wall, give the user
// a wall-clock window to sign in in the visible browser, and hand control back
// with a clear status when the window expires. Nothing here fills credentials
// or works around the wall.

export const DEFAULT_LOGIN_WAIT_MS = Number(process.env.BROWSER_LOGIN_WAIT_MS) || 50_000;
const POLL_MS = 1500;

const URL_PATTERN = /(^|[/.])(login|signin|sign-in|sign_in|auth|authorize|oauth2?|sso|session\/new|account\/login|checkpoint|challenge)(\/|$|\?)/i;
const TEXT_PATTERN = /\b(sign in|sign-in|log in|login|anmelden|se connecter|iniciar sesión|two-factor|verification code|one-time code|captcha)\b/i;

// Heuristic login-wall detection; returns a reason string or undefined.
export async function detectLoginWall(page) {
	const url = page.url();
	if (URL_PATTERN.test(new URL(url).pathname + new URL(url).search)) return `URL looks like a login/auth page: ${url}`;
	const signals = await page
		.evaluate(() => {
			const visible = (el) => {
				const rect = el.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0;
			};
			const passwords = Array.from(document.querySelectorAll('input[type="password"]')).filter(visible).length;
			const otp = Array.from(document.querySelectorAll('input[autocomplete*="one-time-code"], input[name*="otp" i], input[name*="code" i]')).filter(visible).length;
			const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"]'))
				.filter(visible)
				.map((el) => (el.innerText || el.value || "").trim())
				.filter(Boolean)
				.slice(0, 60);
			return { passwords, otp, buttons, title: document.title, text: (document.body?.innerText || "").slice(0, 2000) };
		})
		.catch(() => undefined);
	if (!signals) return undefined;
	if (signals.passwords > 0) return "a visible password field is present";
	if (signals.otp > 0 && TEXT_PATTERN.test(signals.text)) return "a one-time-code / 2FA prompt is present";
	if (signals.buttons.some((b) => /^(sign in|log in|login|continue with (google|apple|github|microsoft|facebook))/i.test(b)) && TEXT_PATTERN.test(signals.title + " " + signals.text)) {
		return "the page offers only sign-in actions";
	}
	return undefined;
}

// Waits for the user to clear a login wall. Resolves with the outcome; never
// interacts with the page.
export async function waitForManualLogin(page, { timeoutMs = DEFAULT_LOGIN_WAIT_MS, log = console.error } = {}) {
	const reason = await detectLoginWall(page);
	if (!reason) return { loginWall: false, resolved: true };

	log(`⏸ Login wall detected — ${reason}`);
	log(`  Log in manually in the visible browser window. Waiting up to ${Math.round(timeoutMs / 1000)}s; credentials are never entered by the agent.`);

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		const still = await detectLoginWall(page).catch(() => reason);
		if (!still) {
			log(`✓ Login completed — continuing at ${page.url()}`);
			return { loginWall: true, resolved: true };
		}
	}
	log(`✗ Still on a login wall after ${Math.round(timeoutMs / 1000)}s at ${page.url()}`);
	log("  Handing back: log in in the visible browser, then re-run this command. Do not bypass the login.");
	return { loginWall: true, resolved: false, url: page.url(), reason };
}
