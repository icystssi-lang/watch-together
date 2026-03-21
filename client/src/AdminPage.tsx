import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiBase } from "./apiBase";
import "./index.css";

type RoomRow = {
  roomId: string;
  hostSocketId: string;
  memberCount: number;
  maxUsers: number | null;
  onlyHostControls: boolean;
  videoProvider: string | null;
};

type AuditEntry = {
  id: number;
  ts: number;
  actor_sub: string | null;
  action: string;
  meta: Record<string, unknown>;
};

type Props = {
  token: string;
};

export function AdminPage({ token }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const authHeader = useCallback(
    (): HeadersInit => ({ Authorization: `Bearer ${token}` }),
    [token]
  );

  const load = useCallback(async () => {
    setError(null);
    const base = apiBase();
    try {
      const [rRooms, rAudit] = await Promise.all([
        fetch(`${base}/api/admin/rooms`, { headers: authHeader() }),
        fetch(`${base}/api/admin/audit?limit=80`, { headers: authHeader() }),
      ]);
      if (rRooms.status === 401 || rRooms.status === 403) {
        setError("Not authorized as admin.");
        return;
      }
      if (!rRooms.ok) {
        setError("Failed to load rooms.");
        return;
      }
      const j = await rRooms.json();
      setRooms(Array.isArray(j.rooms) ? j.rooms : []);

      if (rAudit.ok) {
        const aj = await rAudit.json();
        setAudit(Array.isArray(aj.entries) ? aj.entries : []);
      }
    } catch {
      setError("Network error");
    }
  }, [authHeader]);

  useEffect(() => {
    void load();
  }, [load]);

  async function disconnectSocket(socketId: string) {
    if (!socketId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${apiBase()}/api/admin/disconnect-socket`, {
        method: "POST",
        headers: {
          ...authHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ socketId, reason: "admin_ui" }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(typeof j.error === "string" ? j.error : "Disconnect failed");
        return;
      }
      await load();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app admin-page">
      <header className="room-header">
        <div>
          <h1>Admin</h1>
          <p className="muted">Rooms and recent audit entries.</p>
        </div>
        <div className="header-actions">
          <button type="button" onClick={() => void load()} disabled={busy}>
            Refresh
          </button>
          <Link to="/" className="nav-link">
            Watch app
          </Link>
        </div>
      </header>

      {error && <p className="banner">{error}</p>}

      <h2 className="admin-section-title">Rooms</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Room</th>
              <th>Members</th>
              <th>Max</th>
              <th>Host socket</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rooms.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No active rooms
                </td>
              </tr>
            ) : (
              rooms.map((row) => (
                <tr key={row.roomId}>
                  <td>{row.roomId}</td>
                  <td>{row.memberCount}</td>
                  <td>{row.maxUsers == null ? "∞" : row.maxUsers}</td>
                  <td className="mono">{row.hostSocketId}</td>
                  <td>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void disconnectSocket(row.hostSocketId)}
                    >
                      Disconnect host
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="admin-section-title">Audit log</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Meta</th>
            </tr>
          </thead>
          <tbody>
            {audit.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No entries
                </td>
              </tr>
            ) : (
              audit.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{new Date(a.ts).toISOString()}</td>
                  <td className="mono">{a.actor_sub ?? "—"}</td>
                  <td>{a.action}</td>
                  <td className="mono small-meta">
                    {JSON.stringify(a.meta)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
