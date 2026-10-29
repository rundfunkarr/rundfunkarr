/**
 * Fetch wrapper with retry logic and exponential backoff
 */

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * Check if an error or status code is retryable
 */
function isRetryable(status: number): boolean {
  // Retry on server errors (5xx) and rate limiting (429)
  return status >= 500 || status === 429;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with automatic retry on transient failures
 *
 * Retries on:
 * - Network errors (fetch throws)
 * - Server errors (5xx)
 * - Rate limiting (429)
 *
 * Does NOT retry on:
 * - Client errors (4xx except 429)
 * - Successful responses (2xx, 3xx)
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULT_OPTIONS, ...options };

  let lastError: Error | null = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);

      // Success or non-retryable error - return immediately
      if (response.ok || !isRetryable(response.status)) {
        return response;
      }

      // Retryable error - save response and continue
      lastResponse = response;

      if (attempt < maxRetries) {
        const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs);
        console.log(
          `[fetchWithRetry] Request failed with status ${response.status}, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`
        );
        await sleep(delay);
      }
    } catch (error) {
      // A cancelled or timed-out request must not be retried: every retry would
      // fail the same way and only delay the caller by the backoff.
      if (init?.signal?.aborted) throw error;

      // Network error - save and retry
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs);
        console.log(
          `[fetchWithRetry] Network error, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries}): ${lastError.message}`
        );
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  if (lastResponse) {
    return lastResponse;
  }

  throw lastError || new Error("Fetch failed after retries");
}
