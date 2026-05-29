import { useState, useCallback, useEffect, useRef } from "react";
import NavPanel from "./components/NavPanel.jsx";
import Chat from "./components/Chat.jsx";
import FileViewer from "./components/FileViewer.jsx";
import { useAgent } from "./hooks/useAgent.js";

export default function App() {
  const [view, setView] = useState("chat");
  const [activePath, setActivePath] = useState(null);
  const [initData, setInitData] = useState(null);
  const [pendingCommand, setPendingCommand] = useState(null);
  const [messages, setMessages] = useState([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingActions, setStreamingActions] = useState([]);
  const [fileContent, setFileContent] = useState("");
  const [fileContentPath, setFileContentPath] = useState(null);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [chatsList, setChatsList] = useState([]);
  const streamingActionsRef = useRef([]);
  const streamingContentRef = useRef("");
  streamingActionsRef.current = streamingActions;
  streamingContentRef.current = streamingContent;

  const handleMessage = useCallback((data, send) => {
    if (data.type === "init:complete") {
      setInitData(data);
      setChatsList(data.chats || []);
      return;
    }
    if (data.type === "chats:content") {
      if (data.messages) setMessages(data.messages);
      if (data.chatId) setCurrentChatId(data.chatId);
      return;
    }
    if (data.type === "chats:updated") {
      if (Array.isArray(data.chats)) setChatsList(data.chats);
      return;
    }
    if (data.type === "agent:token") {
      setStreamingContent((prev) => prev + (data.token || ""));
      return;
    }
    if (data.type === "agent:action") {
      setStreamingActions((prev) => [...prev, { tool: data.tool, input: data.input, preview: data.preview }]);
      return;
    }
    if (data.type === "agent:done") {
      const actions = [...streamingActionsRef.current];
      const finalContent = (data.fullResponse && String(data.fullResponse).trim()) || streamingContentRef.current || "";
      setStreamingActions([]);
      setStreamingContent("");
      let nextForSave;
      setMessages((prev) => {
        const next = [...prev, { role: "assistant", content: finalContent, actions }];
        nextForSave = next;
        return next;
      });
      if (data.chatId) {
        setCurrentChatId(data.chatId);
        if (send && nextForSave) {
          const preview = nextForSave.find((m) => m.role === "user")?.content?.slice(0, 80) || "New chat";
          send({ type: "chats:save", chatId: data.chatId, messages: nextForSave, preview });
        }
      }
      return;
    }
    if (data.type === "agent:error") {
      setMessages((prev) => [...prev, { role: "assistant", content: "Error: " + (data.error || "Unknown"), error: true }]);
      setStreamingContent("");
      setStreamingActions([]);
      return;
    }
    if (data.type === "file:content") {
      setFileContent(data.content ?? "");
      setFileContentPath(data.path ?? null);
      return;
    }
  }, []);

  const { connected, streaming, sendMessage, send } = useAgent(handleMessage);

  useEffect(() => {
    if (connected && !initData) {
      send({ type: "init" });
    }
  }, [connected, initData, send]);

  useEffect(() => {
    if (view === "file" && activePath) {
      send({ type: "file:read", path: activePath });
    }
  }, [view, activePath, send]);

  return (
    <div className="app">
      <nav className="nav-column">
        <NavPanel
          initData={initData}
          view={view}
          activePath={activePath}
          setView={setView}
          setActivePath={setActivePath}
          currentChatId={currentChatId}
          chatsList={chatsList}
          onNewChat={() => {
            setMessages([]);
            setCurrentChatId(null);
            setView("chat");
          }}
          onLoadChat={(chatId) => {
            setView("chat");
            send({ type: "chats:load", chatId });
          }}
          send={send}
          onInsertCommand={(cmd) => {
            setView("chat");
            setPendingCommand(cmd);
          }}
        />
      </nav>
      <main className="main-column">
        {view === "chat" ? (
          <Chat
            connected={connected}
            streaming={streaming}
            sendMessage={sendMessage}
            initData={initData}
            messages={messages}
            streamingContent={streamingContent}
            streamingActions={streamingActions}
            setMessages={setMessages}
            pendingCommand={pendingCommand}
            clearPendingCommand={() => setPendingCommand(null)}
            currentChatId={currentChatId}
            onOpenFile={(path) => {
              setActivePath(path);
              setView("file");
            }}
          />
        ) : (
          <FileViewer
            path={activePath}
            content={fileContentPath === activePath ? fileContent : undefined}
            onBack={() => setView("chat")}
            send={send}
            editable={activePath?.startsWith("workspace/company/")}
          />
        )}
      </main>
    </div>
  );
}
