# Watch Together (MVP)

Watch YouTube, Vimeo, direct video files (e.g. `.mp4`), or generic embed URLs together in a room, with synced play/pause/seek (best effort for generic iframes) and chat. **No video is hosted**—each person plays media in their own browser.

## Requirements

- Node.js 18+

## Run locally

Terminal 1 — server (port **3001**):

```bash
cd server
npm install
npm start
```

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

Set `VITE_SOCKET_URL` if the API is not at `http://localhost:3001` (see `client/.env.development`).

## Usage

1. Open `http://localhost:5173`.
2. **Create room** or **Join** with a room ID.
3. Paste a supported URL and **Load video**.
4. Open the same room in another tab or browser to verify sync and chat.

Optional query param: `http://localhost:5173/?room=YOURROOMID` pre-fills the join field.

## Supported URLs

- **YouTube** (watch, youtu.be, Shorts)
- **Vimeo** (`vimeo.com/123`)
- **Direct file** (`.mp4`, `.webm`, `.ogg`)
- **Other HTTPS URLs** — loaded in a generic `<iframe>` (sync may be limited)

## Stack

- Server: Express, Socket.IO, in-memory rooms
- Client: React (Vite), Socket.IO client, YouTube IFrame API, `@vimeo/player`
