# Veluma

**Veluma** is a watch-together app: YouTube, Vimeo, direct video files (e.g. `.mp4`), or generic embed URLs in a room, with synced play/pause/seek (best effort for generic iframes) and chat. The **host** can also **share a screen or browser tab** to the room via WebRTC (mesh). **No video is hosted** on the server for URL-based playback—each person loads embeds or files in their own browser; screen share is peer‑to‑peer from the host.

## Requirements

- Node.js 18+

## Configuration

Copy [`.env.example`](.env.example) and set at least:

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | Required in production — signing key for auth tokens |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | If **no** admin exists in the database yet, the first server start creates that admin |
| `DATABASE_PATH` | Optional — defaults to `server/data/app.db` (SQLite) |

Client (`client/.env.development`):

| Variable | Purpose |
|----------|---------|
| `VITE_SOCKET_URL` | Socket.IO server (default `http://localhost:3001`) |
| `VITE_WEBRTC_ICE_SERVERS` | Optional JSON array of `RTCIceServer` objects for screen share (add **TURN** when P2P fails behind strict NAT). Example: `[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]` |
| `VITE_APP_COPYRIGHT_HOLDER` | Optional — copyright name in the footer (defaults are in [`client/src/siteMeta.ts`](client/src/siteMeta.ts)) |
| `VITE_APP_BUILT_BY` | Optional — “Built by …” line in the footer |

If `VITE_WEBRTC_ICE_SERVERS` is unset, the client uses public **STUN** only (`stun:stun.l.google.com:19302`).

Footer text can also be customized by editing **`DEFAULT_COPYRIGHT_HOLDER`** and **`DEFAULT_BUILT_BY`** in [`client/src/siteMeta.ts`](client/src/siteMeta.ts).

## Run locally

Terminal 1 — server (port **3001**):

```bash
cd server
npm install
set JWT_SECRET=your-long-secret
set ADMIN_EMAIL=you@example.com
set ADMIN_PASSWORD=your-secure-password
npm start
```

(On Unix use `export VAR=value`.)

Terminal 2 — client (port **5173**):

```bash
cd client
npm install
npm run dev
```

Or from the repo root:

```bash
npm install
npm run dev
```

## Deploy (e.g. Railway)

### API + WebSocket (Node)

The repo root [`package.json`](package.json) defines **`npm start`** (`node server/index.js`) and **`postinstall`** so Railway install **server** dependencies from the monorepo root. Set **`JWT_SECRET`**, **`ADMIN_EMAIL`**, **`ADMIN_PASSWORD`**, and optionally **`DATABASE_PATH`** on a persistent volume. **`PORT`** is provided by the platform.

### React client (separate Railway service)

Use a **second** service in the same Railway project, pointed at the same repo:

1. **Add service** → **GitHub Repo** → pick this repository again.
2. **Settings → Root Directory**: `client`
3. **Variables** (required at **build** time for Vite):
   - **`VITE_SOCKET_URL`** — public **`https://…`** origin of your Node service (no trailing slash). Example: `https://watch-together-api.up.railway.app`
   - Optional: **`VITE_WEBRTC_ICE_SERVERS`**, **`VITE_APP_COPYRIGHT_HOLDER`**, **`VITE_APP_BUILT_BY`** (same meaning as in [Configuration](#configuration)).
4. Deploy. [`client/railway.json`](client/railway.json) sets **`npm ci && npm run build`** and starts **`serve`** on **`$PORT`** with SPA fallback (deep links like `/admin` work). If you change **`VITE_SOCKET_URL`**, trigger a new deploy so the bundle rebuilds.
5. **Generate Domain** (or custom domain) on the **client** service for the public site URL.

Local production check after `npm run build` in `client`: **`npm start`** serves `dist` on port **3000** (see [`client/package.json`](client/package.json)). Template: [`client/.env.production.example`](client/.env.production.example).

## Auth

1. Open `http://localhost:5173`.
2. **Register**, **Login**, or **Continue as guest**.
3. The client stores a JWT and sends it with every Socket.IO connection (`auth.token`).

## Rooms, host, and limits

- **Create room** or **Join** with a room ID.
- Default **max participants per room** is **10**; the **host** can change it (1–100) or set **Unlimited**.
- The host can **kick** a participant (dropdown under “Room capacity”).
- **Only host can control playback** toggle works as before.
- **Share screen** (host only): mesh WebRTC — the host uploads once **per viewer**, so keep the group small (roughly **2–5 viewers**) for acceptable quality and bandwidth. For larger rooms, use a dedicated SFU service instead (not included here). **Audio** is requested when supported (e.g. Chrome: share a **tab** and enable **Share tab audio**); whole-screen capture may be video-only depending on the browser and OS.
- **Screen share** requires a [**secure context**](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) in production (**HTTPS**); `http://localhost` is allowed for local development.
- If the host leaves, screen share is **cleared** automatically for the room.

## Admin

- Users with `role = admin` see an **Admin** link and can open **`/admin`**.
- Admin API: `GET /api/admin/rooms`, `POST /api/admin/disconnect-socket`, `GET /api/admin/audit` (Bearer JWT).

## Logging and audit

- Server logs are JSON via **pino** (stdout). Set `LOG_LEVEL` if needed.
- Security-relevant actions are also written to the SQLite **`audit_log`** table (viewable on `/admin`).

## Supported video URLs

- **YouTube** (watch, youtu.be, Shorts)
- **Vimeo** (`vimeo.com/123`)
- **Direct file** (`.mp4`, `.webm`, `.ogg`)
- **Other HTTPS URLs** — generic `<iframe>` (sync may be limited)
- **Screen / tab capture** — host uses **Share screen** (not a URL); signaling goes through Socket.IO (`rtc_signal`, `video_unloaded`).

## Stack

- Server: Express, Socket.IO, SQLite (`better-sqlite3`), JWT, bcrypt, pino
- Client: React (Vite), React Router, Socket.IO client, YouTube IFrame API, `@vimeo/player`

## Bans (optional)

Insert into `bans(subject)` where `subject` is `user:<id>` (see JWT `sub` for registered users) or `email:user@example.com` to block login/register for that identifier.
