const VALID_PROVIDERS = new Set([
  "youtube",
  "vimeo",
  "html5",
  "iframe",
  "screenshare",
]);

export function isValidProvider(p) {
  return typeof p === "string" && VALID_PROVIDERS.has(p);
}

export function createRoomState(roomId, hostSocketId) {
  return {
    roomId,
    hostSocketId,
    onlyHostControls: false,
    /** @type {number | null} null = unlimited */
    maxUsers: 10,
    videoProvider: null,
    videoSource: null,
    currentTime: 0,
    isPlaying: false,
    /** @type {string[]} */
    recentChatMessageIds: [],
    /** @type {Map<string, Map<string, Set<string>>>} messageId -> emoji -> usernames */
    messageReactions: new Map(),
  };
}
