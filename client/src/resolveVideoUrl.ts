export type VideoProvider = "youtube" | "vimeo" | "html5" | "iframe";

export type ResolveResult =
  | { ok: true; provider: VideoProvider; source: string }
  | { ok: false; reason: string };

function tryParseUrl(raw: string): URL | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    return new URL(t);
  } catch {
    try {
      return new URL(`https://${t}`);
    } catch {
      return null;
    }
  }
}

function extractYouTubeId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (host.endsWith("youtube.com")) {
    if (url.pathname.startsWith("/shorts/")) {
      const id = url.pathname.split("/")[2];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    const v = url.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const embed = url.pathname.match(/^\/embed\/([\w-]{11})/);
    if (embed) return embed[1];
  }
  return null;
}

function extractVimeoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  if (!host.endsWith("vimeo.com")) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[0];
  if (id && /^\d+$/.test(id)) return id;
  return null;
}

const DIRECT_EXT = /\.(mp4|webm|ogg)(\?.*)?$/i;

export function resolveVideoUrl(input: string): ResolveResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "Empty URL" };

  const url = tryParseUrl(trimmed);
  if (!url) return { ok: false, reason: "Invalid URL" };

  const yt = extractYouTubeId(url);
  if (yt) return { ok: true, provider: "youtube", source: yt };

  const vm = extractVimeoId(url);
  if (vm) return { ok: true, provider: "vimeo", source: vm };

  if (DIRECT_EXT.test(url.pathname) || DIRECT_EXT.test(url.href)) {
    return { ok: true, provider: "html5", source: url.href };
  }

  const proto = url.protocol.toLowerCase();
  if (proto === "http:" || proto === "https:") {
    return { ok: true, provider: "iframe", source: url.href };
  }

  return { ok: false, reason: "Unsupported URL" };
}
