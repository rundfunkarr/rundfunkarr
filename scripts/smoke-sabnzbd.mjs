// Run with npm run test:sabnzbd. Requires ffmpeg and ffprobe on PATH.
// Uses an isolated database, local media server and temporary download folders.
// This checks the real HTTP/download lifecycle; it does not launch Sonarr.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
const require = createRequire(path.join(process.cwd(), "package.json"));
const { PrismaClient } = require("@prisma/client");
const root = await mkdtemp(path.join(tmpdir(), "rundfunkarr-43-44-proof-"));
console.log(`Evidence: ${root}`);
const env = {
  ...process.env,
  DATABASE_URL: `file:${root}/test.db`,
  DOWNLOAD_FOLDER_PATH: `${root}/downloads`,
  DOWNLOAD_TEMP_PATH: `${root}/incomplete`,
  DOWNLOAD_FOLDER_PATH_MAPPING: "",
  TVDB_API_KEY: "",
  TVDB_PIN: "",
  TMDB_API_KEY: "",
  NODE_ENV: "production",
};
execFileSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { env, stdio: "pipe" }
);
const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
await db.config.create({ data: { key: "download.convertToMkv", value: "false" } });
const fixtures = new Map();
for (const height of [720, 1080]) {
  const file = `${root}/fixture-${height}.mp4`;
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=blue:s=${height === 720 ? 1280 : 1920}x${height}:d=0.3`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    file,
  ]);
  fixtures.set(`/${height}.mp4`, await readFile(file));
}
let release;
const source = createServer(async (req, res) => {
  const bytes = fixtures.get(req.url);
  if (!bytes) {
    res.writeHead(404).end();
    return;
  }
  await new Promise((resolve) => {
    release = resolve;
  });
  res.writeHead(200, { "Content-Length": bytes.length, "Content-Type": "video/mp4" });
  res.end(bytes);
});
await new Promise((resolve) => source.listen(0, "127.0.0.1", resolve));
const sourcePort = source.address().port;
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const base = `http://127.0.0.1:${port}`;
const log = createWriteStream(`${root}/server.log`);
const app = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)],
  { env, stdio: ["ignore", "pipe", "pipe"] }
);
const appExited = new Promise((resolve) => app.once("exit", resolve));
app.stdout.pipe(log);
app.stderr.pipe(log);
const results = [];
const request = (url, options) =>
  fetch(`${base}${url}`, { ...options, signal: AbortSignal.timeout(10000) });
async function waitFor(fn) {
  for (let i = 0; i < 150; i++) {
    const result = await fn();
    if (result) return result;
    await delay(100);
  }
  throw new Error("Timed out");
}
function form(content, title = "test") {
  const data = new FormData();
  data.set("name", new Blob([content], { type: "application/x-nzb" }), `${title}.nzb`);
  return data;
}
try {
  await waitFor(async () => {
    try {
      return (await request("/api?mode=version")).ok;
    } catch {
      return false;
    }
  });
  const invalid =
    '<nzb><file poster="test" date="0" subject="test"><groups><group>test</group></groups><segments><segment bytes="0" number="1">test</segment></segments></file></nzb>';
  for (const output of ["", "&output=json"]) {
    const response = await request(`/api?mode=addfile&cat=&priority=0${output}`, {
      method: "POST",
      body: form(invalid),
    });
    assert.equal(response.status, 200);
    const body = output ? await response.json() : await response.text();
    assert.deepEqual(
      body,
      output ? { status: false, error: "Invalid NZB format" } : "error: Invalid NZB format\n"
    );
    assert.equal(await db.download.count(), 0);
    results.push({
      case: output ? "invalid-json" : "invalid-text",
      httpStatus: response.status,
      body,
    });
  }
  for (const [height, category] of [
    [720, ""],
    [1080, ""],
    [1080, "sonarr"],
  ]) {
    release = undefined;
    const title = `Checker.Tobi.S14E03.${height}p.${category || "uncategorized"}`;
    const mediaUrl = `http://127.0.0.1:${sourcePort}/${height}.mp4`;
    const params = new URLSearchParams({
      encodedUrl: Buffer.from(mediaUrl).toString("base64"),
      encodedTitle: Buffer.from(title).toString("base64"),
    });
    const nzb = await (await request(`/api/newznab/fake_nzb_download?${params}`)).text();
    const added = await (
      await request(`/api?mode=addfile&output=json&cat=${category}`, {
        method: "POST",
        body: form(nzb, title),
      })
    ).json();
    assert.equal(added.status, true);
    const id = added.nzo_ids[0];
    await waitFor(() => Boolean(release));
    const queue = await (await request("/api?mode=queue&output=json")).json();
    const item = queue.queue.slots.find((item) => item.nzo_id === id);
    assert.equal(item.cat, category);
    assert.equal(item.status, "Downloading");
    release();
    const historyItem = await waitFor(async () => {
      const history = await (await request("/api?mode=history&output=json")).json();
      return history.history.slots.find((item) => item.nzo_id === id);
    });
    assert.equal(historyItem.status, "Completed");
    assert.equal(historyItem.category, category);
    assert.equal(historyItem.storage, `${root}/downloads/${category || "default"}/${title}.mp4`);
    assert.deepEqual(await readFile(historyItem.storage), fixtures.get(`/${height}.mp4`));
    assert.equal((await db.download.findUnique({ where: { id } })).category, category);
    const finishedQueue = await (await request("/api?mode=queue")).json();
    assert(!finishedQueue.queue.slots.some((item) => item.nzo_id === id));
    const metadata = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width,height",
          "-of",
          "json",
          historyItem.storage,
        ],
        { encoding: "utf8" }
      )
    );
    assert.equal(metadata.streams[0].height, height);
    results.push({
      case: `${height}p-${category || "empty-category"}`,
      added,
      queue: item,
      history: historyItem,
      ffprobe: metadata,
      databaseCategory: category,
      byteIdentical: true,
    });
  }
  await writeFile(`${root}/results.json`, JSON.stringify({ passed: true, results }, null, 2));
  console.log(
    JSON.stringify({ passed: true, cases: results.length, evidence: `${root}/results.json` })
  );
} finally {
  release?.();
  app.kill("SIGTERM");
  await appExited;
  source.closeAllConnections();
  await new Promise((resolve) => source.close(resolve));
  await db.$disconnect();
  log.end();
}
