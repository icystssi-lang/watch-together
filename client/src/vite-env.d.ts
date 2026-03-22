/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOCKET_URL: string;
  /** JSON array of RTCIceServer for WebRTC screen share (optional TURN). */
  readonly VITE_WEBRTC_ICE_SERVERS?: string;
  /** Copyright holder name (optional; default in siteMeta.ts). */
  readonly VITE_APP_COPYRIGHT_HOLDER?: string;
  /** Builder credit, “Built by …” (optional). */
  readonly VITE_APP_BUILT_BY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
