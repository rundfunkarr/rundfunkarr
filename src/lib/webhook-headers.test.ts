import { describe, expect, it } from "vitest";
import { MAX_WEBHOOK_HEADERS, parseWebhookHeaders, webhookHeaderSecrets } from "./webhook-headers";

describe("parseWebhookHeaders", () => {
  it("reads one header per line and ignores blank lines and surrounding spaces", () => {
    expect(
      parseWebhookHeaders("Authorization: Bearer abc:def\r\n\n  X-Source :  RundfunkArr  \n")
    ).toEqual({ headers: { Authorization: "Bearer abc:def", "X-Source": "RundfunkArr" } });
    expect(parseWebhookHeaders("")).toEqual({ headers: {} });
    expect(parseWebhookHeaders(undefined)).toEqual({ headers: {} });
  });

  it.each([
    ["Authorization Bearer geheim", "Zeile 1: „Name: Wert“ erwartet."],
    [": geheim", "Zeile 1: „Name: Wert“ erwartet."],
    ["X-Ok: 1\nX Bad: geheim", "Zeile 2: ungültiger Header-Name."],
    ["Badä: geheim", "Zeile 1: ungültiger Header-Name."],
    ["X-Empty:", "Zeile 1: Wert fehlt."],
    [
      "X-Token: geheim\rX-Injected: 1",
      "Zeile 1: Der Wert darf nur ASCII-Zeichen ohne Steuerzeichen enthalten.",
    ],
    [
      "X-Token: gehe\u0000im",
      "Zeile 1: Der Wert darf nur ASCII-Zeichen ohne Steuerzeichen enthalten.",
    ],
    ["X-Token: geheimü", "Zeile 1: Der Wert darf nur ASCII-Zeichen ohne Steuerzeichen enthalten."],
    ["X-Token: a\nx-token: b", "Zeile 2: „x-token“ steht doppelt."],
    [`X-Long: ${"a".repeat(4097)}`, "Zeile 1: Der Wert ist zu lang."],
  ])("rejects %j", (input, error) => {
    expect(parseWebhookHeaders(input)).toEqual({ error });
  });

  it.each(["Content-Type", "content-length", "HOST", "Transfer-Encoding", "Connection"])(
    "does not let %s override what RundfunkArr or the HTTP client sets",
    (name) => {
      expect(parseWebhookHeaders(`${name}: text/plain`).error).toBe(
        `Zeile 1: „${name}“ setzt RundfunkArr selbst.`
      );
    }
  );

  it("limits the number of headers", () => {
    const lines = (count: number) =>
      Array.from({ length: count }, (_, i) => `X-H${i}: v`).join("\n");
    expect(parseWebhookHeaders(lines(MAX_WEBHOOK_HEADERS)).headers).toBeDefined();
    expect(parseWebhookHeaders(lines(MAX_WEBHOOK_HEADERS + 1)).error).toBe(
      `Höchstens ${MAX_WEBHOOK_HEADERS} Header möglich.`
    );
  });

  it("never repeats header values in error messages", () => {
    for (const input of ["geheim-ohne-doppelpunkt", "geheim name: x", "X-A: geheimä"])
      expect(parseWebhookHeaders(input).error).not.toContain("geheim");
  });
});

describe("webhookHeaderSecrets", () => {
  it("returns full values and the credential after an auth scheme, even for invalid input", () => {
    expect(
      webhookHeaderSecrets("Authorization: Bearer tok-123\nX-Api-Key: key-456\nkaputt\nX-Empty:")
    ).toEqual(["Bearer tok-123", "tok-123", "key-456"]);
    expect(webhookHeaderSecrets("Content-Type: geheim-trotzdem")).toEqual(["geheim-trotzdem"]);
    expect(webhookHeaderSecrets(null)).toEqual([]);
  });
});
