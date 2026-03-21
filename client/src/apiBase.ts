export function apiBase(): string {
  const u = import.meta.env.VITE_SOCKET_URL || "http://localhost:3001";
  return u.replace(/\/$/, "");
}

export function socketUrl(): string {
  return apiBase();
}
