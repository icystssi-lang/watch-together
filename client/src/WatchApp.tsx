import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { socketUrl } from "./apiBase";
import { Chat } from "./Chat";
import { resolveVideoUrl } from "./resolveVideoUrl";
import { SyncedPlayer, type SyncedVideo } from "./SyncedPlayer";
import "./index.css";

export type Peer = {
  socketId: string;
  displayName: string;
  sub: string | null;
};

type RoomPayload = {
  roomId: string;
  hostSocketId: string;
  onlyHostControls: boolean;
  videoProvider: string | null;
  videoSource: string | null;
  currentTime: number;
  isPlaying: boolean;
  username?: string;
  maxUsers?: number | null;
  peers?: Peer[];
};

type Props = {
  token: string;
  onLogout: () => void;
  isAdmin?: boolean;
};

export function WatchApp({ token, onLogout, isAdmin }: Props) {
  const [socket, setSocket] = useState<Socket | null>(null);
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
  const [maxUsers, setMaxUsers] = useState<number | null>(10);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [kickTarget, setKickTarget] = useState("");
  const [maxInput, setMaxInput] = useState("10");
  const [maxUnlimited, setMaxUnlimited] = useState(false);

  useEffect(() => {
    const s = io(socketUrl(), { auth: { token } });
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, [token]);

  useEffect(() => {
    if (!socket) return;
    const onConnect = () => setMyId(socket.id ?? null);
    const onDisconnect = () => setMyId(socket.id ?? null);
    const onConnectError = (err: Error) => {
      const m = err?.message || "";
      if (
        m.includes("INVALID_TOKEN") ||
        m.includes("UNAUTHORIZED") ||
        m.includes("BANNED")
      ) {
        onLogout();
        return;
      }
      setBanner("Could not reach the server. Is it running?");
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    if (socket.connected) onConnect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
    };
  }, [socket, onLogout]);

  const applyRoomPayload = useCallback((p: RoomPayload) => {
    setRoomId(p.roomId);
    setHostSocketId(p.hostSocketId);
    setOnlyHostControls(p.onlyHostControls);
    setPlayback({ time: p.currentTime, isPlaying: p.isPlaying });
    if (p.username) setUsername(p.username);
    if (p.maxUsers !== undefined) {
      setMaxUsers(p.maxUsers);
      setMaxUnlimited(p.maxUsers == null);
      setMaxInput(p.maxUsers == null ? "" : String(p.maxUsers));
    }
    if (p.peers) setPeers(p.peers);
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
    if (!socket) return;
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
    const onJoinErr = (e: { error?: string }) => {
      if (e?.error === "room_full") {
        setBanner("This room is full. Ask the host to raise the limit.");
      } else {
        setBanner("Room not found.");
      }
    };
    const onPeers = ({ peers: list }: { peers: Peer[] }) => setPeers(list);
    const onSettings = ({ maxUsers: m }: { maxUsers: number | null }) => {
      setMaxUsers(m);
      setMaxUnlimited(m == null);
      setMaxInput(m == null ? "" : String(m));
    };
    const onKicked = () => {
      setPhase("lobby");
      setRoomId(null);
      setHostSocketId(null);
      setVideo(null);
      setPeers([]);
      setBanner("You were removed from the room by the host.");
    };

    socket.on("room_joined", onJoined);
    socket.on("load_video", onLoad);
    socket.on("play", onPlay);
    socket.on("pause", onPause);
    socket.on("seek", onSeek);
    socket.on("host_controls_changed", onHostControls);
    socket.on("host_changed", onHostChanged);
    socket.on("control_denied", onDenied);
    socket.on("join_error", onJoinErr);
    socket.on("room_peers", onPeers);
    socket.on("room_settings_changed", onSettings);
    socket.on("you_were_kicked", onKicked);
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
      socket.off("room_peers", onPeers);
      socket.off("room_settings_changed", onSettings);
      socket.off("you_were_kicked", onKicked);
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
    if (!socket) return;
    setBanner(null);
    socket.emit("create_room");
  }

  function joinRoom() {
    if (!socket) return;
    const id = joinInput.trim().toUpperCase();
    if (!id) return;
    setBanner(null);
    socket.emit("join_room", { roomId: id });
  }

  function leaveRoom() {
    if (!socket) return;
    socket.emit("leave_room");
    setPhase("lobby");
    setRoomId(null);
    setHostSocketId(null);
    setVideo(null);
    setPlayback({ time: 0, isPlaying: false });
    setPeers([]);
  }

  function loadVideo() {
    if (!socket || !canControl) return;
    const r = resolveVideoUrl(urlInput);
    if (!r.ok) {
      setBanner(r.reason);
      return;
    }
    setBanner(null);
    socket.emit("load_video", { provider: r.provider, source: r.source });
    setUrlInput("");
  }

  function applyMaxUsers() {
    if (!socket || !isHost) return;
    if (maxUnlimited) {
      socket.emit("set_room_max_users", { maxUsers: null });
    } else {
      const n = Number(maxInput);
      if (!Number.isFinite(n) || n < 1) {
        setBanner("Enter a valid max (1–100) or enable Unlimited.");
        return;
      }
      socket.emit("set_room_max_users", { maxUsers: n });
    }
    setBanner(null);
  }

  function kickSelected() {
    if (!socket || !isHost || !kickTarget) return;
    socket.emit("kick_participant", { targetSocketId: kickTarget });
    setKickTarget("");
  }

  const hostToggle = useMemo(
    () => (
      <label className="host-toggle">
        <input
          type="checkbox"
          checked={onlyHostControls}
          disabled={!isHost}
          onChange={(e) =>
            socket?.emit("set_host_only_controls", {
              enabled: e.target.checked,
            })
          }
        />
        Only host can control playback
      </label>
    ),
    [isHost, onlyHostControls, socket]
  );

  if (!socket || !socket.connected) {
    return (
      <div className="app lobby">
        <h1>Watch Together</h1>
        <p className="muted">
          {socket ? "Connecting…" : "Initializing…"}
        </p>
      </div>
    );
  }

  const peerCount = peers.length;
  const capLabel =
    maxUsers == null ? `${peerCount} / ∞` : `${peerCount} / ${maxUsers}`;

  if (phase === "lobby") {
    return (
      <div className="app lobby">
        <header className="lobby-top">
          <div className="lobby-nav">
            {isAdmin && (
              <Link to="/admin" className="nav-link">
                Admin
              </Link>
            )}
            <button type="button" className="linkish" onClick={onLogout}>
              Sign out
            </button>
          </div>
        </header>
        <h1>Watch Together</h1>
        <p className="muted">
          YouTube, Vimeo, direct video files, or generic embed URLs.
        </p>
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
            {" · "}
            <span title="Members / max">{capLabel}</span>
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
          {isAdmin && (
            <Link to="/admin" className="nav-link">
              Admin
            </Link>
          )}
          <button type="button" onClick={copyLink}>
            Copy room link
          </button>
          <button type="button" onClick={leaveRoom}>
            Leave
          </button>
          <button type="button" onClick={onLogout}>
            Sign out
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
          Generic embed: playback may not stay in sync across everyone — use
          YouTube, Vimeo, or a direct file when possible.
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
        {isHost && (
          <div className="host-tools">
            <p className="muted small" style={{ margin: "0.25rem 0" }}>
              Room capacity (host)
            </p>
            <div className="load-row">
              <label className="host-toggle">
                <input
                  type="checkbox"
                  checked={maxUnlimited}
                  onChange={(e) => setMaxUnlimited(e.target.checked)}
                />
                Unlimited
              </label>
              <input
                type="number"
                min={1}
                max={100}
                disabled={maxUnlimited}
                value={maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                style={{ width: 80 }}
              />
              <button type="button" onClick={applyMaxUsers}>
                Apply limit
              </button>
            </div>
            <div className="load-row">
              <select
                value={kickTarget}
                onChange={(e) => setKickTarget(e.target.value)}
                className="kick-select"
              >
                <option value="">Kick participant…</option>
                {peers
                  .filter((p) => p.socketId !== myId)
                  .map((p) => (
                    <option key={p.socketId} value={p.socketId}>
                      {p.displayName} ({p.socketId.slice(0, 6)}…)
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={kickSelected}
                disabled={!kickTarget}
              >
                Kick
              </button>
            </div>
          </div>
        )}
        {!canControl && (
          <p className="muted small">
            Only the host can control playback right now.
          </p>
        )}
      </section>

      <Chat socket={socket} disabled={false} />
    </div>
  );
}
