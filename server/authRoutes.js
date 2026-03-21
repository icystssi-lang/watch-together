import { Router } from "express";
import bcrypt from "bcrypt";
import { customAlphabet } from "nanoid";
import { createUser, findUserByEmail, isBannedSubject } from "./db.js";
import { signToken } from "./jwtUtil.js";
import { auditLog } from "./audit.js";
import { logger } from "./logger.js";
import { requireAuth } from "./httpAuth.js";

const guestId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

const loginAttempts = new Map();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 20;

function rateLimitIp(ip) {
  const now = Date.now();
  let e = loginAttempts.get(ip);
  if (!e || now > e.resetAt) {
    e = { count: 0, resetAt: now + WINDOW_MS };
    loginAttempts.set(ip, e);
  }
  e.count += 1;
  return e.count <= MAX_ATTEMPTS;
}

function sanitizeDisplayName(name, fallback) {
  const raw = typeof name === "string" ? name.trim().slice(0, 40) : "";
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, "");
  return cleaned || fallback;
}

export function createAuthRouter() {
  const r = Router();

  r.post("/register", (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!rateLimitIp(ip)) {
      return res.status(429).json({ error: "Too many requests" });
    }

    const email = typeof req.body?.email === "string" ? req.body.email : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const displayNameIn = req.body?.displayName;

    if (!email.includes("@") || email.length > 254 || password.length < 6) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const displayName = sanitizeDisplayName(displayNameIn, email.split("@")[0]);

    if (isBannedSubject(`email:${email.trim().toLowerCase()}`)) {
      auditLog(null, "auth_register_denied_ban", { email });
      return res.status(403).json({ error: "Forbidden" });
    }

    try {
      const hash = bcrypt.hashSync(password, 10);
      const id = createUser(email, hash, displayName, "user");
      const sub = `user:${id}`;
      const token = signToken({ sub, role: "user", displayName });
      auditLog(sub, "auth_register", { email });
      logger.info({ sub, email }, "auth_register_ok");
      return res.json({ token, user: { sub, role: "user", displayName, email } });
    } catch (e) {
      if (String(e?.message || "").includes("UNIQUE")) {
        return res.status(409).json({ error: "Email already registered" });
      }
      logger.error({ err: e }, "auth_register_fail");
      return res.status(500).json({ error: "Server error" });
    }
  });

  r.post("/login", (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!rateLimitIp(ip)) {
      return res.status(429).json({ error: "Too many requests" });
    }

    const email = typeof req.body?.email === "string" ? req.body.email : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!email || !password) {
      return res.status(400).json({ error: "Missing credentials" });
    }

    if (isBannedSubject(`email:${email.trim().toLowerCase()}`)) {
      auditLog(null, "auth_login_denied_ban", { email });
      return res.status(403).json({ error: "Forbidden" });
    }

    const user = findUserByEmail(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      auditLog(null, "auth_login_fail", { email });
      logger.info({ email }, "auth_login_fail");
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const sub = `user:${user.id}`;
    if (isBannedSubject(sub)) {
      auditLog(sub, "auth_login_denied_ban_user", {});
      return res.status(403).json({ error: "Forbidden" });
    }

    const displayName = user.display_name;
    const role = user.role;
    const token = signToken({ sub, role, displayName });
    auditLog(sub, "auth_login_ok", { email: user.email });
    logger.info({ sub }, "auth_login_ok");
    return res.json({
      token,
      user: { sub, role, displayName, email: user.email },
    });
  });

  r.post("/guest", (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!rateLimitIp(ip)) {
      return res.status(429).json({ error: "Too many requests" });
    }

    const displayName = sanitizeDisplayName(
      req.body?.displayName,
      `Guest${Math.floor(100 + Math.random() * 900)}`
    );
    const sub = `guest:${guestId()}`;
    const token = signToken({ sub, role: "guest", displayName });
    auditLog(sub, "guest_created", { ip });
    logger.info({ sub }, "guest_created");
    return res.json({ token, user: { sub, role: "guest", displayName } });
  });

  r.get("/me", requireAuth, (req, res) => {
    return res.json({
      sub: req.auth.sub,
      role: req.auth.role,
      displayName: req.auth.displayName,
    });
  });

  return r;
}
