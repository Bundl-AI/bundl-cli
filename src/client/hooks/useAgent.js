import { useRef, useState, useEffect } from "react";

export function useAgent(onMessage) {
  const ws = useRef(null);
  const [connected, setConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/ws`;
    ws.current = new WebSocket(url);
    ws.current.onopen = () => setConnected(true);
    ws.current.onclose = () => setConnected(false);
    ws.current.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "agent:done" || data.type === "agent:error") setStreaming(false);
        if (onMessage) onMessage(data, send);
      } catch (_) {}
    };
  }

  function send(data) {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(data));
    }
  }

  function sendMessage(message, history, chatId = null) {
    setStreaming(true);
    send({ type: "agent:message", message, history, chatId: chatId || undefined });
  }

  useEffect(() => {
    connect();
    return () => {
      if (ws.current) ws.current.close();
    };
  }, []);

  return { connected, streaming, sendMessage, send };
}
