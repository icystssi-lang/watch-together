import { Router } from "express";
import { requireAdmin } from "./httpAuth.js";
import { auditLog, getRecentAudit } from "./audit.js";
import { logger } from "./logger.js";

/**
 * @param {import('socket.io').Server} io
 * @param {() => Array<object>} getRoomsSnapshot
 */
export function createAdminRouter(io, getRoomsSnapshot) {
  const r = Router();
  r.use(requireAdmin);

  r.get("/rooms", (_req, res) => {
    res.json({ rooms: getRoomsSnapshot() });
  });

  r.post("/disconnect-socket", (req, res) => {
    const socketId = typeof req.body?.socketId === "string" ? req.body.socketId : "";
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "admin_disconnect";
    if (!socketId) {
      return res.status(400).json({ error: "socketId required" });
    }
    const sock = io.sockets.sockets.get(socketId);
    if (!sock) {
      return res.status(404).json({ error: "Socket not found" });
    }
    auditLog(req.auth.sub, "admin_disconnect_socket", { targetSocketId: socketId, reason });
    logger.info(
      { actor: req.auth.sub, targetSocketId: socketId },
      "admin_disconnect_socket"
    );
    sock.disconnect(true);
    return res.json({ ok: true });
  });

  r.get("/audit", (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const rows = getRecentAudit(limit);
    res.json({ entries: rows });
  });

  return r;
}
