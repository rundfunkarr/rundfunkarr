import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  cancelProcessOnAbort,
  cancellableProcessOptions,
  terminateProcess,
} from "./process-cancellation";
it.skipIf(process.platform === "win32").each(["abort", "terminate"])(
  "beendet mit %s auch einen gestarteten Kindprozess und schließt seine geerbten Ausgabekanäle",
  async (method) => {
    const controller = new AbortController();
    const proc = spawn(
      process.execPath,
      [
        "-e",
        `const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});process.stdout.write('bereit\\n');setInterval(()=>{},1000);`,
      ],
      cancellableProcessOptions
    );
    const close = once(proc, "close");
    const cleanup = cancelProcessOnAbort(proc, controller.signal);
    try {
      await once(proc.stdout, "data");
      if (method === "abort") controller.abort("cancel");
      else terminateProcess(proc);
      const [, signal] = await close;
      expect(signal).toBe("SIGKILL");
    } finally {
      if (proc.exitCode === null && proc.signalCode === null) terminateProcess(proc);
      cleanup();
    }
  },
  3000
);
