import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { customAlphabet } from "nanoid";
import { createRoomState, isValidProvider } from "./rooms.js";
import { initDb, bootstrapAdmin, isBannedSubject } from "./db.js";
import { verifyToken } from "./jwtUtil.js";
import { createAuthRouter } from "./authRoutes.js";
import { createAdminRouter } from "./adminRoutes.js";
import { logger } from "./logger.js";
import { auditLog } from "./audit.js";

if (!process.env.JWT_SECRET) {
  logger.warn("JWT_SECRET not set — using insecure development default");
}

initDb();
bootstrapAdmin();

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const genRoomId = customAlphabet(alphabet, 8);

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "48kb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
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
    const next = roomSockets.values().next().value;
    if (next) {
      room.hostSocketId = next;
      io.to(roomId).emit("host_changed", { hostSocketId: next });
      auditLog(null, "host_transferred", { roomId, newHostSocketId: next });
    }
  }

  broadcastPeers(roomId);
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

    room.videoProvider = provider;
    room.videoSource = source;
    room.currentTime = 0;
    room.isPlaying = false;

    io.to(roomId).emit("load_video", { provider, source });
  });

  socket.on("play", (data) => {
    const roomId = socketRoom.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return;

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
    if (!roomId) return;

    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (!text) return;

    const msg = {
      username: socket.data.displayName || "User",
      text,
      ts: Date.now(),
    };
    io.to(roomId).emit("receive_message", msg);
  });

  socket.on("disconnect", () => {
    leaveRoom(socket, true);
  });
});

const PORT = Number(process.env.PORT) || 3001;
httpServer.listen(PORT, () => {
  logger.info({ port: PORT }, "server_listening");
});
