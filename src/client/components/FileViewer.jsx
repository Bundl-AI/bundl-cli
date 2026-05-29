import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";

function formatTimestamp(ts) {
  try {
    const d = new Date(ts.trim());
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleDateString(undefined, { dateStyle: "short" }) + " " + d.toLocaleTimeString(undefined, { timeStyle: "short" });
  } catch {
    return ts;
  }
}

function MemoryView({ content, type }) {
  const [sessionExpanded, setSessionExpanded] = useState(false);
  if (type === "session") {
    const sessionMatch = content.match(/^## Session\s+(\S+)\s+([^\n]+)/m);
    const sessionId = sessionMatch ? sessionMatch[1] : "";
    const sessionDate = sessionMatch ? formatTimestamp(sessionMatch[2].trim()) : "";
    const blocks = content.split(/\n###\s+/).slice(1);
    const entryCount = blocks.length;
    return (
      <div className="memory-view memory-session">
        <div className="memory-session-collapsed-card">
          <button
            type="button"
            className="memory-session-card-header"
            onClick={() => setSessionExpanded((e) => !e)}
            aria-expanded={sessionExpanded}
          >
            <span className="memory-session-card-chevron">{sessionExpanded ? "▼" : "▶"}</span>
            <span className="memory-session-id">{sessionId || "Session"}</span>
            {sessionDate && <span className="memory-session-date">{sessionDate}</span>}
            <span className="memory-session-count">{entryCount} {entryCount === 1 ? "entry" : "entries"}</span>
          </button>
          {sessionExpanded && (
            <div className="memory-session-entries">
              {blocks.map((block, i) => {
                const lines = block.trim().split("\n");
                const timestamp = lines[0] ? formatTimestamp(lines[0]) : "";
                let task = "",
                  action = "",
                  result = "";
            let command = "";
            let tools = "";
            lines.slice(1).forEach((line) => {
              if (line.startsWith("Task:")) task = line.replace(/^Task:\s*/, "").trim();
              else if (line.startsWith("Action:")) action = line.replace(/^Action:\s*/, "").trim();
              else if (line.startsWith("Command:")) command = line.replace(/^Command:\s*/, "").trim();
              else if (line.startsWith("Tools:")) tools = line.replace(/^Tools:\s*/, "").trim();
              else if (line.startsWith("Result:")) result = line.replace(/^Result:\s*/, "").trim();
            });
            return (
              <div key={i} className="memory-session-card">
                {timestamp && <div className="memory-card-time">{timestamp}</div>}
                {task && (
                  <div className="memory-card-row">
                    <span className="memory-card-label">Task</span>
                    <span className="memory-card-value">{task}</span>
                  </div>
                )}
                {command && (
                  <div className="memory-card-row">
                    <span className="memory-card-label">Command</span>
                    <span className="memory-card-value memory-card-command">{command}</span>
                  </div>
                )}
                {action && (
                  <div className="memory-card-row">
                    <span className="memory-card-label">Action</span>
                    <span className="memory-card-value">{action}</span>
                  </div>
                )}
                {tools && (
                  <div className="memory-card-row">
                    <span className="memory-card-label">Tools</span>
                    <span className="memory-card-value memory-card-tools">{tools}</span>
                  </div>
                )}
                {result && (
                  <div className="memory-card-row">
                    <span className="memory-card-label">Result</span>
                    <span className="memory-card-value memory-card-result">{result}</span>
                  </div>
                )}
              </div>
            );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }
  if (type === "longterm") {
    const lines = content.split("\n").filter((l) => l.trim());
    return (
      <div className="memory-view memory-longterm">
        <div className="memory-longterm-list">
          {lines.map((line, i) => {
            const pipe = " | ";
            const i1 = line.indexOf(pipe);
            const i2 = i1 >= 0 ? line.indexOf(pipe, i1 + pipe.length) : -1;
            const date = i1 >= 0 ? line.slice(0, i1).trim() : "";
            const category = i1 >= 0 ? (i2 >= 0 ? line.slice(i1 + pipe.length, i2).trim() : line.slice(i1 + pipe.length).trim()) : "";
            const text = i2 >= 0 ? line.slice(i2 + pipe.length).trim() : (i1 >= 0 ? "" : line);
            return (
              <div key={i} className="memory-longterm-card">
                <span className="memory-lt-date">{date}</span>
                <span className={`memory-lt-category memory-lt-${category.replace(/\s/g, "-").toLowerCase()}`}>{category}</span>
                <span className="memory-lt-text">{text}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return null;
}

export default function FileViewer({ path: filePath, content: initialContent, onBack, send, editable }) {
  const [content, setContent] = useState(initialContent ?? "");
  const [mode, setMode] = useState(editable ? "edit" : "view");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (initialContent !== undefined) setContent(initialContent);
  }, [initialContent]);

  const handleSave = useCallback(() => {
    if (!filePath || !send) return;
    setSaving(true);
    send({ type: "file:write", path: filePath, content });
    setToast("Saved");
    setTimeout(() => setToast(""), 2000);
    setTimeout(() => setSaving(false), 300);
  }, [filePath, content, send]);

  if (!filePath) return null;

  const fileName = filePath.split("/").pop() || filePath;
  const isMemorySession = filePath.includes("memory/session.md");
  const isMemoryLongterm = filePath.includes("memory/longterm.md");
  const isMemoryFile = isMemorySession || isMemoryLongterm;

  return (
    <div className="file-viewer">
      <div className="file-viewer-header">
        <button type="button" onClick={onBack}>
          ← Back to Chat
        </button>
        <span style={{ flex: 1, fontFamily: "JetBrains Mono", fontSize: 14 }}>{fileName}</span>
        <button type="button" onClick={() => setMode(mode === "view" ? "edit" : "view")}>
          {mode === "view" ? "Edit" : "View"}
        </button>
        {mode === "edit" && (
          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      <div className="file-viewer-content">
        {mode === "view" ? (
          initialContent === undefined ? (
            <p className="file-viewer-loading">Loading…</p>
          ) : content ? (
            isMemoryFile ? (
              <MemoryView content={content} type={isMemorySession ? "session" : "longterm"} />
            ) : (
              <div className="markdown-body">
                <ReactMarkdown>{content}</ReactMarkdown>
              </div>
            )
          ) : (
            <p className="file-viewer-empty">(empty)</p>
          )
        ) : (
          <>
            <textarea
              className="file-viewer-editor"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onBlur={() => editable && content && handleSave()}
            />
            {editable && (
              <p style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                The agent will use this on the next message.
              </p>
            )}
          </>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
