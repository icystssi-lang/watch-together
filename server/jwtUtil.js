import jwt from "jsonwebtoken";

const DEFAULT_DEV_SECRET = "dev-only-change-me";

export function getJwtSecret() {
  return process.env.JWT_SECRET || DEFAULT_DEV_SECRET;
}

/** @param {{ sub: string, role: string, displayName: string }} payload */
export function signToken(payload) {
  return jwt.sign(
    {
      sub: payload.sub,
      role: payload.role,
      displayName: payload.displayName,
    },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES || "7d" }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}
