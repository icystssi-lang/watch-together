import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { customAlphabet, nanoid } from "nanoid";
import { createRoomState, isValidProvider } from "./rooms.js";
import { initDb, bootstrapAdmin, isBannedSubject } from "./db.js";
import { verifyToken } from "./jwtUtil.js";
import { createAuthRouter } from "./authRoutes.js";
import { createAdminRouter } from "./adminRoutes.js";
import { logger } from "./logger.js";
import { auditLog } from "./audit.js";
import { createCorsOptions } from "./corsOptions.js";

if (!process.env.JWT_SECRET) {
  logger.warn("JWT_SECRET not set — using insecure development default");
}

initDb();
bootstrapAdmin();

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const genRoomId = customAlphabet(alphabet, 8);

const app = express();
const corsOptions = createCorsOptions();
app.use(cors(corsOptions));
app.use(express.json({ limit: "48kb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: corsOptions,
});

/** @type {Map<string, ReturnType<typeof createRoomState>>} */
const rooms = new Map();

/** @type {Map<string, string>} socketId -> roomId */
const socketRoom = new Map();

function getRoomsSnapshot() {
  const out = [];
  for (const [, room] of rooms) {
    const set = io.sockets.adapter.rooms.get(room.roomId);
    const memberCount = set ? set.size : 0;
    out.push({
      roomId: room.roomId,
      hostSocketId: room.hostSocketId,
      memberCount,
      maxUsers: room.maxUsers,
      onlyHostControls: room.onlyHostControls,
      videoProvider: room.videoProvider,
    });
  }
  return out;
}

app.use("/api/auth", createAuthRouter());
app.use("/api/admin", createAdminRouter(io, getRoomsSnapshot));

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token || typeof token !== "string") {
    return next(new Error("UNAUTHORIZED"));
  }
  try {
    const p = verifyToken(token);
    if (isBannedSubject(p.sub)) {
      return next(new Error("BANNED"));
    }
    socket.data.userSub = p.sub;
    socket.data.role = p.role;
    socket.data.displayName = p.displayName;
    socket.data.username = p.displayName;
    next();
  } catch {
    return next(new Error("INVALID_TOKEN"));
  }
});

function getPeersInRoom(roomId) {
  const set = io.sockets.adapter.rooms.get(roomId);
  if (!set) return [];
  const peers = [];
  for (const sid of set) {
    const s = io.sockets.sockets.get(sid);
    if (s) {
      peers.push({
        socketId: sid,
        displayName: s.data.displayName || "User",
        sub: s.data.userSub ?? null,
      });
    }
  }
  return peers;
}

function broadcastPeers(roomId) {
  io.to(roomId).emit("room_peers", { peers: getPeersInRoom(roomId) });
}

function buildPayload(socket, room) {
  return {
    roomId: room.roomId,
    hostSocketId: room.hostSocketId,
    onlyHostControls: room.onlyHostControls,
    videoProvider: room.videoProvider,
    videoSource: room.videoSource,
    currentTime: room.currentTime,
    isPlaying: room.isPlaying,
    username: socket.data.displayName,
    maxUsers: room.maxUsers,
    peers: getPeersInRoom(room.roomId),
  };
}

function isHost(socketId, room) {
  return room.hostSocketId === socketId;
}

function canControl(socketId, room) {
  if (!room.onlyHostControls) return true;
  return isHost(socketId, room);
}

function leaveRoom(socket, notifyOthers = true) {
  const roomId = socketRoom.get(socket.id);
  if (!roomId) return;
  socketRoom.delete(socket.id);
  socket.leave(roomId);

  const room = rooms.get(roomId);
  if (!room) return;

  if (notifyOthers) {
    socket.to(roomId).emit("user_left", { socketId: socket.id });
  }

  const roomSockets = io.sockets.adapter.rooms.get(roomId);
  const count = roomSockets ? roomSockets.size : 0;

  if (count === 0) {
    rooms.delete(roomId);
    logger.info({ roomId }, "room_deleted_empty");
    return;
  }

  if (room.hostSocketId === socket.id) {
    if (room.videoProvider === "screenshare") {
      room.videoProvider = null;
      room.videoSource = null;
      room.currentTime = 0;
      room.isPlaying = false;
      io.to(roomId).emit("video_unloaded");
    }
    const next = roomSockets.values().next().value;
    if (next) {
      room.hostSocketId = next;
      io.to(roomId).emit("host_changed", { hostSocketId: next });
      auditLog(null, "host_transferred", { roomId, newHostSocketId: next });
    }
  }

  broadcastPeers(roomId);
}

function socketsInSameRoom(roomId, a, b) {
  const set = io.sockets.adapter.rooms.get(roomId);
  if (!set) return false;
  return set.has(a) && set.has(b);
}

function normalizeChatEmoji(raw) {
  if (typeof raw !== "string") return "";
  return raw.normalize("NFC").replace(/\uFE0F/g, "").trim();
}

/** Canonical keys (U+1F622 = crying face — explicit escape avoids wrong lookalike chars in source) */
const CHAT_REACTION_EMOJI = new Set(
  ["👍", "❤️", "😂", "😮", "\u{1F622}", "🔥"].map(normalizeChatEmoji),
);
const MAX_CHAT_MESSAGES_TRACKED = 500;

function pruneOldChatMessages(room) {
  if (!room.recentChatMessageIds || !room.messageReactions) return;
  while (room.recentChatMessageIds.length > MAX_CHAT_MESSAGES_TRACKED) {
    const oldId = room.recentChatMessageIds.shift();
    if (oldId) room.messageReactions.delete(oldId);
  }
}

/** @param {Map<string, Set<string>>} inner */
function serializeReactions(inner) {
  const out = {};
  for (const [emoji, users] of inner) {
    if (users.size > 0) out[emoji] = [...users].sort();
  }
  return out;
}

io.on("connection", (socket) => {
  logger.info(
    { socketId: socket.id, sub: socket.data.userSub, role: socket.data.role },
    "socket_connect"
  );

  socket.on("create_room", (ack) => {
    leaveRoom(socket, false);
    let roomId = genRoomId();
    while (rooms.has(roomId)) roomId = genRoomId();

    const room = createRoomState(roomId, socket.id);
    rooms.set(roomId, room);
    socket.join(roomId);
    socketRoom.set(socket.id, roomId);

    auditLog(socket.data.userSub, "room_create", { roomId });
    logger.info({ roomId, host: socket.id }, "room_create");

    const payload = buildPayload(socket, room);
    if (typeof ack === "function") ack(payload);
    socket.emit("room_joined", payload);
    broadcastPeers(roomId);
  });

  socket.on("join_room", (data, ack) => {
    const roomId = data?.roomId?.toUpperCase?.()?.trim();
    if (!roomId || !rooms.has(roomId)) {
      const err = { error: "Room not found" };
      if (typeof ack === "function") ack(err);
      socket.emit("join_error", err);
      auditLog(socket.data.userSub, "room_join_denied", { roomId, reason: "not_found" });
      return;
    }

    leaveRoom(socket, false);
    const room = rooms.get(roomId);
    const set = io.sockets.adapter.rooms.get(roomId);
    const count = set ? set.size : 0;
    if (room.maxUsers != null && count >= room.maxUsers) {
      if (typeof ack === "function") ack({ error: "room_full" });
      socket.emit("join_error", { error: "room_full" });
      auditLog(socket.data.userSub, "room_full", { roomId, count });
      logger.info({ roomId, count, maxUsers: room.maxUsers }, "room_join_denied_full");
      return;
    }

    socket.join(roomId);
    socketRoom.set(socket.id, roomId);

    socket.to(roomId).emit("user_joined", {
      socketId: socket.id,
      username: socket.data.displayName,
    });

    auditLog(socket.data.userSub, "room_join", { roomId });
    logger.info({ roomId, socketId: socket.id }, "room_join");

    const payload = buildPayload(socket, room);
    if (typeof ack === "function") ack(payload);
    socket.emit("room_joined", payload);
    broadcastPeers(roomId);
  });

  socket.on("leave_room", () => {
    leaveRoom(socket, true);
    socket.emit("room_left", {});
  });

  socket.on("kick_participant", (data) => {
    const roomId = socketRoom.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return;

    if (!isHost(socket.id, room)) {
      socket.emit("control_denied", { reason: "not_host" });
      return;
    }

    const targetSocketId =
      typeof data?.targetSocketId === "string" ? data.targetSocketId : "";
    if (!targetSocketId || targetSocketId === socket.id) return;

    const target = io.sockets.sockets.get(targetSocketId);
    if (!target || socketRoom.get(targetSocketId) !== roomId) {
      socket.emit("kick_failed", { error: "not_in_room" });
      return;
    }

    auditLog(socket.data.userSub, "host_kick", {
      roomId,
      targetSocketId,
    });
    logger.info(
      { roomId, host: socket.id, targetSocketId },
      "host_kick"
    );
    io.to(roomId).emit("user_kicked", {
      targetSocketId,
      bySocketId: socket.id,
    });
    target.emit("you_were_kicked", { roomId });
    target.disconnect(true);
  });

  socket.on("transfer_host", (data) => {
    const roomId = socketRoom.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return;

    if (!isHost(socket.id, room)) {
      socket.emit("control_denied", { reason: "not_host" });
      return;
    }

    const targetSocketId =
      typeof data?.targetSocketId === "string" ? data.targetSocketId : "";
    if (!targetSocketId || targetSocketId === socket.id) return;
    if (!socketsInSameRoom(roomId, socket.id, targetSocketId)) return;

    room.hostSocketId = targetSocketId;
    io.to(roomId).emit("host_changed", { hostSocketId: targetSocketId });
    auditLog(socket.data.userSub, "host_transferred_manual", {
      roomId,
      toSocketId: targetSocketId,
    });
    logger.info(
      { roomId, fromSocketId: socket.id, toSocketId: targetSocketId },
      "host_transferred_manual"
    );
  });

  socket.on("set_room_max_users", (data) => {
    const roomId = socketRoom.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return;

    if (!isHost(socket.id, room)) {
      socket.emit("control_denied", { reason: "not_host" });
      return;
    }

    const raw = data?.maxUsers;
    if (raw === null || raw === undefined || raw === "") {
      room.maxUsers = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      room.maxUsers = Math.min(100, Math.max(1, Math.floor(n)));
    }

    auditLog(socket.data.userSub, "room_max_users", {
      roomId,
      maxUsers: room.maxUsers,
    });
    io.to(roomId).emit("room_settings_changed", { maxUsers: room.maxUsers });
  });

  socket.on("load_video", (data) => {
    const roomId = socketRoom.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return;

    if (!canControl(socket.id, room)) {
      socket.emit("control_denied", { reason: "only_host" });
      auditLog(socket.data.userSub, "playback_control_denied", {
        roomId,
        action: "load_video",
      });
      return;
    }

    const provider = data?.provider;
    const source =
      typeof data?.source === "string" ? data.source.trim() : "";
    if (!isValidProvider(provider) || !source) return;

    if (provider === "screenshare" && !isHost(socket.id, room)) {
      socket.emit("control_denied", { reason: "only_host" });
      auditLog(socket.data.userSub, "playback_control_denied", {
        roomId,
        action: "load_video_screenshare",
      });
      return;
    }

    room.videoProvider = provider;
    room.videoSource = source;
    room.currentTime = 0;
    room.isPlaying = false;

    io.to(roomId).emit("load_video", { provider, source });
  });

  socket.on("unload_video", () => {
    const roomId = socketRoom.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return;

    if (!canControl(socket.id, room)) {
      socket.emit("control_denied", { reason: "only_host" });
      auditLog(socket.data.userSub, "playback_control_denied", {
        roomId,
        action: "unload_video",
      });
      return;
    }

    room.videoProvider = null;
    room.videoSource = null;
    room.currentTime = 0;
    room.isPlaying = false;
    io.to(roomId).emit("video_unloaded");
  });

  socket.on("rtc_signal", (data) => {
    const roomId = socketRoom.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room || room.videoProvider !== "screenshare") return;

    const targetSocketId =
      typeof data?.targetSocketId === "string" ? data.targetSocketId : "";
    const payload = data?.payload;
    if (!targetSocketId || payload === null || typeof payload !== "object") {
      return;
    }

    if (!socketsInSameRoom(roomId, socket.id, targetSocketId)) {
      return;
    }

    io.to(targetSocketId).emit("rtc_signal", {
      fromSocketId: socket.id,
      payload,
    });
  });

  socket.on("play", (data) => {
    const roomId = socketRoom.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return;

    if (room.videoProvider === "screenshare") return;

    if (!canControl(socket.id, room)) {
      socket.emit("control_denied", { reason: "only_host" });
      auditLog(socket.data.userSub, "playback_control_denied", {
        roomId,
        action: "play",
      });
      return;
    }

    const time = Number(data?.time);
    if (!Number.isFinite(time)) return;

    room.currentTime = time;
    room.isPlaying = true;
    io.to(roomId).emit("play", { time });
  });

  socket.on("pause", (data) => {
    const roomId = socketRoom.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return;

    if (room.videoProvider === "screenshare") return;

    if (!canControl(socket.id, room)) {
      socket.emit("control_denied", { reason: "only_host" });
      auditLog(socket.data.userSub, "playback_control_denied", {
        roomId,
        action: "pause",
      });
      return;
    }

    const time = Number(data?.time);
    if (!Number.isFinite(time)) return;

    room.currentTime = time;
    room.isPlaying = false;
    io.to(roomId).emit("pause", { time });
  });

  socket.on("seek", (data) => {
    const roomId = socketRoom.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return;

    if (room.videoProvider === "screenshare") return;

    if (!canControl(socket.id, room)) {
      socket.emit("control_denied", { reason: "only_host" });
      auditLog(socket.data.userSub, "playback_control_denied", {
        roomId,
        action: "seek",
      });
      return;
    }

    const time = Number(data?.time);
    if (!Number.isFinite(time)) return;

    room.currentTime = time;
    io.to(roomId).emit("seek", { time });
  });

  socket.on("set_host_only_controls", (data) => {
    const roomId = socketRoom.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return;

    if (!isHost(socket.id, room)) {
      socket.emit("control_denied", { reason: "not_host" });
      return;
    }

    const enabled = Boolean(data?.enabled);
    room.onlyHostControls = enabled;
    io.to(roomId).emit("host_controls_changed", { enabled });
  });

  socket.on("send_message", (data) => {
    const roomId = socketRoom.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return;

    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (!text) return;

    if (!room.recentChatMessageIds) room.recentChatMessageIds = [];
    if (!room.messageReactions) room.messageReactions = new Map();

    const id = nanoid(12);
    room.recentChatMessageIds.push(id);
    room.messageReactions.set(id, new Map());
    pruneOldChatMessages(room);

    const msg = {
      id,
      username: socket.data.displayName || "User",
      text,
      ts: Date.now(),
      reactions: {},
    };
    io.to(roomId).emit("receive_message", msg);
  });

  socket.on("react_message", (data) => {
    const roomId = socketRoom.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return;

    const messageId = typeof data?.messageId === "string" ? data.messageId : "";
    const emoji = normalizeChatEmoji(typeof data?.emoji === "string" ? data.emoji : "");
    if (!messageId || !CHAT_REACTION_EMOJI.has(emoji)) return;

    if (!room.messageReactions) return;
    const inner = room.messageReactions.get(messageId);
    if (!inner) return;

    const username = socket.data.displayName || "User";
    let set = inner.get(emoji);
    if (!set) {
      set = new Set();
      inner.set(emoji, set);
    }
    if (set.has(username)) {
      set.delete(username);
      if (set.size === 0) inner.delete(emoji);
    } else {
      set.add(username);
    }

    io.to(roomId).emit("message_reactions", {
      messageId,
      reactions: serializeReactions(inner),
    });
  });

  socket.on("disconnect", () => {
    leaveRoom(socket, true);
  });
});

const PORT = Number(process.env.PORT) || 3001;
// Bind all interfaces so platform proxies (e.g. Railway) can reach the process; localhost-only breaks edge routing.
const HOST = process.env.LISTEN_HOST || "0.0.0.0";
httpServer.listen(PORT, HOST, () => {
  logger.info({ port: PORT, host: HOST }, "server_listening");
});
