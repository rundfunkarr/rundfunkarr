import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cancelProcessOnAbort, cancellableProcessOptions } from "./process-cancellation";
it.skipIf(process.platform === "win32")(
  "beendet auch einen gestarteten Kindprozess und schließt seine geerbten Ausgabekanäle",
  async () => {
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
      controller.abort("cancel");
      const [, signal] = await close;
      expect(signal).toBe("SIGKILL");
    } finally {
      controller.abort();
      cleanup();
    }
  },
  3000
);
