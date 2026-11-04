import {appendFileSync} from "node:fs";

const state = JSON.parse(process.env.BROWSER_TOOLS_TEST_HOST_STATE);
const upstream = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const parsed = new URL(url);
  if (parsed.origin !== "http://127.0.0.1:19222") return upstream(url, options);
  appendFileSync(process.env.BROWSER_TOOLS_TEST_HOST_REQUESTS, `${parsed.pathname}\n`);
  if (options.method !== "POST" || options.headers["x-browser-tools"] !== "host-v1") throw new Error("Invalid fixture broker request");
  if (parsed.pathname === "/status") return Response.json({focusProtocol: "browser-tools-focus-v2", defaultMode: "background",
    backgroundPolicy: "passive-dom-v1", foregroundLeases: true, directCdp: true, networkSelection: "generation-v1",
    defaultNetworkMode: "proxy", networkModes: ["proxy", "direct"], networkMode: state.networkMode});
  const body = JSON.parse(options.body);
  if (parsed.pathname !== "/resume" || Object.keys(body).join() !== "networkMode") throw new Error("Fixture broker permits only passive network attachment");
  if (body.networkMode !== state.networkMode) return Response.json({error: "FOCUS_BLOCKED: incompatible fixture network; no grant, restart or switch"}, {status: 409});
  return Response.json(state);
};
