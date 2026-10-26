import {FOCUS_PROTOCOL} from "./client.js";

/** Broker denials are single-line FOCUS_BLOCKED reasons; anything else falls back to a generic message. */
async function brokerReason(/** @type {Response} */ response) {
  try {
    const reason = (await response.json())?.error;
    return typeof reason === "string" && reason.startsWith("FOCUS_BLOCKED:") && reason.length <= 500 && !/[\x00-\x1f]/.test(reason) ? reason : undefined;
  } catch { return undefined; }
}

/** @param {(url: string, options: RequestInit) => Promise<Response>} [request] */
export async function requestHostResume(request = fetch, approval = {mode: "background", seconds: 60, targets: /** @type {string[]} */ ([])}) {
  if (!["background", "foreground", "direct"].includes(approval.mode)) throw new Error("FOCUS_BLOCKED: invalid mode");
  const options = {method: "POST", headers: {"x-browser-tools": "host-v1"}, signal: AbortSignal.timeout(30_000)};
  const status = await request("http://127.0.0.1:19222/status", options);
  if (!status.ok) throw new Error("FOCUS_BLOCKED: host launcher has no guarded-status capability; no launch was requested");
  let capability;
  try { capability = await status.json(); } catch { throw new Error("FOCUS_BLOCKED: invalid host status; no launch was requested"); }
  if (capability?.focusProtocol !== FOCUS_PROTOCOL || capability.defaultMode !== "background" || capability.backgroundPolicy !== "passive-dom-v1"
    || capability.foregroundLeases !== true || capability.directCdp !== true) throw new Error("FOCUS_BLOCKED: legacy or unsupported host launcher; no launch was requested");
  const explicit = approval.mode !== "background";
  const response = await request(`http://127.0.0.1:19222/${explicit ? "foreground" : "resume"}`, explicit ? {...options,
    headers: {...options.headers, "content-type": "application/json"}, body: JSON.stringify({...approval, confirmed: true})} : options);
  if (!response.ok) throw new Error(await brokerReason(response) ?? `FOCUS_BLOCKED: ${explicit ? "foreground approval/startup failed; inspect before retrying" : "no running guarded browser; request explicit foreground startup"}`);
  const state = await response.json();
  if (state?.mode !== "host" || state.focusProtocol !== FOCUS_PROTOCOL || typeof state.browserId !== "string"
    || !/^[A-Za-z0-9-]{1,100}$/.test(state.browserId) || !Number.isInteger(state.port) || state.port < 1 || state.port > 65535
    || !Number.isInteger(state.directPort) || state.directPort < 1 || state.directPort > 65535 || state.directPort === state.port
    || state.webSocketDebuggerUrl !== `ws://127.0.0.1:${state.port}/devtools/browser/${state.browserId}`
    || typeof state.userDataDir !== "string" || !state.userDataDir) throw new Error("FOCUS_BLOCKED: invalid host gateway identity");
  return {...state, interactionMode: approval.mode};
}
