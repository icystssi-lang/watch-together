import { verifyToken } from "./jwtUtil.js";

export function requireAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = verifyToken(h.slice(7));
    req.auth = {
      sub: payload.sub,
      role: payload.role,
      displayName: payload.displayName,
    };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireAdmin(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = verifyToken(h.slice(7));
    if (payload.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    req.auth = {
      sub: payload.sub,
      role: payload.role,
      displayName: payload.displayName,
    };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
