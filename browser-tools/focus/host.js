import {FOCUS_PROTOCOL} from "./client.js";

/** @param {(url: string, options: RequestInit) => Promise<Response>} [request] */
export async function requestHostResume(request = fetch) {
  const options = {method: "POST", headers: {"x-browser-tools": "host-v1"}, signal: AbortSignal.timeout(30_000)};
  const status = await request("http://127.0.0.1:19222/status", options);
  if (!status.ok) throw new Error("FOCUS_BLOCKED: host launcher has no guarded-status capability; no launch was requested");
  let capability;
  try { capability = await status.json(); } catch { throw new Error("FOCUS_BLOCKED: invalid host status; no launch was requested"); }
  if (capability?.focusProtocol !== FOCUS_PROTOCOL || capability.foregroundLeases !== true || capability.backgroundActions !== 0) {
    throw new Error("FOCUS_BLOCKED: legacy or unsupported host launcher; no launch was requested");
  }
  const response = await request("http://127.0.0.1:19222/resume", options);
  if (!response.ok) throw new Error("FOCUS_BLOCKED: host gateway unavailable or foreground launch approval required");
  const state = await response.json();
  if (state?.mode !== "host" || state.focusProtocol !== FOCUS_PROTOCOL || typeof state.browserId !== "string"
    || !/^[A-Za-z0-9-]{1,100}$/.test(state.browserId) || !Number.isInteger(state.port) || state.port < 1 || state.port > 65535
    || state.webSocketDebuggerUrl !== `ws://127.0.0.1:${state.port}/devtools/browser/${state.browserId}`
    || typeof state.userDataDir !== "string" || !state.userDataDir) throw new Error("FOCUS_BLOCKED: invalid host gateway identity");
  return state;
}
