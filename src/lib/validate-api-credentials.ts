/** Use the server to validate both newly entered and masked saved credentials. */
export async function validateApiCredentials(
  provider: "tvdb" | "tmdb",
  key: string,
  pin?: string
): Promise<boolean> {
  const response = await fetch("/api/settings/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, key, pin }),
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.valid === true;
}
