export type UpdatePhase = "idle" | "ready" | "updating" | "activated" | "error";
export function updateBannerLabel(phase: UpdatePhase, activeWorkout: boolean, online: boolean): string {
  if (phase === "updating") return "Updating…";
  if (phase === "error") return "Update couldn’t be applied.";
  if (activeWorkout) return "New version available — update after this workout";
  return online ? "New version available" : "Update available · offline";
}
export interface UpdateSnapshot {
  phase: UpdatePhase;
  lastResult: string;
  registration: string;
  controller: string;
  installing: string;
  waiting: string;
  active: string;
}

const empty: UpdateSnapshot = { phase: "idle", lastResult: "none", registration: "checking",
  controller: "none", installing: "none", waiting: "none", active: "none" };
let currentSnapshot = empty;
const listeners = new Set<() => void>();
export function getPwaUpdateSnapshot(): UpdateSnapshot { return currentSnapshot; }
export function subscribePwaUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(snapshot: UpdateSnapshot): void {
  currentSnapshot = snapshot;
  listeners.forEach((listener) => listener());
}

export class PwaUpdateManager {
  private registration: ServiceWorkerRegistration | null = null;
  private originalController: ServiceWorker | null;
  private requestedWorker: ServiceWorker | null = null;
  private watchedWorker: ServiceWorker | null = null;
  private phase: UpdatePhase = "idle";
  private lastResult = "none";
  private reloaded = false;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly container: ServiceWorkerContainer, private readonly reload: () => void,
    private readonly onChange: (snapshot: UpdateSnapshot) => void = publish) {
    this.originalController = container.controller;
    try { this.lastResult = sessionStorage.getItem("treino-local:pwa-last-result") ?? "none"; } catch { /* Optional diagnostic. */ }
    container.addEventListener("controllerchange", this.onControllerChange);
    this.emit();
  }

  async start(): Promise<void> {
    try {
      const registration = await this.container.register("/sw.js", { updateViaCache: "none" });
      if (this.disposed) return;
      this.registration = registration;
      registration.addEventListener("updatefound", this.onUpdateFound);
      this.watchInstalling();
      this.reconcile();
    } catch {
      this.phase = "error";
      this.lastResult = "registration failed";
      this.emit();
    }
  }

  private onUpdateFound = () => { this.watchInstalling(); this.reconcile(); };
  private onWorkerStateChange = () => { this.reconcile(); };
  private onControllerChange = () => {
    if (this.disposed) return;
    const controller = this.container.controller;
    if (this.requestedWorker && controller && controller !== this.originalController) {
      this.clearTimeout();
      this.lastResult = "new controller; reloading";
      this.phase = "activated";
      this.emit();
      this.reloadOnce();
      return;
    }
    // A first install claiming an uncontrolled page is not an update.
    if (!this.originalController && controller) this.originalController = controller;
    if (this.originalController && controller && controller !== this.originalController) {
      this.clearTimeout();
      this.phase = "activated";
      this.lastResult = "another window activated update";
      this.emit();
      return;
    }
    this.reconcile();
  };

  private watchInstalling(): void {
    const worker = this.registration?.installing ?? null;
    if (worker === this.watchedWorker) return;
    this.watchedWorker?.removeEventListener("statechange", this.onWorkerStateChange);
    this.watchedWorker = worker;
    worker?.addEventListener("statechange", this.onWorkerStateChange);
  }

  reconcile(): void {
    if (this.disposed) return;
    this.watchInstalling();
    if (this.phase === "updating" && this.requestedWorker) { this.emit(); return; }
    if (this.phase === "activated" && this.container.controller !== this.originalController) { this.emit(); return; }
    const waiting = this.registration?.waiting;
    this.phase = waiting && this.container.controller && waiting !== this.container.controller ? "ready" : "idle";
    this.emit();
  }

  async check(): Promise<void> {
    if (this.disposed || this.phase === "updating") return;
    if (!this.registration) { await this.start(); return; }
    try { await this.registration.update(); this.lastResult = "update check completed"; }
    catch { this.lastResult = "update check failed; will retry"; }
    this.reconcile();
  }

  async apply(): Promise<void> {
    if (this.disposed || this.phase === "updating" || this.reloaded) return;
    if (!this.registration) {
      await this.start();
      if (!this.registration) return;
    }
    if (this.phase === "activated" && this.container.controller !== this.originalController) {
      this.lastResult = "reloading with active update";
      this.emit();
      this.reloadOnce();
      return;
    }
    let waiting = this.registration?.waiting;
    if (!waiting) {
      this.phase = "updating";
      this.emit();
      try { await this.registration?.update(); }
      catch { this.phase = "error"; this.lastResult = "update check failed"; this.emit(); return; }
      waiting = this.registration?.waiting;
      if (!waiting) { this.phase = "idle"; this.lastResult = "already current"; this.emit(); return; }
    }
    this.requestedWorker = waiting;
    this.phase = "updating";
    this.lastResult = "activation requested";
    this.emit();
    this.timeout = setTimeout(() => {
      if (this.disposed || this.reloaded) return;
      if (this.container.controller && this.container.controller !== this.originalController) {
        this.onControllerChange();
      } else {
        this.requestedWorker = null;
        this.phase = "error";
        this.lastResult = "activation timed out";
        this.emit();
      }
    }, 15000);
    try { waiting.postMessage("SKIP_WAITING"); }
    catch { this.clearTimeout(); this.requestedWorker = null; this.phase = "error";
      this.lastResult = "activation request failed"; this.emit(); }
  }

  private reloadOnce(): void {
    if (this.reloaded) return;
    this.reloaded = true;
    this.reload();
  }
  private clearTimeout(): void { if (this.timeout) clearTimeout(this.timeout); this.timeout = undefined; }
  private emit(): void {
    if (this.disposed) return;
    try { sessionStorage.setItem("treino-local:pwa-last-result", this.lastResult); } catch { /* Optional diagnostic. */ }
    const worker = (value: ServiceWorker | null | undefined) => value ? `${value.state} · ${value.scriptURL}` : "none";
    this.onChange({ phase: this.phase, lastResult: this.lastResult,
      registration: this.registration ? "registered" : this.phase === "error" ? "failed" : "checking", controller: worker(this.container.controller),
      installing: worker(this.registration?.installing), waiting: worker(this.registration?.waiting),
      active: worker(this.registration?.active) });
  }
  dispose(): void {
    this.disposed = true;
    this.clearTimeout();
    this.container.removeEventListener("controllerchange", this.onControllerChange);
    this.registration?.removeEventListener("updatefound", this.onUpdateFound);
    this.watchedWorker?.removeEventListener("statechange", this.onWorkerStateChange);
  }
}
