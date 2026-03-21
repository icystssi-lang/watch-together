const VALID_PROVIDERS = new Set(["youtube", "vimeo", "html5", "iframe"]);

export function isValidProvider(p) {
  return typeof p === "string" && VALID_PROVIDERS.has(p);
}

export function createRoomState(roomId, hostSocketId) {
  return {
    roomId,
    hostSocketId,
    onlyHostControls: false,
    videoProvider: null,
    videoSource: null,
    currentTime: 0,
    isPlaying: false,
  };
}
