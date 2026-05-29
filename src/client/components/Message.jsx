import { useState } from "react";
import ReactMarkdown from "react-markdown";

function getPathFromCommand(cmd) {
  if (!cmd || typeof cmd !== "string") return null;
  const c = cmd.trim();
  if (c.startsWith("cat ")) {
    const path = c.replace(/^cat\s+/, "").trim();
    return path.endsWith(".md") ? path : null;
  }
  if (c.startsWith("echo ") && (c.includes(" >> ") || c.includes(" > "))) {
    const part = c.includes(" >> ") ? c.split(" >> ").pop() : c.split(" > ").pop();
    const path = (part || "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
    return path.endsWith(".md") ? path : null;
  }
  if (c.startsWith("grep ")) {
    const rest = c.replace(/^grep\s+(-\w+\s+)*/, "").trim();
    const tokens = rest.split(/\s+/);
    const path = tokens[tokens.length - 1];
    return path && path.endsWith(".md") ? path : null;
  }
  return null;
}

function DeliverableBlock({ children, className, ...props }) {
  const [copied, setCopied] = useState(false);
  const text = Array.isArray(children) ? children.join("") : (typeof children === "string" ? children : String(children ?? ""));
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const lang = className ? className.replace("language-", "") : "";
  return (
    <div className="deliverable-container">
      <button
        type="button"
        className="deliverable-copy"
        onClick={handleCopy}
        title="Copy to clipboard"
        aria-label="Copy"
      >
        {copied ? (
          <span className="deliverable-copy-label">Copied!</span>
        ) : (
          <svg className="deliverable-copy-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
      {lang && <span className="deliverable-lang">{lang}</span>}
      <pre className={className}>
        <code {...props}>{children}</code>
      </pre>
    </div>
  );
}

function InlineCode({ children, ...props }) {
  return <code {...props}>{children}</code>;
}

export default function Message({ role, content, actions, error, onOpenFile }) {
  const markdownComponents = role === "assistant" ? {
    code: ({ node, className, children, ...props }) => {
      const isBlock = className != null;
      if (isBlock) return <DeliverableBlock className={className} {...props}>{children}</DeliverableBlock>;
      return <InlineCode {...props}>{children}</InlineCode>;
    },
  } : undefined;

  return (
    <div className={`message ${role} ${error ? "error-bubble" : ""}`}>
      {content && (
        <div className="message-body">
          {role === "assistant" ? (
            <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
          ) : (
            content
          )}
        </div>
      )}
      {actions && actions.length > 0 && (
        <div className="tool-calls-block">
          <div className="tool-calls-header">TOOL CALLS ({actions.length})</div>
          <ul className="tool-calls-list">
            {actions.map((a, i) => {
              const cmd = a.input?.command || a.preview || "";
              const path = getPathFromCommand(cmd);
              const isClickable = path && onOpenFile && (path.startsWith("workspace/") || path.startsWith(".bundl/"));
              const label = a.tool === "run_bash" ? (() => {
                if (cmd.startsWith("cat ")) return <>read {cmd.replace(/^cat\s+/, "")}</>;
                if (cmd.startsWith("echo ") && cmd.includes(" >> ")) return <>wrote {cmd.split(" >> ").pop()?.trim() || "file"}</>;
                if (cmd.startsWith("echo ") && cmd.includes(" > ")) return <>wrote {cmd.split(" > ").pop()?.trim() || "file"}</>;
                if (cmd.startsWith("grep ")) return <>searched {cmd.replace(/^grep\s+(-\w+\s+)*/, "").trim()}</>;
                return <>{cmd.slice(0, 60)}{cmd.length > 60 ? "…" : ""}</>;
              })() : <>{a.tool}</>;
              const content = (
                <>
                  {label}
                </>
              );
              return (
                <li key={i} className="tool-calls-item">
                  {isClickable ? (
                    <button type="button" className="tool-calls-item-btn" onClick={() => onOpenFile(path)} title={`Open ${path}`}>
                      {content}
                    </button>
                  ) : (
                    <span>{content}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
