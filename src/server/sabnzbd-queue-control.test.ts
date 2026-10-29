import { beforeEach, describe, expect, it, vi } from "vitest";

const { controlDownload, setQueuePaused, findMany } = vi.hoisted(() => ({
  controlDownload: vi.fn(),
  setQueuePaused: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock("./download-queue", () => ({ controlDownload, setQueuePaused }));
vi.mock("@/lib/db", () => ({ prisma: { download: { findMany } } }));

import { handleQueueCommand } from "./sabnzbd-queue-control";

async function run(query: string) {
  const response = await handleQueueCommand(new URLSearchParams(query));
  return response ? response.json() : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  controlDownload.mockResolvedValue(true);
});

describe("handleQueueCommand (SABnzbd queue API)", () => {
  it.each([
    ["pause", true],
    ["resume", false],
  ])("handles global mode=%s", async (mode, paused) => {
    expect(await run(`mode=${mode}`)).toEqual({ status: true });
    expect(setQueuePaused).toHaveBeenCalledWith(paused);
  });

  it("leaves unrelated commands to the caller", async () => {
    expect(await run("mode=history")).toBeNull();
    expect(await run("mode=queue")).toBeNull();
  });

  it("rejects unknown actions and missing ids", async () => {
    expect(await run("mode=queue&name=explode&value=1")).toEqual({
      status: false,
      error: "Ungültige Queue-Aktion.",
    });
    expect(await run("mode=queue&name=pause")).toMatchObject({ status: false });
    expect(controlDownload).not.toHaveBeenCalled();
  });

  it.each([
    ["pause", "pause"],
    ["resume", "resume"],
    ["delete", "cancel"],
  ])("maps queue %s to %s", async (name, action) => {
    expect(await run(`mode=queue&name=${name}&value=abc`)).toEqual({
      status: true,
      nzo_ids: ["abc"],
    });
    expect(controlDownload).toHaveBeenCalledWith("abc", action, expect.anything());
  });

  it("reports unknown or finished jobs", async () => {
    controlDownload.mockResolvedValue(false);

    expect(await run("mode=queue&name=delete&value=gone")).toEqual({
      status: false,
      nzo_ids: [],
      error: "Auftrag nicht gefunden oder bereits abgeschlossen.",
    });
  });

  it.each([
    ["1", 10],
    ["0", 0],
    ["-1", -10],
    // SABnzbd's "default" priority.
    ["-100", 0],
  ])("translates priority %s and returns the new queue position", async (value, internal) => {
    findMany.mockResolvedValue([{ id: "x" }, { id: "abc" }]);

    expect(await run(`mode=queue&name=priority&value=abc&value2=${value}`)).toEqual({
      status: true,
      position: 1,
    });
    expect(controlDownload).toHaveBeenCalledWith("abc", "priority", internal);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ priority: "desc" }, { createdAt: "asc" }] })
    );
  });

  it("treats priority -2 (paused) as pausing the job", async () => {
    findMany.mockResolvedValue([{ id: "abc" }]);

    expect(await run("mode=queue&name=priority&value=abc&value2=-2")).toEqual({
      status: true,
      position: 0,
    });
    expect(controlDownload).toHaveBeenCalledWith("abc", "pause", -20);
  });

  it.each(["", "&value2=2", "&value2=abc"])("rejects invalid priorities (%s)", async (suffix) => {
    expect(await run(`mode=queue&name=priority&value=abc${suffix}`)).toEqual({
      status: false,
      error: "Ungültige Priorität.",
    });
  });
});
