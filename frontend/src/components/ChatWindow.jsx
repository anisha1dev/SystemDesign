import React, { useEffect, useRef } from "react";

const ChatWindow = ({ messages }) => {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="chat-window">
      {messages.map((msg, idx) => (
        <div
          key={idx}
          className={msg.startsWith("User:") ? "user-msg" : "coach-msg"}
        >
          {msg.replace(/^User: |^Coach: /, "")}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
};

export default ChatWindow;
