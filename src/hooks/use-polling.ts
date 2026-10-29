"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

/** Passed to every run of a `usePolling` loader. */
export interface PollRun {
  /** Aborted when the component unmounts or the loader changes. Pass it to `fetch`. */
  signal: AbortSignal;
  /** False once the run was aborted or a newer run started. Only update state while true. */
  isCurrent: () => boolean;
}

type Loader = (run: PollRun) => Promise<void>;

function start(load: Loader, controller: AbortController, sequence: RefObject<number>) {
  const id = ++sequence.current;
  return load({
    signal: controller.signal,
    isCurrent: () => !controller.signal.aborted && id === sequence.current,
  });
}

/**
 * Keeps component state in sync with a server resource: runs `load` after mount and whenever
 * it changes (memoize it with useCallback), then every `intervalMs` if set.
 *
 * `load` handles its own errors and sets state only after awaiting its request, and only while
 * `run.isCurrent()` holds. Slow responses then never overwrite newer ones, and nothing is
 * applied after unmount. Set loading flags in event handlers or initial state, not in `load`.
 *
 * Returns `refresh`, which starts an extra run right away (buttons, after actions) and resolves
 * when that run has finished.
 */
export function usePolling(load: Loader, intervalMs: number | null = null): () => Promise<void> {
  const sequence = useRef(0);
  const active = useRef<{ load: Loader; controller: AbortController } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    active.current = { load, controller };
    void start(load, controller, sequence);
    const timer = intervalMs
      ? setInterval(() => void start(load, controller, sequence), intervalMs)
      : undefined;
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [load, intervalMs]);

  return useCallback(() => {
    const current = active.current;
    return current ? start(current.load, current.controller, sequence) : Promise.resolve();
  }, []);
}
