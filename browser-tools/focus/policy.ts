export const FOCUS_PROTOCOL = "browser-tools-focus-v2";
export const actions = ["inspect", "javascript", "navigate", "pointer", "keyboard", "screenshot", "tab-create", "tab-close", "activate", "direct-cdp"] as const;
export type Action = typeof actions[number];
export type InteractionMode = "background" | "foreground" | "direct";
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
    super(`FOCUS_BLOCKED: ${reason}. Use passive inspection/API/CLI, or explicitly request a bounded foreground or direct-CDP session; never upgrade automatically.`);
  }
}
const idPattern = /^[A-Za-z0-9-]{1,100}$/;
export function parseLease(value: unknown, browserId: string, now = Date.now()): Lease {
  const lease = value as Lease;
  if (!Number.isSafeInteger(now) || !lease || lease.version !== 1 || lease.browserId !== browserId || typeof browserId !== "string" || !idPattern.test(browserId)
    || !Number.isSafeInteger(lease.issuedAt) || !Number.isSafeInteger(lease.expiresAt)
    || lease.issuedAt > now || lease.expiresAt <= now || lease.expiresAt - lease.issuedAt > 300_000
    || lease.expiresAt <= lease.issuedAt || typeof lease.launch !== "boolean"
    || !Array.isArray(lease.targets) || lease.targets.length > 20 || !lease.targets.every(id => typeof id === "string" && idPattern.test(id))
    || !Array.isArray(lease.actions) || !lease.actions.length || !lease.actions.every(action => actions.includes(action))) {
    throw new FocusDenied("missing, expired or invalid foreground lease");
  }
  return lease;
}

export function leaseKey(lease: Lease): string {
  return JSON.stringify([lease.browserId, lease.issuedAt, lease.expiresAt, lease.targets, lease.actions]);
}

export const passiveMethods = new Set([
  "Browser.getVersion", "Target.getTargets", "Target.getTargetInfo", "Target.attachToTarget", "Target.detachFromTarget",
  "Page.enable", "Page.disable", "Page.getFrameTree",
  "DOM.getDocument", "DOM.describeNode", "DOM.querySelector", "DOM.querySelectorAll", "DOM.getAttributes",
]);
const protocolMethods = new Set([
  ...passiveMethods, "Target.setDiscoverTargets", "Target.setAutoAttach",
  "Runtime.enable", "Runtime.disable", "Runtime.runIfWaitingForDebugger", "Runtime.releaseObject", "Runtime.releaseObjectGroup",
  "Page.setLifecycleEventsEnabled", "DOM.enable", "DOM.disable", "Network.enable", "Network.disable", "Log.enable", "Log.disable",
  "Performance.enable", "Performance.disable",
]);
const methodActions = new Map<string, Action>([
  ...["DOM.getBoxModel", "DOM.getOuterHTML", "DOMSnapshot.captureSnapshot", "Page.getLayoutMetrics", "Accessibility.getFullAXTree"].map(method => [method, "inspect"] as [string, Action]),
  ...["Runtime.evaluate", "Runtime.callFunctionOn", "Runtime.getProperties", "Runtime.addBinding", "Runtime.removeBinding", "DOM.resolveNode", "DOM.requestNode", "Page.addScriptToEvaluateOnNewDocument", "Page.removeScriptToEvaluateOnNewDocument"].map(method => [method, "javascript"] as [string, Action]),
  ...["Page.navigate", "Page.reload", "Page.stopLoading"].map(method => [method, "navigate"] as [string, Action]),
  ...["Input.dispatchMouseEvent", "Input.dispatchTouchEvent", "Input.emulateTouchFromMouseEvent"].map(method => [method, "pointer"] as [string, Action]),
  ...["Input.dispatchKeyEvent", "Input.insertText"].map(method => [method, "keyboard"] as [string, Action]),
  ["Page.captureScreenshot", "screenshot"], ["Target.createTarget", "tab-create"], ["Target.closeTarget", "tab-close"],
  ["Target.activateTarget", "activate"], ["Page.bringToFront", "activate"],
]);
const alwaysDenied = new Set(["Target.sendMessageToTarget", "Target.exposeDevToolsProtocol", "Security.setIgnoreCertificateErrors"]);

// CDP command ids are unique only within their session, and Puppeteer numbers each session from 1.
const pendingKey = (id: unknown, sessionId: unknown) => `${typeof sessionId === "string" ? sessionId : ""}\u0000${id}`;

export class FocusPolicy {
  readonly sessions = new Map<string, string>();
  readonly createdTargets = new Set<string>();
  private readonly pending = new Map<string, {command: Command; epoch?: string}>();
  private epoch?: string;
  private connectionEpoch?: string;
  constructor(readonly browserId: string, private readonly lease: () => unknown, private readonly now = Date.now,
    readonly mode: InteractionMode = "background", readonly ownedTargets = new Set<string>()) {}

  currentLease(): Lease {
    const lease = parseLease(this.lease(), this.browserId, this.now());
    const epoch = leaseKey(lease);
    if (this.epoch !== undefined && this.epoch !== epoch) this.createdTargets.clear();
    this.epoch = epoch;
    return lease;
  }
  connectionAllowed(): void {
    if (this.mode === "background") return;
    const lease = this.currentLease();
    if (this.mode === "direct" && !lease.actions.includes("direct-cdp")) throw new FocusDenied("direct CDP requires separate browser-wide approval");
    const epoch = leaseKey(lease);
    if (this.connectionEpoch !== undefined && this.connectionEpoch !== epoch) throw new FocusDenied("foreground approval changed; explicitly reconnect without replaying work");
    this.connectionEpoch = epoch;
  }
  owns(target: unknown): boolean { return typeof target === "string" && this.ownedTargets.has(target); }
  authorize(command: Command): void {
    if (!Number.isSafeInteger(command.id) || command.id < 0 || typeof command.method !== "string"
      || (command.params !== undefined && (!command.params || typeof command.params !== "object" || Array.isArray(command.params)))) throw new FocusDenied("invalid CDP command");
    const {method, params = {}, sessionId} = command;
    this.connectionAllowed();
    if (alwaysDenied.has(method)) throw new FocusDenied("nested protocol escapes and certificate bypasses are forbidden");
    if (this.mode !== "direct") {
      const lease = this.mode === "foreground" ? this.currentLease() : undefined;
      const allowed = (target: unknown) => typeof target === "string" && (lease ? lease.targets.includes(target) || this.createdTargets.has(target) : this.owns(target));
      const action = methodActions.get(method);
      if (this.mode === "background" && !passiveMethods.has(method)) throw new FocusDenied("this operation is not passive background inspection");
      if (this.mode === "foreground" && ((!action && !protocolMethods.has(method)) || (action && !lease!.actions.includes(action)))) throw new FocusDenied(action ? `foreground lease does not permit ${action}` : "unreviewed CDP method; explicitly request direct CDP");
      if (sessionId !== undefined && !allowed(this.sessions.get(sessionId))) throw new FocusDenied("unknown or unowned CDP session");
      if (params.targetId !== undefined && !allowed(params.targetId)) throw new FocusDenied("unowned target");
      if (method === "Target.getTargetInfo" && !allowed(params.targetId ?? this.sessions.get(sessionId!))) throw new FocusDenied("target information requires an owned target");
      if (method === "Target.attachToTarget" && (!allowed(params.targetId) || params.flatten !== true)) throw new FocusDenied("only flattened owned-target attachment is supported");
      if (method === "Target.detachFromTarget" && !allowed(this.sessions.get(params.sessionId))) throw new FocusDenied("unowned attachment");
      if (method === "Target.setAutoAttach" && params.autoAttach !== false) throw new FocusDenied("browser-wide automatic attachment requires direct-CDP approval");
      if (method === "Target.createTarget" && (params.background !== true || params.url !== "about:blank" || Object.keys(params).some(key => key !== "url" && key !== "background"))) throw new FocusDenied("only a background blank owned tab may be created in scoped mode");
      if (!method.startsWith("Target.") && method !== "Browser.getVersion" && !sessionId) throw new FocusDenied("page actions require an owned CDP session");
      if (method === "Page.navigate" && (typeof params.url !== "string" || (!/^https?:\/\//i.test(params.url) && params.url !== "about:blank"))) throw new FocusDenied("only HTTP(S) and blank navigation are supported");
    }
    const key = pendingKey(command.id, sessionId);
    if (this.pending.size >= 1000 || this.pending.has(key)) throw new FocusDenied("duplicate or excessive pending commands");
    this.pending.set(key, {command, ...(this.mode !== "background" ? {epoch: leaseKey(this.currentLease())} : {})});
  }
  observe(message: any): void {
    const key = pendingKey(message.id, message.sessionId);
    const request = message.id === undefined ? undefined : this.pending.get(key);
    const command = request?.command;
    if (command) {
      this.pending.delete(key);
      if (!message.error) {
        if (command.method === "Target.createTarget" && typeof message.result?.targetId === "string") {
          try { if (request!.epoch === leaseKey(this.currentLease())) this.createdTargets.add(message.result.targetId); } catch {}
          this.ownedTargets.add(message.result.targetId);
        }
        if (command.method === "Target.attachToTarget" && typeof message.result?.sessionId === "string") {
          this.sessions.set(message.result.sessionId, command.params!.targetId);
          if (this.mode !== "direct") this.ownedTargets.add(command.params!.targetId);
        }
        if (command.method === "Target.detachFromTarget") this.sessions.delete(command.params!.sessionId);
        if (command.method === "Target.closeTarget") this.ownedTargets.delete(command.params!.targetId);
      }
    }
    if (this.mode === "direct" && message.method === "Target.attachedToTarget") this.sessions.set(message.params.sessionId, message.params.targetInfo?.targetId);
    if (message.method === "Target.detachedFromTarget") this.sessions.delete(message.params?.sessionId);
    if (message.method === "Target.targetDestroyed") {
      this.createdTargets.delete(message.params?.targetId);
      this.ownedTargets.delete(message.params?.targetId);
      for (const [session, target] of this.sessions) if (target === message.params?.targetId) this.sessions.delete(session);
    }
  }
}
