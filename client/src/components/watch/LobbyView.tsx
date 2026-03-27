import { Link } from "react-router-dom";
import { APP_DISPLAY_NAME } from "../../appName";
import { SiteFooter } from "../../SiteFooter";

type PublicRoom = {
  roomId: string;
  memberCount: number;
  maxUsers: number | null;
  requiresPassword: boolean;
};

type Props = {
  isAdmin?: boolean;
  onLogout: () => void;
  banner: string | null;
  joinInput: string;
  joinPassword: string;
  onJoinInputChange: (v: string) => void;
  onJoinPasswordChange: (v: string) => void;
  createJoinMode: "open" | "password";
  createPassword: string;
  onCreateJoinModeChange: (v: "open" | "password") => void;
  onCreatePasswordChange: (v: string) => void;
  publicRooms: PublicRoom[];
  onJoinPublicRoom: (roomId: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  lobbyBusy: boolean;
  lobbyAction: null | "create" | "join";
};

export function LobbyView({
  isAdmin,
  onLogout,
  banner,
  joinInput,
  joinPassword,
  onJoinInputChange,
  onJoinPasswordChange,
  createJoinMode,
  createPassword,
  onCreateJoinModeChange,
  onCreatePasswordChange,
  publicRooms,
  onJoinPublicRoom,
  onCreateRoom,
  onJoinRoom,
  lobbyBusy,
  lobbyAction,
}: Props) {
  return (
    <div className="app lobby">
      <header className="lobby-top">
        <div className="lobby-nav">
          {isAdmin && (
            <Link to="/admin" className="nav-link">
              Admin
            </Link>
          )}
          <button type="button" className="linkish" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>
      <h1>{APP_DISPLAY_NAME}</h1>
      <p className="muted">
        YouTube, Vimeo, direct video files, or generic embed URLs.
      </p>
      {banner && <p className="banner">{banner}</p>}
      <div className="lobby-actions">
        <div className="host-tools">
          <p className="muted small host-tools__label">Create room access</p>
          <div className="load-row">
            <label className="host-toggle">
              <input
                type="radio"
                name="create-join-mode"
                checked={createJoinMode === "open"}
                onChange={() => onCreateJoinModeChange("open")}
                disabled={lobbyBusy}
              />
              Open room
            </label>
            <label className="host-toggle">
              <input
                type="radio"
                name="create-join-mode"
                checked={createJoinMode === "password"}
                onChange={() => onCreateJoinModeChange("password")}
                disabled={lobbyBusy}
              />
              Password room
            </label>
          </div>
          {createJoinMode === "password" && (
            <input
              type="password"
              value={createPassword}
              onChange={(e) => onCreatePasswordChange(e.target.value)}
              placeholder="Room password (min 4 chars)"
              disabled={lobbyBusy}
            />
          )}
        </div>
        <button
          type="button"
          onClick={onCreateRoom}
          disabled={lobbyBusy}
        >
          {lobbyAction === "create" ? "Creating…" : "Create room"}
        </button>
        <div className="join-row">
          <input
            value={joinInput}
            onChange={(e) => onJoinInputChange(e.target.value.toUpperCase())}
            placeholder="ROOM ID"
            maxLength={12}
            disabled={lobbyBusy}
          />
          <button
            type="button"
            onClick={onJoinRoom}
            disabled={lobbyBusy || !joinInput.trim()}
          >
            {lobbyAction === "join" ? "Joining…" : "Join"}
          </button>
        </div>
        <input
          type="password"
          value={joinPassword}
          onChange={(e) => onJoinPasswordChange(e.target.value)}
          placeholder="Password (only for protected room ID joins)"
          disabled={lobbyBusy}
        />
      </div>
      <div className="host-tools" style={{ marginTop: "1rem" }}>
        <p className="muted small host-tools__label">Available open rooms</p>
        {publicRooms.length === 0 ? (
          <p className="muted small">No open rooms right now.</p>
        ) : (
          publicRooms.map((room) => {
            const cap =
              room.maxUsers == null
                ? `${room.memberCount} / ∞`
                : `${room.memberCount} / ${room.maxUsers}`;
            return (
              <div key={room.roomId} className="load-row">
                <code className="room-id-chip mono">{room.roomId}</code>
                <span className="muted small">{cap}</span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => onJoinPublicRoom(room.roomId)}
                  disabled={lobbyBusy}
                >
                  Join
                </button>
              </div>
            );
          })
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
