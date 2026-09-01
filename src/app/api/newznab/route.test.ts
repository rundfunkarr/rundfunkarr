import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mediathekMocks = vi.hoisted(() => ({
  fetchSearchResultsById: vi.fn(),
  fetchSearchResultsByString: vi.fn(),
  fetchSearchResultsForRssSync: vi.fn(),
  fetchMovieSearchResults: vi.fn(),
  fetchMovieSearchByQuery: vi.fn(),
}));
const showMocks = vi.hoisted(() => ({
  getShowInfoByTvdbId: vi.fn(),
}));
const tmdbMocks = vi.hoisted(() => ({
  getMovieInfoByTmdbId: vi.fn(),
  getMovieInfoByImdbId: vi.fn(),
}));

vi.mock("@/services/mediathek", () => mediathekMocks);
vi.mock("@/services/shows", () => showMocks);
vi.mock("@/services/tmdb", () => tmdbMocks);

import { GET } from "./route";

const EMPTY_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">
  <channel><newznab:response offset="0" total="0"/></channel>
</rss>`;

beforeEach(() => {
  vi.clearAllMocks();
  mediathekMocks.fetchSearchResultsForRssSync.mockResolvedValue(EMPTY_RSS);
});

describe("Newznab indexer validation", () => {
  it("returns a movie-category result for the Radarr sync request", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/newznab/api?t=search&extended=1&cat=2040,2030,2000&apikey=test&limit=100&offset=0"
      )
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(body).toContain('total="1"');
    expect(body).toContain('name="category" value="2040"');
    expect(body).toContain('name="category" value="2030"');
    expect(body).toContain('name="category" value="2000"');
    expect(body).not.toContain('name="category" value="5000"');
    expect(mediathekMocks.fetchSearchResultsForRssSync).toHaveBeenCalledWith(100, 0);
  });

  it("returns a TV-category result for a Sonarr sync request", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/newznab/api?t=search&cat=5040,5030,5000&limit=100&offset=0"
      )
    );
    const body = await response.text();

    expect(body).toContain('total="1"');
    expect(body).toContain('name="category" value="5040"');
    expect(body).toContain('name="category" value="5030"');
    expect(body).toContain('name="category" value="5000"');
    expect(body).not.toContain('name="category" value="2000"');
  });

  it("provides both parent categories when the client does not request categories", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/newznab/api?t=search&limit=100&offset=0")
    );
    const body = await response.text();

    expect(body).toContain('name="category" value="2000"');
    expect(body).toContain('name="category" value="5000"');
  });

  it("returns real RSS results unchanged", async () => {
    const rss = `<?xml version="1.0"?><rss><channel><newznab:response offset="0" total="1"/><item><title>Real result</title></item></channel></rss>`;
    mediathekMocks.fetchSearchResultsForRssSync.mockResolvedValue(rss);

    const response = await GET(
      new NextRequest("http://localhost/api/newznab/api?t=search&cat=2000")
    );

    await expect(response.text()).resolves.toBe(rss);
  });

  it("matches movie categories exactly instead of by substring", async () => {
    mediathekMocks.fetchSearchResultsByString.mockResolvedValue("<rss>generic search</rss>");

    const response = await GET(
      new NextRequest("http://localhost/api/newznab/api?t=search&q=Test&cat=12000")
    );

    await expect(response.text()).resolves.toBe("<rss>generic search</rss>");
    expect(mediathekMocks.fetchMovieSearchByQuery).not.toHaveBeenCalled();
    expect(mediathekMocks.fetchSearchResultsByString).toHaveBeenCalledWith("Test", null, 100, 0);
  });

  it("uses the shared movie validation response for t=movie", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/newznab/api?t=movie&limit=100&offset=0")
    );
    const body = await response.text();

    expect(body).toContain('total="1"');
    expect(body).toContain('name="category" value="2000"');
    expect(body).toContain('name="category" value="2040"');
    expect(body).not.toContain('name="category" value="5000"');
  });
});
