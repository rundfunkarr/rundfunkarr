// Public API of the Mediathek search service. Importers keep using
// "@/services/mediathek"; the implementation lives in the sibling modules.
export {
  fetchSearchResultsById,
  fetchSearchResultsByString,
  fetchSearchResultsForRssSync,
} from "./series-search";
export { fetchMovieSearchResults, fetchMovieSearchByQuery } from "./movie-search";
export { diagnoseRuleset, type RuleDiagnosis } from "./rule-diagnosis";
