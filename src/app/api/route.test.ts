import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Download } from "@prisma/client";

const { create, findMany } = vi.hoisted(() => ({ create: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { download: { create, findMany } } }));
vi.mock("@/server/download-manager", () => ({ startDownloadProcessing: vi.fn(async () => {}) }));

import { GET, POST } from "./route";
import { POST as webPost } from "./download/route";
import { GET as generateNzb } from "./newznab/fake_nzb_download/route";

const title = "Checker.Tobi.S14E03.GERMAN.1080p.WEB.h264-MEDiATHEK";
const url = "https://example.org/video--1080.mp4?token=a&quality=hd";
const invalidNzb =
  '<nzb><file poster="test" date="0" subject="test"><groups><group>test</group></groups><segments><segment bytes="0" number="1">test</segment></segments></file></nzb>';

async function generatedNzb() {
  const params = new URLSearchParams({
    encodedTitle: Buffer.from(title).toString("base64"),
    encodedUrl: Buffer.from(url).toString("base64"),
  });
  return (
    await generateNzb(new NextRequest(`http://localhost/api/newznab/fake_nzb_download?${params}`))
  ).text();
}

function upload(content: string, query = "&output=json&cat=", fileName = `${title}.nzb`) {
  const form = new FormData();
  form.set("name", new File([content], fileName, { type: "application/x-nzb" }));
  return new NextRequest(`http://localhost/api?mode=addfile${query}`, {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  create.mockImplementation(async ({ data }) => ({ ...data, id: "download-id" }));
});

describe("SABnzbd addfile compatibility", () => {
  it("returns the issue #43 error as plain text when output is omitted", async () => {
    const response = await POST(upload(invalidNzb, "&cat=&priority=0"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("error: Invalid NZB format\n");
    expect(create).not.toHaveBeenCalled();
  });

  it("returns a structured JSON failure for Sonarr's output=json", async () => {
    const response = await POST(upload(invalidNzb));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: false, error: "Invalid NZB format" });
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["720p", "1080p"])(
    "round-trips the generated NZB as a %s multipart upload",
    async (quality) => {
      const fileName = title.replace("1080p", quality);
      const response = await POST(
        upload(await generatedNzb(), "&output=json&cat=sonarr", `${fileName}.nzb`)
      );
      expect(await response.json()).toEqual({ status: true, nzo_ids: ["download-id"] });
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({ title: fileName, url, category: "sonarr" }),
      });
    }
  );

  it("does not extract URLs from unrelated multipart fields", async () => {
    const form = new FormData();
    form.set("name", new File([invalidNzb], "test.nzb"));
    form.set("other", `<!-- ${url} -->`);
    const response = await POST(
      new NextRequest("http://localhost/api?mode=addfile&output=json", {
        method: "POST",
        body: form,
      })
    );
    expect(await response.json()).toEqual({ status: false, error: "Invalid NZB format" });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a missing file part with an actionable error", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api?mode=addfile&output=json", {
        method: "POST",
        body: new FormData(),
      })
    );
    expect(await response.json()).toEqual({ status: false, error: "Missing NZB file" });
  });

  it("rejects malformed multipart bodies without treating transport headers as NZB content", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api?mode=addfile&output=json", {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data" },
        body: `filename="test.nzb"\n<!-- ${url} -->`,
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: false, error: "Invalid NZB upload" });
    expect(create).not.toHaveBeenCalled();
  });

  it("reports queue failures in the same Sonarr-compatible envelope", async () => {
    create.mockRejectedValueOnce(new Error("Queue unavailable"));
    const response = await POST(upload(await generatedNzb()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: false, error: "Queue unavailable" });
  });

  it("keeps raw XML uploads and HTTP errors working for the web UI", async () => {
    const body = `filename="${title}.nzb"\n<!-- ${url} -->`;
    const response = await webPost(
      new NextRequest("http://localhost/api/download?mode=addfile&cat=default", {
        method: "POST",
        body,
      })
    );
    expect(await response.json()).toEqual({ status: true, nzo_ids: ["download-id"] });
    const invalid = await webPost(
      new NextRequest("http://localhost/api/download?mode=addfile", {
        method: "POST",
        body: invalidNzb,
      })
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "Invalid NZB format" });
  });
});

describe("SABnzbd download tracking", () => {
  it("keeps failed downloads visible with their error and without an invented storage path", async () => {
    findMany.mockResolvedValueOnce([
      {
        id: "failed-id",
        title,
        category: "",
        status: "failed",
        error: "Download failed",
        filePath: null,
        size: BigInt(0),
        completedAt: null,
      },
    ]);
    const response = await GET(new NextRequest("http://localhost/api?mode=history"));
    expect(await response.json()).toEqual({
      history: {
        slots: [
          {
            nzo_id: "failed-id",
            name: title,
            category: "",
            status: "Failed",
            fail_message: "Download failed",
            storage: "",
            bytes: 0,
            completed: 0,
          },
        ],
      },
    });
  });

  it.each(["", "&cat=", "&cat=sonarr", "&cat=default"])(
    "keeps the category and ID through upload, queue and history (%s)",
    async (categoryQuery) => {
      let download: Download;
      create.mockImplementation(async ({ data }) => {
        download = {
          ...data,
          size: BigInt(0),
          totalSize: BigInt(0),
          downloadedBytes: BigInt(0),
          speed: BigInt(0),
          filePath: null,
          error: null,
          completedAt: null,
        };
        return download;
      });
      findMany.mockImplementation(async ({ where }) =>
        where.status.in.includes(download.status) ? [download] : []
      );
      const category = new URLSearchParams(categoryQuery).get("cat") ?? "";
      const added = await (
        await POST(upload(await generatedNzb(), `&output=json${categoryQuery}`))
      ).json();
      const id = added.nzo_ids[0];
      const queue = await (
        await GET(new NextRequest("http://localhost/api?mode=queue&output=json"))
      ).json();
      expect(queue.queue.slots).toEqual([
        expect.objectContaining({ nzo_id: id, cat: category, status: "Queued" }),
      ]);
      download!.status = "completed";
      download!.completedAt = new Date("2026-10-01T12:00:00Z");
      download!.filePath = `/data/${category || "default"}/${title}.mp4`;
      download!.size = BigInt(1024);
      const completedQueue = await (
        await GET(new NextRequest("http://localhost/api?mode=queue"))
      ).json();
      expect(completedQueue.queue.slots).toEqual([]);
      const history = await (
        await GET(new NextRequest("http://localhost/api?mode=history&output=json"))
      ).json();
      expect(history.history.slots).toEqual([
        expect.objectContaining({
          nzo_id: id,
          category,
          status: "Completed",
          storage: download!.filePath,
          bytes: 1024,
        }),
      ]);
      // Sonarr 4.0.20.3014's GetItems filters by exact category, even if empty.
      expect(
        history.history.slots.filter(
          (item: { category: string }) =>
            item.category === category || (item.category === "*" && category === "")
        )
      ).toHaveLength(1);
    }
  );
});
