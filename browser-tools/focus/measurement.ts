export class FocusTrace {
  private focused: number | null | undefined;
  desktopTransitions = 0;
  referenceTransitions = 0;
  fixtureInputs = 0;
  fixtureKeys = 0;
  decoyInputs = 0;
  referenceVisible = false;
  editorVisible = false;
  ready = false;
  streamHealthy = false;
  unexpectedTargets = 0;

  compositor(event: any): void {
    let id: number | null | undefined;
    if (event?.WindowsChanged?.windows) {
      id = event.WindowsChanged.windows.find((window: any) => window.is_focused)?.id ?? null;
      this.streamHealthy = true;
    } else if (event?.WindowFocusChanged && Object.hasOwn(event.WindowFocusChanged, "id")) id = event.WindowFocusChanged.id;
    else return;
    if (id !== null && !Number.isSafeInteger(id)) throw new Error("Invalid compositor focus event");
    if (this.focused !== undefined && this.focused !== id) this.desktopTransitions++;
    this.focused = id;
  }
  fixture(event: any): void {
    if (!event || typeof event !== "object" || Object.keys(event).some(key => !["kind", "visible"].includes(key))) throw new Error("Fixture reports accept structural events only");
    switch (event.kind) {
      case "reference-visibility":
        if (typeof event.visible !== "boolean") throw new Error("Invalid visibility event");
        if (event.visible !== this.referenceVisible) this.referenceTransitions++;
        this.referenceVisible = event.visible; break;
      case "editor-visibility":
        if (typeof event.visible !== "boolean") throw new Error("Invalid visibility event");
        this.editorVisible = event.visible; break;
      case "fixture-input": this.fixtureInputs++; break;
      case "fixture-key": this.fixtureKeys++; break;
      case "decoy-input": this.decoyInputs++; break;
      case "ready": this.ready = true; break;
      default: throw new Error("Unknown structural fixture event");
    }
  }
  snapshot() {
    return {desktopTransitions: this.desktopTransitions, referenceTransitions: this.referenceTransitions,
      fixtureInputs: this.fixtureInputs, fixtureKeys: this.fixtureKeys, decoyInputs: this.decoyInputs, unexpectedTargets: this.unexpectedTargets};
  }
}

export function fixtureHtml(role: "editor" | "reference" | "decoy" | "login" | "popup"): string {
  const editor = '<textarea id="editor" aria-label="Disposable autosaving editor"></textarea><button id="focus" onclick="document.querySelector(\'#editor\').focus()">DOM focus fixture</button><select id="picker"><option value="first">First function</option><option value="second">Second function</option></select>';
  const content = role === "editor" ? editor : role === "decoy" ? '<p>Select the reference tab in the fixture browser, then return to this separate application. Type disposable text only.</p><button id="ready">Begin measurement</button><textarea id="decoy" aria-label="Decoy typing"></textarea>' : role === "login" ? '<form><input type="password" autocomplete="current-password"><button>Sign in</button></form>' : '<p>Disposable focus fixture</p>';
  return `<!doctype html><meta charset="utf-8"><title>Disposable focus fixture: ${role}</title>${content}<script>
    const report = event => fetch('/event', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event)});
    const role = ${JSON.stringify(role)};
    if (role === 'reference' || role === 'editor') {
      const visibility = () => report({kind:role+'-visibility',visible:document.visibilityState==='visible'});
      document.addEventListener('visibilitychange', visibility); visibility();
    }
    if (role !== 'decoy') document.addEventListener('keydown', event => { if (event.isTrusted) report({kind:'fixture-key'}); }, true);
    if (role === 'editor') {
      document.querySelector('#editor').addEventListener('input', event => {
        localStorage.setItem('disposable-focus-autosave', event.target.value);
        report({kind:'fixture-input'});
      });
    }
    if (role === 'decoy') {
      document.querySelector('#decoy').addEventListener('input', () => report({kind:'decoy-input'}));
      document.querySelector('#ready').onclick = () => { report({kind:'ready'}); document.querySelector('#decoy').focus(); };
    }
    document.querySelector('form')?.addEventListener('submit', event => event.preventDefault());
  </script>`;
}
