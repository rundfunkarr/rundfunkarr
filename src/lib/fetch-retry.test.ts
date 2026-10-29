import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./fetch-retry";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchWithRetry", () => {
  it("returns successful responses without retrying and forwards the request init", async () => {
    fetchMock.mockResolvedValue(new Response("ok"));
    const init = { method: "POST", body: "{}" };

    const response = await fetchWithRetry("https://example.test", init);

    expect(await response.text()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://example.test", init);
  });

  it.each([400, 401, 404])("does not retry client error %i", async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));

    const response = await fetchWithRetry("https://example.test");

    expect(response.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx and 429 with exponential backoff until a request succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response("ok"));

    const pending = fetchWithRetry("https://example.test", undefined, { baseDelayMs: 100 });

    await vi.advanceTimersByTimeAsync(99);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Second delay doubles (100 * 2^1).
    await vi.advanceTimersByTimeAsync(199);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    expect((await pending).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("caps the backoff delay at maxDelayMs", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response("ok"));

    const pending = fetchWithRetry("https://example.test", undefined, {
      baseDelayMs: 5000,
      maxDelayMs: 50,
    });
    await vi.advanceTimersByTimeAsync(50);

    expect((await pending).ok).toBe(true);
  });

  it("returns the last retryable response once retries are exhausted", async () => {
    fetchMock.mockImplementation(async () => new Response("down", { status: 502 }));

    const pending = fetchWithRetry("https://example.test", undefined, {
      maxRetries: 2,
      baseDelayMs: 10,
    });
    await vi.runAllTimersAsync();

    expect((await pending).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries network errors and rethrows the last one when retries are exhausted", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const pending = fetchWithRetry("https://example.test", undefined, {
      maxRetries: 1,
      baseDelayMs: 10,
    });
    const assertion = expect(pending).rejects.toThrow("fetch failed");
    await vi.runAllTimersAsync();

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("wraps non-Error rejections", async () => {
    fetchMock.mockRejectedValue("boom");

    await expect(
      fetchWithRetry("https://example.test", undefined, { maxRetries: 0 })
    ).rejects.toThrow("boom");
  });

  it("stops immediately when the caller's signal is aborted instead of retrying", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort(new Error("cancelled"));
      throw new DOMException("This operation was aborted", "AbortError");
    });

    await expect(
      fetchWithRetry("https://example.test", { signal: controller.signal })
    ).rejects.toThrow("aborted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
