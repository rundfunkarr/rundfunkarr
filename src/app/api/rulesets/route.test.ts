import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ApiResultItem } from "@/types";
import { diagnoseRuleset } from "@/services/mediathek";
const { findUnique, create, update, deleteMany, reload, show, query } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  reload: vi.fn(),
  show: vi.fn(),
  query: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: { generatedRuleset: { findUnique, create, update, deleteMany } },
}));
vi.mock("@/services/rulesets", () => ({ reloadLocalRulesets: reload }));
vi.mock("@/services/shows", () => ({ getShowInfoByTvdbId: show }));
vi.mock("@/services/content-search", () => ({ queryContent: query }));
vi.mock("@/services/mediathek", () => ({
  diagnoseRuleset: vi.fn(async () => ({ status: "matched" })),
}));
import { POST, DELETE } from "./route";
import { POST as preview } from "./preview/route";
const data = {
  topic: "Testserie",
  tvdbId: 123,
  matchingStrategy: "ItemTitleExact",
  filters: "[]",
  titleRegexRules: '[{"type":"regex","field":"title","pattern":"(.*)"}]',
  seasonRegex: "",
  episodeRegex: "",
};
const request = (body: unknown) =>
  new NextRequest("http://localhost/api/rulesets", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  show.mockResolvedValue({ name: "Testserie", germanName: null, episodes: [] });
  findUnique.mockResolvedValue(null);
  create.mockImplementation(async ({ data }) => ({ ...data, id: "lokal" }));
});

describe("Lokale Rulesets", () => {
  it("speichert einen Community-Override und aktualisiert sofort den Matcher", async () => {
    const response = await POST(request({ ...data, id: "community-123-123" }));
    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ topic: "Testserie", tvdbId: 123, showName: "Testserie" }),
    });
    expect(reload).toHaveBeenCalledOnce();
  });
  it.each([
    { filters: "{}" },
    { titleRegexRules: '[{"type":"regex","field":"title","pattern":"["}]' },
    { episodeRegex: "[" },
    { tvdbId: 0 },
  ])("weist ungültige Regeln ohne Speichern zurück: %j", async (changes) => {
    expect((await POST(request({ ...data, ...changes }))).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
  it("überschreibt keine andere lokale Regel desselben Themas", async () => {
    findUnique.mockResolvedValue({ id: "vorhanden" });
    expect((await POST(request(data))).status).toBe(409);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it("aktualisiert die Regeln auch nach dem Löschen", async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    expect((await DELETE(new NextRequest("http://localhost/api/rulesets?id=lokal"))).status).toBe(
      200
    );
    expect(reload).toHaveBeenCalledOnce();
  });
  it("löscht keine Community-Regel", async () => {
    expect(
      (await DELETE(new NextRequest("http://localhost/api/rulesets?id=community-123"))).status
    ).toBe(400);
    expect(deleteMany).not.toHaveBeenCalled();
  });
  it("zeigt einen Quellenausfall als Fehler an, nicht als leere Trefferliste", async () => {
    query.mockResolvedValue(null);
    expect((await preview(request(data))).status).toBe(502);
  });
  it("behält exakte Thementreffer vor neueren Teiltreffern innerhalb des Vorschau-Limits", async () => {
    const candidate = (title: string, topic: string, timestamp: number): ApiResultItem => ({
      channel: "ARD",
      title,
      topic,
      description: "",
      filmlisteTimestamp: timestamp,
      duration: 1800,
      size: 100,
      url_website: "https://example.org/folge",
      url_video: "https://example.org/folge.mp4",
      url_video_hd: "",
      url_video_low: "",
    });
    const partial = Array.from({ length: 30 }, (_, index) =>
      candidate(`Teiltreffer ${index}`, "Testserie Extra", 100 - index)
    );
    const exact = [candidate("Exakt neu", data.topic, 2), candidate("Exakt alt", data.topic, 1)];
    query.mockResolvedValue([...partial, ...exact]);
    vi.mocked(diagnoseRuleset).mockImplementation(async (item) => ({
      title: item.title,
      topic: item.topic,
      duration: item.duration,
      url: item.url_website,
      status: "filtered",
      reason: "Testdiagnose",
    }));

    const response = await preview(request(data));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.limit).toBe(30);
    expect(body.results).toHaveLength(30);
    expect(body.results.map((result: { title: string }) => result.title)).toEqual([
      ...exact.map((item) => item.title),
      ...partial.slice(0, 28).map((item) => item.title),
    ]);
    expect(diagnoseRuleset).toHaveBeenCalledTimes(30);
  });
  it("unterscheidet nicht verfügbare Metadaten", async () => {
    show.mockResolvedValue(null);
    expect((await preview(request(data))).status).toBe(422);
  });
});
