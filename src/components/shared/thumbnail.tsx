"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Image as ImageIcon } from "lucide-react";
import { useSettings } from "@/contexts/settings-context";
import { cn } from "@/lib/utils";

// One lookup per programme page for the lifetime of the tab.
const lookups = new Map<string, Promise<string | null>>();

function lookupPreview(websiteUrl: string): Promise<string | null> {
  let pending = lookups.get(websiteUrl);
  if (!pending) {
    pending = fetch(`/api/thumbnail?url=${encodeURIComponent(websiteUrl)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => (typeof data?.imageUrl === "string" ? data.imageUrl : null))
      .catch(() => null);
    lookups.set(websiteUrl, pending);
  }
  return pending;
}

/**
 * Preview image for a programme or series. Uses `src` when the source already
 * provides an image; otherwise asks the server for the programme page's preview
 * once the element scrolls into view. Renders nothing when the matching display
 * setting is off, or when no image is known unless `always` asks for a placeholder.
 */
export function Thumbnail({
  src,
  websiteUrl,
  alt = "",
  ratio = "video",
  className,
  fallback,
  always = false,
  setting = "thumbnails",
}: {
  src?: string | null;
  websiteUrl?: string;
  alt?: string;
  ratio?: "video" | "poster";
  className?: string;
  fallback?: ReactNode;
  always?: boolean;
  /** Display setting that switches this image off: preview stills or series posters. */
  setting?: "thumbnails" | "posters";
}) {
  const { settings } = useSettings();
  const enabled =
    settings?.[setting === "posters" ? "ui.posters" : "search.thumbnails"] !== "false";
  const container = useRef<HTMLDivElement>(null);
  const [lookedUp, setLookedUp] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const shouldLookUp = !src && !!websiteUrl && enabled;

  useEffect(() => {
    if (!shouldLookUp || !websiteUrl) return;
    const element = container.current;
    if (!element) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void lookupPreview(websiteUrl).then((url) => {
          if (!cancelled) setLookedUp(url);
        });
      },
      { rootMargin: "240px" }
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [shouldLookUp, websiteUrl]);

  const resolved = src || lookedUp;
  if (!enabled) return null;
  if (!resolved && !shouldLookUp && !always) return null;
  const showImage = !!resolved && !failed;

  return (
    <div
      ref={container}
      className={cn(
        "relative shrink-0 self-start overflow-hidden rounded-md bg-muted",
        ratio === "poster" ? "aspect-[2/3]" : "aspect-video",
        className
      )}
    >
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element -- images stay on the broadcasters' CDNs; no optimisation or proxying
        <img
          src={resolved}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0"
          )}
        />
      )}
      {(!showImage || !loaded) && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/60">
          {fallback ?? <ImageIcon className="size-4" aria-hidden />}
        </div>
      )}
    </div>
  );
}
