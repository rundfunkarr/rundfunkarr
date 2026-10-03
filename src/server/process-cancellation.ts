import type { ChildProcess } from "node:child_process";

// Unter POSIX erhält der gestartete Prozess eine eigene Prozessgruppe.
// Beim Abbrechen müssen auch von yt-dlp gestartete FFmpeg-Prozesse enden.
export const cancellableProcessOptions = { detached: process.platform !== "win32" };
export function cancelProcessOnAbort(proc: ChildProcess, signal?: AbortSignal): () => void {
  const abort = () => {
    try {
      if (process.platform !== "win32" && proc.pid) process.kill(-proc.pid, "SIGKILL");
      else proc.kill("SIGKILL");
    } catch {
      /* Der Prozess kann bereits beendet sein. */
    }
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  return () => signal?.removeEventListener("abort", abort);
}
