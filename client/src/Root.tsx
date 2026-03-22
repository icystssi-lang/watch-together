import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { apiBase } from "./apiBase";
import { AdminPage } from "./AdminPage";
import { AuthScreen } from "./AuthScreen";
import { WatchApp } from "./WatchApp";
import "./index.css";

const STORAGE_KEY = "veluma-auth-token";

type Me = { sub: string; role: string; displayName: string };

export default function Root() {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY)
  );
  const [me, setMe] = useState<Me | null>(null);
  const [meReady, setMeReady] = useState(() => !localStorage.getItem(STORAGE_KEY));

  useEffect(() => {
    if (!token) {
      setMe(null);
      setMeReady(true);
      return;
    }
    setMeReady(false);
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`${apiBase()}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) {
          if (r.status === 401) {
            localStorage.removeItem(STORAGE_KEY);
            if (!cancelled) setToken(null);
          }
          if (!cancelled) setMe(null);
          return;
        }
        const j = await r.json();
        if (!cancelled) setMe(j);
      } catch {
        if (!cancelled) setMe(null);
      } finally {
        if (!cancelled) setMeReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const clearAuth = () => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setMe(null);
  };

  if (!token) {
    return (
      <AuthScreen
        onAuthed={(t) => {
          localStorage.setItem(STORAGE_KEY, t);
          setToken(t);
        }}
      />
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/admin"
          element={
            !meReady ? (
              <div className="app lobby">
                <p className="muted">Loading…</p>
              </div>
            ) : me?.role === "admin" ? (
              <AdminPage token={token} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="*"
          element={
            <WatchApp
              token={token}
              onLogout={clearAuth}
              isAdmin={me?.role === "admin"}
            />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
