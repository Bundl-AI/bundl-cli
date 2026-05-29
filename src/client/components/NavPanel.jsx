import { useState } from "react";

export default function NavPanel({ initData, view, activePath, setView, setActivePath, currentChatId, chatsList, onNewChat, onLoadChat, onInsertCommand }) {
  const [sectionsOpen, setSectionsOpen] = useState({ chat: true, company: true, skills: false, memory: false, artifacts: false, commands: true });
  const [artifactsExpanded, setArtifactsExpanded] = useState({});

  function toggleSection(key) {
    setSectionsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleArtifactDir(dir) {
    setArtifactsExpanded((prev) => ({ ...prev, [dir]: !prev[dir] }));
  }

  const companyFiles = initData?.companyFiles || [];
  const skills = initData?.skills || [];
  const commands = initData?.commands || [];
  const artifactDirs = initData?.artifactDirs || {};

  return (
    <>
      <div className="nav-section">
        <div className="nav-section-title" onClick={() => toggleSection("chat")}>
          <span className="nav-section-chevron">{sectionsOpen.chat ? "▼" : "▶"}</span>
          CHAT
        </div>
        {sectionsOpen.chat && (
          <>
            <div
              className={`nav-item ${view === "chat" && !currentChatId ? "nav-item-selected" : ""}`}
              onClick={onNewChat}
            >
              💬 New chat
            </div>
            {(chatsList || []).map((chat) => (
              <div
                key={chat.id}
                className={`nav-item nav-item-sub ${view === "chat" && currentChatId === chat.id ? "nav-item-selected" : ""}`}
                onClick={() => onLoadChat(chat.id)}
              >
                <span className="nav-chat-preview">{chat.preview || "Chat"}</span>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="nav-section">
        <div className="nav-section-title" onClick={() => toggleSection("company")}>
          <span className="nav-section-chevron">{sectionsOpen.company ? "▼" : "▶"}</span>
          COMPANY
        </div>
        {sectionsOpen.company &&
          companyFiles.map((f) => (
            <div
              key={f.path}
              className={`nav-item ${view === "file" && activePath === f.path ? "nav-item-selected" : ""}`}
              onClick={() => {
                setActivePath(f.path);
                setView("file");
              }}
            >
              <span className={`dot ${f.hasContent ? "green" : "grey"}`} />
              {f.name.replace(".md", "")}
            </div>
          ))}
      </div>

      <div className="nav-section">
        <div className="nav-section-title" onClick={() => toggleSection("skills")}>
          <span className="nav-section-chevron">{sectionsOpen.skills ? "▼" : "▶"}</span>
          SKILLS
        </div>
        {sectionsOpen.skills &&
          skills.map((s) => (
            <div
              key={s.location}
              className={`nav-item ${view === "file" && activePath === s.location ? "nav-item-selected" : ""}`}
              onClick={() => {
                setActivePath(s.location);
                setView("file");
              }}
            >
              {s.name}
            </div>
          ))}
      </div>

      <div className="nav-section">
        <div className="nav-section-title" onClick={() => toggleSection("memory")}>
          <span className="nav-section-chevron">{sectionsOpen.memory ? "▼" : "▶"}</span>
          MEMORY
        </div>
        {sectionsOpen.memory && (
          <>
            <div className={`nav-item ${view === "file" && activePath === "workspace/memory/longterm.md" ? "nav-item-selected" : ""}`} onClick={() => { setActivePath("workspace/memory/longterm.md"); setView("file"); }}>
              longterm.md
            </div>
            <div className={`nav-item ${view === "file" && activePath === "workspace/memory/session.md" ? "nav-item-selected" : ""}`} onClick={() => { setActivePath("workspace/memory/session.md"); setView("file"); }}>
              session.md
            </div>
          </>
        )}
      </div>

      <div className="nav-section">
        <div className="nav-section-title" onClick={() => toggleSection("artifacts")}>
          <span className="nav-section-chevron">{sectionsOpen.artifacts ? "▼" : "▶"}</span>
          ARTIFACTS
        </div>
        {sectionsOpen.artifacts &&
          Object.entries(artifactDirs).map(([dir, files]) => (
            <div key={dir}>
              <div className="nav-item" onClick={() => toggleArtifactDir(dir)}>
                {artifactsExpanded[dir] ? "▼" : "▶"} {dir}/
              </div>
              {artifactsExpanded[dir] &&
                files
                  .filter((f) => !f.isDirectory)
                  .map((f) => {
                    const artifactPath = "workspace/artifacts/" + dir + "/" + f.name;
                    return (
                      <div
                        key={f.name}
                        className={`nav-item nav-item-sub ${view === "file" && activePath === artifactPath ? "nav-item-selected" : ""}`}
                        onClick={() => {
                          setActivePath(artifactPath);
                          setView("file");
                        }}
                      >
                        {f.name}
                      </div>
                    );
                  })}
            </div>
          ))}
      </div>

      <div className="nav-section">
        <div className="nav-section-title" onClick={() => toggleSection("commands")}>
          <span className="nav-section-chevron">{sectionsOpen.commands ? "▼" : "▶"}</span>
          COMMANDS
        </div>
        {sectionsOpen.commands &&
          commands.map((cmd) => (
            <div
              key={cmd}
              className="nav-item"
              onClick={() => onInsertCommand(cmd)}
            >
              {cmd}
            </div>
          ))}
      </div>
    </>
  );
}
