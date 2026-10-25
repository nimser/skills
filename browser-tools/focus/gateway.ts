import {FocusDenied, FocusPolicy, FOCUS_PROTOCOL, leaseKey, type Command, type InteractionMode} from "./policy.ts";

interface Peer { send(value: string): unknown; close(code?: number, reason?: string): unknown }
interface Connection {
  peer: Peer;
  policy: FocusPolicy;
  state: "opening" | "active" | "closing";
  root?: string;
  sessions: Map<string, string>;
  queued: number[];
  queuedBytes: number;
  settled: Promise<void>;
  settle(): void;
}
interface Call {connection: Connection; original: Command; epoch?: string}
interface Control {connection: Connection; method: "Target.attachToBrowserTarget" | "Target.detachFromTarget"; timer: ReturnType<typeof setTimeout>}
export function parseBrowserFrame(text: string): any {
  const message = JSON.parse(text);
  const record = (value: any) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!record(message)
    || (message.id === undefined ? typeof message.method !== "string" : !Number.isSafeInteger(message.id) || (!record(message.result) && !record(message.error)))
    || (message.params !== undefined && !record(message.params))
    || (message.sessionId !== undefined && typeof message.sessionId !== "string")
    || (message.method === "Target.attachedToTarget" && (typeof message.params?.sessionId !== "string" || typeof message.params?.targetInfo?.targetId !== "string"))) throw new Error("Invalid browser frame");
  return message;
}
export class FocusGateway {
  private connection?: Connection;
  private broken = false;
  private wireId = 0;
  private readonly calls = new Map<number, Call>();
  private readonly controls = new Map<number, Control>();
  private readonly created = new Map<string, string>();
  private readonly owned = new Set<string>();
  constructor(readonly browserId: string, private readonly lease: () => unknown, private readonly upstream: (message: string) => void,
    private readonly now = Date.now, private readonly controlTimeoutMs = 5000) {}

  async available(): Promise<boolean> {
    this.checkLease();
    if (this.connection?.state === "closing") await this.connection.settled;
    return !this.broken && !this.connection;
  }
  connect(peer: Peer, mode: InteractionMode = "background"): boolean {
    if (this.broken || this.connection) return false;
    const policy = new FocusPolicy(this.browserId, this.lease, this.now, mode, this.owned);
    try {
      policy.connectionAllowed();
      if (mode !== "background") {
        const epoch = leaseKey(policy.currentLease());
        for (const [target, approval] of this.created) if (approval === epoch) policy.createdTargets.add(target);
      }
    } catch { return false; }
    let settle!: () => void;
    const settled = new Promise<void>(resolve => { settle = resolve; });
    const connection: Connection = {peer, policy, state: "opening", sessions: new Map(), queued: [], queuedBytes: 0, settled, settle};
    this.connection = connection;
    this.control(connection, "Target.attachToBrowserTarget", {});
    return true;
  }
  disconnect(peer: Peer): void {
    const connection = this.connection;
    if (connection?.peer === peer) this.retire(connection);
  }
  checkLease(): void {
    const connection = this.connection;
    if (!connection || connection.state === "closing") return;
    try { connection.policy.connectionAllowed(); }
    catch { this.retire(connection, 1008, "Approval ended; sent mutations have uncertain outcomes"); }
  }
  receive(peer: Peer, text: string): void {
    let command: Command | undefined;
    let submitted = false;
    try {
      this.checkLease();
      const connection = this.connection;
      if (peer !== connection?.peer || connection.state === "closing") throw new FocusDenied("gateway connection is unavailable or retiring");
      const bytes = Buffer.byteLength(text);
      if (bytes > 1_000_000 || (connection.state === "opening" && connection.queuedBytes + bytes > 1_000_000)) throw new FocusDenied("command exceeds the bounded transport size");
      command = JSON.parse(text);
      if (!command || typeof command !== "object") throw new FocusDenied("invalid protocol message");
      if (command.sessionId !== undefined && !connection.sessions.has(command.sessionId)) throw new FocusDenied("unknown protocol session for this connection");
      connection.policy.authorize(command);
      const wireId = ++this.wireId;
      this.calls.set(wireId, {connection, original: command,
        ...(connection.policy.mode !== "background" ? {epoch: leaseKey(connection.policy.currentLease())} : {})});
      submitted = true;
      if (connection.state === "opening") { connection.queued.push(wireId); connection.queuedBytes += bytes; }
      else this.dispatch(wireId);
    } catch (error) {
      if (submitted) { this.fail(); return; }
      try { peer.send(JSON.stringify({id: command?.id ?? 0, ...(command?.sessionId ? {sessionId: command.sessionId} : {}), error: {code: -32001, message: error instanceof FocusDenied ? error.message : new FocusDenied("invalid or unavailable protocol operation").message}})); }
      catch { this.disconnect(peer); }
    }
  }
  private dispatch(id: number): void {
    const call = this.calls.get(id);
    if (!call || call.connection !== this.connection || call.connection.state !== "active") return;
    this.checkLease();
    if (call.connection.state !== "active") return;
    const {method, params, sessionId} = call.original;
    this.upstream(JSON.stringify({id, method, params, sessionId: sessionId ?? call.connection.root}));
  }
  private control(connection: Connection, method: Control["method"], params: Record<string, string>): void {
    const id = ++this.wireId;
    const timer = setTimeout(() => this.fail(), this.controlTimeoutMs);
    timer.unref();
    this.controls.set(id, {connection, method, timer});
    try { this.upstream(JSON.stringify({id, method, params})); }
    catch { this.fail(); }
  }
  private retire(connection: Connection, code?: number, reason?: string): void {
    if (connection !== this.connection || connection.state === "closing") return;
    connection.state = "closing";
    connection.queued = [];
    connection.queuedBytes = 0;
    for (const [id, call] of this.calls) if (call.connection === connection) this.calls.delete(id);
    if (code !== undefined) try { connection.peer.close(code, reason); } catch {}
    if (connection.root) this.control(connection, "Target.detachFromTarget", {sessionId: connection.root});
  }
  fromBrowser(text: string): void {
    try { this.forwardBrowser(parseBrowserFrame(text)); }
    catch { this.fail(); }
  }
  private recordSession(connection: Connection, session: unknown, parent: string): void {
    if (typeof session !== "string" || !session || session === connection.root
      || (connection.sessions.has(session) && connection.sessions.get(session) !== parent)) throw new Error("Invalid child session");
    connection.sessions.set(session, parent);
  }
  private forgetSession(connection: Connection, session: string): void {
    for (const [child, parent] of connection.sessions) if (parent === session) this.forgetSession(connection, child);
    connection.sessions.delete(session);
    connection.policy.sessions.delete(session);
  }
  private forwardBrowser(message: any): void {
    if (typeof message.id === "number") {
      const control = this.controls.get(message.id);
      if (control) {
        clearTimeout(control.timer);
        this.controls.delete(message.id);
        const {connection} = control;
        if (message.error || message.sessionId !== undefined || connection !== this.connection) { this.fail(); return; }
        if (control.method === "Target.attachToBrowserTarget") {
          if (typeof message.result.sessionId !== "string" || !message.result.sessionId) { this.fail(); return; }
          connection.root = message.result.sessionId;
          if (connection.state === "closing") { this.control(connection, "Target.detachFromTarget", {sessionId: connection.root!}); return; }
          connection.state = "active";
          this.checkLease();
          const queued = connection.queued;
          connection.queued = [];
          connection.queuedBytes = 0;
          for (const id of queued) this.dispatch(id);
        } else {
          connection.sessions.clear();
          this.connection = undefined;
          connection.settle();
        }
        return;
      }
      const call = this.calls.get(message.id);
      if (!call) return;
      this.calls.delete(message.id);
      const {connection} = call;
      if (connection !== this.connection || connection.state !== "active") return;
      message.id = call.original.id;
      if (call.original.sessionId === undefined) delete message.sessionId;
      else message.sessionId = call.original.sessionId;
      if (!message.error && ["Target.attachToTarget", "Target.attachToBrowserTarget"].includes(call.original.method)) this.recordSession(connection, message.result?.sessionId, call.original.sessionId ?? connection.root!);
      connection.policy.observe(message);
      if (!message.error && call.original.method === "Target.createTarget") {
        try { if (call.epoch === leaseKey(connection.policy.currentLease())) this.created.set(message.result.targetId, call.epoch!); } catch { /* Expired actions are uncertain, not retried. */ }
      }
      this.checkLease();
      if (connection.state !== "active") return;
      if (!message.error && connection.policy.mode !== "direct" && call.original.method === "Target.getTargets") {
        const approved = connection.policy.mode === "foreground" ? connection.policy.currentLease().targets : [];
        message.result.targetInfos = (message.result?.targetInfos || []).filter((target: any) => this.owned.has(target.targetId) || approved.includes(target.targetId));
      }
      connection.peer.send(JSON.stringify(message));
      return;
    }
    const connection = this.connection;
    if (!connection) return;
    if (!message.sessionId && message.method === "Target.detachedFromTarget" && message.params?.sessionId === connection.root && connection.state !== "closing") { this.fail(); return; }
    if (!message.sessionId || (message.sessionId !== connection.root && !connection.sessions.has(message.sessionId))) return;
    if (message.method === "Target.targetDestroyed") {
      this.created.delete(message.params?.targetId);
      this.owned.delete(message.params?.targetId);
    }
    if (connection.state !== "active") return;
    if (message.method === "Target.attachedToTarget") this.recordSession(connection, message.params.sessionId, message.sessionId);
    if (message.method === "Target.detachedFromTarget") this.forgetSession(connection, message.params?.sessionId);
    if (message.sessionId === connection.root) delete message.sessionId;
    connection.policy.observe(message);
    this.checkLease();
    if (connection.state !== "active") return;
    if (connection.policy.mode !== "direct") {
      if (message.sessionId && !connection.policy.sessions.has(message.sessionId)) return;
      const target = message.params?.targetInfo?.targetId ?? message.params?.targetId;
      if (!message.sessionId && (!target || !this.owned.has(target))) return;
    }
    connection.peer.send(JSON.stringify(message));
  }
  fail(): void {
    this.broken = true;
    for (const control of this.controls.values()) clearTimeout(control.timer);
    this.controls.clear();
    this.calls.clear();
    const connection = this.connection;
    this.connection = undefined;
    if (connection) {
      connection.state = "closing";
      connection.settle();
      try { connection.peer.close(1011, "Browser transport unavailable; outcomes can be uncertain"); } catch {}
    }
  }
}
export function gatewayVersion(browserId: string, port: number, mode: InteractionMode = "background", product = "Chrome/0") {
  return {Browser: product, "Protocol-Version": "1.3", focusProtocol: FOCUS_PROTOCOL, interactionMode: mode,
    browserId, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/${browserId}${mode === "background" ? "" : `/${mode}`}`};
}
