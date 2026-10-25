export const FOCUS_PROTOCOL = "browser-tools-focus-v1";
export const actions = ["inspect", "javascript", "navigate", "pointer", "keyboard", "screenshot", "tab-create", "tab-close"] as const;
export type Action = typeof actions[number];
export interface Lease {
  version: 1;
  browserId: string;
  issuedAt: number;
  expiresAt: number;
  targets: string[];
  actions: Action[];
  launch: boolean;
}
export interface Command {
  id: number;
  method: string;
  params?: Record<string, any>;
  sessionId?: string;
}
export class FocusDenied extends Error {
  constructor(public readonly reason: string) {
    super(`FOCUS_BLOCKED: ${reason}. Use API/CLI or request an explicit foreground window; do not retry or activate the browser.`);
  }
}
const idPattern = /^[A-Za-z0-9-]{1,100}$/;
export function parseLease(value: unknown, browserId: string, now = Date.now()): Lease {
  const lease = value as Lease;
  if (!lease || lease.version !== 1 || lease.browserId !== browserId || typeof browserId !== "string" || !idPattern.test(browserId)
    || !Number.isSafeInteger(lease.issuedAt) || !Number.isSafeInteger(lease.expiresAt)
    || lease.issuedAt > now || lease.expiresAt <= now || lease.expiresAt - lease.issuedAt > 300_000
    || lease.expiresAt <= lease.issuedAt || typeof lease.launch !== "boolean"
    || !Array.isArray(lease.targets) || lease.targets.length > 20 || !lease.targets.every(id => typeof id === "string" && idPattern.test(id))
    || !Array.isArray(lease.actions) || !lease.actions.length || !lease.actions.every(action => actions.includes(action))) {
    throw new FocusDenied("missing, expired or invalid foreground lease");
  }
  return lease;
}

const protocolMethods = new Set([
  "Browser.getVersion", "Target.getTargets", "Target.getTargetInfo", "Target.setDiscoverTargets",
  "Target.attachToTarget", "Target.detachFromTarget", "Target.setAutoAttach",
  "Runtime.enable", "Runtime.disable", "Runtime.runIfWaitingForDebugger", "Runtime.releaseObject", "Runtime.releaseObjectGroup",
  "Page.enable", "Page.disable", "Page.getFrameTree", "Page.setLifecycleEventsEnabled",
  "DOM.enable", "DOM.disable", "Network.enable", "Network.disable", "Log.enable", "Log.disable",
  "Performance.enable", "Performance.disable", "Security.setIgnoreCertificateErrors",
]);
const methodActions = new Map<string, Action>([
  ...["DOM.getDocument", "DOM.describeNode", "DOM.querySelector", "DOM.querySelectorAll", "DOM.getBoxModel", "DOM.getAttributes", "DOM.getOuterHTML", "DOMSnapshot.captureSnapshot", "Page.getLayoutMetrics", "Accessibility.getFullAXTree"].map(method => [method, "inspect"] as [string, Action]),
  ...["Runtime.evaluate", "Runtime.callFunctionOn", "Runtime.getProperties", "Runtime.addBinding", "Runtime.removeBinding", "DOM.resolveNode", "DOM.requestNode", "Page.addScriptToEvaluateOnNewDocument", "Page.removeScriptToEvaluateOnNewDocument"].map(method => [method, "javascript"] as [string, Action]),
  ...["Page.navigate", "Page.reload", "Page.stopLoading"].map(method => [method, "navigate"] as [string, Action]),
  ...["Input.dispatchMouseEvent", "Input.dispatchTouchEvent", "Input.emulateTouchFromMouseEvent"].map(method => [method, "pointer"] as [string, Action]),
  ...["Input.dispatchKeyEvent", "Input.insertText"].map(method => [method, "keyboard"] as [string, Action]),
  ["Page.captureScreenshot", "screenshot"], ["Target.createTarget", "tab-create"], ["Target.closeTarget", "tab-close"],
]);
const alwaysDenied = new Set(["Target.activateTarget", "Page.bringToFront", "Browser.close", "Browser.setWindowBounds", "Target.sendMessageToTarget", "Target.exposeDevToolsProtocol", "Target.attachToBrowserTarget", "Security.setIgnoreCertificateErrors"]);

export class FocusPolicy {
  readonly sessions = new Map<string, string>();
  readonly createdTargets = new Set<string>();
  private readonly pending = new Map<number, Command>();
  private leaseIssuedAt?: number;
  constructor(readonly browserId: string, private readonly lease: () => unknown, private readonly now = Date.now) {}

  currentLease(): Lease {
    const lease = parseLease(this.lease(), this.browserId, this.now());
    if (this.leaseIssuedAt !== undefined && this.leaseIssuedAt !== lease.issuedAt) this.createdTargets.clear();
    this.leaseIssuedAt = lease.issuedAt;
    return lease;
  }

  authorize(command: Command): void {
    const lease = this.currentLease();
    if (!Number.isSafeInteger(command.id) || command.id < 0 || typeof command.method !== "string"
      || (command.params !== undefined && (!command.params || typeof command.params !== "object" || Array.isArray(command.params)))) {
      throw new FocusDenied("invalid CDP command");
    }
    const {method, params = {}, sessionId} = command;
    if (alwaysDenied.has(method)) throw new FocusDenied("activation, escape and browser-global mutations are forbidden");
    const action = methodActions.get(method);
    if (!action && !protocolMethods.has(method)) throw new FocusDenied("unreviewed CDP method");
    if (action && !lease.actions.includes(action)) throw new FocusDenied(`foreground lease does not permit ${action}`);
    const allowed = (target: unknown) => typeof target === "string" && (lease.targets.includes(target) || this.createdTargets.has(target));
    if (sessionId !== undefined && !allowed(this.sessions.get(sessionId))) throw new FocusDenied("unknown or unowned CDP session");
    if (params.targetId !== undefined && !allowed(params.targetId)) throw new FocusDenied("unowned target");
    if (method === "Target.attachToTarget" && (!allowed(params.targetId) || params.flatten !== true)) throw new FocusDenied("only flattened owned-target attachment is supported");
    if (method === "Target.detachFromTarget" && !allowed(this.sessions.get(params.sessionId))) throw new FocusDenied("unowned attachment");
    if (method === "Target.setAutoAttach" && params.autoAttach !== false) throw new FocusDenied("automatic attachment can pause foreign pages");
    if (method === "Target.createTarget" && (params.background !== true || params.url !== "about:blank" || Object.keys(params).some(key => key !== "url" && key !== "background"))) {
      throw new FocusDenied("only a background blank owned tab may be created");
    }
    if (action && method !== "Target.createTarget" && method !== "Target.closeTarget" && !sessionId) throw new FocusDenied("page actions require an owned CDP session");
    if (method === "Target.closeTarget" && !allowed(params.targetId)) throw new FocusDenied("unowned target");
    if (method === "Page.navigate" && (typeof params.url !== "string" || (!/^https?:\/\//i.test(params.url) && params.url !== "about:blank"))) throw new FocusDenied("only HTTP(S) and blank navigation are supported");
    if (this.pending.size >= 1000 || this.pending.has(command.id)) throw new FocusDenied("duplicate or excessive pending commands");
    this.pending.set(command.id, command);
  }

  observe(message: any): void {
    const command = this.pending.get(message.id);
    if (command) {
      this.pending.delete(message.id);
      if (!message.error) {
        if (command.method === "Target.createTarget" && typeof message.result?.targetId === "string") this.createdTargets.add(message.result.targetId);
        if (command.method === "Target.attachToTarget" && typeof message.result?.sessionId === "string") this.sessions.set(message.result.sessionId, command.params!.targetId);
        if (command.method === "Target.detachFromTarget") this.sessions.delete(command.params!.sessionId);
        if (command.method === "Target.closeTarget") this.createdTargets.delete(command.params!.targetId);
      }
    }
    if (message.method === "Target.detachedFromTarget") this.sessions.delete(message.params?.sessionId);
    if (message.method === "Target.targetDestroyed") {
      this.createdTargets.delete(message.params?.targetId);
      for (const [session, target] of this.sessions) if (target === message.params?.targetId) this.sessions.delete(session);
    }
  }
}
