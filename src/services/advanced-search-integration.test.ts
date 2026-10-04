import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/search/advanced/route";
import { POST } from "@/app/api/search/batch/route";

const { queryMediathekView, addToQueue, settings, findCategories, saveCategory, searchMulti } =
  vi.hoisted(() => ({
    queryMediathekView: vi.fn(),
    addToQueue: vi.fn(),
    settings: new Map<string, string>(),
    findCategories: vi.fn(),
    saveCategory: vi.fn(),
    searchMulti: vi.fn(),
  }));
vi.mock("@/lib/mediathek-client", () => ({ queryMediathekView }));
vi.mock("@/lib/settings", () => ({
  getSetting: async (key: string) => settings.get(key) ?? null,
}));
vi.mock("@/providers/srf", () => ({
  srfProvider: { isEnabled: async () => false },
}));
vi.mock("@/lib/db", () => ({
  prisma: { topicCategory: { findMany: findCategories, upsert: saveCategory } },
}));
vi.mock("./tmdb", () => ({ searchMulti }));
vi.mock("./download", () => ({ addToQueue }));

const item = (i: number, title: string) => ({
  channel: "ZDF",
  topic: "Wissen",
  title,
  description: "",
  timestamp: 1_790_000_000 + i,
  filmlisteTimestamp: 1_790_000_000 + i,
  duration: 1800,
  size: 10,
  url_website: "https://example.org/programme",
  url_video: `https://example.org/${i}.mp4`,
  url_video_hd: `https://example.org/${i}-hd.mp4`,
  url_video_low: "",
  url_subtitle: `https://example.org/${i}.vtt`,
  audioLanguage: "eng",
});

beforeEach(() => {
  vi.clearAllMocks();
  settings.clear();
  settings.set("matching.audioVariant", "all");
  addToQueue.mockResolvedValue({ id: "download" });
  findCategories.mockResolvedValue([{ topic: "Wissen", category: "tv" }]);
  saveCategory.mockResolvedValue({});
  searchMulti.mockResolvedValue({ mediaType: "tv", tmdbId: 42 });
});

it("keeps cached category badges without querying TMDB until results are selected", async () => {
  findCategories.mockResolvedValue([{ topic: "Topic 999", category: "movie" }]);
  queryMediathekView.mockResolvedValue(
    Array.from({ length: 1000 }, (_, i) => ({
      ...item(i, `Film ${i}`),
      topic: `Topic ${i === 997 ? 998 : i}`,
    }))
  );

  const first = await (
    await GET(new NextRequest("http://localhost/api/search/advanced?q=Film"))
  ).json();
  expect(first.total).toBe(1000);
  expect(first.results[0].category).toBe("movie");
  expect(first.results[1].category).toBeUndefined();
  expect(searchMulti).not.toHaveBeenCalled();
  expect(saveCategory).not.toHaveBeenCalled();

  const selected = first.results.slice(0, 3);
  const response = await POST(
    new NextRequest("http://localhost/api/search/batch", {
      method: "POST",
      body: JSON.stringify({
        snapshot: first.snapshot,
        ids: selected.map((result: { id: string }) => result.id),
        quality: "high",
      }),
    })
  );
  expect(response.status).toBe(200);
  expect(searchMulti).toHaveBeenCalledExactlyOnceWith("Topic 998");
  expect(saveCategory).toHaveBeenCalledTimes(1);
  expect(addToQueue.mock.calls.map((call) => call[2])).toEqual(["movie", "tv", "tv"]);
});

it.each([
  ["standard", ["Naturfilm"]],
  ["original", ["Naturfilm (OmU)"]],
  ["description", ["Naturfilm (Audiodeskription)"]],
  ["all", ["Naturfilm", "Naturfilm (OmU)", "Naturfilm (Audiodeskription)"]],
] as const)(
  "retains the configured %s audio variant in advanced search",
  async (variant, titles) => {
    settings.set("matching.audioVariant", variant);
    queryMediathekView.mockResolvedValue([
      item(1, "Naturfilm"),
      item(2, "Naturfilm (OmU)"),
      item(3, "Naturfilm (Audiodeskription)"),
    ]);

    const response = await GET(new NextRequest("http://localhost/api/search/advanced?q=Wissen"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results.map((result: { title: string }) => result.title).sort()).toEqual(
      [...titles].sort()
    );
  }
);

it("preserves subtitle and language metadata through pagination and batch downloads", async () => {
  settings.set("matching.audioVariant", "original");
  queryMediathekView.mockResolvedValue([
    item(100, "Naturfilm"),
    item(101, "Naturfilm (Audiodeskription)"),
    ...Array.from({ length: 51 }, (_, i) => item(i, `Naturfilm ${i} (OmU)`)),
  ]);

  const first = await (
    await GET(new NextRequest("http://localhost/api/search/advanced?q=Wissen"))
  ).json();
  expect(first.total).toBe(51);
  expect(first.results).toHaveLength(50);
  expect(first.hasMore).toBe(true);
  const second = await (
    await GET(
      new NextRequest(`http://localhost/api/search/advanced?snapshot=${first.snapshot}&offset=50`)
    )
  ).json();
  expect(second.results).toHaveLength(1);
  expect(second.hasMore).toBe(false);
  expect(queryMediathekView).toHaveBeenCalledTimes(1);
  const selected = [first.results[0], second.results[0]];
  expect(selected.map((result) => result.url_subtitle)).toEqual([
    "https://example.org/50.vtt",
    "https://example.org/0.vtt",
  ]);

  const response = await POST(
    new NextRequest("http://localhost/api/search/batch", {
      method: "POST",
      body: JSON.stringify({
        snapshot: first.snapshot,
        ids: selected.map((result) => result.id),
        quality: "high",
      }),
    })
  );
  expect(response.status).toBe(200);
  expect((await response.json()).results).toEqual(
    selected.map((result) => ({ id: result.id, downloadId: "download" }))
  );
  expect(addToQueue).toHaveBeenCalledTimes(2);
  for (const result of selected)
    expect(addToQueue).toHaveBeenCalledWith(result.url_video_hd, `Wissen - ${result.title}`, "tv", {
      subtitleUrl: result.url_subtitle,
      audioLanguage: "eng",
    });
});
