import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

export type ChatMessage = { username: string; text: string; ts: number };

type Props = {
  socket: Socket;
  disabled?: boolean;
};

export function Chat({ socket, disabled }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMsg = (msg: ChatMessage) => {
      setMessages((m) => [...m, msg]);
    };
    socket.on("receive_message", onMsg);
    return () => {
      socket.off("receive_message", onMsg);
    };
  }, [socket]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send() {
    const text = draft.trim();
    if (!text || disabled) return;
    socket.emit("send_message", { text });
    setDraft("");
  }

  return (
    <div className="chat">
      <h3 className="chat-title">Chat</h3>
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={`${m.ts}-${i}`} className="chat-line">
            <span className="chat-user">{m.username}</span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
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
