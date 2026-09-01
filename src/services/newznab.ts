import { Builder } from "xml2js";
import type {
  NewznabRss,
  NewznabItem,
  NewznabAttribute,
  MatchedEpisodeInfo,
  TvdbEpisode,
  EpisodeType,
  TmdbMovieData,
  ApiResultItem,
} from "@/types";
import type { MovieMatchResult } from "./movie-matcher";

const XML_BUILDER = new Builder({
  xmldec: { version: "1.0", encoding: "UTF-8" },
  renderOpts: { pretty: true },
});

const MOVIE_CATEGORY_IDS = new Set([
  "2000",
  "2010",
  "2020",
  "2030",
  "2040",
  "2045",
  "2050",
  "2060",
]);
const TV_CATEGORY_IDS = new Set(["5000", "5030", "5040"]);
const ADVERTISED_CATEGORY_IDS = new Set([...MOVIE_CATEGORY_IDS, ...TV_CATEGORY_IDS]);

export function generateAttributes(
  season: string | null,
  categoryValues: string[],
  tvdbId?: number
): NewznabAttribute[] {
  const attributes: NewznabAttribute[] = [];

  for (const categoryValue of categoryValues) {
    attributes.push({ name: "category", value: categoryValue });
  }

  if (season) {
    attributes.push({ name: "season", value: season });
  }

  if (tvdbId) {
    attributes.push({ name: "tvdbid", value: tvdbId.toString() });
  }

  return attributes;
}

export function getEmptyRssResult(): NewznabRss {
  return {
    channel: {
      title: "RundfunkArr",
      description: "RundfunkArr API results",
      response: {
        offset: 0,
        total: 0,
      },
      items: [],
    },
  };
}

export function serializeRss(rss: NewznabRss): string {
  const xmlObj = {
    rss: {
      $: {
        version: "2.0",
        "xmlns:newznab": "http://www.newznab.com/DTD/2010/feeds/attributes/",
      },
      channel: {
        title: rss.channel.title,
        description: rss.channel.description,
        "newznab:response": {
          $: {
            offset: rss.channel.response.offset,
            total: rss.channel.response.total,
          },
        },
        item: rss.channel.items.map((item) => ({
          title: item.title,
          guid: {
            $: { isPermaLink: item.guid.isPermaLink },
            _: item.guid.value,
          },
          link: item.link,
          comments: item.comments,
          pubDate: item.pubDate,
          category: item.category,
          description: item.description,
          enclosure: {
            $: {
              url: item.enclosure.url,
              length: item.enclosure.length,
              type: item.enclosure.type,
            },
          },
          "newznab:attr": item.attributes.map((attr) => ({
            $: { name: attr.name, value: attr.value },
          })),
        })),
      },
    },
  };

  return XML_BUILDER.buildObject(xmlObj);
}

export function convertItemsToRss(items: NewznabItem[], limit: number, offset: number): string {
  if (!items || items.length === 0) {
    return serializeRss(getEmptyRssResult());
  }

  const paginatedItems = items.slice(offset, offset + limit);

  const rss: NewznabRss = {
    channel: {
      title: "RundfunkArr",
      description: "RundfunkArr API results",
      response: {
        offset: offset,
        total: items.length,
      },
      items: paginatedItems,
    },
  };

  return serializeRss(rss);
}

export function parseNewznabCategoryIds(categoryParam: string | null): string[] {
  if (!categoryParam) {
    return [];
  }

  return [
    ...new Set(
      categoryParam
        .split(",")
        .map((category) => category.trim())
        .filter((category) => /^\d+$/.test(category))
    ),
  ];
}

export function isMovieCategoryRequest(categoryIds: string[]): boolean {
  return categoryIds.some((categoryId) => MOVIE_CATEGORY_IDS.has(categoryId));
}

export function getValidationRss(requestedCategoryIds: string[], now: Date = new Date()): string {
  const categoryIds = requestedCategoryIds.filter((categoryId) =>
    ADVERTISED_CATEGORY_IDS.has(categoryId)
  );
  const hasMovieCategory = categoryIds.some((categoryId) => MOVIE_CATEGORY_IDS.has(categoryId));
  const hasTvCategory = categoryIds.some((categoryId) => TV_CATEGORY_IDS.has(categoryId));

  if (hasMovieCategory && !categoryIds.includes("2000")) {
    categoryIds.push("2000");
  }
  if (hasTvCategory && !categoryIds.includes("5000")) {
    categoryIds.push("5000");
  }
  if (categoryIds.length === 0) {
    categoryIds.push("2000", "5000");
  }

  const movieOnly =
    categoryIds.some((categoryId) => MOVIE_CATEGORY_IDS.has(categoryId)) &&
    !categoryIds.some((categoryId) => TV_CATEGORY_IDS.has(categoryId));
  const title = movieOnly
    ? "RundfunkArr.Validation.2024.GERMAN.1080p.WEB.h264-TEST"
    : "RundfunkArr.Validation.S01E01.GERMAN.1080p.WEB.h264-TEST";

  const validationItem: NewznabItem = {
    title,
    guid: {
      isPermaLink: false,
      value: `rundfunkarr-validation-${movieOnly ? "movie" : "tv"}`,
    },
    link: "https://example.invalid/rundfunkarr-validation",
    comments: "https://example.invalid/rundfunkarr-validation",
    pubDate: now.toUTCString(),
    category: movieOnly ? "Movies > HD" : "TV > HD",
    description: "Synthetic result used to validate RundfunkArr category support.",
    enclosure: {
      url: "https://example.invalid/rundfunkarr-validation.nzb",
      length: 1_000_000,
      type: "application/x-nzb",
    },
    attributes: [
      ...categoryIds.map((categoryId) => ({ name: "category", value: categoryId })),
      { name: "size", value: "1000000" },
    ],
  };

  return convertItemsToRss([validationItem], 1, 0);
}

// Title formatting utilities
function formatTitle(title: string): string {
  // Replace German Umlaute and special characters
  let formatted = title
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue");

  // Replace & with and
  formatted = formatted.replace(/&/g, "and");

  // Remove unwanted symbols
  formatted = formatted.replace(/[/:;,""''@#?$%^*+=!|<>,()]/g, "");

  // Replace whitespace with dots
  formatted = formatted.replace(/\s+/g, ".").replace(/\.\./g, ".");

  return formatted;
}

function getPaddedSeason(episode: TvdbEpisode): string {
  return episode.seasonNumber.toString().padStart(2, "0");
}

function getPaddedEpisode(episode: TvdbEpisode): string {
  return episode.episodeNumber.toString().padStart(2, "0");
}

function generateTitle(
  info: MatchedEpisodeInfo,
  quality: string,
  episodeType: EpisodeType
): string {
  const episode = info.episode;

  if (episodeType === "daily") {
    const aired = episode.aired ? new Date(episode.aired) : new Date();
    const dateStr = aired.toISOString().split("T")[0]; // yyyy-MM-dd
    return `${info.showName}.${dateStr}.${episode.name}.GERMAN.${quality}.WEB.h264-MEDiATHEK`.replace(
      / /g,
      "."
    );
  }

  return `${info.showName}.S${getPaddedSeason(episode)}E${getPaddedEpisode(episode)}.${episode.name}.GERMAN.${quality}.WEB.h264-MEDiATHEK`.replace(
    / /g,
    "."
  );
}

function createRssItem(
  info: MatchedEpisodeInfo,
  quality: string,
  sizeMultiplier: number,
  category: string,
  categoryValues: string[],
  url: string,
  episodeType: EpisodeType
): NewznabItem {
  const adjustedSize = Math.floor(info.item.size * sizeMultiplier);
  const parsedTitle = generateTitle(info, quality, episodeType);
  const formattedTitle = formatTitle(parsedTitle);

  const encodedTitle = Buffer.from(formattedTitle).toString("base64");
  const encodedUrl = Buffer.from(url).toString("base64");

  const fakeDownloadUrl = `/api/newznab/fake_nzb_download?encodedUrl=${encodedUrl}&encodedTitle=${encodedTitle}`;
  const item = info.item;

  return {
    title: formattedTitle,
    guid: {
      isPermaLink: true,
      value: `${item.url_website}#${quality}${episodeType === "daily" ? "" : "-d"}`,
    },
    link: url,
    comments: item.url_website,
    pubDate: new Date(item.filmlisteTimestamp * 1000).toUTCString(),
    category: category,
    description: item.description,
    enclosure: {
      url: fakeDownloadUrl,
      length: adjustedSize,
      type: "application/x-nzb",
    },
    attributes: generateAttributes(getPaddedSeason(info.episode), categoryValues, info.tvdbId),
  };
}

function createRssItems(
  info: MatchedEpisodeInfo,
  quality: string,
  sizeMultiplier: number,
  category: string,
  categoryValues: string[],
  url: string
): NewznabItem[] {
  const items: NewznabItem[] = [
    createRssItem(
      info,
      quality,
      sizeMultiplier,
      category,
      categoryValues,
      url,
      "standard" as EpisodeType
    ),
  ];

  // Also create daily type if season is a year
  if (info.episode.seasonNumber > 1950) {
    items.push(
      createRssItem(
        info,
        quality,
        sizeMultiplier,
        category,
        categoryValues,
        url,
        "daily" as EpisodeType
      )
    );
  }

  return items;
}

export type QualityPreference = "all" | "best" | "1080p" | "720p" | "480p";

export function generateRssItems(
  info: MatchedEpisodeInfo,
  qualityPreference: QualityPreference = "all"
): NewznabItem[] {
  const items: NewznabItem[] = [];
  const baseCategories = ["5000", "2000"];

  const has1080p = !!info.item.url_video_hd;
  const has720p = !!info.item.url_video;
  const has480p = !!info.item.url_video_low;

  // Determine which qualities to include based on preference
  let include1080p = false;
  let include720p = false;
  let include480p = false;

  switch (qualityPreference) {
    case "all":
      include1080p = has1080p;
      include720p = has720p;
      include480p = has480p;
      break;
    case "best":
      // Only include the best available quality
      if (has1080p) {
        include1080p = true;
      } else if (has720p) {
        include720p = true;
      } else if (has480p) {
        include480p = true;
      }
      break;
    case "1080p":
      include1080p = has1080p;
      break;
    case "720p":
      include720p = has720p;
      break;
    case "480p":
      include480p = has480p;
      break;
  }

  if (include1080p) {
    items.push(
      ...createRssItems(
        info,
        "1080p",
        1.6,
        "TV > HD",
        [...baseCategories, "5040", "2040"],
        info.item.url_video_hd
      )
    );
  }

  if (include720p) {
    items.push(
      ...createRssItems(
        info,
        "720p",
        1.0,
        "TV > HD",
        [...baseCategories, "5040", "2040"],
        info.item.url_video
      )
    );
  }

  if (include480p) {
    items.push(
      ...createRssItems(
        info,
        "480p",
        0.4,
        "TV > SD",
        [...baseCategories, "5030", "2030"],
        info.item.url_video_low
      )
    );
  }

  return items;
}

// ============== MOVIE RSS GENERATION ==============

function generateMovieAttributes(
  categoryValues: string[],
  tmdbId?: number,
  imdbId?: string | null
): NewznabAttribute[] {
  const attributes: NewznabAttribute[] = [];

  for (const categoryValue of categoryValues) {
    attributes.push({ name: "category", value: categoryValue });
  }

  if (tmdbId) {
    attributes.push({ name: "tmdbid", value: tmdbId.toString() });
  }

  if (imdbId) {
    attributes.push({ name: "imdbid", value: imdbId });
  }

  return attributes;
}

function generateMovieTitle(movieData: TmdbMovieData, quality: string): string {
  const year = movieData.releaseDate ? movieData.releaseDate.split("-")[0] : "";
  const title = movieData.germanTitle || movieData.title;
  const yearPart = year ? `.${year}` : "";

  return `${title}${yearPart}.GERMAN.${quality}.WEB.h264-MEDiATHEK`.replace(/ /g, ".");
}

function createMovieRssItem(
  item: ApiResultItem,
  movieData: TmdbMovieData,
  quality: string,
  sizeMultiplier: number,
  category: string,
  categoryValues: string[],
  url: string
): NewznabItem {
  const adjustedSize = Math.floor(item.size * sizeMultiplier);
  const parsedTitle = generateMovieTitle(movieData, quality);
  const formattedTitle = formatTitle(parsedTitle);

  const encodedTitle = Buffer.from(formattedTitle).toString("base64");
  const encodedUrl = Buffer.from(url).toString("base64");

  const fakeDownloadUrl = `/api/newznab/fake_nzb_download?encodedUrl=${encodedUrl}&encodedTitle=${encodedTitle}`;

  return {
    title: formattedTitle,
    guid: {
      isPermaLink: true,
      value: `${item.url_website}#movie-${quality}`,
    },
    link: url,
    comments: item.url_website,
    pubDate: new Date(item.filmlisteTimestamp * 1000).toUTCString(),
    category: category,
    description: item.description,
    enclosure: {
      url: fakeDownloadUrl,
      length: adjustedSize,
      type: "application/x-nzb",
    },
    attributes: generateMovieAttributes(categoryValues, movieData.tmdbId, movieData.imdbId),
  };
}

/**
 * Generate RSS items for a movie match
 */
export function generateMovieRssItems(
  matchResult: MovieMatchResult,
  movieData: TmdbMovieData,
  qualityPreference: QualityPreference = "all"
): NewznabItem[] {
  const items: NewznabItem[] = [];
  const item = matchResult.item;

  // Movie categories (2000 = Movies)
  const baseCategories = ["2000"];

  const has1080p = !!item.url_video_hd;
  const has720p = !!item.url_video;
  const has480p = !!item.url_video_low;

  let include1080p = false;
  let include720p = false;
  let include480p = false;

  switch (qualityPreference) {
    case "all":
      include1080p = has1080p;
      include720p = has720p;
      include480p = has480p;
      break;
    case "best":
      if (has1080p) {
        include1080p = true;
      } else if (has720p) {
        include720p = true;
      } else if (has480p) {
        include480p = true;
      }
      break;
    case "1080p":
      include1080p = has1080p;
      break;
    case "720p":
      include720p = has720p;
      break;
    case "480p":
      include480p = has480p;
      break;
  }

  if (include1080p) {
    items.push(
      createMovieRssItem(
        item,
        movieData,
        "1080p",
        1.6,
        "Movies > HD",
        [...baseCategories, "2040"],
        item.url_video_hd
      )
    );
  }

  if (include720p) {
    items.push(
      createMovieRssItem(
        item,
        movieData,
        "720p",
        1.0,
        "Movies > HD",
        [...baseCategories, "2040"],
        item.url_video
      )
    );
  }

  if (include480p) {
    items.push(
      createMovieRssItem(
        item,
        movieData,
        "480p",
        0.4,
        "Movies > SD",
        [...baseCategories, "2030"],
        item.url_video_low
      )
    );
  }

  return items;
}

/**
 * Generate RSS items for API results that don't match any ruleset.
 * Uses topic + title as the release name so they still appear in search results.
 */
export function generateGenericRssItems(
  item: ApiResultItem,
  qualityPreference: QualityPreference = "all"
): NewznabItem[] {
  const items: NewznabItem[] = [];
  const baseCategories = ["5000"];

  const has1080p = !!item.url_video_hd;
  const has720p = !!item.url_video;
  const has480p = !!item.url_video_low;

  let include1080p = false;
  let include720p = false;
  let include480p = false;

  switch (qualityPreference) {
    case "all":
      include1080p = has1080p;
      include720p = has720p;
      include480p = has480p;
      break;
    case "best":
      if (has1080p) {
        include1080p = true;
      } else if (has720p) {
        include720p = true;
      } else if (has480p) {
        include480p = true;
      }
      break;
    case "1080p":
      include1080p = has1080p;
      break;
    case "720p":
      include720p = has720p;
      break;
    case "480p":
      include480p = has480p;
      break;
  }

  if (include1080p) {
    items.push(
      createGenericRssItem(
        item,
        "1080p",
        1.6,
        "TV > HD",
        [...baseCategories, "5040"],
        item.url_video_hd
      )
    );
  }

  if (include720p) {
    items.push(
      createGenericRssItem(
        item,
        "720p",
        1.0,
        "TV > HD",
        [...baseCategories, "5040"],
        item.url_video
      )
    );
  }

  if (include480p) {
    items.push(
      createGenericRssItem(
        item,
        "480p",
        0.4,
        "TV > SD",
        [...baseCategories, "5030"],
        item.url_video_low
      )
    );
  }

  return items;
}

/**
 * Parse season and episode numbers from Mediathek titles.
 * Common patterns:
 *   (S01/E05), (S2026/E02)  — standard ARD/ZDF format
 *   (4/6)                    — episode/total format (no season info)
 *   Folge 5, Folge 5:        — episode-only with optional colon
 *   Staffel 2 Folge 3        — explicit season + episode
 */
function parseEpisodeFromTitle(title: string): {
  season: number | null;
  episode: number | null;
  episodeName: string;
} {
  let season: number | null = null;
  let episode: number | null = null;
  let episodeName = title;

  // Pattern 1: (S01/E05) or S01/E05
  const sPattern = title.match(/\(?S(\d+)\/E(\d+)\)?/i);
  if (sPattern) {
    season = parseInt(sPattern[1], 10);
    episode = parseInt(sPattern[2], 10);
    episodeName = title.replace(sPattern[0], "").trim();
  }

  // Pattern 2: Staffel N Folge N
  if (episode === null) {
    const staffelPattern = title.match(/Staffel\s+(\d+)\s+Folge\s+(\d+)/i);
    if (staffelPattern) {
      season = parseInt(staffelPattern[1], 10);
      episode = parseInt(staffelPattern[2], 10);
      episodeName = title.replace(staffelPattern[0], "").trim();
    }
  }

  // Pattern 3: Folge N (with optional episode name after colon)
  if (episode === null) {
    const folgePattern = title.match(/Folge\s+(\d+)(?:\s*:\s*(.+?))?(?:\s*\(|$)/i);
    if (folgePattern) {
      episode = parseInt(folgePattern[1], 10);
      if (folgePattern[2]) {
        episodeName = folgePattern[2].trim();
      } else {
        episodeName = title.replace(folgePattern[0], "").trim();
      }
    }
  }

  // Pattern 4: (N/N) — episode/total, only if no season found yet
  if (episode === null) {
    const fracPattern = title.match(/\((\d+)\/(\d+)\)/);
    if (fracPattern) {
      episode = parseInt(fracPattern[1], 10);
      episodeName = title.replace(fracPattern[0], "").trim();
    }
  }

  // Clean up episode name: remove trailing "(Audiodeskription)", "(mit Untertitel)", etc.
  episodeName = episodeName
    .replace(/\(Audiodeskription\)/gi, "")
    .replace(/\(mit Untertitel\)/gi, "")
    .replace(/\(Originalversion\)/gi, "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Remove leading/trailing punctuation artifacts
  episodeName = episodeName.replace(/^[:\-–\s]+|[:\-–\s]+$/g, "").trim();

  return { season, episode, episodeName };
}

function createGenericRssItem(
  item: ApiResultItem,
  quality: string,
  sizeMultiplier: number,
  category: string,
  categoryValues: string[],
  url: string
): NewznabItem {
  const adjustedSize = Math.floor(item.size * sizeMultiplier);

  const parsed = parseEpisodeFromTitle(item.title);
  let rawTitle: string;

  if (parsed.episode !== null) {
    const seasonNum = parsed.season ?? 1;
    const paddedSeason = seasonNum.toString().padStart(2, "0");
    const paddedEpisode = parsed.episode.toString().padStart(2, "0");
    // Omit the episode-name segment when the pattern consumed the whole title
    // (e.g. "Staffel 2 Folge 3"), otherwise it duplicates the SxxExx info.
    rawTitle = parsed.episodeName
      ? `${item.topic}.S${paddedSeason}E${paddedEpisode}.${parsed.episodeName}.GERMAN.${quality}.WEB.h264-MEDiATHEK`
      : `${item.topic}.S${paddedSeason}E${paddedEpisode}.GERMAN.${quality}.WEB.h264-MEDiATHEK`;
  } else {
    rawTitle = `${item.topic}.${item.title}.GERMAN.${quality}.WEB.h264-MEDiATHEK`;
  }

  const formattedTitle = formatTitle(rawTitle);

  const encodedTitle = Buffer.from(formattedTitle).toString("base64");
  const encodedUrl = Buffer.from(url).toString("base64");

  const fakeDownloadUrl = `/api/newznab/fake_nzb_download?encodedUrl=${encodedUrl}&encodedTitle=${encodedTitle}`;

  const attributes: NewznabAttribute[] = categoryValues.map((v) => ({
    name: "category",
    value: v,
  }));

  // Add season/episode attributes if parsed
  if (parsed.episode !== null) {
    const seasonNum = parsed.season ?? 1;
    attributes.push({
      name: "season",
      value: seasonNum.toString().padStart(2, "0"),
    });
    attributes.push({
      name: "episode",
      value: parsed.episode.toString().padStart(2, "0"),
    });
  }

  return {
    title: formattedTitle,
    guid: {
      isPermaLink: true,
      value: `${item.url_website}#${quality}`,
    },
    link: url,
    comments: item.url_website,
    pubDate: new Date(item.filmlisteTimestamp * 1000).toUTCString(),
    category: category,
    description: item.description,
    enclosure: {
      url: fakeDownloadUrl,
      length: adjustedSize,
      type: "application/x-nzb",
    },
    attributes,
  };
}

// Generate fake NZB file content
export function generateFakeNzb(url: string, title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
  <!-- ${url} -->
  <head>
    <meta type="title">${title}</meta>
  </head>
  <file poster="RundfunkArr" date="${Math.floor(Date.now() / 1000)}" subject="${title}">
    <groups>
      <group>alt.binaries.mediathek</group>
    </groups>
    <segments>
      <segment bytes="1024" number="1">${Buffer.from(url).toString("base64")}</segment>
    </segments>
  </file>
</nzb>`;
}

// Capabilities XML
export function getCapabilitiesXml(): string {
  const caps = {
    caps: {
      server: {
        $: {
          version: "1.0",
          title: "RundfunkArr",
          strapline: "German Public TV Indexer",
          email: "",
          url: "",
        },
      },
      limits: {
        $: {
          max: "100",
          default: "100",
        },
      },
      registration: {
        $: {
          available: "no",
          open: "no",
        },
      },
      searching: {
        search: { $: { available: "yes", supportedParams: "q" } },
        "tv-search": { $: { available: "yes", supportedParams: "q,tvdbid,season,ep" } },
        "movie-search": { $: { available: "yes", supportedParams: "q,tmdbid,imdbid" } },
      },
      categories: {
        category: [
          {
            $: { id: "5000", name: "TV" },
            subcat: [{ $: { id: "5030", name: "TV/SD" } }, { $: { id: "5040", name: "TV/HD" } }],
          },
          {
            $: { id: "2000", name: "Movies" },
            subcat: [
              { $: { id: "2030", name: "Movies/SD" } },
              { $: { id: "2040", name: "Movies/HD" } },
            ],
          },
        ],
      },
    },
  };

  return XML_BUILDER.buildObject(caps);
}
