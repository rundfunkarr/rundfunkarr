import * as path from "path";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { rememberLogSecret } from "@/lib/logger";

/**
 * Outbound notifications (generic webhook, ntfy, Gotify, Discord).
 *
 * Sending is fire-and-forget: callers use the `notify*` functions, which return
 * immediately and never throw. Every request has a short timeout and is sent
 * exactly once; failures only end up in the log. Like the other third-party
 * API calls (TVDB, TMDB, SRG-SSR), notifications use plain fetch without the
 * download proxy, which is meant for geo-blocked media only.
 */

export const NOTIFICATION_TARGETS = ["webhook", "ntfy", "gotify", "discord"] as const;
export type NotificationTarget = (typeof NOTIFICATION_TARGETS)[number];
export type NotificationEventName =
  | "download.completed"
  | "download.failed"
  | "subscription.queued"
  | "test";
/** Severity in Apprise naming, so the webhook payload fits Apprise-style receivers. */
export type NotificationType = "success" | "failure" | "info";

export interface NotificationDownload {
  id: string;
  title: string;
  channel: string | null;
  category: string | null;
  fileName: string | null;
  filePath: string | null;
  size: number | null;
  warning: string | null;
  error: string | null;
}

export interface NotificationSubscription {
  id: string;
  name: string;
  query: string;
  downloads: { id: string; title: string; channel: string | null }[];
}

/** Stable webhook payload. Fields are only ever added; `version` changes on breaking changes. */
export interface NotificationPayload {
  version: 1;
  event: NotificationEventName;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: string;
  download: NotificationDownload | null;
  subscription: NotificationSubscription | null;
}

export interface TargetConfig {
  url: string;
  topic?: string;
  token?: string;
}

export interface SendResult {
  target: NotificationTarget;
  success: boolean;
  error?: string;
}

export const SEND_TIMEOUT_MS = 10_000;
/** Upper bound for concurrently pending requests; protects against piling up on a dead target. */
const MAX_IN_FLIGHT = 20;
const MAX_BODY_LENGTH = 1500;
const MAX_LISTED_DOWNLOADS = 10;
const DEFAULT_NTFY_URL = "https://ntfy.sh";

const EVENT_SETTINGS: Record<Exclude<NotificationEventName, "test">, string> = {
  "download.completed": "notifications.event.downloadCompleted",
  "download.failed": "notifications.event.downloadFailed",
  "subscription.queued": "notifications.event.subscriptionQueued",
};

export const TARGET_LABELS: Record<NotificationTarget, string> = {
  webhook: "Webhook",
  ntfy: "ntfy",
  gotify: "Gotify",
  discord: "Discord",
};

/** Setting keys per target. `enabled` defaults to on; a target is used once it is configured. */
export const TARGET_SETTINGS: Record<
  NotificationTarget,
  { url: string; topic?: string; token?: string }
> = {
  webhook: { url: "notifications.webhook.url" },
  ntfy: {
    url: "notifications.ntfy.url",
    topic: "notifications.ntfy.topic",
    token: "notifications.ntfy.token",
  },
  gotify: { url: "notifications.gotify.url", token: "notifications.gotify.token" },
  discord: { url: "notifications.discord.url" },
};

function enabledKey(target: NotificationTarget) {
  return `notifications.${target}.enabled`;
}

const shared = globalThis as typeof globalThis & {
  rundfunkarrNotifications?: { inFlight: number };
};
const state = (shared.rundfunkarrNotifications ??= { inFlight: 0 });

function logWarning(message: string) {
  console.warn(`[Benachrichtigungen] ${message}`);
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Same field order for every event, so payloads read consistently. */
function downloadInfo(download: NotificationDownload): NotificationDownload {
  const { id, title, channel, category, fileName, filePath, size, warning, error } = download;
  return { id, title, channel, category, fileName, filePath, size, warning, error };
}

function withChannel(title: string, channel: string | null) {
  return channel ? `${title} (${channel})` : title;
}

export function buildDownloadCompletedPayload(
  download: Omit<NotificationDownload, "fileName" | "error">,
  now = new Date()
): NotificationPayload {
  const fileName = download.filePath ? path.basename(download.filePath) : null;
  const lines = [withChannel(download.title, download.channel)];
  if (fileName) lines.push(`Datei: ${fileName}`);
  if (download.warning) lines.push(`Hinweis: ${download.warning}`);
  return {
    version: 1,
    event: "download.completed",
    type: "success",
    title: "Download abgeschlossen",
    body: truncate(lines.join("\n"), MAX_BODY_LENGTH),
    timestamp: now.toISOString(),
    download: downloadInfo({ ...download, fileName, error: null }),
    subscription: null,
  };
}

export function buildDownloadFailedPayload(
  download: Pick<NotificationDownload, "id" | "title" | "channel" | "category"> & { error: string },
  now = new Date()
): NotificationPayload {
  const lines = [withChannel(download.title, download.channel), `Fehler: ${download.error}`];
  return {
    version: 1,
    event: "download.failed",
    type: "failure",
    title: "Download fehlgeschlagen",
    body: truncate(lines.join("\n"), MAX_BODY_LENGTH),
    timestamp: now.toISOString(),
    download: downloadInfo({
      ...download,
      fileName: null,
      filePath: null,
      size: null,
      warning: null,
    }),
    subscription: null,
  };
}

export function buildSubscriptionQueuedPayload(
  subscription: NotificationSubscription,
  now = new Date()
): NotificationPayload {
  const count = subscription.downloads.length;
  const listed = subscription.downloads
    .slice(0, MAX_LISTED_DOWNLOADS)
    .map((item) => `• ${withChannel(item.title, item.channel)}`);
  if (count > MAX_LISTED_DOWNLOADS) listed.push(`… und ${count - MAX_LISTED_DOWNLOADS} weitere`);
  return {
    version: 1,
    event: "subscription.queued",
    type: "info",
    title: `Suchabo „${subscription.name}“: ${count === 1 ? "1 neuer Download" : `${count} neue Downloads`}`,
    body: truncate(listed.join("\n"), MAX_BODY_LENGTH),
    timestamp: now.toISOString(),
    download: null,
    subscription,
  };
}

export function buildTestPayload(
  target: NotificationTarget,
  now = new Date()
): NotificationPayload {
  return {
    version: 1,
    event: "test",
    type: "info",
    title: "Testnachricht von RundfunkArr",
    body: `Wenn diese Nachricht ankommt, ist ${TARGET_LABELS[target]} richtig eingerichtet.`,
    timestamp: now.toISOString(),
    download: null,
    subscription: null,
  };
}

export interface OutboundRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function parseHttpUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label}: ungültige Adresse.`);
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error(`${label}: nur http:// und https:// werden unterstützt.`);
  return url;
}

const DISCORD_COLORS: Record<NotificationType, number> = {
  success: 0x2e9d5b,
  failure: 0xd64545,
  info: 0x3b82c4,
};
const NTFY_TAGS: Record<NotificationType, string> = {
  success: "white_check_mark",
  failure: "x",
  info: "inbox_tray",
};

/** Builds the HTTP request for one target. Throws a German message for incomplete settings. */
export function buildRequest(
  target: NotificationTarget,
  config: TargetConfig,
  payload: NotificationPayload
): OutboundRequest {
  const json = { "Content-Type": "application/json", "User-Agent": "RundfunkArr" };
  const label = TARGET_LABELS[target];
  switch (target) {
    case "webhook": {
      if (!config.url.trim()) throw new Error("Webhook: Adresse fehlt.");
      return {
        url: parseHttpUrl(config.url, label).toString(),
        headers: json,
        body: JSON.stringify(payload),
      };
    }
    case "ntfy": {
      const topic = config.topic?.trim();
      if (!topic) throw new Error("ntfy: Topic fehlt.");
      // JSON publishing goes to the server root and keeps umlauts intact (header titles are ASCII-only).
      const url = parseHttpUrl(config.url.trim() || DEFAULT_NTFY_URL, label);
      const token = config.token?.trim();
      return {
        url: url.toString(),
        headers: token ? { ...json, Authorization: `Bearer ${token}` } : json,
        body: JSON.stringify({
          topic,
          title: payload.title,
          message: payload.body,
          tags: [NTFY_TAGS[payload.type]],
          priority: payload.type === "failure" ? 4 : 3,
        }),
      };
    }
    case "gotify": {
      if (!config.url.trim()) throw new Error("Gotify: Serveradresse fehlt.");
      const token = config.token?.trim();
      if (!token) throw new Error("Gotify: App-Token fehlt.");
      const url = parseHttpUrl(config.url, label);
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/message`;
      return {
        url: url.toString(),
        headers: { ...json, "X-Gotify-Key": token },
        body: JSON.stringify({
          title: payload.title,
          message: payload.body,
          priority: payload.type === "failure" ? 8 : 5,
        }),
      };
    }
    case "discord": {
      if (!config.url.trim()) throw new Error("Discord: Webhook-Adresse fehlt.");
      return {
        url: parseHttpUrl(config.url, label).toString(),
        headers: json,
        body: JSON.stringify({
          username: "RundfunkArr",
          // Titles come from broadcasters; never let them ping anyone.
          allowed_mentions: { parse: [] },
          embeds: [
            {
              title: truncate(payload.title, 256),
              description: payload.body,
              color: DISCORD_COLORS[payload.type],
              timestamp: payload.timestamp,
            },
          ],
        }),
      };
    }
  }
}

/** Sends one request with a timeout. Never throws; the result carries a German error text. */
export async function sendToTarget(
  target: NotificationTarget,
  config: TargetConfig,
  payload: NotificationPayload
): Promise<SendResult> {
  let request: OutboundRequest;
  try {
    request = buildRequest(target, config, payload);
  } catch (error) {
    return { target, success: false, error: (error as Error).message };
  }
  if (state.inFlight >= MAX_IN_FLIGHT)
    return { target, success: false, error: "Zu viele ausstehende Benachrichtigungen." };
  state.inFlight++;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Timeout", "TimeoutError")),
    SEND_TIMEOUT_MS
  );
  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      // Do not forward tokens to wherever a redirect points; 3xx is reported as an error.
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.ok) {
      await response.body?.cancel().catch(() => {});
      return { target, success: true };
    }
    const detail = truncate((await response.text().catch(() => "")).trim(), 200);
    return {
      target,
      success: false,
      error: `HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
    };
  } catch (error) {
    const name = (error as Error)?.name;
    return {
      target,
      success: false,
      error:
        name === "TimeoutError" || name === "AbortError"
          ? `Keine Antwort nach ${SEND_TIMEOUT_MS / 1000} Sekunden.`
          : `Nicht erreichbar: ${(error as Error)?.message || String(error)}`,
    };
  } finally {
    clearTimeout(timer);
    state.inFlight--;
  }
}

function targetKeys(target: NotificationTarget) {
  return Object.values(TARGET_SETTINGS[target]);
}

function readTargetConfig(
  target: NotificationTarget,
  values: Record<string, string | null>
): TargetConfig {
  const keys = TARGET_SETTINGS[target];
  const config: TargetConfig = {
    url: values[keys.url] ?? "",
    topic: keys.topic ? (values[keys.topic] ?? "") : undefined,
    token: keys.token ? (values[keys.token] ?? "") : undefined,
  };
  rememberTargetSecrets(target, config);
  return config;
}

/** Registers a target's secret fields for log redaction before anything is sent. */
export function rememberTargetSecrets(target: NotificationTarget, config: TargetConfig) {
  // Make sure secrets never show up verbatim in the log, even if read from env-initialized rows
  // or typed into the settings form but not saved yet.
  if (target === "webhook" || target === "discord") rememberLogSecret(config.url);
  rememberLogSecret(config.token);
}

/** A target is active when it is not switched off and its required fields are filled in. */
function isConfigured(target: NotificationTarget, config: TargetConfig) {
  if (target === "ntfy") return Boolean(config.topic?.trim());
  if (target === "gotify") return Boolean(config.url.trim() && config.token?.trim());
  return Boolean(config.url.trim());
}

/** Loads all active targets for an event, or none when the event is switched off. */
export async function activeTargets(
  event: NotificationEventName
): Promise<{ target: NotificationTarget; config: TargetConfig }[]> {
  const keys = [
    ...(event === "test" ? [] : [EVENT_SETTINGS[event]]),
    ...NOTIFICATION_TARGETS.flatMap((target) => [enabledKey(target), ...targetKeys(target)]),
  ];
  const values = await getSettings(keys);
  if (event !== "test" && values[EVENT_SETTINGS[event]] === "false") return [];
  return NOTIFICATION_TARGETS.flatMap((target) => {
    if (values[enabledKey(target)] === "false") return [];
    const config = readTargetConfig(target, values);
    return isConfigured(target, config) ? [{ target, config }] : [];
  });
}

/** Sends a payload to all active targets in parallel. Never throws. */
export async function dispatchNotification(payload: NotificationPayload): Promise<SendResult[]> {
  let targets: Awaited<ReturnType<typeof activeTargets>>;
  try {
    targets = await activeTargets(payload.event);
  } catch (error) {
    logWarning(`Einstellungen konnten nicht gelesen werden: ${(error as Error)?.message}`);
    return [];
  }
  const results = await Promise.all(
    targets.map(({ target, config }) => sendToTarget(target, config, payload))
  );
  for (const result of results)
    if (!result.success)
      logWarning(`${TARGET_LABELS[result.target]} (${payload.event}): ${result.error}`);
  return results;
}

/** Starts sending in the background. Neither blocks nor throws. */
function fireAndForget(build: () => Promise<NotificationPayload>) {
  try {
    void build()
      .then(dispatchNotification)
      .catch((error) => logWarning(`Versand fehlgeschlagen: ${(error as Error)?.message}`));
  } catch (error) {
    logWarning(`Versand fehlgeschlagen: ${(error as Error)?.message}`);
  }
}

/** Downloads queued by a search subscription know their broadcaster; others do not store it. */
async function channelOf(downloadId: string): Promise<string | null> {
  try {
    const match = await prisma.subscriptionMatch.findFirst({
      where: { downloadId },
      select: { channel: true },
    });
    return match?.channel || null;
  } catch {
    return null;
  }
}

export function notifyDownloadCompleted(download: {
  id: string;
  title: string;
  category?: string | null;
  filePath: string;
  size: number;
  warning?: string | null;
}) {
  fireAndForget(async () =>
    buildDownloadCompletedPayload({
      id: download.id,
      title: download.title,
      channel: await channelOf(download.id),
      category: download.category || null,
      filePath: download.filePath,
      size: download.size,
      warning: download.warning || null,
    })
  );
}

export function notifyDownloadFailed(download: {
  id: string;
  title?: string | null;
  category?: string | null;
  error: string;
}) {
  fireAndForget(async () =>
    buildDownloadFailedPayload({
      id: download.id,
      title: download.title || `Download ${download.id}`,
      channel: await channelOf(download.id),
      category: download.category || null,
      error: download.error,
    })
  );
}

export function notifySubscriptionQueued(subscription: NotificationSubscription) {
  if (subscription.downloads.length === 0) return;
  fireAndForget(async () => buildSubscriptionQueuedPayload(subscription));
}
