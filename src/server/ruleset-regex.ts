import { Worker } from "node:worker_threads";

const EXECUTION_MS = 100;
const QUEUE_WAIT_MS = 2_000;
const MAX_PENDING = 64;
const MAX_PATTERN_LENGTH = 4_096;
const MAX_INPUT_LENGTH = 65_536;
const COOLDOWN_MS = 60_000;
const MAX_COOLDOWNS = 128;

type Mode = "test" | "first" | "last";
type Results = { test: boolean; first: string | null; last: string | null };
type Result = Results[Mode];
type ErrorCode = "timeout" | "busy" | "too-large" | "unavailable";

export class RulesetRegexError extends Error {
  constructor(public readonly code: ErrorCode) {
    const messages: Record<ErrorCode, string> = {
      timeout: "Ein regulärer Ausdruck benötigt zu viel Zeit. Bitte vereinfache die Regel.",
      busy: "Die Regelauswertung ist ausgelastet. Bitte versuche es gleich erneut.",
      "too-large": "Der reguläre Ausdruck oder der auszuwertende Text ist zu lang.",
      unavailable: "Die Regelauswertung ist derzeit nicht verfügbar. Bitte versuche es erneut.",
    };
    super(messages[code]);
    this.name = "RulesetRegexError";
  }
}

// The shared executor can outlive this module's class identity during a dev reload.
export function isRulesetRegexError(error: unknown): error is RulesetRegexError {
  return (
    error instanceof Error &&
    error.name === "RulesetRegexError" &&
    "code" in error &&
    ["timeout", "busy", "too-large", "unavailable"].includes(String(error.code))
  );
}

// A self-contained source keeps this worker usable in Next's standalone build.
// Patterns and input are always message data, never interpolated into executable code.
const WORKER_SOURCE = `
const { parentPort } = require("node:worker_threads");
parentPort.on("message", ({ id, mode, pattern, value }) => {
  try {
    const regex = new RegExp(pattern);
    let result;
    if (mode === "test") {
      result = regex.test(value);
    } else {
      const match = regex.exec(value);
      result = mode === "first"
        ? (match && match.length > 1 ? match[1] ?? null : null)
        : (match ? match[match.length - 1] ?? "" : null);
    }
    parentPort.postMessage({ id, result });
  } catch (error) {
    if (error instanceof SyntaxError) {
      parentPort.postMessage({ id, result: mode === "test" ? false : null });
    } else {
      parentPort.postMessage({ id, failed: true });
    }
  }
});
parentPort.postMessage({ ready: true });
`;

interface Job {
  id: number;
  mode: Mode;
  pattern: string;
  value: string;
  resolve: (result: Result) => void;
  reject: (error: RulesetRegexError) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** Serial execution bounds CPU use; queue and input limits bound retained data. */
export class RulesetRegexExecutor {
  private worker?: Worker;
  private ready = false;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private stopping?: Promise<void>;
  private closed = false;
  private nextId = 0;
  private active?: Job;
  private queue: Job[] = [];
  private cooldowns = new Map<string, number>();

  evaluate<M extends Mode>(mode: M, pattern: string, value: string): Promise<Results[M]> {
    if (this.closed) return Promise.reject(new RulesetRegexError("unavailable"));
    if (pattern.length > MAX_PATTERN_LENGTH || value.length > MAX_INPUT_LENGTH)
      return Promise.reject(new RulesetRegexError("too-large"));
    if (this.isCoolingDown(pattern)) return Promise.reject(new RulesetRegexError("timeout"));
    if (this.queue.length + Number(Boolean(this.active)) >= MAX_PENDING)
      return Promise.reject(new RulesetRegexError("busy"));

    return new Promise<Results[M]>((resolve, reject) => {
      const job: Job = {
        id: ++this.nextId,
        mode,
        pattern,
        value,
        resolve: (result) => resolve(result as Results[M]),
        reject,
      };
      job.timer = setTimeout(() => {
        this.queue = this.queue.filter((pending) => pending !== job);
        reject(new RulesetRegexError("busy"));
      }, QUEUE_WAIT_MS);
      this.queue.push(job);
      this.drain();
    });
  }

  private isCoolingDown(pattern: string): boolean {
    const until = this.cooldowns.get(pattern);
    if (until === undefined) return false;
    if (until > Date.now()) return true;
    this.cooldowns.delete(pattern);
    return false;
  }

  private start(): void {
    try {
      const worker = new Worker(WORKER_SOURCE, {
        eval: true,
        execArgv: [],
        env: {},
        resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 4 },
      });
      this.worker = worker;
      this.startupTimer = setTimeout(() => this.stop("unavailable"), QUEUE_WAIT_MS);
      worker.on("message", (message) => {
        if (this.worker !== worker) return;
        if (message.ready) {
          clearTimeout(this.startupTimer);
          this.ready = true;
          this.drain();
          return;
        }
        const job = this.active;
        if (!job || message.id !== job.id) return;
        if (message.failed) {
          this.stop("unavailable");
          return;
        }
        clearTimeout(job.timer);
        this.active = undefined;
        job.resolve(message.result);
        this.drain();
      });
      worker.on("error", () => {
        if (this.worker === worker) this.stop("unavailable");
      });
      worker.on("exit", () => {
        if (this.worker === worker) this.stop("unavailable");
      });
    } catch {
      this.stop("unavailable");
    }
  }

  private drain(): void {
    if (this.closed || this.stopping || this.active) return;
    if (!this.queue.length) {
      this.worker?.unref();
      return;
    }
    if (!this.worker) {
      this.start();
      return;
    }
    if (!this.ready) return;
    const job = this.queue.shift()!;
    clearTimeout(job.timer);
    // An earlier job may have timed out with this same pattern while it was queued.
    if (this.isCoolingDown(job.pattern)) {
      job.reject(new RulesetRegexError("timeout"));
      this.drain();
      return;
    }
    this.active = job;
    this.worker.ref();
    job.timer = setTimeout(() => this.stop("timeout"), EXECUTION_MS);
    try {
      this.worker.postMessage({
        id: job.id,
        mode: job.mode,
        pattern: job.pattern,
        value: job.value,
      });
    } catch {
      this.stop("unavailable");
    }
  }

  private stop(code: ErrorCode): void {
    const worker = this.worker;
    this.worker = undefined;
    this.ready = false;
    clearTimeout(this.startupTimer);
    if (this.active) {
      const job = this.active;
      this.active = undefined;
      clearTimeout(job.timer);
      if (code === "timeout") {
        this.cooldowns.set(job.pattern, Date.now() + COOLDOWN_MS);
        if (this.cooldowns.size > MAX_COOLDOWNS)
          this.cooldowns.delete(this.cooldowns.keys().next().value!);
      }
      job.reject(new RulesetRegexError(code));
    }
    if (code !== "timeout") {
      for (const job of this.queue) {
        clearTimeout(job.timer);
        job.reject(new RulesetRegexError(code));
      }
      this.queue = [];
    }
    if (worker) {
      // Do not start a replacement until the runaway worker has actually exited.
      this.stopping = worker.terminate().then(
        () => undefined,
        () => undefined
      );
      void this.stopping.then(() => {
        this.stopping = undefined;
        this.drain();
      });
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.stop("unavailable");
    await this.stopping;
  }
}

// Share one worker across routes and development reloads instead of one per request.
const globalForRegex = globalThis as typeof globalThis & { rulesetRegex?: RulesetRegexExecutor };
const executor = (globalForRegex.rulesetRegex ??= new RulesetRegexExecutor());
export const runRulesetRegex = <M extends Mode>(mode: M, pattern: string, value: string) =>
  executor.evaluate(mode, pattern, value);
