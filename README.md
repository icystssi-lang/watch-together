# Watch Together

Watch YouTube, Vimeo, direct video files (e.g. `.mp4`), or generic embed URLs together in a room, with synced play/pause/seek (best effort for generic iframes) and chat. **No video is hosted**—each person plays media in their own browser.

## Requirements

- Node.js 18+

## Configuration

Copy [`.env.example`](.env.example) and set at least:

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | Required in production — signing key for auth tokens |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | If **no** admin exists in the database yet, the first server start creates that admin |
| `DATABASE_PATH` | Optional — defaults to `server/data/app.db` (SQLite) |

Client: `client/.env.development` can set `VITE_SOCKET_URL` (default `http://localhost:3001`).

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

## Auth

1. Open `http://localhost:5173`.
2. **Register**, **Login**, or **Continue as guest**.
3. The client stores a JWT and sends it with every Socket.IO connection (`auth.token`).

## Rooms, host, and limits

- **Create room** or **Join** with a room ID.
- Default **max participants per room** is **10**; the **host** can change it (1–100) or set **Unlimited**.
- The host can **kick** a participant (dropdown under “Room capacity”).
- **Only host can control playback** toggle works as before.

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

## Stack

- Server: Express, Socket.IO, SQLite (`better-sqlite3`), JWT, bcrypt, pino
- Client: React (Vite), React Router, Socket.IO client, YouTube IFrame API, `@vimeo/player`

## Bans (optional)

Insert into `bans(subject)` where `subject` is `user:<id>` (see JWT `sub` for registered users) or `email:user@example.com` to block login/register for that identifier.
