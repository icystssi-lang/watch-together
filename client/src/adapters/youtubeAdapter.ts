import { createEmitCooldown } from "./emitCooldown";
import type { CreateAdapterOptions, VideoAdapter } from "./types";

let apiPromise: Promise<void> | null = null;

function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    tag.onerror = () => reject(new Error("Failed to load YouTube IFrame API"));
    document.body.appendChild(tag);
  });
  return apiPromise;
}

export async function createYoutubeAdapter(
  opts: CreateAdapterOptions
): Promise<VideoAdapter> {
  await loadYouTubeIframeApi();
  if (!window.YT?.Player) throw new Error("YouTube API unavailable");

  let suppress = false;
  const emitCooldown = createEmitCooldown(350);
  /** Real API object — only valid after `onReady` (`seekTo` etc. are missing before then). */
  let player: YT.Player | null = null;
  /** Constructor return — use for `destroy()` even if `onReady` never ran. */
  let instance: YT.Player | null = null;
  let pollId: ReturnType<typeof setInterval> | null = null;
  let lastKnownTime = 0;
  let destroyed = false;

  let resolveReady!: () => void;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const clearPoll = () => {
    if (pollId !== null) {
      clearInterval(pollId);
      pollId = null;
    }
  };

  const startPoll = () => {
    clearPoll();
    pollId = setInterval(() => {
      if (suppress || emitCooldown.isActive() || !player || destroyed) return;
      try {
        const t = player.getCurrentTime();
        const st = player.getPlayerState();
        if (st === YT.PlayerState.PLAYING && Math.abs(t - lastKnownTime) > 2) {
          opts.onUserEvent({ type: "seek", time: t });
        }
        lastKnownTime = t;
      } catch {
        /* ignore */
      }
    }, 600);
  };

  async function whenReady(): Promise<YT.Player | null> {
    if (destroyed) return null;
    await readyPromise;
    return destroyed ? null : player;
  }

  return {
    provider: "youtube",

    setSuppressEmit(value: boolean) {
      suppress = value;
    },

    mount(container: HTMLElement) {
      destroyed = false;
      container.innerHTML = "";
      if (opts.audioOnly) {
        const note = document.createElement("div");
        note.className = "synced-player-placeholder";
        note.textContent = "Audio-only mode: YouTube video is hidden.";
        container.appendChild(note);
      }
      const el = document.createElement("div");
      el.style.width = opts.audioOnly ? "1px" : "100%";
      el.style.height = opts.audioOnly ? "1px" : "100%";
      el.style.opacity = opts.audioOnly ? "0.01" : "1";
      el.style.pointerEvents = opts.audioOnly ? "none" : "auto";
      container.appendChild(el);

      instance = new window.YT!.Player(el, {
        videoId: opts.source,
        playerVars: { playsinline: 1, rel: 0 },
        events: {
          onReady: (e) => {
            if (destroyed) return;
            player = e.target;
            try {
              lastKnownTime = player.getCurrentTime();
            } catch {
              lastKnownTime = 0;
            }
            startPoll();
            resolveReady();
          },
          onStateChange: (e) => {
            if (suppress || emitCooldown.isActive() || !player || destroyed) return;
            try {
              const t = player.getCurrentTime();
              if (e.data === YT.PlayerState.PLAYING) {
                lastKnownTime = t;
                opts.onUserEvent({ type: "play", time: t });
                startPoll();
              } else if (e.data === YT.PlayerState.PAUSED) {
                lastKnownTime = t;
                opts.onUserEvent({ type: "pause", time: t });
              }
            } catch {
              /* ignore */
            }
          },
        },
      });
    },

    destroy() {
      destroyed = true;
      clearPoll();
      try {
        instance?.destroy();
      } catch {
        /* ignore */
      }
      instance = null;
      player = null;
      resolveReady();
    },

    async applySeek(time: number) {
      const p = await whenReady();
      if (!p || typeof p.seekTo !== "function") return;
      p.seekTo(time, true);
      lastKnownTime = time;
      emitCooldown.bump();
    },

    async applyPlay(time: number) {
      const p = await whenReady();
      if (!p || typeof p.seekTo !== "function") return;
      p.seekTo(time, true);
      p.playVideo();
      lastKnownTime = time;
      emitCooldown.bump();
    },

    async applyPause(time: number) {
      const p = await whenReady();
      if (!p || typeof p.seekTo !== "function") return;
      p.seekTo(time, true);
      p.pauseVideo();
      lastKnownTime = time;
      emitCooldown.bump();
    },
  };
}
