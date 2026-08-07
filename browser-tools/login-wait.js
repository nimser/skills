// Login-wall detection and manual-login wait for browser-tools helpers.
//
// Policy: login is ALWAYS manual. Helpers pause on a login wall, give the user
// a wall-clock window to sign in in the visible browser, and hand control back
// with a clear status when the window expires. Nothing here fills credentials
// or works around the wall.

export const DEFAULT_LOGIN_WAIT_MS = Number(process.env.BROWSER_LOGIN_WAIT_MS) || 50_000;
// Extra grace while the user is still typing, and the ceiling on such extensions.
export const LOGIN_IDLE_MS = Number(process.env.BROWSER_LOGIN_IDLE_MS) || 20_000;
export const LOGIN_MAX_WAIT_MS = Number(process.env.BROWSER_LOGIN_MAX_WAIT_MS) || 300_000;
const POLL_MS = 1500;
const ACTIVITY_FLAG = "__browserToolsLoginActivity";

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

// Counts typing/pointer events on the page without reading any value: only an
// event tally and a timestamp cross the boundary.
async function pollActivity(page, flag) {
	return page
		.evaluate((key) => {
			if (!window[key]) {
				const state = { count: 0, last: 0 };
				const bump = () => {
					state.count += 1;
					state.last = Date.now();
				};
				for (const type of ["keydown", "input", "paste", "pointerdown"]) {
					window.addEventListener(type, bump, { capture: true, passive: true });
				}
				window[key] = state;
			}
			return { count: window[key].count, sinceMs: window[key].last ? Date.now() - window[key].last : Infinity };
		}, flag)
		.catch(() => ({ count: 0, sinceMs: Infinity }));
}

// Waits for the user to clear a login wall. Resolves with the outcome; never
// interacts with the page.
export async function waitForManualLogin(page, { timeoutMs = DEFAULT_LOGIN_WAIT_MS, log = console.error } = {}) {
	const reason = await detectLoginWall(page);
	if (!reason) return { loginWall: false, resolved: true };

	log(`⏸ Login wall detected — ${reason}`);
	log(`  Log in manually in the visible browser window. Waiting up to ${Math.round(timeoutMs / 1000)}s; credentials are never entered by the agent.`);

	const start = Date.now();
	const hardDeadline = start + Math.max(timeoutMs, LOGIN_MAX_WAIT_MS);
	let deadline = start + timeoutMs;
	let extended = false;
	await pollActivity(page, ACTIVITY_FLAG);

	for (;;) {
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		const still = await detectLoginWall(page).catch(() => reason);
		if (!still) {
			log(`✓ Login completed — continuing at ${page.url()}`);
			return { loginWall: true, resolved: true };
		}
		const now = Date.now();
		if (now >= hardDeadline) break;
		const activity = await pollActivity(page, ACTIVITY_FLAG);
		if (activity.sinceMs < LOGIN_IDLE_MS) {
			deadline = Math.min(Math.max(deadline, now + (LOGIN_IDLE_MS - activity.sinceMs)), hardDeadline);
			if (!extended) {
				extended = true;
				log(`  Typing detected — holding off, waiting for ${Math.round(LOGIN_IDLE_MS / 1000)}s of no input.`);
			}
		}
		if (now >= deadline) break;
	}
	log(`✗ Still on a login wall after ${Math.round((Date.now() - start) / 1000)}s at ${page.url()}`);
	log("  Handing back: log in in the visible browser, then re-run this command. Do not bypass the login.");
	return { loginWall: true, resolved: false, url: page.url(), reason };
}
