import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { customAlphabet } from "nanoid";
import { createRoomState, isValidProvider } from "./rooms.js";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const genRoomId = customAlphabet(alphabet, 8);

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
});

/** @type {Map<string, ReturnType<typeof createRoomState>>} */
const rooms = new Map();

/** @type {Map<string, string>} socketId -> roomId */
const socketRoom = new Map();

function randomUsername() {
  return `User${Math.floor(100 + Math.random() * 900)}`;
}

function ensureUsername(socket) {
  if (!socket.data.username) socket.data.username = randomUsername();
  return socket.data.username;
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
    return;
  }

  if (room.hostSocketId === socket.id) {
    const next = roomSockets.values().next().value;
    if (next) {
      room.hostSocketId = next;
      io.to(roomId).emit("host_changed", { hostSocketId: next });
    }
  }
}

io.on("connection", (socket) => {
  ensureUsername(socket);

  socket.on("create_room", (ack) => {
    leaveRoom(socket, false);
    let roomId = genRoomId();
    while (rooms.has(roomId)) roomId = genRoomId();

    const room = createRoomState(roomId, socket.id);
    rooms.set(roomId, room);
    socket.join(roomId);
    socketRoom.set(socket.id, roomId);

    const payload = {
      roomId,
      hostSocketId: room.hostSocketId,
      onlyHostControls: room.onlyHostControls,
      videoProvider: room.videoProvider,
      videoSource: room.videoSource,
      currentTime: room.currentTime,
      isPlaying: room.isPlaying,
      username: socket.data.username,
    };
    if (typeof ack === "function") ack(payload);
    socket.emit("room_joined", payload);
  });

  socket.on("join_room", (data, ack) => {
    const roomId = data?.roomId?.toUpperCase?.()?.trim();
    if (!roomId || !rooms.has(roomId)) {
      const err = { error: "Room not found" };
      if (typeof ack === "function") ack(err);
      socket.emit("join_error", err);
      return;
    }

    leaveRoom(socket, false);
    const room = rooms.get(roomId);
    socket.join(roomId);
    socketRoom.set(socket.id, roomId);

    socket.to(roomId).emit("user_joined", {
      socketId: socket.id,
      username: socket.data.username,
    });

    const payload = {
      roomId,
      hostSocketId: room.hostSocketId,
      onlyHostControls: room.onlyHostControls,
      videoProvider: room.videoProvider,
      videoSource: room.videoSource,
      currentTime: room.currentTime,
      isPlaying: room.isPlaying,
      username: socket.data.username,
    };
    if (typeof ack === "function") ack(payload);
    socket.emit("room_joined", payload);
  });

  socket.on("leave_room", () => {
    leaveRoom(socket, true);
    socket.emit("room_left", {});
  });

  socket.on("load_video", (data) => {
    const roomId = socketRoom.get(socket.id);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) return;

    if (!canControl(socket.id, room)) {
      socket.emit("control_denied", { reason: "only_host" });
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
      username: ensureUsername(socket),
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
  console.log(`Watch Together server on http://localhost:${PORT}`);
});
