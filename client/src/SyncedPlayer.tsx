import { useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";
import { createVideoAdapter } from "./adapters";
import type { VideoAdapter } from "./adapters/types";
import type { VideoProvider } from "./resolveVideoUrl";

export type SyncedVideo = { provider: VideoProvider; source: string };

type Playback = { time: number; isPlaying: boolean };

type Props = {
  socket: Socket;
  canControl: boolean;
  video: SyncedVideo | null;
  playback: Playback;
};

export function SyncedPlayer({ socket, canControl, video, playback }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<VideoAdapter | null>(null);
  const canControlRef = useRef(canControl);
  canControlRef.current = canControl;

  const playbackRef = useRef(playback);
  playbackRef.current = playback;

  useEffect(() => {
    if (!video || !containerRef.current) {
      adapterRef.current?.destroy();
      adapterRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = "";
      return;
    }

    const el = containerRef.current;
    let cancelled = false;

    void (async () => {
      try {
        const adapter = await createVideoAdapter(video.provider, {
          source: video.source,
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
      } catch (err) {
        console.error(err);
        el.innerHTML = "";
        const p = document.createElement("p");
        p.textContent =
          err instanceof Error ? err.message : "Could not load this video.";
        el.appendChild(p);
      }
    })();

    return () => {
      cancelled = true;
      adapterRef.current?.destroy();
      adapterRef.current = null;
    };
  }, [socket, video]);

  useEffect(() => {
    const a = adapterRef.current;
    if (!a || !video) return;
    void (async () => {
      a.setSuppressEmit(true);
      if (playback.isPlaying) await a.applyPlay(playback.time);
      else await a.applyPause(playback.time);
      a.setSuppressEmit(false);
    })();
  }, [playback, video]);

  return (
    <div
      className="synced-player-wrap"
      style={{
        width: "100%",
        aspectRatio: "16 / 9",
        background: "#111",
        borderRadius: 8,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {!video && (
        <div className="synced-player-placeholder">
          No video loaded. Paste a URL and click Load video.
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
