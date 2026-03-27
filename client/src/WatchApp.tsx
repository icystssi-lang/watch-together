import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import { socketUrl } from "./apiBase";
import { APP_DISPLAY_NAME } from "./appName";
import { Chat } from "./Chat";
import {
  ActivityFeed,
  type ActivityLine,
} from "./components/watch/ActivityFeed";
import { LobbyView } from "./components/watch/LobbyView";
import {
  exitFullscreen,
  getFullscreenElement,
  tryEnterDomFullscreen,
  tryEnterIosNativeVideoFullscreen,
} from "./fullscreenDom";
import { resolveVideoUrl } from "./resolveVideoUrl";
import { ScreenShareStage } from "./ScreenShareStage";
import { SiteFooter } from "./SiteFooter";
import {
  SyncedPlayer,
  type PlayerLoadState,
} from "./SyncedPlayer";
import type { VideoProvider } from "./resolveVideoUrl";
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
  audioOnly?: boolean;
  currentTime: number;
  isPlaying: boolean;
  username?: string;
  maxUsers?: number | null;
  peers?: Peer[];
  requiresPassword?: boolean;
};

type PublicRoom = {
  roomId: string;
  memberCount: number;
  maxUsers: number | null;
  onlyHostControls: boolean;
  videoProvider: string | null;
  requiresPassword: boolean;
};

type RoomVideo = {
  provider: VideoProvider;
  source: string;
  audioOnly?: boolean;
};

type Props = {
  token: string;
  onLogout: () => void;
  isAdmin?: boolean;
};

function isInstagramWebViewUA(ua: string): boolean {
  const s = ua.toLowerCase();
  return s.includes("instagram") && (s.includes("; wv)") || s.includes(" wv "));
}

export function WatchApp({ token, onLogout, isAdmin }: Props) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"lobby" | "room">("lobby");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [hostSocketId, setHostSocketId] = useState<string | null>(null);
  const [onlyHostControls, setOnlyHostControls] = useState(false);
  const [video, setVideo] = useState<RoomVideo | null>(null);
  const [playback, setPlayback] = useState({ time: 0, isPlaying: false });
  const [joinInput, setJoinInput] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [createJoinMode, setCreateJoinMode] = useState<"open" | "password">("open");
  const [createPassword, setCreatePassword] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [maxUsers, setMaxUsers] = useState<number | null>(10);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [kickTarget, setKickTarget] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  const [maxInput, setMaxInput] = useState("10");
  const [maxUnlimited, setMaxUnlimited] = useState(false);
  const [audioOnlyInput, setAudioOnlyInput] = useState(false);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  const [lobbyBusy, setLobbyBusy] = useState(false);
  const [lobbyAction, setLobbyAction] = useState<null | "create" | "join">(
    null,
  );
  const [activityLines, setActivityLines] = useState<ActivityLine[]>([]);
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);

  const phaseRef = useRef(phase);
  const roomIdRef = useRef(roomId);
  const peersRef = useRef(peers);
  const pendingRejoinRoomIdRef = useRef<string | null>(null);
  const pendingRejoinPasswordRef = useRef<string>("");
  const hostSocketIdRef = useRef<string | null>(hostSocketId);
  const activityIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeLocalBlobUrlRef = useRef<string | null>(null);
  const pendingHostTransferTargetRef = useRef<string | null>(null);
  const lastConnectedAtRef = useRef(0);
  const lastDisconnectReasonRef = useRef<string | null>(null);
  const lastConnectErrorRef = useRef<string | null>(null);
  const reconnectGuardUntilRef = useRef(0);

  phaseRef.current = phase;
  roomIdRef.current = roomId;
  peersRef.current = peers;
  hostSocketIdRef.current = hostSocketId;

  const playerShellRef = useRef<HTMLDivElement>(null);
  const fullscreenModeRef = useRef<"none" | "dom" | "pseudo" | "ios-video">(
    "none",
  );
  const iosVideoRef = useRef<HTMLVideoElement | null>(null);
  const iosVideoDetachRef = useRef<(() => void) | null>(null);
  const isInstagramWebView = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return isInstagramWebViewUA(navigator.userAgent || "");
  }, []);

  const pushActivity = useCallback((text: string) => {
    const id = ++activityIdRef.current;
    setActivityLines((prev) => [...prev.slice(-199), { id, text }]);
  }, []);

  const teardownPlayerFullscreen = useCallback(() => {
    const detach = iosVideoDetachRef.current;
    const v = iosVideoRef.current as
      | (HTMLVideoElement & { webkitExitFullscreen?: () => void })
      | null;
    v?.webkitExitFullscreen?.();
    detach?.();

    iosVideoDetachRef.current = null;
    iosVideoRef.current = null;

    const shell = playerShellRef.current;
    if (shell?.classList.contains("player-shell--pseudo-fullscreen")) {
      shell.classList.remove("player-shell--pseudo-fullscreen");
      document.body.style.overflow = "";
    }
    if (shell && getFullscreenElement() === shell) {
      void exitFullscreen();
    }
    fullscreenModeRef.current = "none";
    setPlayerFullscreen(false);
  }, []);

  const syncPlayerFullscreen = useCallback(() => {
    const shell = playerShellRef.current;
    const fs = getFullscreenElement();
    if (fs === shell) {
      fullscreenModeRef.current = "dom";
      setPlayerFullscreen(true);
      return;
    }
    if (fullscreenModeRef.current === "dom") {
      fullscreenModeRef.current = "none";
      setPlayerFullscreen(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("fullscreenchange", syncPlayerFullscreen);
    document.addEventListener("webkitfullscreenchange", syncPlayerFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", syncPlayerFullscreen);
      document.removeEventListener(
        "webkitfullscreenchange",
        syncPlayerFullscreen,
      );
    };
  }, [syncPlayerFullscreen]);

  useEffect(() => {
    if (!playerFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const shell = playerShellRef.current;
      if (!shell?.classList.contains("player-shell--pseudo-fullscreen")) return;
      shell.classList.remove("player-shell--pseudo-fullscreen");
      document.body.style.overflow = "";
      fullscreenModeRef.current = "none";
      setPlayerFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playerFullscreen]);

  useEffect(() => () => teardownPlayerFullscreen(), [teardownPlayerFullscreen]);

  const togglePlayerFullscreen = useCallback(async () => {
    const el = playerShellRef.current;
    if (!el) return;

    if (playerFullscreen) {
      if (fullscreenModeRef.current === "pseudo") {
        el.classList.remove("player-shell--pseudo-fullscreen");
        document.body.style.overflow = "";
        fullscreenModeRef.current = "none";
        setPlayerFullscreen(false);
        return;
      }
      if (fullscreenModeRef.current === "ios-video") {
        const v = iosVideoRef.current as
          | (HTMLVideoElement & { webkitExitFullscreen?: () => void })
          | null;
        v?.webkitExitFullscreen?.();
        iosVideoDetachRef.current?.();
        return;
      }
      if (getFullscreenElement() === el) {
        void exitFullscreen();
        return;
      }
      fullscreenModeRef.current = "none";
      setPlayerFullscreen(false);
      return;
    }

    if (await tryEnterDomFullscreen(el)) {
      fullscreenModeRef.current = "dom";
      setPlayerFullscreen(true);
      return;
    }

    const videoEl = tryEnterIosNativeVideoFullscreen(el);
    if (videoEl) {
      fullscreenModeRef.current = "ios-video";
      iosVideoRef.current = videoEl;

      const detach = () => {
        videoEl.removeEventListener("webkitendfullscreen", detach);
        videoEl.removeEventListener(
          "webkitpresentationmodechanged",
          onPresentation,
        );
        if (iosVideoRef.current === videoEl) iosVideoRef.current = null;
        if (iosVideoDetachRef.current === detach) iosVideoDetachRef.current = null;
        if (fullscreenModeRef.current === "ios-video") {
          fullscreenModeRef.current = "none";
          setPlayerFullscreen(false);
        }
      };

      function onPresentation() {
        const mode = (
          videoEl as HTMLVideoElement & { webkitPresentationMode?: string }
        ).webkitPresentationMode;
        if (mode !== "fullscreen") detach();
      }

      videoEl.addEventListener("webkitendfullscreen", detach);
      videoEl.addEventListener("webkitpresentationmodechanged", onPresentation);
      iosVideoDetachRef.current = detach;
      setPlayerFullscreen(true);
      return;
    }

    el.classList.add("player-shell--pseudo-fullscreen");
    document.body.style.overflow = "hidden";
    fullscreenModeRef.current = "pseudo";
    setPlayerFullscreen(true);
  }, [playerFullscreen]);

  useEffect(() => {
    const reconnectProfile = isInstagramWebView
      ? {
          timeout: 15000,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 12000,
          randomizationFactor: 0.5,
        }
      : {
          timeout: 12000,
          reconnectionDelay: 800,
          reconnectionDelayMax: 8000,
          randomizationFactor: 0.35,
        };
    const s = io(socketUrl(), {
      auth: { token },
      transports: ["websocket", "polling"],
      upgrade: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      timeout: reconnectProfile.timeout,
      reconnectionDelay: reconnectProfile.reconnectionDelay,
      reconnectionDelayMax: reconnectProfile.reconnectionDelayMax,
      randomizationFactor: reconnectProfile.randomizationFactor,
    });
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, [isInstagramWebView, token]);

  const resetRoomStateToLobby = useCallback(() => {
    if (activeLocalBlobUrlRef.current) {
      URL.revokeObjectURL(activeLocalBlobUrlRef.current);
      activeLocalBlobUrlRef.current = null;
    }
    setRoomId(null);
    setHostSocketId(null);
    setVideo(null);
    setPlayback({ time: 0, isPlaying: false });
    setPeers([]);
    setActivityLines([]);
  }, []);

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
        provider: p.videoProvider as VideoProvider,
        source: p.videoSource,
        audioOnly: Boolean(p.audioOnly),
      });
    } else {
      setVideo(null);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (activeLocalBlobUrlRef.current) {
        URL.revokeObjectURL(activeLocalBlobUrlRef.current);
        activeLocalBlobUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const active = activeLocalBlobUrlRef.current;
    if (!active) return;
    if (!video || video.provider !== "html5" || video.source !== active) {
      URL.revokeObjectURL(active);
      activeLocalBlobUrlRef.current = null;
    }
  }, [video]);

  useEffect(() => {
    if (!socket) return;

    const onConnect = () => {
      lastConnectedAtRef.current = Date.now();
      lastDisconnectReasonRef.current = null;
      lastConnectErrorRef.current = null;
      setMyId(socket.id ?? null);
      const rid = pendingRejoinRoomIdRef.current;
      if (rid) {
        setLobbyBusy(true);
        setLobbyAction("join");
        setBanner("Reconnecting to room…");
        socket.emit("join_room", {
          roomId: rid,
          password: pendingRejoinPasswordRef.current || undefined,
        });
      }
      socket.emit("get_public_rooms");
    };

    const onDisconnect = (reason: string) => {
      lastDisconnectReasonRef.current = reason;
      setMyId(socket.id ?? null);
      const wasRoom = phaseRef.current === "room";
      const rid = roomIdRef.current;
      if (wasRoom && rid) {
        pendingRejoinRoomIdRef.current = rid;
        teardownPlayerFullscreen();
        setPhase("lobby");
        resetRoomStateToLobby();
        setJoinInput(rid);
        setLobbyBusy(false);
        setLobbyAction(null);
        const extra =
          reason === "io client disconnect"
            ? ""
            : " You may rejoin from the lobby if this persists.";
        setBanner(`Connection lost.${extra} Reconnecting…`);
      } else {
        setLobbyBusy(false);
        setLobbyAction(null);
      }
    };

    const onReconnectAttempt = () => {
      if (pendingRejoinRoomIdRef.current) {
        setBanner("Reconnecting to server…");
      }
    };

    const onConnectError = (err: Error) => {
      const m = err?.message || "";
      lastConnectErrorRef.current = m || "connect_error";
      if (
        m.includes("INVALID_TOKEN") ||
        m.includes("UNAUTHORIZED") ||
        m.includes("BANNED")
      ) {
        onLogout();
        return;
      }
      setBanner("Could not connect. Please try again.");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("reconnect_attempt", onReconnectAttempt);
    socket.on("connect_error", onConnectError);
    if (socket.connected) onConnect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("reconnect_attempt", onReconnectAttempt);
      socket.off("connect_error", onConnectError);
    };
  }, [socket, onLogout, resetRoomStateToLobby, teardownPlayerFullscreen]);

  useEffect(() => {
    if (!socket) return;

    const staleMs = isInstagramWebView ? 45000 : 60000;
    const minReconnectGapMs = 1500;
    const tryReconnect = (reason: string) => {
      const now = Date.now();
      if (now < reconnectGuardUntilRef.current) return;
      reconnectGuardUntilRef.current = now + minReconnectGapMs;

      if (socket.disconnected) {
        socket.connect();
        if (pendingRejoinRoomIdRef.current) {
          setBanner(`Reconnecting (${reason})…`);
        }
        return;
      }

      if (lastConnectedAtRef.current > 0 && now - lastConnectedAtRef.current > staleMs) {
        socket.disconnect();
        socket.connect();
        if (pendingRejoinRoomIdRef.current) {
          setBanner(`Refreshing connection (${reason})…`);
        }
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tryReconnect("app resumed");
      }
    };
    const onFocus = () => tryReconnect("window focus");
    const onPageShow = () => tryReconnect("page restore");

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [isInstagramWebView, socket]);

  const reportMediaError = useCallback((message: string) => {
    setBanner(message);
  }, []);

  const onPlayerLoadStateChange = useCallback(
    (state: PlayerLoadState, message?: string) => {
      if (state === "error" && message) setBanner(message);
    },
    [],
  );

  useEffect(() => {
    if (!socket) return;
    const onJoined = (p: RoomPayload) => {
      pendingRejoinRoomIdRef.current = null;
      setLobbyBusy(false);
      setLobbyAction(null);
      setJoinPassword("");
      applyRoomPayload(p);
      setPhase("room");
      setBanner(null);
      const id = ++activityIdRef.current;
      setActivityLines([{ id, text: "You joined the room." }]);
    };
    const onLoad = (d: { provider: string; source: string; audioOnly?: boolean }) => {
      if (
        d.provider === "html5" &&
        d.source.startsWith("blob:") &&
        socket.id !== hostSocketIdRef.current
      ) {
        setBanner("Host loaded a local file. Ask host to use screen share to share it.");
        pushActivity("Host loaded a local-only file.");
        return;
      }
      setVideo({
        provider: d.provider as VideoProvider,
        source: d.source,
        audioOnly: Boolean(d.audioOnly),
      });
      setPlayback({ time: 0, isPlaying: false });
      pushActivity("New video loaded.");
    };
    const onPlay = ({ time }: { time: number }) =>
      setPlayback({ time, isPlaying: true });
    const onPause = ({ time }: { time: number }) =>
      setPlayback({ time, isPlaying: false });
    const onSeek = ({ time }: { time: number }) =>
      setPlayback((prev) => ({ ...prev, time }));
    const onHostControls = ({ enabled }: { enabled: boolean }) =>
      setOnlyHostControls(enabled);
    const onHostChanged = ({ hostSocketId: id }: { hostSocketId: string }) => {
      const prevHostId = hostSocketIdRef.current;
      setHostSocketId(id);

      const newHost = peersRef.current.find((p) => p.socketId === id);
      const hostLabel = newHost?.displayName ?? `Host ${id.slice(0, 6)}…`;
      pushActivity(`Host changed: ${hostLabel}.`);

      if (pendingHostTransferTargetRef.current === id) {
        setBanner(`Host transferred to ${hostLabel}.`);
      } else if (id === myId) {
        setBanner("You are now the host.");
      } else if (prevHostId === myId) {
        setBanner(`Host changed to ${hostLabel}.`);
      }
      pendingHostTransferTargetRef.current = null;
      setTransferTarget("");
    };
    const onDenied = () => {
      pendingHostTransferTargetRef.current = null;
      setBanner("That action is not allowed (host only).");
    };
    const onJoinErr = (e: { error?: string }) => {
      pendingRejoinRoomIdRef.current = null;
      setLobbyBusy(false);
      setLobbyAction(null);
      if (e?.error === "room_full") setBanner("This room is full. Ask the host to raise the limit.");
      else if (e?.error === "password_required") setBanner("Password required for this room.");
      else if (e?.error === "invalid_password") setBanner("Incorrect room password.");
      else if (e?.error === "password_too_short") setBanner("Room password must be at least 4 characters.");
      else setBanner("Room not found or you can no longer join.");
    };
    const onPublicRooms = ({ rooms }: { rooms: PublicRoom[] }) => {
      setPublicRooms(Array.isArray(rooms) ? rooms : []);
    };
    const onPeers = ({ peers: list }: { peers: Peer[] }) => setPeers(list);
    const onSettings = ({ maxUsers: m }: { maxUsers: number | null }) => {
      setMaxUsers(m);
      setMaxUnlimited(m == null);
      setMaxInput(m == null ? "" : String(m));
    };
    const onKicked = () => {
      pendingRejoinRoomIdRef.current = null;
      teardownPlayerFullscreen();
      setPhase("lobby");
      resetRoomStateToLobby();
      setLobbyBusy(false);
      setLobbyAction(null);
      setBanner("You were removed from the room by the host.");
    };
    const onVideoUnloaded = () => {
      setVideo(null);
      setPlayback({ time: 0, isPlaying: false });
      pushActivity("Video cleared.");
    };
    const onUserJoined = ({
      username: joinedName,
    }: {
      username: string;
    }) => {
      pushActivity(`${joinedName} joined.`);
    };
    const onUserLeft = ({ socketId }: { socketId: string }) => {
      const left = peersRef.current.find((p) => p.socketId === socketId);
      const label = left?.displayName ?? "Someone";
      pushActivity(`${label} left.`);
    };

    socket.on("room_joined", onJoined);
    socket.on("load_video", onLoad);
    socket.on("video_unloaded", onVideoUnloaded);
    socket.on("play", onPlay);
    socket.on("pause", onPause);
    socket.on("seek", onSeek);
    socket.on("host_controls_changed", onHostControls);
    socket.on("host_changed", onHostChanged);
    socket.on("control_denied", onDenied);
    socket.on("join_error", onJoinErr);
    socket.on("room_peers", onPeers);
    socket.on("room_settings_changed", onSettings);
    socket.on("public_rooms", onPublicRooms);
    socket.on("you_were_kicked", onKicked);
    socket.on("user_joined", onUserJoined);
    socket.on("user_left", onUserLeft);
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
      socket.off("public_rooms", onPublicRooms);
      socket.off("you_were_kicked", onKicked);
      socket.off("video_unloaded", onVideoUnloaded);
      socket.off("user_joined", onUserJoined);
      socket.off("user_left", onUserLeft);
    };
  }, [
    socket,
    applyRoomPayload,
    teardownPlayerFullscreen,
    resetRoomStateToLobby,
    pushActivity,
    myId,
  ]);

  useEffect(() => {
    if (!socket || !socket.connected || phase !== "lobby") return;
    socket.emit("get_public_rooms");
  }, [phase, socket]);

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
    void navigator.clipboard.writeText(u.toString()).then(
      () => {
        setBanner("Room link copied.");
        setTimeout(() => setBanner(null), 2000);
      },
      () => setBanner("Could not copy — select the room ID and copy manually."),
    );
  }, [roomId]);

  const copyRoomId = useCallback(() => {
    if (!roomId) return;
    void navigator.clipboard.writeText(roomId).then(
      () => {
        setBanner("Room ID copied.");
        setTimeout(() => setBanner(null), 2000);
      },
      () => setBanner("Could not copy — select the room ID and copy manually."),
    );
  }, [roomId]);

  function createRoom() {
    if (!socket || lobbyBusy) return;
    if (createJoinMode === "password" && createPassword.trim().length < 4) {
      setBanner("Set a room password with at least 4 characters.");
      return;
    }
    setBanner(null);
    setLobbyBusy(true);
    setLobbyAction("create");
    pendingRejoinPasswordRef.current =
      createJoinMode === "password" ? createPassword.trim() : "";
    socket.emit("create_room", {
      joinMode: createJoinMode,
      password:
        createJoinMode === "password" ? createPassword.trim() : undefined,
    });
  }

  function joinRoom() {
    if (!socket || lobbyBusy) return;
    const id = joinInput.trim().toUpperCase();
    if (!id) return;
    const password = joinPassword.trim();
    setBanner(null);
    setLobbyBusy(true);
    setLobbyAction("join");
    pendingRejoinPasswordRef.current = password;
    socket.emit("join_room", { roomId: id, password: password || undefined });
  }

  function joinPublicRoom(nextRoomId: string) {
    setJoinInput(nextRoomId);
    setJoinPassword("");
    if (!socket || lobbyBusy) return;
    setBanner(null);
    setLobbyBusy(true);
    setLobbyAction("join");
    pendingRejoinPasswordRef.current = "";
    socket.emit("join_room", { roomId: nextRoomId });
  }

  function leaveRoom() {
    if (!socket) return;
    pendingRejoinRoomIdRef.current = null;
    pendingRejoinPasswordRef.current = "";
    teardownPlayerFullscreen();
    socket.emit("leave_room");
    setPhase("lobby");
    resetRoomStateToLobby();
    setLobbyBusy(false);
    setLobbyAction(null);
    socket.emit("get_public_rooms");
  }

  function loadVideo() {
    if (!socket || !canControl) return;
    const r = resolveVideoUrl(urlInput);
    if (!r.ok) {
      setBanner(r.reason);
      return;
    }
    setBanner(null);
    socket.emit("load_video", {
      provider: r.provider,
      source: r.source,
      audioOnly: audioOnlyInput,
    });
    setUrlInput("");
  }

  function startScreenShare() {
    if (!socket || !isHost) return;
    setBanner(null);
    socket.emit("load_video", {
      provider: "screenshare",
      source: "stream",
      audioOnly: audioOnlyInput,
    });
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

  function transferHost() {
    if (!socket || !isHost || !transferTarget) return;
    pendingHostTransferTargetRef.current = transferTarget;
    socket.emit("transfer_host", { targetSocketId: transferTarget });
  }

  function loadLocalVideoFromDevice(file: File | null) {
    if (!socket || !isHost || !file) return;
    if (!file.type.startsWith("video/")) {
      setBanner("Please choose a valid video file.");
      return;
    }
    if (activeLocalBlobUrlRef.current) {
      URL.revokeObjectURL(activeLocalBlobUrlRef.current);
    }
    const objectUrl = URL.createObjectURL(file);
    activeLocalBlobUrlRef.current = objectUrl;
    socket.emit("load_video", { provider: "html5", source: objectUrl });
    setBanner(`Loaded local file: ${file.name}`);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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
    [isHost, onlyHostControls, socket],
  );

  if (!socket || !socket.connected) {
    return (
      <div className="app lobby">
        <h1>{APP_DISPLAY_NAME}</h1>
        <p className="muted">
          {socket ? "Connecting…" : "Initializing…"}
        </p>
        <SiteFooter />
      </div>
    );
  }

  const peerCount = peers.length;
  const capLabel =
    maxUsers == null ? `${peerCount} / ∞` : `${peerCount} / ${maxUsers}`;

  if (phase === "lobby") {
    return (
      <LobbyView
        isAdmin={isAdmin}
        onLogout={onLogout}
        banner={banner}
        joinInput={joinInput}
        joinPassword={joinPassword}
        onJoinInputChange={setJoinInput}
        onJoinPasswordChange={setJoinPassword}
        createJoinMode={createJoinMode}
        createPassword={createPassword}
        onCreateJoinModeChange={setCreateJoinMode}
        onCreatePasswordChange={setCreatePassword}
        publicRooms={publicRooms}
        onJoinPublicRoom={joinPublicRoom}
        onCreateRoom={createRoom}
        onJoinRoom={joinRoom}
        lobbyBusy={lobbyBusy}
        lobbyAction={lobbyAction}
      />
    );
  }

  return (
    <div className="app room room-layout">
      <header className="room-header">
        <div className="room-header__main">
          <h1>{APP_DISPLAY_NAME}</h1>
          <p className="muted room-header__meta">
            <span title="Members / max">{capLabel}</span>
            {username && (
              <>
                {" · "}
                You are <strong>{username}</strong>
                {isHost && " (host)"}
              </>
            )}
          </p>
          <div className="room-id-row">
            <span className="room-id-label">Room</span>
            <code className="room-id-chip mono">{roomId}</code>
            <button type="button" className="btn-secondary" onClick={copyRoomId}>
              Copy ID
            </button>
          </div>
        </div>
        <div className="header-actions">
          {isAdmin && (
            <Link to="/admin" className="nav-link">
              Admin
            </Link>
          )}
          <button type="button" className="btn-secondary" onClick={copyLink}>
            Copy room link
          </button>
          <button type="button" onClick={leaveRoom}>
            Leave
          </button>
          <button type="button" className="linkish" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>

      {banner && <p className="banner banner--room">{banner}</p>}

      <div className="room-main">
        <div className="room-main__primary">
          <div className="player-shell" ref={playerShellRef}>
            <div className="player-shell__toolbar">
              <button
                type="button"
                className="player-fullscreen-btn"
                onClick={togglePlayerFullscreen}
                aria-pressed={playerFullscreen}
                title={
                  playerFullscreen
                    ? "Exit fullscreen (Esc)"
                    : "Fill the screen with the player"
                }
              >
                {playerFullscreen ? "Exit fullscreen" : "Fullscreen"}
              </button>
            </div>
            {video?.provider === "screenshare" && myId && hostSocketId ? (
              <ScreenShareStage
                socket={socket}
                mySocketId={myId}
                hostSocketId={hostSocketId}
                isHost={isHost}
                peers={peers}
                audioOnly={Boolean(video.audioOnly)}
                onError={reportMediaError}
              />
            ) : (
              <SyncedPlayer
                socket={socket}
                canControl={canControl}
                video={video}
                playback={playback}
                onLoadStateChange={onPlayerLoadStateChange}
              />
            )}
          </div>

          {video?.provider === "iframe" && (
            <p className="hint">
              Generic embed: playback may not stay in sync across everyone — use
              YouTube, Vimeo, or a direct file when possible.
            </p>
          )}
          {video?.provider === "screenshare" && !isHost && (
            <p className="hint">
              Live screen share from the host. If it does not start, ask the host to
              restart sharing.
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
              <button
                type="button"
                onClick={startScreenShare}
                disabled={!isHost || video?.provider === "screenshare"}
                title="Host only — mesh WebRTC to viewers in this room"
              >
                {audioOnlyInput ? "Share screen audio" : "Share screen"}
              </button>
            </div>
            {canControl && (
              <label className="host-toggle">
                <input
                  type="checkbox"
                  checked={audioOnlyInput}
                  onChange={(e) => setAudioOnlyInput(e.target.checked)}
                />
                Audio-only mode for next load/share
              </label>
            )}
            {hostToggle}
            {isHost && (
              <div className="host-tools">
                <p className="muted small host-tools__label">
                  Room capacity (host)
                </p>
                <div className="load-row">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*"
                    onChange={(e) => {
                      loadLocalVideoFromDevice(e.target.files?.[0] ?? null);
                    }}
                  />
                </div>
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
                    className="input-narrow"
                    min={1}
                    max={100}
                    disabled={maxUnlimited}
                    value={maxInput}
                    onChange={(e) => setMaxInput(e.target.value)}
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
                <div className="load-row">
                  <select
                    value={transferTarget}
                    onChange={(e) => setTransferTarget(e.target.value)}
                    className="kick-select"
                  >
                    <option value="">Transfer host to…</option>
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
                    onClick={transferHost}
                    disabled={!transferTarget}
                  >
                    Transfer host
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
        </div>

        <aside className="room-sidebar">
          <ActivityFeed lines={activityLines} />
          <div className="chat-card">
            <Chat
              key={roomId ?? ""}
              socket={socket}
              disabled={false}
              myUsername={username ?? undefined}
            />
          </div>
        </aside>
      </div>

      <SiteFooter />
    </div>
  );
}
