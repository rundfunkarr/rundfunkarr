// Mediathek API Types
export interface MediathekApiResponse {
  result: MediathekApiResult;
  err: unknown | null;
}

export interface MediathekApiResult {
  results: ApiResultItem[];
  queryInfo: QueryInfo;
}

export interface QueryInfo {
  filmlisteTimestamp: number;
  searchEngineTime: number;
  resultCount: number;
  totalResults: number;
}

export interface ApiResultItem {
  timestamp?: number;
  channel: string;
  topic: string;
  title: string;
  description: string;
  filmlisteTimestamp: number;
  duration: number;
  size: number;
  url_website: string;
  url_video: string;
  url_video_low: string;
  url_video_hd: string;
}

// TVDB Types
export interface TvdbData {
  id: number;
  name: string;
  germanName: string | null;
  aliases: TvdbAlias[];
  episodes: TvdbEpisode[];
}

// TMDB Movie Types
export interface TmdbMovieData {
  tmdbId: number;
  imdbId: string | null;
  title: string; // Original title
  germanTitle: string; // German title
  runtime: number | null; // Runtime in minutes
  releaseDate: string | null;
}

export interface TvdbAlias {
  language: string;
  name: string;
}

export interface TvdbEpisode {
  name: string;
  aired: Date | null;
  runtime: number | null;
  seasonNumber: number;
  episodeNumber: number;
}

// Ruleset Types
export interface RulesetApiResponse {
  rulesets: Ruleset[];
  pagination: Pagination;
}

export interface Pagination {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
}

export interface Ruleset {
  id: number;
  mediaId: number;
  topic: string;
  priority: number;
  filters: string; // JSON string
  titleRegexRules: string; // JSON string
  episodeRegex: string | null;
  seasonRegex: string | null;
  matchingStrategy: MatchingStrategy;
  media: Media;
}

export interface Media {
  media_id: number;
  media_name: string;
  media_type: string;
  media_tvdbId: number;
  media_tmdbId: number | null;
  media_imdbId: string | null;
}

export enum MatchingStrategy {
  SeasonAndEpisodeNumber = "SeasonAndEpisodeNumber",
  ItemTitleIncludes = "ItemTitleIncludes",
  ItemTitleExact = "ItemTitleExact",
  ItemTitleEqualsAirdate = "ItemTitleEqualsAirdate",
}

export interface Filter {
  attribute: string;
  type: MatchType;
  value: string | number;
}

export enum MatchType {
  ExactMatch = "ExactMatch",
  Contains = "Contains",
  Regex = "Regex",
  GreaterThan = "GreaterThan",
  LessThan = "LessThan",
}

export interface TitleRegexRule {
  type: TitleRegexRuleType;
  value?: string;
  field?: string;
  pattern?: string;
}

export enum TitleRegexRuleType {
  Static = "static",
  Regex = "regex",
}

// Matched Episode Info
export interface MatchedEpisodeInfo {
  episode: TvdbEpisode;
  item: ApiResultItem;
  showName: string;
  matchedTitle: string;
  tvdbId: number;
}

// Newznab Types
export interface NewznabRss {
  channel: NewznabChannel;
}

export interface NewznabChannel {
  title: string;
  description: string;
  response: NewznabResponse;
  items: NewznabItem[];
}

export interface NewznabResponse {
  offset: number;
  total: number;
}

export interface NewznabItem {
  title: string;
  guid: NewznabGuid;
  link: string;
  comments: string;
  pubDate: string;
  category: string;
  description: string;
  enclosure: NewznabEnclosure;
  attributes: NewznabAttribute[];
}

export interface NewznabGuid {
  isPermaLink: boolean;
  value: string;
}

export interface NewznabEnclosure {
  url: string;
  length: number;
  type: string;
}

export interface NewznabAttribute {
  name: string;
  value: string;
}

// Episode Type for title generation
export enum EpisodeType {
  Standard = "standard",
  Daily = "daily",
}

// Helper functions for TvdbData
export function findEpisodeByAirDate(data: TvdbData, airDate: Date): TvdbEpisode | undefined {
  return data.episodes.find((ep) => {
    if (!ep.aired) return false;
    const epDate = new Date(ep.aired);
    return (
      epDate.getFullYear() === airDate.getFullYear() &&
      epDate.getMonth() === airDate.getMonth() &&
      epDate.getDate() === airDate.getDate()
    );
  });
}

export function findEpisodesByAirYear(data: TvdbData, year: number): TvdbEpisode[] {
  return data.episodes.filter((ep) => {
    if (!ep.aired) return false;
    return new Date(ep.aired).getFullYear() === year;
  });
}

export function findEpisodesBySeason(data: TvdbData, seasonNumber: number): TvdbEpisode[] {
  return data.episodes.filter((ep) => ep.seasonNumber === seasonNumber);
}

export function findEpisodeBySeasonAndNumber(
  data: TvdbData,
  seasonNumber: number,
  episodeNumber: number
): TvdbEpisode | undefined {
  return data.episodes.find(
    (ep) => ep.seasonNumber === seasonNumber && ep.episodeNumber === episodeNumber
  );
}

export function getPaddedSeason(episode: TvdbEpisode): string {
  return episode.seasonNumber.toString().padStart(2, "0");
}

export function getPaddedEpisode(episode: TvdbEpisode): string {
  return episode.episodeNumber.toString().padStart(2, "0");
}
