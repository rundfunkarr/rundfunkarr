import packageJson from "../../package.json";

const RELEASE_VERSION = /^\d+\.\d+\.\d+/;

/**
 * Builds the version label shown in the UI.
 *
 * Docker images pass their build channel: the release version for tags ("1.4.0"),
 * otherwise the branch ("main"), "nightly" or "pr-71". Those builds show the short
 * commit as well, because one channel name covers many builds. Without build info
 * (local development, native installs) the package.json version is shown.
 */
export function formatAppVersion(
  build: string | undefined,
  commit: string | undefined,
  packageVersion: string
): string {
  const channel = build?.trim().replace(/^v(?=\d)/, "");
  if (!channel) return `v${packageVersion}`;
  if (RELEASE_VERSION.test(channel)) return `v${channel}`;
  const shortCommit = commit?.trim().slice(0, 7);
  return shortCommit ? `${channel} · ${shortCommit}` : channel;
}

// NEXT_PUBLIC_* values are inlined at build time; the Dockerfile sets them from build args.
export const appVersion = formatAppVersion(
  process.env.NEXT_PUBLIC_APP_VERSION,
  process.env.NEXT_PUBLIC_APP_COMMIT,
  packageJson.version
);
