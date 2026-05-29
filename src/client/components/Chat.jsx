import { useRef, useEffect } from "react";
import Message from "./Message.jsx";

export default function Chat({
  connected,
  streaming,
  sendMessage,
  initData,
  messages,
  streamingContent,
  streamingActions,
  setMessages,
  pendingCommand,
  clearPendingCommand,
  currentChatId,
  onOpenFile,
}) {
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamingContent]);

  useEffect(() => {
    if (pendingCommand && inputRef.current) {
      const el = inputRef.current;
      const before = el.value.trim();
      el.value = before ? before + " " + pendingCommand : pendingCommand;
      el.focus();
      clearPendingCommand();
    }
  }, [pendingCommand, clearPendingCommand]);

  function handleSend() {
    const el = inputRef.current;
    if (!el) return;
    const text = el.value.trim();
    if (!text) return;
    const newMessages = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    el.value = "";
    sendMessage(text, newMessages, currentChatId ?? undefined);
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const showWelcome = messages.length === 0 && !streaming;

  return (
    <div className="chat-panel">
      <div className="messages" ref={scrollRef}>
        <div className="messages-inner">
        {showWelcome && (
          <div className="chat-welcome">
            <pre className="chat-welcome-logo" aria-hidden="true">
{`    __                    ____
   / /_  __  ______  ____/ / /
  / __ \\/ / / / __ \\/ __  / / 
 / /_/ / /_/ / / / / /_/ / /  
/_.___/\\__,_/_/ /_/\\__,_/_/   `}
            </pre>
            <p className="chat-welcome-tagline">  The open corpus standard for AI employees.</p>
            <p className="chat-welcome-version">  1.0.0</p>
            <p className="chat-welcome-hr">  ─────────────────────────────────────────</p>
          </div>
        )}
        {messages.map((m, i) => (
          <Message
            key={i}
            role={m.role}
            content={m.content}
            actions={m.actions}
            error={m.error}
            onOpenFile={onOpenFile}
          />
        ))}
        {streaming && (
          <>
            {streamingActions.length > 0 && (
              <div className="tool-calls-block">
                <div className="tool-calls-header">TOOL CALLS ({streamingActions.length})</div>
                <ul className="tool-calls-list">
                  {streamingActions.map((a, i) => (
                    <li key={"a" + i} className="tool-calls-item">
                      <span>{a.tool === "run_bash" ? String(a.preview || "").slice(0, 60) + "…" : a.tool}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="message agent">
              {streamingContent ? (
                <Message role="assistant" content={streamingContent} />
              ) : (
                <div className="typing">
                  Agent is thinking<span>.</span><span>.</span><span>.</span>
                </div>
              )}
            </div>
          </>
        )}
        </div>
      </div>
      <div className="input-bar">
        <div className="input-bar-inner">
        <div className="input-container-wrap">
          <div className="command-pills">
            {(initData?.commands || []).slice(0, 6).map((cmd) => (
              <button
                key={cmd}
                type="button"
                className="command-pill"
                onClick={() => {
                  if (inputRef.current) {
                    const v = inputRef.current.value.trim();
                    inputRef.current.value = v ? v + " " + cmd : cmd;
                    inputRef.current.focus();
                  }
                }}
              >
                {cmd}
              </button>
            ))}
          </div>
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder={connected ? "Ask anything, or use /command…" : "Connecting…"}
            disabled={!connected}
            onKeyDown={onKeyDown}
            rows={2}
          />
          <div className="input-row">
            <button onClick={handleSend} disabled={!connected || streaming}>
              Send
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
