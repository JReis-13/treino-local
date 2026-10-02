export function safeVideoUrl(value: string | undefined): string | undefined {
  if (!value || value.length > 500) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return undefined;
    if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname) &&
        (/^\/(?:watch|shorts|embed)(?:\/|$)/.test(url.pathname))) return url.href;
    if (url.hostname === "youtu.be" && /^\/[A-Za-z0-9_-]{11}$/.test(url.pathname)) return url.href;
  } catch { /* Untrusted source link. */ }
  return undefined;
}
