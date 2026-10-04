import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/search/advanced/route";
import { POST as batch } from "@/app/api/search/batch/route";
import {
  advancedSearch,
  enqueueSelection,
  getSearchSnapshot,
  searchFilters,
} from "./advanced-search";
import { manualDownload } from "./manual-download";
import { isStreamingUrl, getStreamHeight } from "@/lib/stream-url";
const { queryContent, addToQueue, getSetting, getVideoInfo } = vi.hoisted(() => ({
  queryContent: vi.fn(),
  addToQueue: vi.fn(),
  getSetting: vi.fn(),
  getVideoInfo: vi.fn(),
}));
vi.mock("./content-search", () => ({ queryContent }));
vi.mock("./download", () => ({ addToQueue }));
vi.mock("./category", () => ({ getCategoriesForTopics: async () => new Map([["Wissen", "tv"]]) }));
vi.mock("@/lib/settings", () => ({ getSetting }));
vi.mock("@/server/ytdlp", () => ({ getVideoInfo }));
const item = (i: number, overrides = {}) => ({
  channel: "ZDF",
  topic: "Wissen",
  title: `Sendung ${i}`,
  description: "",
  timestamp: Date.UTC(2026, 8, 1, 12) / 1000 + i,
  filmlisteTimestamp: Date.UTC(2026, 9, 1) / 1000,
  duration: 1800,
  size: 10,
  url_website: "https://www.zdf.de/video",
  url_video: `https://example.org/${i}.mp4`,
  url_video_hd: `https://example.org/${i}-hd.mp4`,
  url_video_low: "",
  ...overrides,
});
beforeEach(() => {
  vi.clearAllMocks();
  queryContent.mockResolvedValue([item(1)]);
  addToQueue.mockResolvedValue({ id: "download" });
  getSetting.mockResolvedValue("false");
});
afterEach(() => vi.useRealTimers());
it("filtert nach Ausstrahlungsdatum und Laufzeit statt nach dem Änderungsdatum der Filmliste", async () => {
  queryContent.mockResolvedValue([
    item(1),
    item(2, { duration: 600 }),
    item(3, { timestamp: Date.UTC(2026, 8, 2) / 1000 }),
    item(4, { channel: "ARD" }),
  ]);
  const result = await advancedSearch(
    searchFilters.parse({
      q: "Wissen",
      channel: "ZDF",
      from: "2026-09-01",
      to: "2026-09-01",
      minMinutes: 20,
      maxMinutes: 40,
    })
  );
  expect(result.results.map((x) => x.title)).toEqual(["Sendung 1"]);
});
it("lädt weitere Ergebnisse aus derselben unveränderten Suche", async () => {
  queryContent.mockResolvedValue(Array.from({ length: 73 }, (_, i) => item(i)));
  const first = await (
    await GET(new NextRequest("http://localhost/api/search/advanced?q=Wissen"))
  ).json();
  expect(first.results).toHaveLength(50);
  expect(first.hasMore).toBe(true);
  queryContent.mockResolvedValue([item(999)]);
  const second = await (
    await GET(
      new NextRequest(`http://localhost/api/search/advanced?snapshot=${first.snapshot}&offset=50`)
    )
  ).json();
  expect(second.results).toHaveLength(23);
  expect(second.hasMore).toBe(false);
  expect(second.total).toBe(73);
  expect(new Set([...first.results, ...second.results].map((x) => x.id)).size).toBe(73);
  expect(queryContent).toHaveBeenCalledTimes(1);
});
it("weist abgelaufene Suchen und ungültige Datumsgrenzen zurück", async () => {
  vi.useFakeTimers();
  const result = await advancedSearch(searchFilters.parse({ q: "Wissen" }));
  vi.advanceTimersByTime(300001);
  expect(getSearchSnapshot(result.id)).toBeUndefined();
  expect(
    (await GET(new NextRequest(`http://localhost/api/search/advanced?snapshot=${result.id}`)))
      .status
  ).toBe(410);
  for (const input of [
    { from: "2026-02-30" },
    { from: "2026-09-02", to: "2026-09-01" },
    { minMinutes: 40, maxMinutes: 20 },
  ])
    expect(searchFilters.safeParse({ q: "Wissen", ...input }).success).toBe(false);
});
it("meldet eine begrenzte Liste und verbirgt einen Quellausfall nicht als leere Suche", async () => {
  queryContent.mockResolvedValue(Array.from({ length: 1000 }, (_, i) => item(i)));
  expect((await advancedSearch(searchFilters.parse({ q: "Wissen" }))).limited).toBe(true);
  queryContent.mockResolvedValue(null);
  expect((await GET(new NextRequest("http://localhost/api/search/advanced?q=Wissen"))).status).toBe(
    502
  );
});
it("übernimmt nur gewählte Treffer, Qualität und Kategorie und meldet Teilfehler", async () => {
  queryContent.mockResolvedValue([item(1), item(2)]);
  const result = await advancedSearch(searchFilters.parse({ q: "Wissen" }));
  addToQueue.mockRejectedValueOnce(new Error("Testfehler"));
  const rows = await enqueueSelection(
    result.id,
    result.results.map((x) => x.id),
    "low"
  );
  expect(rows?.filter((x) => x.error)).toHaveLength(1);
  expect(rows?.filter((x) => x.downloadId)).toHaveLength(1);
  expect(addToQueue).toHaveBeenCalledWith(
    "https://example.org/2.mp4",
    "Wissen - Sendung 2",
    "tv",
    {}
  );
  await expect(enqueueSelection(result.id, ["fremd"], "high")).rejects.toThrow();
});
it("weist doppelte Auswahlen zurück, bevor Downloads entstehen", async () => {
  const result = await advancedSearch(searchFilters.parse({ q: "Wissen" }));
  const id = result.results[0].id;
  const response = await batch(
    new NextRequest("http://localhost/api/search/batch", {
      method: "POST",
      body: JSON.stringify({ snapshot: result.id, ids: [id, id], quality: "high" }),
    })
  );
  expect(response.status).toBe(400);
  expect(addToQueue).not.toHaveBeenCalled();
});
it("erhält bei Mediathek-Seiten den stabilen Link und die gewünschte Stream-Qualität", async () => {
  getSetting.mockResolvedValue("true");
  getVideoInfo.mockResolvedValue({ title: "Natur: Wald" });
  await manualDownload("https://www.ardmediathek.de/video/test", "low");
  const [url, title] = addToQueue.mock.calls[0];
  expect(url).toContain("rundfunkarr-page=1");
  expect(isStreamingUrl(url)).toBe(true);
  expect(getStreamHeight(url)).toBe(480);
  expect(title).toBe("Natur_ Wald");
});
it("verhindert HTML-Dateien als Video und berücksichtigt die deaktivierte Stream-Unterstützung", async () => {
  await expect(manualDownload("https://www.zdf.de/video/test", "high")).rejects.toThrow("HLS");
  await expect(manualDownload("https://zdf.de.example.org/video/test", "high")).rejects.toThrow(
    "MP4"
  );
  await expect(manualDownload("file:///tmp/test.mp4", "high")).rejects.toThrow("HTTP");
  expect(addToQueue).not.toHaveBeenCalled();
  await manualDownload("https://example.org/Film.mp4", "high");
  expect(addToQueue).toHaveBeenCalledWith("https://example.org/Film.mp4", "Film", "default");
});
