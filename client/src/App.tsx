import { useCallback, useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Chat } from "./Chat";
import { resolveVideoUrl } from "./resolveVideoUrl";
import { SyncedPlayer, type SyncedVideo } from "./SyncedPlayer";
import "./index.css";

type RoomPayload = {
  roomId: string;
  hostSocketId: string;
  onlyHostControls: boolean;
  videoProvider: string | null;
  videoSource: string | null;
  currentTime: number;
  isPlaying: boolean;
  username?: string;
};

function socketUrl() {
  const env = import.meta.env.VITE_SOCKET_URL;
  if (env) return env;
  return "http://localhost:3001";
}

export default function App() {
  const [socket] = useState<Socket>(() => io(socketUrl(), { autoConnect: true }));
  const [myId, setMyId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"lobby" | "room">("lobby");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [hostSocketId, setHostSocketId] = useState<string | null>(null);
  const [onlyHostControls, setOnlyHostControls] = useState(false);
  const [video, setVideo] = useState<SyncedVideo | null>(null);
  const [playback, setPlayback] = useState({ time: 0, isPlaying: false });
  const [joinInput, setJoinInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    const onConnect = () => setMyId(socket.id ?? null);
    const onDisconnect = () => setMyId(socket.id ?? null);
    const onConnectError = () =>
      setBanner("Could not reach the server. Is it running?");
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    if (socket.connected) onConnect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
    };
  }, [socket]);

  const applyRoomPayload = useCallback((p: RoomPayload) => {
    setRoomId(p.roomId);
    setHostSocketId(p.hostSocketId);
    setOnlyHostControls(p.onlyHostControls);
    setPlayback({ time: p.currentTime, isPlaying: p.isPlaying });
    if (p.username) setUsername(p.username);
    if (p.videoProvider && p.videoSource) {
      setVideo({
        provider: p.videoProvider as SyncedVideo["provider"],
        source: p.videoSource,
      });
    } else {
      setVideo(null);
    }
  }, []);

  useEffect(() => {
    const onJoined = (p: RoomPayload) => {
      applyRoomPayload(p);
      setPhase("room");
      setBanner(null);
    };
    const onLoad = (d: { provider: string; source: string }) => {
      setVideo({
        provider: d.provider as SyncedVideo["provider"],
        source: d.source,
      });
      setPlayback({ time: 0, isPlaying: false });
    };
    const onPlay = ({ time }: { time: number }) =>
      setPlayback({ time, isPlaying: true });
    const onPause = ({ time }: { time: number }) =>
      setPlayback({ time, isPlaying: false });
    const onSeek = ({ time }: { time: number }) =>
      setPlayback((prev) => ({ ...prev, time }));
    const onHostControls = ({ enabled }: { enabled: boolean }) =>
      setOnlyHostControls(enabled);
    const onHostChanged = ({ hostSocketId: id }: { hostSocketId: string }) =>
      setHostSocketId(id);
    const onDenied = () => setBanner("That action is not allowed (host only).");
    const onJoinErr = () => setBanner("Room not found.");

    socket.on("room_joined", onJoined);
    socket.on("load_video", onLoad);
    socket.on("play", onPlay);
    socket.on("pause", onPause);
    socket.on("seek", onSeek);
    socket.on("host_controls_changed", onHostControls);
    socket.on("host_changed", onHostChanged);
    socket.on("control_denied", onDenied);
    socket.on("join_error", onJoinErr);
    return () => {
      socket.off("room_joined", onJoined);
      socket.off("load_video", onLoad);
      socket.off("play", onPlay);
      socket.off("pause", onPause);
      socket.off("seek", onSeek);
      socket.off("host_controls_changed", onHostControls);
      socket.off("host_changed", onHostChanged);
      socket.off("control_denied", onDenied);
      socket.off("join_error", onJoinErr);
    };
  }, [socket, applyRoomPayload]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("room")?.trim();
    if (q) setJoinInput(q.toUpperCase());
  }, []);

  const isHost = myId != null && hostSocketId != null && myId === hostSocketId;
  const canControl = !onlyHostControls || isHost;

  const copyLink = useCallback(() => {
    if (!roomId) return;
    const u = new URL(window.location.href);
    u.searchParams.set("room", roomId);
    void navigator.clipboard.writeText(u.toString());
    setBanner("Room link copied.");
    setTimeout(() => setBanner(null), 2000);
  }, [roomId]);

  function createRoom() {
    setBanner(null);
    socket.emit("create_room");
  }

  function joinRoom() {
    const id = joinInput.trim().toUpperCase();
    if (!id) return;
    setBanner(null);
    socket.emit("join_room", { roomId: id });
  }

  function leaveRoom() {
    socket.emit("leave_room");
    setPhase("lobby");
    setRoomId(null);
    setHostSocketId(null);
    setVideo(null);
    setPlayback({ time: 0, isPlaying: false });
  }

  function loadVideo() {
    if (!canControl) return;
    const r = resolveVideoUrl(urlInput);
    if (!r.ok) {
      setBanner(r.reason);
      return;
    }
    setBanner(null);
    socket.emit("load_video", { provider: r.provider, source: r.source });
    setUrlInput("");
  }

  const hostToggle = useMemo(
    () => (
      <label className="host-toggle">
        <input
          type="checkbox"
          checked={onlyHostControls}
          disabled={!isHost}
          onChange={(e) =>
            socket.emit("set_host_only_controls", { enabled: e.target.checked })
          }
        />
        Only host can control playback
      </label>
    ),
    [isHost, onlyHostControls, socket]
  );

  if (phase === "lobby") {
    return (
      <div className="app lobby">
        <h1>Watch Together</h1>
        <p className="muted">YouTube, Vimeo, direct video files, or generic embed URLs.</p>
        {banner && <p className="banner">{banner}</p>}
        <div className="lobby-actions">
          <button type="button" onClick={createRoom}>
            Create room
          </button>
          <div className="join-row">
            <input
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
              placeholder="ROOM ID"
              maxLength={12}
            />
            <button type="button" onClick={joinRoom}>
              Join
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app room">
      <header className="room-header">
        <div>
          <h1>Watch Together</h1>
          <p className="muted">
            Room <strong>{roomId}</strong>
            {username && (
              <>
                {" "}
                · You are <strong>{username}</strong>
                {isHost && " (host)"}
              </>
            )}
          </p>
        </div>
        <div className="header-actions">
          <button type="button" onClick={copyLink}>
            Copy room link
          </button>
          <button type="button" onClick={leaveRoom}>
            Leave
          </button>
        </div>
      </header>

      {banner && <p className="banner">{banner}</p>}

      <SyncedPlayer
        socket={socket}
        canControl={canControl}
        video={video}
        playback={playback}
      />

      {video?.provider === "iframe" && (
        <p className="hint">
          Generic embed: playback may not stay in sync across everyone — use YouTube,
          Vimeo, or a direct file when possible.
        </p>
      )}

      <section className="controls">
        <div className="load-row">
          <input
            className="url-input"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Paste video URL…"
            disabled={!canControl}
          />
          <button type="button" onClick={loadVideo} disabled={!canControl}>
            Load video
          </button>
        </div>
        {hostToggle}
        {!canControl && (
          <p className="muted small">Only the host can control playback right now.</p>
        )}
      </section>

      <Chat socket={socket} disabled={false} />
    </div>
  );
}
