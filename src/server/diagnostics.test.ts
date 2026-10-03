import { afterEach, expect, it, vi } from "vitest";
import { testArrConnection } from "./diagnostics";
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
afterEach(() => fetchMock.mockReset());
it("prüft eine Installation mit Basispfad und gibt weder Schlüssel noch Client-Konfiguration zurück", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ appName: "Sonarr", version: "4.0" }))
    .mockResolvedValueOnce(
      Response.json([
        {
          enable: true,
          implementation: "Sabnzbd",
          fields: [{ name: "apiKey", value: "anderes-geheimnis" }],
        },
      ])
    );
  const result = await testArrConnection("sonarr", "http://server:8989/sonarr", "test-geheimnis");
  expect(result.status).toBe("ok");
  expect(fetchMock.mock.calls[0][0].toString()).toBe(
    "http://server:8989/sonarr/api/v3/system/status"
  );
  expect(fetchMock.mock.calls[0][1].headers).toEqual({ "X-Api-Key": "test-geheimnis" });
  expect(fetchMock.mock.calls[0][1].redirect).toBe("error");
  expect(JSON.stringify(result)).not.toContain("geheimnis");
});
it("unterscheidet ungültige Zugangsdaten, fehlende Download-Clients und Quellausfälle", async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
  expect((await testArrConnection("radarr", "http://server:7878", "key")).message).toContain(
    "API-Schlüssel"
  );
  fetchMock
    .mockResolvedValueOnce(Response.json({ appName: "Radarr", version: "6" }))
    .mockResolvedValueOnce(Response.json([]));
  expect((await testArrConnection("radarr", "http://server:7878", "key")).status).toBe("warn");
  fetchMock.mockRejectedValueOnce(new Error("Testfehler mit key"));
  expect((await testArrConnection("radarr", "http://server:7878", "key")).status).toBe("error");
});
it.each(["file:///tmp/test", "http://user:pass@host", "http://host?token=secret"])(
  "weist ungeeignete Basisadresse %s vor einem Abruf zurück",
  async (url) => {
    await expect(testArrConnection("sonarr", url, "key")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  }
);
