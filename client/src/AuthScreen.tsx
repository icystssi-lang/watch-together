import { useState } from "react";
import { apiBase } from "./apiBase";

type Mode = "login" | "register" | "guest";

type Props = {
  onAuthed: (token: string) => void;
};

export function AuthScreen({ onAuthed }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [guestName, setGuestName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    const base = apiBase();
    try {
      let path = "";
      let body: Record<string, string> = {};
      if (mode === "login") {
        path = "/api/auth/login";
        body = { email, password };
      } else if (mode === "register") {
        path = "/api/auth/register";
        body = { email, password, displayName };
      } else {
        path = "/api/auth/guest";
        body = guestName.trim() ? { displayName: guestName.trim() } : {};
      }
      const r = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(typeof data.error === "string" ? data.error : "Request failed");
        return;
      }
      if (typeof data.token === "string") {
        onAuthed(data.token);
      } else {
        setError("Invalid server response");
      }
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app lobby auth-screen">
      <h1>Watch Together</h1>
      <p className="muted">Sign in, create an account, or continue as a guest.</p>

      <div className="auth-tabs">
        <button
          type="button"
          className={mode === "login" ? "tab active" : "tab"}
          onClick={() => setMode("login")}
        >
          Login
        </button>
        <button
          type="button"
          className={mode === "register" ? "tab active" : "tab"}
          onClick={() => setMode("register")}
        >
          Register
        </button>
        <button
          type="button"
          className={mode === "guest" ? "tab active" : "tab"}
          onClick={() => setMode("guest")}
        >
          Guest
        </button>
      </div>

      {error && <p className="banner">{error}</p>}

      {mode !== "guest" ? (
        <div className="auth-fields">
          {mode === "register" && (
            <input
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="nickname"
            />
          )}
          <input
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <input
            placeholder="Password (min 6 chars)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={
              mode === "register" ? "new-password" : "current-password"
            }
          />
        </div>
      ) : (
        <div className="auth-fields">
          <input
            placeholder="Display name (optional)"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
          />
        </div>
      )}

      <button type="button" disabled={busy} onClick={() => void submit()}>
        {busy ? "Please wait…" : mode === "guest" ? "Continue as guest" : mode === "register" ? "Create account" : "Login"}
      </button>
    </div>
  );
}
