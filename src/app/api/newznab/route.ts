import { NextRequest, NextResponse } from "next/server";
import {
  fetchSearchResultsById,
  fetchSearchResultsByString,
  fetchSearchResultsForRssSync,
  fetchMovieSearchResults,
  fetchMovieSearchByQuery,
} from "@/services/mediathek";
import { getShowInfoByTvdbId } from "@/services/shows";
import { getMovieInfoByTmdbId, getMovieInfoByImdbId } from "@/services/tmdb";
import {
  serializeRss,
  getEmptyRssResult,
  getValidationRss,
  isMovieCategoryRequest,
  parseNewznabCategoryIds,
} from "@/services/newznab";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const t = searchParams.get("t");
  const limit = parseInt(searchParams.get("limit") || "100", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const q = searchParams.get("q");
  const tvdbid = searchParams.get("tvdbid");
  const imdbid = searchParams.get("imdbid");
  const tmdbid = searchParams.get("tmdbid");
  const season = searchParams.get("season");
  const episode = searchParams.get("ep");
  const categoryIds = parseNewznabCategoryIds(searchParams.get("cat"));

  // Handle capabilities request
  if (t === "caps") {
    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<caps>
    <limits max="5000" default="5000"/>
    <registration available="no" open="no"/>
    <searching>
        <search available="yes" supportedParams="q"/>
        <tv-search available="yes" supportedParams="q,season,ep,tvdbid"/>
        <movie-search available="yes" supportedParams="q,tmdbid,imdbid"/>
        <audio-search available="no" supportedParams="" />
    </searching>
    <categories>
        <category id="2000" name="Movies">
            <subcat id="2040" name="HD"/>
            <subcat id="2030" name="SD"/>
        </category>
        <category id="5000" name="TV">
            <subcat id="5040" name="HD"/>
            <subcat id="5030" name="SD"/>
        </category>
    </categories>
</caps>`;

    return new NextResponse(xmlContent, {
      status: 200,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  }

  // Handle movie search requests
  if (t === "movie") {
    console.log(
      `[Newznab] Movie search request: t=${t}, q=${q}, tmdbid=${tmdbid}, imdbid=${imdbid}`
    );

    try {
      // Search by TMDB ID
      if (tmdbid) {
        const parsedTmdbId = parseInt(tmdbid, 10);
        console.log(`[Newznab] Searching movie by TMDB ID: ${parsedTmdbId}`);
        if (!isNaN(parsedTmdbId)) {
          const movieData = await getMovieInfoByTmdbId(parsedTmdbId);
          console.log(
            `[Newznab] TMDB lookup result: ${movieData ? `Found "${movieData.germanTitle}" (Original: "${movieData.title}")` : "Not found"}`
          );

          if (!movieData) {
            return new NextResponse(serializeRss(getEmptyRssResult()), {
              status: 200,
              headers: { "Content-Type": "application/xml; charset=utf-8" },
            });
          }

          const searchResults = await fetchMovieSearchResults(movieData, limit, offset);

          return new NextResponse(searchResults, {
            status: 200,
            headers: { "Content-Type": "application/xml; charset=utf-8" },
          });
        }
      }

      // Search by IMDB ID
      if (imdbid) {
        console.log(`[Newznab] Searching movie by IMDB ID: ${imdbid}`);
        const movieData = await getMovieInfoByImdbId(imdbid);
        console.log(
          `[Newznab] IMDB lookup result: ${movieData ? `Found "${movieData.germanTitle}" (Original: "${movieData.title}")` : "Not found"}`
        );

        if (!movieData) {
          return new NextResponse(serializeRss(getEmptyRssResult()), {
            status: 200,
            headers: { "Content-Type": "application/xml; charset=utf-8" },
          });
        }

        const searchResults = await fetchMovieSearchResults(movieData, limit, offset);

        return new NextResponse(searchResults, {
          status: 200,
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      }

      // Search by query string for movies
      if (q) {
        console.log(`[Newznab] Movie search by query: ${q} - not implemented, returning empty`);
        return new NextResponse(serializeRss(getEmptyRssResult()), {
          status: 200,
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      }

      // No search criteria provided - return a category-compatible validation item
      return new NextResponse(getValidationRss(["2000", "2040"]), {
        status: 200,
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      });
    } catch (error) {
      console.error("Movie search error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 400 }
      );
    }
  }

  // Handle TV search requests
  if (t === "tvsearch" || t === "search") {
    // Check if this is a movie search (by category)
    const isMovieSearch = isMovieCategoryRequest(categoryIds);

    if (isMovieSearch && q) {
      console.log(
        `[Newznab] Movie search via t=search detected: q=${q}, cat=${categoryIds.join(",")}`
      );

      try {
        const searchResults = await fetchMovieSearchByQuery(q, limit, offset);
        return new NextResponse(searchResults, {
          status: 200,
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      } catch (error) {
        console.error("Movie search by query error:", error);
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Unknown error" },
          { status: 400 }
        );
      }
    }

    console.log(
      `[Newznab] TV search request: t=${t}, q=${q}, tvdbid=${tvdbid}, season=${season}, episode=${episode}`
    );

    try {
      // Search by TVDB ID
      if (tvdbid) {
        const parsedTvdbId = parseInt(tvdbid, 10);
        console.log(`[Newznab] Searching by TVDB ID: ${parsedTvdbId}`);
        if (!isNaN(parsedTvdbId)) {
          const tvdbData = await getShowInfoByTvdbId(parsedTvdbId);
          console.log(
            `[Newznab] TVDB lookup result: ${tvdbData ? `Found "${tvdbData.name}" (German: "${tvdbData.germanName}")` : "Not found"}`
          );

          if (!tvdbData) {
            return new NextResponse(serializeRss(getEmptyRssResult()), {
              status: 200,
              headers: { "Content-Type": "application/xml; charset=utf-8" },
            });
          }

          const searchResults = await fetchSearchResultsById(
            tvdbData,
            season,
            episode,
            limit,
            offset
          );

          return new NextResponse(searchResults, {
            status: 200,
            headers: { "Content-Type": "application/xml; charset=utf-8" },
          });
        }
      }

      // RSS sync (no params) - return dummy result for Sonarr test
      if (!q && !season && !imdbid && !tvdbid && !tmdbid) {
        const searchResults = await fetchSearchResultsForRssSync(limit, offset);

        // If no results, return an item in the categories requested by the *arr app
        if (searchResults.includes('total="0"')) {
          return new NextResponse(getValidationRss(categoryIds), {
            status: 200,
            headers: { "Content-Type": "application/xml; charset=utf-8" },
          });
        }

        return new NextResponse(searchResults, {
          status: 200,
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      }

      // Search by query string
      const searchResults = await fetchSearchResultsByString(q, season, limit, offset);
      return new NextResponse(searchResults, {
        status: 200,
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      });
    } catch (error) {
      console.error("Search error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
