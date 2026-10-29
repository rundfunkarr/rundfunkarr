import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, upsert, deleteMany } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { websitePreview: { findUnique, upsert, deleteMany } } }));

const fetchMock = vi.fn();
const PAGE = "https://www.zdf.de/serien/die-bergretter";
const IMAGE = "https://www.zdf.de/assets/bergretter-100~1920x1080";

function html(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    ...init,
    headers: { "content-type": "text/html; charset=utf-8", ...(init.headers ?? {}) },
  });
}
function redirect(location: string | null, status = 302) {
  return new Response(null, { status, headers: location ? { location } : {} });
}

async function load() {
  vi.resetModules();
  return (await import("./website-preview")).getWebsitePreview;
}

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(null);
  upsert.mockResolvedValue({});
  deleteMany.mockResolvedValue({ count: 0 });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("getWebsitePreview", () => {
  it("never fetches pages outside the broadcaster allowlist", async () => {
    const getWebsitePreview = await load();

    expect(await getWebsitePreview("https://example.com/page")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("extracts og:image, stores it for 30 days and serves repeats from memory", async () => {
    fetchMock.mockResolvedValue(
      html(`<html><head><meta property="og:image" content="${IMAGE}"></head><body>`)
    );
    const getWebsitePreview = await load();

    expect(await getWebsitePreview(`${PAGE}#player`)).toBe(IMAGE);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(PAGE),
      expect.objectContaining({
        redirect: "manual",
        headers: expect.objectContaining({ "Accept-Language": "de" }),
      })
    );
    const { create } = upsert.mock.calls[0][0];
    expect(create.url).toBe(PAGE);
    expect(create.imageUrl).toBe(IMAGE);
    const days = (create.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);

    expect(await getWebsitePreview(PAGE)).toBe(IMAGE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("uses a fresh database entry and ignores expired ones", async () => {
    findUnique.mockResolvedValueOnce({
      imageUrl: "https://cached/img.jpg",
      expiresAt: new Date(Date.now() + 1000),
    });
    let getWebsitePreview = await load();
    expect(await getWebsitePreview(PAGE)).toBe("https://cached/img.jpg");
    expect(fetchMock).not.toHaveBeenCalled();

    findUnique.mockResolvedValueOnce({ imageUrl: "https://old", expiresAt: new Date(0) });
    fetchMock.mockResolvedValue(html(`<meta name="twitter:image" content="/img.jpg">`));
    getWebsitePreview = await load();
    expect(await getWebsitePreview(PAGE)).toBe("https://www.zdf.de/img.jpg");
  });

  it("follows redirects within the allowlist and resolves images against the final URL", async () => {
    fetchMock
      .mockResolvedValueOnce(redirect("/serien/bergretter-neu", 301))
      .mockResolvedValueOnce(redirect("https://www.3sat.de/bergretter"))
      .mockResolvedValueOnce(html(`<link rel="image_src" href="bild.jpg">`));
    const getWebsitePreview = await load();

    expect(await getWebsitePreview(PAGE)).toBe("https://www.3sat.de/bild.jpg");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      PAGE,
      "https://www.zdf.de/serien/bergretter-neu",
      "https://www.3sat.de/bergretter",
    ]);
  });

  it("refuses redirects to foreign hosts and caches the miss for one day", async () => {
    fetchMock.mockResolvedValueOnce(redirect("http://127.0.0.1:8989/api"));
    const getWebsitePreview = await load();

    expect(await getWebsitePreview(PAGE)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { create } = upsert.mock.calls[0][0];
    expect(create.imageUrl).toBeNull();
    expect((create.expiresAt.getTime() - Date.now()) / 3_600_000).toBeCloseTo(24, 0);
  });

  it.each([
    ["a redirect without location", () => redirect(null)],
    [
      "a non-HTML response",
      () => new Response("{}", { headers: { "content-type": "application/json" } }),
    ],
    ["an error status", () => html("", { status: 404 })],
    ["a page without preview image", () => html("<head><title>x</title></head>")],
  ])("returns null for %s", async (_label, reply) => {
    fetchMock.mockImplementation(async () => reply());
    const getWebsitePreview = await load();

    expect(await getWebsitePreview(PAGE)).toBeNull();
  });

  it("gives up after three redirects", async () => {
    fetchMock.mockImplementation(async () => redirect("https://www.zdf.de/loop"));
    const getWebsitePreview = await load();

    expect(await getWebsitePreview(PAGE)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("treats network errors as a miss and survives database write failures", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    upsert.mockRejectedValue(new Error("database locked"));
    const getWebsitePreview = await load();

    expect(await getWebsitePreview(PAGE)).toBeNull();
  });

  it("shares one request between concurrent callers for the same page", async () => {
    let respond!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (respond = resolve)));
    const getWebsitePreview = await load();

    const first = getWebsitePreview(PAGE);
    const second = getWebsitePreview(PAGE);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    respond(html(`<meta property="og:image" content="${IMAGE}">`));

    expect(await Promise.all([first, second])).toEqual([IMAGE, IMAGE]);
  });

  it("fetches at most four pages in parallel", async () => {
    const pending: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)));
    const getWebsitePreview = await load();

    const results = Array.from({ length: 6 }, (_, i) => getWebsitePreview(`${PAGE}/${i}`));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).toHaveBeenCalledTimes(4);

    pending.shift()!(html(""));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    while (pending.length || fetchMock.mock.calls.length < 6) {
      await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
      pending.shift()!(html(""));
    }

    expect(await Promise.all(results)).toEqual(Array(6).fill(null));
  });

  it("stops reading the body after </head>", async () => {
    const encoder = new TextEncoder();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(
          encoder.encode(
            pulls === 1
              ? `<head><meta property="og:image" content="${IMAGE}"></head>`
              : "x".repeat(1000)
          )
        );
      },
    });
    fetchMock.mockResolvedValue(new Response(body, { headers: { "content-type": "text/html" } }));
    const getWebsitePreview = await load();

    expect(await getWebsitePreview(PAGE)).toBe(IMAGE);
    expect(pulls).toBeLessThanOrEqual(2);
  });

  it("prunes long-expired cache rows at most once per hour", async () => {
    fetchMock.mockImplementation(async () => html(""));
    const getWebsitePreview = await load();

    await getWebsitePreview(`${PAGE}/a`);
    await getWebsitePreview(`${PAGE}/b`);

    await vi.waitFor(() => expect(deleteMany).toHaveBeenCalledTimes(1));
    expect(deleteMany.mock.calls[0][0].where.expiresAt.lt.getTime()).toBeLessThan(
      Date.now() - 6 * 86_400_000
    );
  });
});
