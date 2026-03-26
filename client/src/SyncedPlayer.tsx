import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { createVideoAdapter } from "./adapters";
import type { VideoAdapter } from "./adapters/types";
import type { VideoProvider } from "./resolveVideoUrl";

export type SyncedVideo = {
  provider: VideoProvider;
  source: string;
  audioOnly?: boolean;
};

type Playback = { time: number; isPlaying: boolean };

export type PlayerLoadState = "idle" | "loading" | "ready" | "error";

const TIME_EPSILON = 0.35;
const SEEK_DEBOUNCE_MS = 160;

type Props = {
  socket: Socket;
  canControl: boolean;
  video: SyncedVideo | null;
  playback: Playback;
  onLoadStateChange?: (state: PlayerLoadState, message?: string) => void;
};

function playbackMatchesApplied(
  pb: Playback,
  applied: { time: number; isPlaying: boolean },
) {
  if (applied.time < 0) return false;
  return (
    pb.isPlaying === applied.isPlaying &&
    Math.abs(pb.time - applied.time) < TIME_EPSILON
  );
}

export function SyncedPlayer({
  socket,
  canControl,
  video,
  playback,
  onLoadStateChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<VideoAdapter | null>(null);
  const canControlRef = useRef(canControl);
  canControlRef.current = canControl;

  const playbackRef = useRef(playback);
  playbackRef.current = playback;

  const lastAppliedRef = useRef<{ time: number; isPlaying: boolean }>({
    time: -1,
    isPlaying: false,
  });
  const seekDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loadState, setLoadState] = useState<PlayerLoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);

  const reportLoad = useCallback(
    (state: PlayerLoadState, message?: string) => {
      setLoadState(state);
      if (state === "error" && message) setLoadError(message);
      else if (state !== "error") setLoadError(null);
      onLoadStateChange?.(state, message);
    },
    [onLoadStateChange],
  );

  useEffect(() => {
    if (!video) {
      reportLoad("idle");
      lastAppliedRef.current = { time: -1, isPlaying: false };
    }
  }, [video, reportLoad]);

  useEffect(() => {
    if (!video || !containerRef.current) {
      adapterRef.current?.destroy();
      adapterRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = "";
      return;
    }

    const el = containerRef.current;
    let cancelled = false;
    reportLoad("loading");

    void (async () => {
      try {
        const adapter = await createVideoAdapter(video.provider, {
          source: video.source,
          audioOnly: Boolean(video.audioOnly),
          onUserEvent: (e) => {
            if (!canControlRef.current) return;
            if (e.type === "play") socket.emit("play", { time: e.time });
            else if (e.type === "pause") socket.emit("pause", { time: e.time });
            else if (e.type === "seek") socket.emit("seek", { time: e.time });
          },
        });
        if (cancelled) {
          adapter.destroy();
          return;
        }
        adapterRef.current?.destroy();
        adapterRef.current = adapter;
        adapter.mount(el);

        const pb = playbackRef.current;
        adapter.setSuppressEmit(true);
        if (pb.isPlaying) await adapter.applyPlay(pb.time);
        else await adapter.applyPause(pb.time);
        adapter.setSuppressEmit(false);
        lastAppliedRef.current = { time: pb.time, isPlaying: pb.isPlaying };
        if (!cancelled) reportLoad("ready");
      } catch (err) {
        console.error(err);
        el.innerHTML = "";
        const msg =
          err instanceof Error ? err.message : "Could not load this video.";
        if (!cancelled) reportLoad("error", msg);
      }
    })();

    return () => {
      cancelled = true;
      adapterRef.current?.destroy();
      adapterRef.current = null;
    };
  }, [socket, video, reportLoad]);

  useEffect(() => {
    return () => {
      if (seekDebounceRef.current) {
        clearTimeout(seekDebounceRef.current);
        seekDebounceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (seekDebounceRef.current) {
      clearTimeout(seekDebounceRef.current);
      seekDebounceRef.current = null;
    }
  }, [video]);

  useEffect(() => {
    const a = adapterRef.current;
    if (!a || !video) return;

    const applied = lastAppliedRef.current;
    if (playbackMatchesApplied(playback, applied)) return;

    const samePlayState = playback.isPlaying === applied.isPlaying;

    const runApply = async (pb: Playback) => {
      const ad = adapterRef.current;
      if (!ad) return;
      ad.setSuppressEmit(true);
      if (pb.isPlaying) await ad.applyPlay(pb.time);
      else await ad.applyPause(pb.time);
      ad.setSuppressEmit(false);
      lastAppliedRef.current = { time: pb.time, isPlaying: pb.isPlaying };
    };

    if (!samePlayState) {
      void runApply(playback);
      return;
    }

    seekDebounceRef.current = setTimeout(() => {
      seekDebounceRef.current = null;
      const pb = playbackRef.current;
      void runApply(pb);
    }, SEEK_DEBOUNCE_MS);
  }, [playback, video]);

  const showLoadingOverlay = Boolean(video) && loadState === "loading";
  const showErrorOverlay = Boolean(video) && loadState === "error";

  return (
    <div className="synced-player-wrap">
      {!video && (
        <div className="synced-player-placeholder">
          No video loaded. Paste a URL and click Load video.
        </div>
      )}
      {showLoadingOverlay && (
        <div className="synced-player-overlay" aria-live="polite">
          Loading video…
        </div>
      )}
      {showErrorOverlay && loadError && (
        <div className="synced-player-overlay synced-player-overlay--error" role="alert">
          {loadError}
        </div>
      )}
      <div
        ref={containerRef}
        className="synced-player"
        style={{
          width: "100%",
          height: "100%",
          display: video ? "block" : "none",
        }}
      />
    </div>
  );
}
