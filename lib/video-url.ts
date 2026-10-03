export interface YouTubeVideo { id: string; externalUrl: string; embedUrl: string }

export function parseYouTubeVideo(value: string | undefined): YouTubeVideo | undefined {
  if (!value || value.length > 500) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return undefined;
    const fullHost = ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname);
    const id = fullHost && url.pathname === "/watch" ? url.searchParams.get("v") :
      fullHost && /^\/(?:shorts|embed)\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname) ? url.pathname.split("/")[2] :
      url.hostname === "youtu.be" && /^\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname) ? url.pathname.split("/")[1] : undefined;
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return undefined;
    return { id, externalUrl: `https://www.youtube.com/watch?v=${id}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0` };
  } catch { /* Untrusted source link. */ }
  return undefined;
}

export function safeVideoUrl(value: string | undefined): string | undefined {
  return parseYouTubeVideo(value)?.externalUrl;
}
