import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

/** Canonical reaction key (matches server); strips emoji presentation selector so whitelist always matches. */
function normalizeReactionKey(s: string): string {
  return s.normalize("NFC").replace(/\uFE0F/g, "").trim();
}

function normalizeReactionsRecord(rec: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[normalizeReactionKey(k)] = v;
  }
  return out;
}

/** U+1F622 = crying face (explicit escape avoids wrong lookalike in source files). */
const REACTION_PICKER: readonly { readonly key: string; readonly glyph: string }[] = (
  ["👍", "❤️", "😂", "😮", "\u{1F622}", "🔥"] as const
).map((glyph) => ({ glyph, key: normalizeReactionKey(glyph) }));

function reactionGlyphForKey(key: string): string {
  for (const r of REACTION_PICKER) {
    if (r.key === key) return r.glyph;
  }
  return key;
}

const LONG_PRESS_MS = 480;
const HOVER_CLOSE_MS = 420;
const FLOATER_GAP_PX = 10;
const FLOATER_EST_HEIGHT_PX = 46;

export type ChatMessage = {
  id: string;
  username: string;
  text: string;
  ts: number;
  reactions: Record<string, string[]>;
};

type Props = {
  socket: Socket;
  disabled?: boolean;
  myUsername?: string;
};

function useTouchUi() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: none)");
    const apply = () => setTouch(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return touch;
}

export function Chat({ socket, disabled, myUsername }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [activeReactionMessageId, setActiveReactionMessageId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const floaterInnerRef = useRef<HTMLDivElement>(null);
  const rowElByIdRef = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const longPressTimer = useRef<number | null>(null);
  const hoverCloseTimer = useRef<number | null>(null);
  const touchUi = useTouchUi();
  const [floaterPos, setFloaterPos] = useState<{ left: number; top: number } | null>(null);

  const cancelHoverClose = useCallback(() => {
    if (hoverCloseTimer.current) {
      clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
  }, []);

  const scheduleHoverClose = useCallback(() => {
    cancelHoverClose();
    hoverCloseTimer.current = window.setTimeout(() => {
      hoverCloseTimer.current = null;
      setActiveReactionMessageId(null);
    }, HOVER_CLOSE_MS);
  }, [cancelHoverClose]);

  const updateFloaterPosition = useCallback(() => {
    const id = activeReactionMessageId;
    if (!id) {
      setFloaterPos(null);
      return;
    }
    const row = rowElByIdRef.current.get(id);
    const cont = chatMessagesRef.current;
    if (!row || !cont) return;

    const rowRect = row.getBoundingClientRect();
    const contRect = cont.getBoundingClientRect();
    const h = floaterInnerRef.current?.offsetHeight || FLOATER_EST_HEIGHT_PX;
    const centerX = contRect.left + contRect.width / 2;

    let top = rowRect.bottom + FLOATER_GAP_PX;
    if (top + h > contRect.bottom - 6) {
      top = rowRect.top - FLOATER_GAP_PX - h;
    }
    top = Math.max(contRect.top + 6, top);
    top = Math.min(top, contRect.bottom - h - 6);

    setFloaterPos({ left: centerX, top });
  }, [activeReactionMessageId]);

  useLayoutEffect(() => {
    if (!activeReactionMessageId) {
      setFloaterPos(null);
      return;
    }
    updateFloaterPosition();
    requestAnimationFrame(() => updateFloaterPosition());

    const cont = chatMessagesRef.current;
    if (cont) {
      cont.addEventListener("scroll", updateFloaterPosition, { passive: true });
    }
    window.addEventListener("resize", updateFloaterPosition);

    const ro = new ResizeObserver(() => updateFloaterPosition());
    if (cont) ro.observe(cont);
    const row = rowElByIdRef.current.get(activeReactionMessageId);
    if (row) ro.observe(row);
    const inner = floaterInnerRef.current;
    if (inner) ro.observe(inner);

    return () => {
      cont?.removeEventListener("scroll", updateFloaterPosition);
      window.removeEventListener("resize", updateFloaterPosition);
      ro.disconnect();
    };
  }, [activeReactionMessageId, messages, updateFloaterPosition]);

  useEffect(() => {
    return () => {
      if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current);
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!activeReactionMessageId) return;
    function onPointerDown(ev: PointerEvent) {
      const el = chatMessagesRef.current;
      if (el && !el.contains(ev.target as Node)) {
        setActiveReactionMessageId(null);
      }
    }
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === "Escape") setActiveReactionMessageId(null);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeReactionMessageId]);

  useEffect(() => {
    if (
      activeReactionMessageId &&
      !messages.some((x) => x.id === activeReactionMessageId)
    ) {
      setActiveReactionMessageId(null);
    }
  }, [messages, activeReactionMessageId]);

  useEffect(() => {
    const onMsg = (msg: ChatMessage) => {
      if (!msg?.id) return;
      setMessages((m) => [
        ...m,
        {
          ...msg,
          reactions: normalizeReactionsRecord(
            msg.reactions && typeof msg.reactions === "object" ? msg.reactions : {},
          ),
        },
      ]);
    };
    const onReactions = (data: { messageId?: string; reactions?: Record<string, string[]> }) => {
      const messageId = typeof data?.messageId === "string" ? data.messageId : "";
      const reactions =
        data?.reactions && typeof data.reactions === "object" ? data.reactions : null;
      if (!messageId || !reactions) return;
      const reactionsNorm = normalizeReactionsRecord(reactions);
      setMessages((msgs) =>
        msgs.map((x) => (x.id === messageId ? { ...x, reactions: reactionsNorm } : x)),
      );
    };
    socket.on("receive_message", onMsg);
    socket.on("message_reactions", onReactions);
    return () => {
      socket.off("receive_message", onMsg);
      socket.off("message_reactions", onReactions);
    };
  }, [socket]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function clearLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function send() {
    const text = draft.trim();
    if (!text || disabled) return;
    socket.emit("send_message", { text });
    setDraft("");
  }

  function toggleReaction(messageId: string, emoji: string) {
    if (disabled) return;
    socket.emit("react_message", { messageId, emoji: normalizeReactionKey(emoji) });
  }

  function pickFromBar(messageId: string, emoji: string) {
    toggleReaction(messageId, emoji);
    cancelHoverClose();
    setActiveReactionMessageId(null);
  }

  const activeMessage = activeReactionMessageId
    ? messages.find((x) => x.id === activeReactionMessageId)
    : undefined;

  return (
    <div className="chat">
      <h3 className="chat-title">Chat</h3>
      <div className="chat-messages" ref={chatMessagesRef}>
        {messages.map((m) => {
          const isMine = Boolean(myUsername && m.username === myUsername);
          const isTarget = activeReactionMessageId === m.id;
          const reactionEntries = Object.entries(m.reactions).filter(([, u]) => u.length > 0);
          const hasReactions = reactionEntries.length > 0;

          return (
            <div
              key={m.id}
              className={`chat-msg-row ${isMine ? "chat-msg-row--mine" : ""} ${isTarget ? "chat-msg-row--react-target" : ""}`}
              ref={(node) => {
                if (node) rowElByIdRef.current.set(m.id, node);
                else rowElByIdRef.current.delete(m.id);
              }}
              onMouseEnter={() => {
                if (disabled || touchUi) return;
                cancelHoverClose();
                setActiveReactionMessageId(m.id);
              }}
              onMouseLeave={() => {
                if (disabled || touchUi) return;
                scheduleHoverClose();
              }}
            >
              {!isMine && <span className="chat-msg-sender">{m.username}</span>}
              <div className="chat-msg-block">
                <div
                  className={`chat-msg-bubble-wrap ${hasReactions ? "chat-msg-bubble-wrap--has-reactions" : ""}`}
                  onPointerDown={(e) => {
                    if (!touchUi || disabled || e.pointerType === "mouse") return;
                    clearLongPress();
                    longPressTimer.current = window.setTimeout(() => {
                      longPressTimer.current = null;
                      setActiveReactionMessageId(m.id);
                      if (typeof navigator !== "undefined" && navigator.vibrate) {
                        navigator.vibrate(12);
                      }
                    }, LONG_PRESS_MS);
                  }}
                  onPointerUp={clearLongPress}
                  onPointerCancel={clearLongPress}
                  onPointerLeave={(e) => {
                    if (e.pointerType !== "mouse") clearLongPress();
                  }}
                >
                  {touchUi && (
                    <button
                      type="button"
                      className="chat-msg-mobile-react"
                      disabled={disabled}
                      title="Reactions"
                      aria-label="Open reactions"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveReactionMessageId((cur) => (cur === m.id ? null : m.id));
                      }}
                    >
                      <span aria-hidden>😊</span>
                    </button>
                  )}

                  <div className={`chat-msg-bubble ${isMine ? "chat-msg-bubble--mine" : ""}`}>
                    {m.text}
                  </div>

                  {hasReactions && (
                    <div className="chat-msg-reaction-summary" aria-label="Reactions on this message">
                      {reactionEntries.map(([emoji, users]) => (
                        <span
                          key={emoji}
                          className="chat-msg-reaction-chip"
                          title={users.join(", ")}
                        >
                          <span className="chat-msg-reaction-chip-emoji">
                            {reactionGlyphForKey(emoji)}
                          </span>
                          {users.length > 1 && (
                            <span className="chat-msg-reaction-chip-count">{users.length}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {activeMessage && (
          <div
            className="chat-reaction-floater"
            role="presentation"
            style={
              floaterPos
                ? {
                    position: "fixed",
                    left: floaterPos.left,
                    top: floaterPos.top,
                    transform: "translateX(-50%)",
                    zIndex: 50,
                  }
                : {
                    position: "fixed",
                    left: -9999,
                    top: 0,
                    opacity: 0,
                    zIndex: 50,
                    pointerEvents: "none",
                  }
            }
          >
            <div
              ref={floaterInnerRef}
              className="chat-reaction-floater-inner"
              role="toolbar"
              aria-label="React to message"
              onMouseEnter={cancelHoverClose}
              onMouseLeave={() => {
                if (!touchUi) scheduleHoverClose();
              }}
            >
              {REACTION_PICKER.map(({ key, glyph }) => {
                const mine = Boolean(
                  myUsername && activeMessage.reactions[key]?.includes(myUsername),
                );
                return (
                  <button
                    key={key}
                    type="button"
                    className={
                      mine
                        ? "chat-reaction-floater-btn chat-reaction-floater-btn--mine"
                        : "chat-reaction-floater-btn"
                    }
                    disabled={disabled}
                    title={mine ? `Remove ${glyph}` : glyph}
                    onClick={() => pickFromBar(activeMessage.id, key)}
                  >
                    <span className="chat-reaction-floater-emoji">{glyph}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <input
          className="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={disabled ? "Join a room to chat" : "Message…"}
          disabled={disabled}
        />
        <button type="button" onClick={send} disabled={disabled}>
          Send
        </button>
      </div>
    </div>
  );
}
