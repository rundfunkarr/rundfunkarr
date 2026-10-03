import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { findMany, count } = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { download: { findMany, count } } }));
import { GET } from "./route";
import { GET as webGET } from "./download/route";

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  count.mockResolvedValue(123);
});

describe.each([GET, webGET])("Historienseiten", (get) => {
  it("begrenzt die Datenbankabfrage und liefert die Gesamtzahl", async () => {
    const response = await get(
      new NextRequest("http://localhost/api?mode=history&start=50&limit=50")
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      history: { slots: [], noofslots: 123, start: 50, limit: 50 },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 50,
        take: 50,
        orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      })
    );
  });

  it("behält die vollständige Historie für bestehende Clients bei", async () => {
    const response = await get(new NextRequest("http://localhost/api?mode=history"));
    expect(await response.json()).toEqual({ history: { slots: [] } });
    const query = findMany.mock.calls[0][0];
    expect(query).not.toHaveProperty("take");
    expect(query).not.toHaveProperty("skip");
    expect(count).not.toHaveBeenCalled();
  });

  it.each([
    "limit=0",
    "limit=1001",
    "limit=1.5",
    "start=-1",
    "start=NaN",
    "start=2147483648",
    "limit=",
  ])("weist ungültige Grenzen zurück: %s", async (query) => {
    const response = await get(new NextRequest(`http://localhost/api?mode=history&${query}`));
    expect(response.status).toBe(400);
    expect(findMany).not.toHaveBeenCalled();
  });
});
