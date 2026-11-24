import {windowRemaining, FOREGROUND_SECONDS, validDuration} from "./limits.js";

export function startOptions(args) {
  let mode = "background", seconds = FOREGROUND_SECONDS, foreground = false, direct = false, networkMode = "proxy";
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const key = arg.startsWith("--network=") ? "--network" : arg;
    if (seen.has(key)) throw new Error(`Duplicate option: ${key}`);
    seen.add(key);
    if (arg === "--host" || arg === "--resume") continue;
    if (arg === "--foreground") foreground = true;
    else if (arg === "--direct-cdp") direct = true;
    else if (arg === "--seconds") {
      const value = args[++index];
      if (!/^[1-9]\d*$/.test(value ?? "")) throw new Error("--seconds requires a positive integer");
      seconds = Number(value);
    }
    else if (arg.startsWith("--network=")) networkMode = arg.slice("--network=".length);
    else throw new Error("Use browser-start.js [--host] [--resume] [--network=proxy|direct] [--foreground [--direct-cdp] [--seconds N]]; resets and local profile copying are unsupported");
  }
  if (!validDuration(seconds)) throw new Error("Invalid browser window duration");
  if ((direct || seen.has("--seconds")) && !foreground) throw new Error("--direct-cdp and --seconds require explicit --foreground");
  if (foreground) mode = direct ? "direct" : "foreground";
  if (!["proxy", "direct"].includes(networkMode)) throw new Error("Network must be proxy or explicitly approved direct");
  return {mode, seconds, networkMode};
}

export function modeEndpoint(state) {
  const mode = state.interactionMode || "background";
  if (!["background", "foreground", "direct"].includes(mode)) throw new Error("FOCUS_BLOCKED: invalid interaction mode");
  if (mode === "direct" && (!Number.isInteger(state.directPort) || state.directPort < 1 || state.directPort > 65535 || state.directPort === state.port)) throw new Error("FOCUS_BLOCKED: invalid direct-CDP discovery port");
  if (state.window && mode !== "background") windowRemaining(state.window);
  const capability = state.window && mode !== "background" ? `/window/${state.window.token}` : "";
  const browserURL = mode === "direct" ? `http://127.0.0.1:${state.directPort}${capability}` : `http://127.0.0.1:${state.port}${mode === "background" ? "" : "/foreground"}${capability}`;
  return {mode, browserURL: mode === "direct" && capability ? undefined : browserURL,
    metadataURL: `${browserURL}/json/version`,
    browserWSEndpoint: `${state.webSocketDebuggerUrl}${mode === "background" ? "" : `/${mode}`}${capability}`};
}
