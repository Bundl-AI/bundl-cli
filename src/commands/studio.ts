import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, statSync, chmodSync, unlinkSync, appendFileSync, watch } from "node:fs";
import path, { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { readConfig } from "../utils/config.js";
import { getCredentials } from "../utils/auth.js";
import { showBanner, getBannerText } from "../utils/banner.js";
import yaml from "js-yaml";

// Credentials live in user HOME only — never in project (repo-safe)
const CREDENTIALS_DIR = path.join(os.homedir(), ".bundl");
const CREDENTIALS_PATH = path.join(os.homedir(), ".bundl", "credentials.json");

/** True if workspace has been initialized (company.md + .bundl exist). */
function isWorkspaceInitialized(cwd: string): boolean {
  return existsSync(resolve(cwd, "company.md")) && existsSync(resolve(cwd, ".bundl"));
}

/** For debug only: never log the full key. Anthropic: "sk-ant-...****", OpenAI: "sk-...****" */
function maskApiKey(key: string | null): string {
  if (!key || typeof key !== "string") return "(no key)";
  const trimmed = key.trim();
  if (trimmed.length <= 10) return "****";
  return trimmed.slice(0, 10) + "****";
}

export type PreferredProvider = "anthropic" | "openai";

type StudioCredentials = {
  anthropic_api_key?: string;
  openai_api_key?: string;
  preferred_provider?: PreferredProvider;
};

function getStudioCredentials(): StudioCredentials {
  const envAnthropic = process.env.ANTHROPIC_API_KEY;
  const envOpenAI = process.env.OPENAI_API_KEY;
  let data: StudioCredentials = {};
  try {
    if (existsSync(CREDENTIALS_PATH)) {
      const raw = readFileSync(CREDENTIALS_PATH, "utf-8");
      data = JSON.parse(raw) as StudioCredentials;
    }
  } catch {
    // ignore
  }
  return {
    anthropic_api_key: typeof envAnthropic === "string" && envAnthropic.trim() ? envAnthropic.trim() : (typeof data.anthropic_api_key === "string" && data.anthropic_api_key.trim() ? data.anthropic_api_key.trim() : undefined),
    openai_api_key: typeof envOpenAI === "string" && envOpenAI.trim() ? envOpenAI.trim() : (typeof data.openai_api_key === "string" && data.openai_api_key.trim() ? data.openai_api_key.trim() : undefined),
    preferred_provider: data.preferred_provider === "openai" || data.preferred_provider === "anthropic" ? data.preferred_provider : undefined,
  };
}

function saveStudioCredentials(updates: Partial<StudioCredentials>): void {
  if (!existsSync(CREDENTIALS_DIR)) mkdirSync(CREDENTIALS_DIR, { recursive: true });
  const current = getStudioCredentials();
  const next: StudioCredentials = {
    anthropic_api_key: updates.anthropic_api_key !== undefined ? updates.anthropic_api_key.trim() : current.anthropic_api_key,
    openai_api_key: updates.openai_api_key !== undefined ? updates.openai_api_key.trim() : current.openai_api_key,
    preferred_provider: updates.preferred_provider !== undefined ? updates.preferred_provider : current.preferred_provider,
  };
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(next, null, 2));
  try {
    chmodSync(CREDENTIALS_PATH, 0o600);
  } catch {
    // chmod may fail on Windows
  }
}

/** Resolve provider: preferred_provider → else whichever key exists → else both → anthropic. Returns provider + key or null. */
function getProviderAndKey(preferredOverride?: PreferredProvider): { provider: PreferredProvider; apiKey: string } | null {
  const creds = getStudioCredentials();
  const hasAnthropic = !!creds.anthropic_api_key;
  const hasOpenAI = !!creds.openai_api_key;
  const preferred = preferredOverride ?? creds.preferred_provider;
  if (preferred === "openai" && hasOpenAI) return { provider: "openai", apiKey: creds.openai_api_key! };
  if (preferred === "anthropic" && hasAnthropic) return { provider: "anthropic", apiKey: creds.anthropic_api_key! };
  if (hasAnthropic && hasOpenAI) return { provider: "anthropic", apiKey: creds.anthropic_api_key! };
  if (hasAnthropic) return { provider: "anthropic", apiKey: creds.anthropic_api_key! };
  if (hasOpenAI) return { provider: "openai", apiKey: creds.openai_api_key! };
  return null;
}

function getAnthropicApiKey(): string | null {
  return getStudioCredentials().anthropic_api_key ?? null;
}

const PORT = 8787;
const HOST = "localhost";
const CORPUS_DIR = ".bundl/corpus";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** Workspace files live in project root (not under .bundl/). Old location for migration. */
const OLD_WORKSPACE_ROOT = ".bundl/workspace";

const CORPUS_PREFIX: Record<string, string> = { sdr: "sales-", pm: "product-" };

const AGENTS = [
  {
    id: "sdr",
    name: "Jordan",
    role: "AI SDR",
    description: "Outbound sequences, lead qualification, CRM logging",
    color: "#7c6aff",
    prefix: "sales-",
    files: ["leads.md", "memory/jordan.md", "drafts/pending/", "drafts/approved/"],
    tabs: ["Queue", "Drafts", "Sent", "Memory"],
    welcomeMessage:
      "Hi, I'm Jordan. I handle outbound prospecting and sequences. Add your leads to leads.md and I'll get to work. What would you like me to do?",
  },
  {
    id: "pm",
    name: "Alex",
    role: "AI PM",
    description: "PRDs, roadmap prioritization, backlog management",
    color: "#ff6a9e",
    prefix: "product-",
    files: ["backlog.md", "memory/alex.md", "drafts/pending/", "drafts/approved/"],
    tabs: ["Backlog", "In Draft", "Published", "Memory"],
    welcomeMessage:
      "Hi, I'm Alex. I manage your product backlog and write PRDs. Add items to backlog.md and I'll help prioritize. What are we working on?",
  },
] as const;

/** Path security: block traversal and sensitive paths. All paths relative to process.cwd(). */
function safePath(p: string): string {
  let clean = p.replace(/\.\./g, "").replace(/^\//, "").replace(/^~/, "").trim();
  const blocked = ["credentials", ".env", ".bundl/bundl.yaml"];
  if (blocked.some((b) => clean.includes(b))) throw new Error("Access denied");
  return clean;
}

function getWorkspacePaths(cwd: string, agentId: string): { leadsPath?: string; backlogPath?: string; memoryPath: string; draftsPending: string; draftsApproved: string } {
  const memoryPath = agentId === "sdr" ? resolve(cwd, "memory", "jordan.md") : resolve(cwd, "memory", "alex.md");
  return {
    leadsPath: agentId === "sdr" ? resolve(cwd, "leads.md") : undefined,
    backlogPath: agentId === "pm" ? resolve(cwd, "backlog.md") : undefined,
    memoryPath,
    draftsPending: resolve(cwd, "drafts", "pending"),
    draftsApproved: resolve(cwd, "drafts", "approved"),
  };
}

type SocketLike = NodeJS.ReadableStream & {
  write: (data: Buffer | string) => boolean;
  destroy?: () => void;
};

type WsClient = {
  send: (data: string) => void;
  socket: SocketLike;
};

function getDashboardHtml(workspaceName: string, skillCount: number, loggedIn: boolean, userEmail?: string | null, studioUrl?: string): string {
  const url = studioUrl || `http://${HOST}:${PORT}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bundl Studio</title>
  <link rel="icon" href="/favicon.ico" type="image/svg+xml">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #1A1A1A; color: #FFFFFF; min-height: 100vh; }
    .layout { min-height: 100vh; }
    .topbar { position: fixed; top: 0; left: 0; right: 0; height: 52px; z-index: 11; background: #212121; border-bottom: 1px solid #3A3A3A; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; }
    .topbar-left { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: #FFFFFF; }
    .topbar-badge { font-size: 10px; font-weight: 500; color: #B0B0B0; background: #2B2B2B; padding: 2px 6px; border-radius: 4px; }
    .topbar-center { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #B0B0B0; max-width: 50%; overflow: hidden; }
    .topbar-center .context { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .topbar-nav-toggle { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; margin-right: 4px; background: transparent; border: none; border-radius: 6px; color: #B0B0B0; cursor: pointer; }
    .topbar-nav-toggle:hover { background: #2B2B2B; color: #FFF; }
    .topbar-nav-toggle svg { width: 20px; height: 20px; transition: transform 0.2s; }
    .layout.sidebar-collapsed .sidebar { width: 0; min-width: 0; overflow: hidden; padding: 0; border-right-width: 0; }
    .layout.sidebar-collapsed .main { margin-left: 0; }
    .layout.sidebar-collapsed .bottom-bar { left: 0; }
    .sidebar-header .nav-icon { width: 14px; height: 14px; margin-right: 8px; flex-shrink: 0; }
    .sidebar-header .nav-icon.nav-icon-fill { width: 12px; height: 12px; }
    .sidebar-header .nav-icon svg { display: block; width: 100%; height: 100%; }
    .sidebar-header .nav-icon path { stroke: currentColor; fill: none; }
    .sidebar-header .nav-icon.nav-icon-fill path { fill: currentColor; stroke: none; }
    .sidebar-header .nav-icon circle { stroke: currentColor; }
    .sidebar-header .nav-icon-spacer { width: 12px; flex-shrink: 0; }
    .sidebar-header .nav-icon.nav-icon-handoff { width: 14px; height: 14px; }
    .sidebar-header .nav-icon.nav-icon-workspace { width: 14px; height: 14px; }
    .topbar-skill-toggle { display: none; align-items: center; gap: 4px; margin-left: 12px; }
    .topbar-skill-toggle.visible { display: flex; }
    .topbar-skill-toggle button { background: transparent; border: 1px solid #404040; color: #B0B0B0; padding: 4px 10px; font-size: 12px; border-radius: 4px; cursor: pointer; }
    .topbar-skill-toggle button:hover { background: #2B2B2B; color: #FFF; }
    .topbar-skill-toggle button.active { background: #2B2B2B; color: #FFF; border-color: #505050; }
    .topbar-agent-toggle { display: none; align-items: center; gap: 4px; margin-left: 12px; }
    .topbar-agent-toggle.visible { display: flex; }
    .topbar-agent-toggle button { background: transparent; border: 1px solid #404040; color: #B0B0B0; padding: 4px 10px; font-size: 12px; border-radius: 4px; cursor: pointer; }
    .topbar-agent-toggle button:hover { background: #2B2B2B; color: #FFF; }
    .topbar-agent-toggle button.active { background: #2B2B2B; color: #FFF; border-color: #505050; }
    .topbar-actions { display: flex; align-items: center; gap: 8px; }
    .topbar-btn { background: #2B2B2B; border: none; border-radius: 4px; color: #FFFFFF; padding: 6px 12px; font-size: 12px; cursor: pointer; }
    .topbar-btn:hover:not(:disabled) { background: #2E2E33; }
    .topbar-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .topbar-user { font-size: 12px; color: #B0B0B0; padding: 6px 10px; border-radius: 4px; background: #2B2B2B; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .topbar-login { font-size: 12px; color: #FFFFFF; padding: 6px 12px; border-radius: 4px; background: #3b82f6; border: none; cursor: pointer; }
    .topbar-login:hover { background: #2563eb; }
    .body-wrap { margin-top: 52px; display: flex; min-height: calc(100vh - 52px); }
    .sidebar { position: fixed; top: 52px; left: 0; bottom: 0; width: 220px; z-index: 10; background: #212121; border-right: 1px solid #3A3A3A; padding: 12px 0; display: flex; flex-direction: column; overflow-y: auto; }
    .sidebar-section { margin-bottom: 4px; }
    .sidebar-header { display: flex; align-items: center; padding: 6px 12px; cursor: pointer; color: #B0B0B0; font-size: 13px; user-select: none; border-left: 3px solid transparent; }
    .sidebar-header:hover { background: #2B2B2B; color: #FFFFFF; }
    .sidebar-header .chevron { margin-right: 6px; width: 12px; height: 12px; flex-shrink: 0; transition: transform 0.15s; }
    .sidebar-header .chevron svg { display: block; }
    .sidebar-header .chevron path { stroke: currentColor; }
    .sidebar-section .chevron { transform: rotate(-90deg); }
    .sidebar-section.collapsed .chevron { transform: rotate(0deg); }
    .sidebar-section.collapsed .sidebar-items { display: none; }
    .sidebar-agent-block { margin-bottom: 2px; }
    .sidebar-agent-block .sidebar-item.agent-item { display: flex; align-items: center; gap: 10px; cursor: pointer; padding-left: 12px; }
    .sidebar-agent-block .agent-chevron { width: 12px; height: 12px; flex-shrink: 0; transition: transform 0.15s; }
    .sidebar-agent-block .agent-chevron path { stroke: currentColor; }
    .sidebar-agent-block .agent-chevron { transform: rotate(0deg); }
    .sidebar-agent-block:has(.sidebar-agent-files.expanded) .agent-chevron { transform: rotate(-90deg); }
    .sidebar-file.tree-nested { padding-left: 20px; font-size: 12px; color: #B0B0B0; }
    .sidebar-badge { font-size: 11px; background: #3A3A3A; padding: 1px 6px; border-radius: 10px; margin-left: 4px; }
    .sidebar-handoff-badge { font-size: 11px; background: #ea580c; color: #fff; padding: 1px 6px; border-radius: 10px; margin-left: 4px; }
    .sidebar-header.selected { background: #2B2B2B; color: #FFFFFF; border-left-color: #FFFFFF; padding-left: 9px; }
    .sidebar-item { display: flex; align-items: center; padding: 8px 12px 8px 28px; cursor: pointer; color: #B0B0B0; font-size: 13px; border-left: 3px solid transparent; }
    .sidebar-item:hover { background: #2B2B2B; color: #FFFFFF; }
    .sidebar-item.selected { background: #2B2B2B; color: #FFFFFF; border-left-color: #FFFFFF; }
    .sidebar-item .dot { width: 6px; height: 6px; border-radius: 50%; margin-right: 8px; flex-shrink: 0; }
    .sidebar-item .dot.working { background: #3b82f6; }
    .sidebar-item .dot.completed { background: #22c55e; }
    .sidebar-item .dot.none { background: transparent; }
    .sidebar-item .dot.active { background: #22c55e; }
    .sidebar-item .dot.idle { background: #666; }
    .sidebar-item.agent-item .dot.active { background: #22c55e; }
    .sidebar-item .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sidebar-item .meta { font-size: 11px; color: #666; margin-top: 2px; }
    .sidebar-item.disabled { opacity: 0.5; cursor: default; color: #666; }
    .sidebar-item.disabled:hover { background: transparent; color: #666; }
    .sidebar-agent-files { display: none; padding-left: 12px; margin-bottom: 4px; }
    .sidebar-agent-files.expanded { display: block; }
    .sidebar-agent-files .sidebar-file { padding: 4px 12px 4px 24px; font-size: 12px; color: #B0B0B0; cursor: pointer; }
    .sidebar-agent-files .sidebar-file:hover { color: #FFF; background: #2B2B2B; }
    #sidebar-workspace .sidebar-file { padding: 6px 12px 6px 28px; font-size: 13px; color: #B0B0B0; cursor: pointer; }
    #sidebar-workspace .sidebar-file:hover { color: #FFF; background: #2B2B2B; }
    .agent-view { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 0; }
    .agent-header { padding: 20px 24px; border-bottom: 1px solid #3A3A3A; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    .agent-header-left { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
    .agent-header .agent-name { font-size: 22px; font-weight: 700; color: #FFF; margin: 0; }
    .agent-header .agent-role { font-size: 14px; color: #B0B0B0; }
    .agent-header .agent-status { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #B0B0B0; }
    .agent-header .agent-status .dot { width: 8px; height: 8px; border-radius: 50%; }
    .agent-provider-pill { font-size: 11px; color: #666; background: #2C2C2C; padding: 2px 8px; border-radius: 6px; margin-left: 8px; }
    .agent-header-stats { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-left: auto; }
    .agent-header-stats .stat-pill { font-size: 12px; color: #B0B0B0; background: #2C2C2C; padding: 4px 10px; border-radius: 6px; }
    .agent-view-content { flex: 1; overflow: auto; padding: 0 24px 24px; }
    .agent-pending-cards { margin: 16px 0; }
    .agent-pending-card { background: #2C2C2C; border: 1px solid #3A3A3A; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
    .agent-pending-card .card-label { font-size: 13px; color: #e8e8f0; }
    .agent-pending-card .card-meta { font-size: 11px; color: #888; }
    .agent-pipeline-table-wrap { background: #282828; border: 1px solid #3A3A3A; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.15); margin-top: 16px; }
    .agent-pipeline-table-wrap table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .agent-pipeline-table-wrap th, .agent-pipeline-table-wrap td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #3A3A3A; }
    .agent-pipeline-table-wrap th { background: #252528; color: #B0B0B0; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; }
    .agent-pipeline-table-wrap tbody tr:hover td { background: #2A2A2E; }
    .agent-pipeline-table-wrap tr.expanded-row + tr.detail-row td { background: #252528; padding: 14px 16px; border-bottom: 1px solid #3A3A3A; }
    .priority-pill.priority-high { background: #4a3a1a; color: #fbbf24; }
    .priority-pill.priority-medium { background: #2a2a2a; color: #B0B0B0; }
    .effort-pill { background: #1e3a2a; color: #86efac; }
    .agent-add-form-wrap { margin-top: 16px; padding-top: 16px; border-top: 1px solid #3A3A3A; }
    .agent-chat { flex: 1; overflow: auto; padding: 20px 24px 120px 24px; display: flex; flex-direction: column; gap: 16px; max-width: 720px; width: 100%; }
    .agent-chat-banner { font-family: ui-monospace, \"SF Mono\", monospace; font-size: 13px; line-height: 1.4; color: #B0B0B0; white-space: pre-wrap; margin-bottom: 16px; }
    .agent-chat-banner-line { white-space: pre-wrap; word-break: break-all; }
    .agent-msg { display: flex; gap: 12px; align-items: flex-start; }
    .agent-msg.user { flex-direction: row-reverse; }
    .agent-msg .msg-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 6px; }
    .agent-msg .msg-bubble { max-width: 80%; padding: 12px 16px; border-radius: 10px; font-size: 14px; line-height: 1.5; }
    .agent-msg.agent .msg-bubble { background: #2C2C2C; color: #FFF; }
    .agent-msg.user .msg-bubble { background: #3A3A3A; color: #FFF; }
    .agent-msg .msg-name { font-size: 11px; color: #888; margin-bottom: 4px; }
    .agent-typing { display: flex; gap: 12px; align-items: flex-start; padding: 12px 0; }
    .agent-typing .msg-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 6px; }
    .agent-typing .typing-text { color: #888; font-size: 14px; }
    .agent-typing .typing-dots { display: inline-block; min-width: 1.2em; animation: typing-opacity 1s ease-in-out infinite; }
    @keyframes typing-opacity { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
    .api-key-setup { background: #2C2C2C; border-radius: 8px; padding: 16px; margin-top: 12px; }
    .api-key-setup p { margin: 0 0 12px; font-size: 13px; color: #B0B0B0; line-height: 1.5; }
    .api-key-setup input { width: 100%; max-width: 400px; padding: 8px 12px; background: #1A1A1A; border: 1px solid #404040; border-radius: 6px; color: #FFF; font-size: 13px; margin-right: 8px; }
    .api-key-setup .key-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
    .api-key-setup .api-key-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
    .api-key-setup .api-key-tab { padding: 6px 12px; font-size: 12px; background: #1A1A1A; border: 1px solid #404040; color: #B0B0B0; border-radius: 6px; cursor: pointer; }
    .api-key-setup .api-key-tab:hover { color: #FFF; border-color: #505050; }
    .api-key-setup .api-key-tab.active { background: #2B2B2B; color: #FFF; border-color: #505050; }
    .api-key-setup .api-key-note { font-size: 12px; color: #666; margin: 8px 0 0; }
    .api-key-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100; display: none; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(4px); }
    .api-key-modal.visible { display: flex; }
    .api-key-modal-content { background: #252528; border: 1px solid #404040; border-radius: 16px; padding: 28px; max-width: 440px; width: 100%; box-shadow: 0 24px 48px rgba(0,0,0,0.5); }
    .api-key-modal-content h3 { margin: 0 0 20px; font-size: 18px; font-weight: 600; color: #e8e8f0; }
    .api-key-modal-content .api-key-setup { background: transparent; padding: 0; margin: 0; }
    .api-key-modal-content .api-key-tabs { display: flex; gap: 6px; margin-bottom: 16px; }
    .api-key-modal-content .api-key-tab { padding: 8px 16px; font-size: 13px; background: #2C2C2C; border: 1px solid #404040; color: #B0B0B0; border-radius: 8px; cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s; }
    .api-key-modal-content .api-key-tab:hover { color: #FFF; border-color: #505050; background: #333; }
    .api-key-modal-content .api-key-tab.active { background: #3A3A3E; color: #FFF; border-color: #FFF; }
    .api-key-modal-content .key-row { display: flex; gap: 12px; margin-bottom: 16px; align-items: center; }
    .api-key-modal-content .key-row input { flex: 1; min-width: 0; padding: 12px 14px; background: #1A1A1A; border: 1px solid #404040; border-radius: 8px; color: #FFF; font-size: 14px; }
    .api-key-modal-content .key-row input:focus { outline: none; border-color: #FFF; box-shadow: 0 0 0 2px rgba(255,255,255,0.2); }
    .api-key-modal-content .key-row input::placeholder { color: #666; }
    .api-key-modal-content .api-key-save-btn { padding: 12px 24px; background: #FFF; color: #1A1A1A; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; flex-shrink: 0; transition: background 0.15s, filter 0.15s; }
    .api-key-modal-content .api-key-save-btn:hover { background: #e8e8e8; filter: brightness(1.02); }
    .api-key-modal-content .api-key-note { font-size: 12px; color: #888; margin: 0; line-height: 1.5; }
    .agent-approval { padding: 16px 24px; border-top: 1px solid #3A3A3A; }
    .agent-approval .approval-divider { font-size: 12px; color: #666; text-align: center; margin-bottom: 12px; }
    .agent-approval .approval-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; font-size: 13px; }
    .agent-approval .approval-actions { display: flex; gap: 8px; }
    .agent-approval .approval-list { margin: 8px 0; }
    #file-data-table.flash-green { animation: flashGreen 800ms ease; }
    #file-data-table.flash-red { animation: flashRed 800ms ease; box-shadow: 0 0 0 2px #b91c1c; }
    @keyframes flashGreen { 0% { box-shadow: 0 0 0 2px #22c55e; } 100% { box-shadow: none; } }
    @keyframes flashRed { 0% { box-shadow: 0 0 0 2px #b91c1c; } }
    .agent-approval .approval-all { margin-top: 12px; text-align: right; }
    .file-view { padding: 24px; overflow: auto; }
    .file-view .file-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; font-size: 13px; color: #B0B0B0; }
    .file-view .table-wrap { background: #282828; border: 1px solid #3A3A3A; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.15); }
    .file-view table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .file-view th, .file-view td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #3A3A3A; }
    .file-view th { background: #252528; color: #B0B0B0; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; }
    .file-view tr:not(:last-child) td { border-bottom: 1px solid #3A3A3A; }
    .file-view tbody tr:hover td { background: #2A2A2E; }
    .file-view td[contenteditable="true"] { background: #252528; color: #e8e8f0; transition: background 0.15s, border-color 0.15s, box-shadow 0.15s; }
    .file-view td[contenteditable="true"]:hover { background: #2A2A2E; }
    .file-view td[contenteditable="true"]:focus { outline: none; background: #2C2C2C; border-color: #505050; box-shadow: 0 0 0 1px #505050; }
    .file-view .status-pill { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 12px; }
    .file-view .status-pill.not-contacted { background: #666; }
    .file-view .status-pill.contacted { background: #b59a00; color: #000; }
    .file-view .status-pill.replied { background: #22c55e; }
    .file-view .status-pill.qualified { background: var(--agent-color, #7c6aff); }
    .file-view .status-pill.disqualified { background: #dc2626; }
    .file-view .status-pill.not-started { background: #666; }
    .sidebar-extension-card { display: flex; align-items: center; gap: 12px; margin: 12px; padding: 12px 14px; background: #2C2C2C; border-radius: 8px; border: 1px solid #3A3A3A; text-decoration: none; color: inherit; margin-top: auto; }
    .sidebar-extension-card:hover { background: #333; }
    .sidebar-extension-icon { width: 36px; height: 36px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #B0B0B0; }
    .sidebar-extension-icon svg { width: 28px; height: 28px; }
    .sidebar-extension-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .sidebar-extension-text strong { font-size: 13px; color: #FFF; }
    .sidebar-extension-text span { font-size: 12px; color: #B0B0B0; }
    .onboarding-wrap { flex: 1; display: flex; flex-direction: row; min-height: 0; background: #0D0D0D; }
    .onboarding-left { flex: 0 0 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 56px; border-right: 1px solid #252525; }
    .onboarding-right { flex: 0 0 50%; overflow-y: auto; padding: 48px 56px; display: flex; flex-direction: column; justify-content: center; background: #0D0D0D; }
    .onboarding-panel { width: 100%; max-width: 440px; }
    .onboarding-title { font-size: 22px; font-weight: 700; margin: 0 0 8px; color: #FFF; }
    .onboarding-sub { font-size: 13px; color: #888; margin: 0 0 24px; }
    .onboarding-why-title { font-size: 18px; font-weight: 700; color: #FFF; margin: 0 0 32px; }
    .onboarding-why-block { margin-bottom: 28px; }
    .onboarding-why-block h3 { font-size: 15px; font-weight: 600; color: #FFF; margin: 0 0 8px; }
    .onboarding-why-block p { font-size: 14px; color: #B0B0B0; line-height: 1.5; margin: 0; }
    .onboarding-step-title { font-size: 16px; font-weight: 600; color: #e8e8f0; margin: 0 0 16px; }
    .onboarding-field { margin-bottom: 16px; }
    .onboarding-field label { display: block; font-size: 12px; color: #B0B0B0; margin-bottom: 6px; }
    .onboarding-field input[type="text"], .onboarding-field textarea { width: 100%; padding: 10px 12px; background: #1A1A1A; border: 1px solid #404040; border-radius: 8px; color: #FFF; font-size: 14px; }
    .onboarding-radio, .onboarding-checkboxes { display: flex; flex-wrap: wrap; gap: 12px; }
    .onboarding-radio label, .onboarding-checkboxes label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #e8e8f0; cursor: pointer; }
    .onboarding-btn { margin-top: 8px; padding: 12px 24px; background: #FFF; color: #1A1A1A; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .onboarding-btn.secondary { background: #2C2C2C; color: #B0B0B0; margin-right: 12px; }
    .onboarding-btn:hover { opacity: 0.95; }
    .onboarding-hint { font-size: 13px; color: #888; margin: 0 0 16px; }
    .onboarding-cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 16px; }
    .onboarding-card { background: #2C2C2C; border: 1px solid #3A3A3A; border-radius: 12px; padding: 20px; }
    .onboarding-card-emoji { font-size: 28px; margin-bottom: 8px; }
    .onboarding-card-name { font-size: 16px; font-weight: 600; color: #FFF; }
    .onboarding-card-role { font-size: 12px; color: #888; margin-bottom: 8px; }
    .onboarding-card-desc { font-size: 13px; color: #B0B0B0; margin-bottom: 12px; line-height: 1.4; }
    .onboarding-card-btn { padding: 8px 16px; background: #FFF; color: #1A1A1A; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; }
    .onboarding-card.hired { opacity: 0.6; border-color: #22c55e; }
    .onboarding-card.hired .onboarding-card-btn { display: none; }
    .onboarding-hired-list { font-size: 13px; color: #22c55e; margin-bottom: 16px; }
    .onboarding-step-3-actions { display: flex; align-items: center; margin-top: 16px; }
    .onboarding-api-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
    .onboarding-tab { padding: 8px 16px; background: #2C2C2C; border: 1px solid #404040; color: #B0B0B0; border-radius: 8px; font-size: 13px; cursor: pointer; }
    .onboarding-tab.active { background: #3A3A3E; color: #FFF; border-color: #505050; }
    .main { margin-left: 220px; flex: 1; display: flex; flex-direction: column; min-width: 0; background: #1A1A1A; overflow: hidden; min-height: calc(100vh - 52px); }
    .main.has-chat-active { padding-bottom: 100px; }
    .main-content { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; padding: 20px; }
    .view { display: none; flex: 1; flex-direction: column; min-height: 0; overflow: hidden; }
    .view.active { display: flex; }
    .view:not(.active) { display: none !important; }
    #view-terminal { align-items: center; }
    .terminal-log { flex: 1; min-height: 120px; overflow: auto; font-family: ui-monospace, "SF Mono", monospace; font-size: 13px; line-height: 1.5; padding: 0 0 120px 0; max-width: 720px; width: 100%; }
    #agent-chat-view { display: flex; flex-direction: column; align-items: center; }
    .terminal-log .line { white-space: pre-wrap; word-break: break-all; }
    .terminal-log .line.stdout { color: #FFFFFF; }
    .terminal-log .line.stderr { color: #e08080; }
    .terminal-log .line.system { color: #B0B0B0; }
    .terminal-log .block { margin-bottom: 12px; }
    .terminal-log .block .ts { font-size: 11px; color: #666; margin-bottom: 2px; }
    .skill-detail-view { display: flex; flex: 1; flex-direction: column; min-height: 0; padding: 0; max-width: none; }
    .skill-dashboard { display: flex; flex: 1; min-height: 0; overflow: hidden; }
    .skill-dashboard-left { width: 28%; min-width: 260px; flex-shrink: 0; border-right: 1px solid #3A3A3A; padding: 24px; overflow: auto; background: #1A1A1A; }
    .skill-dashboard-right { flex: 1; padding: 24px; overflow: auto; background: #1A1A1A; }
    .skill-quickstart-title { font-size: 18px; font-weight: 700; color: #FFF; margin: 0 0 4px; }
    .skill-quickstart-sub { font-size: 13px; color: #B0B0B0; margin-bottom: 20px; }
    .skill-quickstart-field { margin-bottom: 16px; }
    .skill-quickstart-field label { display: block; font-size: 12px; font-weight: 500; color: #B0B0B0; margin-bottom: 6px; }
    .skill-quickstart-field input, .skill-quickstart-field textarea { width: 100%; background: #2C2C2C; border: 1px solid #404040; border-radius: 6px; padding: 10px 12px; color: #FFF; font-size: 14px; }
    .skill-quickstart-field textarea { min-height: 80px; resize: vertical; }
    .skill-dashboard-right .detail-tags { margin-bottom: 12px; }
    .skill-dashboard-right .detail-tags .tag { display: inline-block; padding: 4px 8px; border-radius: 9999px; background: #666; color: #FFF; font-size: 12px; margin-right: 8px; }
    .skill-dashboard-right .detail-title { font-size: 22px; font-weight: 700; color: #FFF; margin: 0 0 12px; }
    .skill-dashboard-right .detail-desc { font-size: 14px; color: #B0B0B0; line-height: 1.5; margin-bottom: 24px; }
    .skill-dashboard-right .detail-system-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #B0B0B0; font-weight: 600; margin-bottom: 10px; }
    .skill-dashboard-right .detail-system-value { font-size: 14px; line-height: 1.6; color: #E0E0E0; white-space: pre-wrap; }
    .skill-agent-view { padding: 24px; overflow: auto; }
    .skill-agent-view .agent-format-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #666; margin-bottom: 20px; font-weight: 600; }
    .skill-agent-view .agent-section { margin-bottom: 24px; }
    .skill-agent-view .agent-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #B0B0B0; margin-bottom: 8px; font-weight: 600; }
    .skill-agent-view .agent-value { font-family: ui-monospace, monospace; font-size: 13px; color: #E0E0E0; white-space: pre-wrap; background: #2C2C2C; padding: 16px; border-radius: 8px; }
    .skill-agent-view .agent-skill-markdown { line-height: 1.6; white-space: pre-wrap; }
    .card.stub { background: #2C2C2C; border-radius: 8px; padding: 24px; }
    .card.stub .meta { color: #999; }
    .card.stub button { background: #333; color: #999; cursor: not-allowed; border: none; border-radius: 4px; padding: 10px 16px; font-size: 14px; }
    .bottom-bar { display: none; position: fixed; bottom: 0; left: 220px; right: 0; z-index: 9; padding: 20px 24px 24px; background: transparent; }
    .bottom-bar.visible { display: flex; flex-direction: column; justify-content: flex-end; }
    .bottom-bar-inner { max-width: 720px; margin: 0 auto; width: 100%; }
    .chat-input-card { background: #282828; border: 1px solid #3A3A3A; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.25); overflow: hidden; display: flex; flex-direction: column; }
    .chat-input-card .chat-input-textarea-wrap { padding: 14px 16px 10px; }
    .chat-input-card textarea { width: 100%; min-height: 72px; max-height: 200px; background: transparent; border: none; color: #e8e8f0; font-family: inherit; font-size: 15px; line-height: 1.5; resize: none; display: block; }
    .chat-input-card textarea::placeholder { color: #888; }
    .chat-input-card textarea:focus { outline: none; }
    .chat-input-footer { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px 10px 16px; border-top: 1px solid #3A3A3A; min-height: 44px; }
    .chat-input-footer-left { display: flex; align-items: center; gap: 12px; font-size: 12px; color: #888; }
    .chat-input-footer-left .agent-provider-select { background: transparent; border: none; color: #B0B0B0; padding: 4px 20px 4px 0; font-size: 12px; cursor: pointer; }
    .chat-input-footer-left .agent-provider-select:hover { color: #e8e8f0; }
    .send-btn { width: 44px; height: 44px; flex-shrink: 0; border-radius: 12px; background: #FFFFFF; color: #1A1A1A; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: filter 0.15s; }
    .send-btn:hover:not(:disabled) { background: #e5e5e5; }
    .bottom-bar.agent-mode .send-btn { background: #FFFFFF; color: #1A1A1A; }
    .bottom-bar.agent-mode .send-btn:hover:not(:disabled) { background: #e5e5e5; }
    .agent-provider-row { display: flex; align-items: center; gap: 6px; margin: 0; }
    .agent-provider-label { font-size: 12px; color: #888; }
    .agent-provider-select.standalone { background: #2B2B2B; border: 1px solid #404040; color: #FFF; padding: 6px 10px; border-radius: 6px; font-size: 13px; }
    .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .send-btn svg { width: 20px; height: 20px; }
  </style>
</head>
<body>
  <div class="layout">
    <header class="topbar">
      <div class="topbar-left"><button type="button" class="topbar-nav-toggle" id="topbar-nav-toggle" title="Toggle sidebar"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 54" fill="none" class="topbar-nav-toggle-icon"><path d="M53 0H11C8.08262 0 5.28472 1.15892 3.22182 3.22182C1.15892 5.28472 0 8.08262 0 11V43C0 45.9174 1.15892 48.7153 3.22182 50.7782C5.28472 52.8411 8.08262 54 11 54H53C55.9174 54 58.7153 52.8411 60.7782 50.7782C62.8411 48.7153 64 45.9174 64 43V11C64 8.08262 62.8411 5.28472 60.7782 3.22182C58.7153 1.15892 55.9174 0 53 0ZM36 46H11C10.2044 46 9.44129 45.6839 8.87868 45.1213C8.31607 44.5587 8 43.7956 8 43V11C8 10.2044 8.31607 9.44129 8.87868 8.87868C9.44129 8.31607 10.2044 8 11 8H36V46ZM56 43C56 43.7956 55.6839 44.5587 55.1213 45.1213C54.5587 45.6839 53.7956 46 53 46H44V8H53C53.7956 8 54.5587 8.31607 55.1213 8.87868C55.6839 9.44129 56 10.2044 56 11V43Z" fill="currentColor"/></svg></button>Bundl Studio <span class="topbar-badge">ALPHA</span></div>
      <div class="topbar-center"><span class="context" id="topbar-context">Terminal</span><div class="topbar-skill-toggle" id="topbar-skill-toggle"><button type="button" data-mode="human">Human</button><button type="button" data-mode="agent" class="active">Agent</button></div></div>
      <div class="topbar-actions">
        <button type="button" class="topbar-btn" data-cmd="bundl validate">Validate</button>
        <button type="button" class="topbar-btn" data-cmd="bundl push" ${loggedIn ? '' : ' disabled'}>Push</button>
        <button type="button" class="topbar-btn" data-cmd="bundl pull" ${loggedIn ? '' : ' disabled'}>Pull</button>
        ${loggedIn ? '<span class="topbar-user" title="' + escapeHtml(userEmail || '') + '">' + escapeHtml(userEmail || 'Logged in') + '</span>' : '<button type="button" class="topbar-login" data-cmd="bundl login">Login</button>'}
      </div>
    </header>
    <div class="body-wrap" style="display:flex;flex:1;min-height:0;flex-direction:column;width:100%">
      <aside class="sidebar">
        <div class="sidebar-section" data-section="chat">
          <div class="sidebar-header selected" data-view="chat">&gt;_ Terminal</div>
        </div>
        <div class="sidebar-section collapsed" data-section="skills">
          <div class="sidebar-header"><span class="chevron"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><path d="M9 6L15 12L9 18" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="nav-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><g clip-path="url(#clip_skills)"><circle cx="17" cy="7" r="3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="17" r="3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 14H20V19C20 19.5523 19.5523 20 19 20H15C14.4477 20 14 19.5523 14 19V14Z" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 4H10V9C10 9.55228 9.55228 10 9 10H5C4.44772 10 4 9.55228 4 9V4Z" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></g><defs><clipPath id="clip_skills"><rect width="24" height="24" fill="white"/></clipPath></defs></svg></span> Skills</div>
          <div class="sidebar-items" id="sidebar-skills"></div>
        </div>
        <a href="https://chromewebstore.google.com/detail/pbogmoeacaibapdfekldkkiklbhggokn?utm_source=item-share-cli" target="_blank" rel="noopener noreferrer" class="sidebar-extension-card">
          <span class="sidebar-extension-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.42676 6.61041L7.4015 10.0336C8.16529 8.24978 9.9367 7 12 7C12.0001 7 12.0002 7 12.0002 7C12.0009 7 12.0015 7 12.0022 7L18.876 7.00164C17.3298 4.87831 14.8252 3.5 12 3.5C9.35222 3.5 6.98693 4.70986 5.42676 6.61041ZM19.9565 9.00189L16.0011 9.00095C16.6283 9.83645 17 10.8748 17 12C17 12.9096 16.7562 13.7653 16.3297 14.502C16.3295 14.5024 16.3293 14.5027 16.3291 14.5031L12.8969 20.4532C17.1697 20.0051 20.5 16.3915 20.5 12C20.5 10.9432 20.3076 9.93325 19.9565 9.00189ZM10.6248 20.3895L12.6006 16.9643C12.4037 16.9879 12.2033 17 12 17C10.1489 17 8.53409 15.9936 7.67077 14.5029C7.66808 14.4982 7.66539 14.4936 7.66272 14.4889L4.23238 8.54246C3.76163 9.59828 3.5 10.7679 3.5 12C3.5 16.2261 6.58477 19.7326 10.6248 20.3895ZM9.40185 13.5012C9.92235 14.3994 10.8916 15 12 15C13.1086 15 14.078 14.3992 14.5984 13.5007C14.8536 13.0601 15 12.5487 15 12C15 10.3437 13.6577 9.00089 12.0016 9C12.0011 9 12.0005 9 12 9C11.9999 9 11.9998 9 11.9998 9C10.343 9.00013 9 10.3432 9 12C9 12.5447 9.14427 13.0527 9.39603 13.4911C9.39784 13.4943 9.39966 13.4974 9.40148 13.5006C9.4016 13.5008 9.40173 13.501 9.40185 13.5012ZM3.41111 5.95867C5.3098 3.26381 8.44887 1.5 12 1.5C16.222 1.5 19.8599 3.99185 21.5272 7.58073C22.1518 8.92522 22.5 10.4233 22.5 12C22.5 17.799 17.799 22.5 12 22.5C11.6877 22.5 11.3784 22.4863 11.0725 22.4595C5.70745 21.9894 1.5 17.4866 1.5 12C1.5 9.75262 2.20719 7.66743 3.41111 5.95867Z" fill="currentColor"></path></svg></span>
          <div class="sidebar-extension-text"><strong>Get the extension</strong><span>Use Bundl from any tab in Chrome</span></div>
        </a>
      </aside>
      <main class="main has-chat-active">
        <div class="main-content">
          <div id="view-terminal" class="view active">
            <div id="terminal-output" class="terminal-log"></div>
          </div>
          <div id="view-skill-detail" class="view skill-detail-view">
            <div id="skill-detail-placeholder" style="color:#999;padding:24px 0;">Select a skill from the sidebar.</div>
            <div id="skill-detail-wrap" style="display:none;">
              <div id="skill-human-view" class="skill-dashboard" style="display:none;"></div>
              <div id="skill-agent-view" class="skill-agent-view" style="display:none;"></div>
            </div>
          </div>
        </div>
        <div class="bottom-bar visible" id="bottom-bar">
          <div class="bottom-bar-inner">
            <div class="chat-input-card">
              <div class="chat-input-textarea-wrap">
                <textarea id="terminal-input" placeholder="Run a command, or ask anything..." rows="1"></textarea>
              </div>
              <div class="chat-input-footer">
                <div class="chat-input-footer-left">
                  <div id="agent-provider-row" class="agent-provider-row" style="display:none;">
                    <label class="agent-provider-label">Model</label>
                    <select id="agent-provider-select" class="agent-provider-select">
                      <option value="anthropic">Claude (Anthropic)</option>
                      <option value="openai">GPT-4o (OpenAI)</option>
                    </select>
                  </div>
                </div>
                <button type="button" class="send-btn" id="terminal-send" title="Send">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
      </div>
    </div>
    <div id="api-key-modal" class="api-key-modal" aria-hidden="true">
      <div class="api-key-modal-content" id="api-key-modal-content">
        <h3 id="api-key-modal-title">Add API key</h3>
        <div class="api-key-setup" id="agent-api-key-setup-modal">
          <div class="api-key-tabs"><button type="button" class="api-key-tab active" data-provider="anthropic">Anthropic</button><button type="button" class="api-key-tab" data-provider="openai">OpenAI</button></div>
          <div class="key-row"><input type="password" id="agent-api-key-input-modal" placeholder="Paste your API key" autocomplete="off"><button type="button" class="api-key-save-btn" id="agent-api-key-save-modal">Save key</button></div>
          <p class="api-key-note">Your key is stored locally in ~/.bundl/ and never uploaded anywhere.</p>
        </div>
      </div>
    </div>
  </div>
  <script>
    var terminalOutput = document.getElementById('terminal-output');
    var terminalInput = document.getElementById('terminal-input');
    var terminalSend = document.getElementById('terminal-send');
    var topbarContext = document.getElementById('topbar-context');
    var sidebarSkills = document.getElementById('sidebar-skills');
    var skillDetailWrap = document.getElementById('skill-detail-wrap');
    var skillDetailPlaceholder = document.getElementById('skill-detail-placeholder');

    var ws = null, reconnectTimer = null, skills = [], currentView = 'chat', selectedSkillId = null, currentSkill = null, skillViewMode = 'agent';
    var skillHumanView = document.getElementById('skill-human-view');
    var skillAgentView = document.getElementById('skill-agent-view');
    var topbarSkillToggle = document.getElementById('topbar-skill-toggle');

    function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function showToast(text) {
      var toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;bottom:100px;right:24px;background:#2C2C2C;border:1px solid #3A3A3A;padding:12px 16px;border-radius:8px;font-size:13px;z-index:20;';
      toast.textContent = text;
      document.body.appendChild(toast);
      setTimeout(function() { toast.remove(); }, 3500);
    }
    function setApiKeyInputPlaceholder(provider) {
      var inputEl = document.getElementById('agent-api-key-input-modal');
      if (!inputEl) return;
      inputEl.placeholder = provider === 'openai' ? 'Paste your OpenAI API key (e.g. sk-...)' : 'Paste your Anthropic API key (e.g. sk-ant-...)';
    }
    function showApiKeyModal(agentName, defaultProvider) {
      var modal = document.getElementById('api-key-modal');
      var titleEl = document.getElementById('api-key-modal-title');
      var inputEl = document.getElementById('agent-api-key-input-modal');
      if (titleEl) titleEl.textContent = 'Add API key to activate ' + (agentName || 'agent');
      if (inputEl) inputEl.value = '';
      var activeTab = defaultProvider || 'anthropic';
      setApiKeyInputPlaceholder(activeTab);
      document.querySelectorAll('#agent-api-key-setup-modal .api-key-tab').forEach(function(tab) {
        tab.classList.toggle('active', tab.dataset.provider === activeTab);
      });
      document.querySelectorAll('#agent-api-key-setup-modal .api-key-tab').forEach(function(tab) {
        tab.onclick = function() {
          document.querySelectorAll('#agent-api-key-setup-modal .api-key-tab').forEach(function(t) { t.classList.remove('active'); });
          tab.classList.add('active');
          activeTab = tab.dataset.provider || 'anthropic';
          setApiKeyInputPlaceholder(activeTab);
        };
      });
      var saveBtn = document.getElementById('agent-api-key-save-modal');
      if (saveBtn) {
        saveBtn.onclick = function() {
          var key = (document.getElementById('agent-api-key-input-modal').value || '').trim();
          if (!key || !ws || ws.readyState !== WebSocket.OPEN) return;
          var payload = { type: 'config:set', preferred_provider: activeTab };
          if (activeTab === 'anthropic') payload.anthropic_api_key = key; else payload.openai_api_key = key;
          ws.send(JSON.stringify(payload));
        };
      }
      if (modal) {
        modal.onclick = function(e) { if (e.target === modal) hideApiKeyModal(); };
        modal.classList.add('visible');
        modal.setAttribute('aria-hidden', 'false');
      }
    }
    function hideApiKeyModal() {
      var modal = document.getElementById('api-key-modal');
      if (modal) {
        modal.classList.remove('visible');
        modal.setAttribute('aria-hidden', 'true');
      }
    }
    function updateSendButtonState() {
      var sendBtn = document.getElementById('terminal-send');
      if (sendBtn) sendBtn.disabled = false;
    }
    function stripAnsi(str) {
      if (typeof str !== 'string') return str;
      var out = '', i = 0, code = 27;
      while (i < str.length) {
        if (str.charCodeAt(i) === code && str[i + 1] === '[') {
          var j = i + 2;
          while (j < str.length && /[?0-9;]/.test(str[j])) j++;
          if (j < str.length && /[A-Za-z]/.test(str[j])) { i = j + 1; continue; }
        }
        out += str[i];
        i++;
      }
      return out;
    }
    function addLine(text, kind) {
      var div = document.createElement('div');
      div.className = 'line ' + (kind || 'stdout');
      div.textContent = stripAnsi(text);
      terminalOutput.appendChild(div);
      terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }

    function connect() {
      var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + location.host);
      ws.onopen = function() {
        var studioUrl = location.protocol + '//' + location.host;
        addLine('bundl studio running at ' + studioUrl, 'system');
        addLine('Terminal mirroring active - all output visible here and in browser', 'system');
        addLine('Studio connected. Terminal ready.', 'system');
        terminalSend.disabled = false;
        ws.send(JSON.stringify({ type: 'skill:list' }));
      };
      ws.onmessage = function(ev) {
        try {
          var msg = JSON.parse(ev.data);
          if (msg.type === 'banner' && msg.data) {
            var bannerLines = (msg.data + '').split('\\n');
            for (var i = 0; i < bannerLines.length; i++) addLine(bannerLines[i], 'system');
          } else if (msg.type === 'stdout') addLine(msg.data, 'stdout');
          else if (msg.type === 'stderr') addLine(msg.data, 'stderr');
          else if (msg.type === 'skill:list') { skills = msg.data || []; renderSidebarSkills(); }
          else if (msg.type === 'skill:get') showSkillDetail(msg.data);
          else if (msg.type === 'shell:exit') addLine('Shell exited (code ' + (msg.code ?? '') + '). Respawning...', 'system');
          else if (msg.type === 'config:saved') {
            hideApiKeyModal();
          }
        } catch (e) {}
      };
      ws.onclose = function() {
        addLine('Reconnecting...', 'system');
        terminalSend.disabled = true;
        reconnectTimer = setTimeout(connect, 1500);
      };
      ws.onerror = function() {};
    }

    function stripPrefixTitleCase(id, prefix) {
      if (!id || typeof id !== 'string') return id || '';
      var rest = prefix ? id.replace(new RegExp('^' + prefix.replace(/-/g, '\\-') + '\\-?'), '') : id;
      return rest.split(/[-_]/).map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }).join(' ');
    }
    function renderSidebarSkills() {
      if (skills.length === 0) {
        sidebarSkills.innerHTML = '<div class="sidebar-item" style="padding-left:28px;color:#666;">No skills in corpus</div>';
        return;
      }
      var salesSkills = skills.filter(function(s) { var id = (s.id || '').toLowerCase(); return id.indexOf('sales-') === 0; });
      var productSkills = skills.filter(function(s) { var id = (s.id || '').toLowerCase(); return id.indexOf('product-') === 0; });
      var otherSkills = skills.filter(function(s) { var id = (s.id || '').toLowerCase(); return id.indexOf('sales-') !== 0 && id.indexOf('product-') !== 0; });
      function skillItem(s, prefix) {
        var sel = s.id === selectedSkillId ? ' selected' : '';
        var label = stripPrefixTitleCase(s.id, prefix) || s.name || s.id || '';
        return '<div class="sidebar-item' + sel + '" data-view="skill" data-id="' + escapeHtml(s.id || '') + '"><span class="dot completed"></span><div><span class="label">' + escapeHtml(label) + '</span></div></div>';
      }
      var html = '';
      if (salesSkills.length) {
        html += '<div class="sidebar-section skills-prefix-section collapsed" data-prefix="sales"><div class="sidebar-header skills-prefix-header"><span class="chevron"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><path d="M9 6L15 12L9 18" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="sidebar-group-label">Sales</span></div><div class="sidebar-items skills-prefix-items">';
        salesSkills.forEach(function(s) { html += skillItem(s, 'sales'); });
        html += '</div></div>';
      }
      if (productSkills.length) {
        html += '<div class="sidebar-section skills-prefix-section collapsed" data-prefix="product"><div class="sidebar-header skills-prefix-header"><span class="chevron"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><path d="M9 6L15 12L9 18" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="sidebar-group-label">Product</span></div><div class="sidebar-items skills-prefix-items">';
        productSkills.forEach(function(s) { html += skillItem(s, 'product'); });
        html += '</div></div>';
      }
      if (otherSkills.length) {
        html += '<div class="sidebar-group-label" style="padding:8px 12px 4px;font-size:11px;color:#888;text-transform:uppercase;">Other</div>';
        otherSkills.forEach(function(s) { html += skillItem(s, ''); });
      }
      sidebarSkills.innerHTML = html;
      sidebarSkills.querySelectorAll('.skills-prefix-header').forEach(function(h) {
        h.onclick = function() {
          var section = h.closest('.skills-prefix-section');
          if (section) section.classList.toggle('collapsed');
        };
      });
      sidebarSkills.querySelectorAll('.sidebar-item[data-view="skill"]').forEach(function(el) {
        el.addEventListener('click', function() {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'skill:get', id: el.dataset.id }));
          showView('skill', el.dataset.id);
        });
      });
    }

    function renderAgentDashboard(data) {
      var agent = data.agent || {};
      var viewAgent = document.getElementById('view-agent');
      if (viewAgent) viewAgent.style.setProperty('--agent-color', '#e8e8f0');
      var mainEl = document.querySelector('.main');
      if (mainEl) mainEl.style.setProperty('--agent-color', '#e8e8f0');
      var header = document.getElementById('agent-header');
      if (header) {
        var providerLabel = (data.activeProvider === 'openai') ? 'gpt-4o' : (data.activeProvider === 'anthropic') ? 'claude haiku' : '';
        var pillHtml = providerLabel ? '<span class="agent-provider-pill">' + escapeHtml(providerLabel) + '</span>' : '';
        var stats = data.stats || {};
        var statKeys = agent.id === 'sdr' ? ['Total Leads', 'Contacted', 'Replies', 'Sent'] : ['Total Backlog', 'In Progress', 'Done', 'Drafts'];
        var statPillsHtml = statKeys.filter(function(k) { return stats[k] !== undefined; }).map(function(k) { return '<span class="stat-pill">' + escapeHtml(k) + ': ' + (stats[k] || 0) + '</span>'; }).join('');
        var addBtnLabel = agent.id === 'sdr' ? '+ Add Lead' : '+ Add Item';
        header.innerHTML = '<div class="agent-header-left"><h1 class="agent-name">' + escapeHtml(agent.name || '') + '</h1><span class="agent-role">' + escapeHtml(agent.role || '') + '</span><span class="agent-status"><span class="dot" style="background:#22c55e"></span> ready</span>' + pillHtml + '</div><div class="agent-header-stats" id="agent-header-stats">' + statPillsHtml + '</div><button type="button" class="topbar-btn" id="agent-add-cta-btn">' + escapeHtml(addBtnLabel) + '</button>';
        var addCta = document.getElementById('agent-add-cta-btn');
        if (addCta) {
          addCta.onclick = function() {
            if (ws && ws.readyState === WebSocket.OPEN) {
              currentFilePath = agent.id === 'sdr' ? 'leads.md' : 'backlog.md';
              document.getElementById('agent-dashboard-panel').style.display = 'none';
              document.getElementById('agent-file-panel').style.display = 'block';
              document.getElementById('file-header').innerHTML = '<span style="color:#888">Loading...</span>';
              document.getElementById('file-content').innerHTML = '<p style="color:#888">Loading...</p>';
              ws.send(JSON.stringify({ type: 'file:read', path: currentFilePath }));
            }
          };
        }
      }
      var topbarAgentToggle = document.getElementById('topbar-agent-toggle');
      agentTabMode = 'dashboard';
      if (topbarAgentToggle) {
        topbarAgentToggle.querySelectorAll('button').forEach(function(btn) {
          btn.classList.toggle('active', btn.dataset.tab === 'dashboard');
        });
        topbarAgentToggle.querySelectorAll('button[data-tab]').forEach(function(tab) {
          tab.onclick = function() {
            var tabName = tab.dataset.tab;
            agentTabMode = tabName;
            document.getElementById('agent-dashboard-view').style.display = tabName === 'dashboard' ? 'block' : 'none';
            document.getElementById('agent-chat-view').style.display = tabName === 'chat' ? 'flex' : 'none';
            topbarAgentToggle.querySelectorAll('button[data-tab]').forEach(function(t) { t.classList.toggle('active', t.dataset.tab === tabName); });
            if (tabName === 'dashboard' && ws && ws.readyState === WebSocket.OPEN) {
              if (agent.id === 'sdr') ws.send(JSON.stringify({ type: 'file:read', path: 'leads.md' }));
              else ws.send(JSON.stringify({ type: 'file:read', path: 'backlog.md' }));
              ws.send(JSON.stringify({ type: 'dir:read', path: 'drafts/pending' }));
              ws.send(JSON.stringify({ type: 'dir:read', path: 'drafts/approved' }));
            }
          };
        });
      }
      document.getElementById('agent-dashboard-view').style.display = 'block';
      document.getElementById('agent-chat-view').style.display = 'none';
      var pendingCardsEl = document.getElementById('agent-pending-cards');
      if (pendingCardsEl) {
        pendingCardsEl.style.display = 'none';
        pendingCardsEl.innerHTML = '';
      }
      var tableWrap = document.getElementById('agent-pipeline-table-wrap');
      if (tableWrap) tableWrap.innerHTML = '<p style="color:#888;font-size:13px;">Loading...</p>';
      var addFormWrap = document.getElementById('agent-add-form-wrap');
      if (addFormWrap) addFormWrap.innerHTML = '';
      if (ws && ws.readyState === WebSocket.OPEN) {
        if (agent.id === 'sdr') ws.send(JSON.stringify({ type: 'file:read', path: 'leads.md' }));
        else ws.send(JSON.stringify({ type: 'file:read', path: 'backlog.md' }));
        ws.send(JSON.stringify({ type: 'dir:read', path: 'drafts/pending' }));
        ws.send(JSON.stringify({ type: 'dir:read', path: 'drafts/approved' }));
      }
      var chatEl = document.getElementById('agent-chat');
      if (chatEl) {
        if (storedBannerForAgentChat) {
          var bannerLines = storedBannerForAgentChat.split('\\n');
          var bannerHtml = '';
          for (var i = 0; i < bannerLines.length; i++) {
            var line = stripAnsi(bannerLines[i]);
            if (/open corpus/i.test(line)) continue;
            bannerHtml += '<div class="agent-chat-banner-line">' + escapeHtml(line) + '</div>';
          }
          chatEl.innerHTML = bannerHtml ? '<div class="agent-chat-banner">' + bannerHtml + '</div>' : '';
        } else {
          chatEl.innerHTML = '';
        }
      }
      if (data.hasApiKey === false) {
        showApiKeyModal(agent.name || 'Agent', 'anthropic');
      } else {
        hideApiKeyModal();
      }
      var approvalEl = document.getElementById('agent-approval');
      if (approvalEl) approvalEl.style.display = 'none';
      document.getElementById('agent-dashboard-panel').style.display = 'flex';
      document.getElementById('agent-file-panel').style.display = 'none';
    }

    function renderAgentFiles(agentId, files, stats) {
      var container = document.getElementById('agent-files-' + agentId);
      if (!container) return;
      var pending = (stats && (stats['Drafts'] != null ? stats['Drafts'] : stats['In Draft'] != null ? stats['In Draft'] : 0)) || 0;
      var approved = (stats && (stats['Sent'] != null ? stats['Sent'] : stats['Approved'] != null ? stats['Approved'] : 0)) || 0;
      var mainFile = agentId === 'sdr' ? 'leads.md' : 'backlog.md';
      var memoryFile = agentId === 'sdr' ? 'memory/jordan.md' : 'memory/alex.md';
      container.innerHTML = '<div class="sidebar-file tree-file" data-path="' + mainFile + '" data-type="file">' + mainFile + '</div>' +
        '<div class="sidebar-file tree-dir">drafts/</div>' +
        '<div class="sidebar-file tree-file tree-nested" data-path="drafts/pending" data-type="dir">pending <span class="sidebar-badge" id="agent-' + agentId + '-pending-badge">' + pending + '</span></div>' +
        '<div class="sidebar-file tree-file tree-nested" data-path="drafts/approved" data-type="dir">approved <span class="sidebar-badge" id="agent-' + agentId + '-approved-badge">' + approved + '</span></div>' +
        '<div class="sidebar-file tree-file" data-path="' + memoryFile + '" data-type="file">' + memoryFile + '</div>';
    }
    function updateDraftBadges(pending, approved) {
      var sdrP = document.getElementById('agent-sdr-pending-badge');
      var sdrA = document.getElementById('agent-sdr-approved-badge');
      var pmP = document.getElementById('agent-pm-pending-badge');
      var pmA = document.getElementById('agent-pm-approved-badge');
      if (sdrP) sdrP.textContent = pending;
      if (sdrA) sdrA.textContent = approved;
      if (pmP) pmP.textContent = pending;
      if (pmA) pmA.textContent = approved;
    }

    function parseMarkdownTable(content) {
      var lines = content.split(/\\r?\\n/);
      var rows = [];
      var headerRow = [];
      var sepIdx = -1;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!/^\\s*\\|/.test(line)) continue;
        var cells = line.split('|').slice(1, -1).map(function(c) { return c.trim(); });
        if (cells.length === 0) continue;
        if (/^[-:\\s]+$/.test(cells.join(''))) { sepIdx = i; continue; }
        if (sepIdx < 0) { headerRow = cells; sepIdx = i; continue; }
        rows.push(cells);
      }
      return { headers: headerRow, rows: rows };
    }

    function statusPillClass(status) {
      if (!status) return 'not-contacted';
      var s = (status + '').toLowerCase().replace(/\\s/g, '-');
      if (s === 'contacted') return 'contacted';
      if (s === 'replied') return 'replied';
      if (s === 'qualified') return 'qualified';
      if (s === 'disqualified') return 'disqualified';
      if (s === 'not-started') return 'not-started';
      return 'not-contacted';
    }

    function renderFileContent(msg) {
      var path = msg.path;
      var name = msg.name || path.split('/').pop() || '';
      var content = msg.content || '';
      var headerEl = document.getElementById('file-header');
      var contentEl = document.getElementById('file-content');
      if (!headerEl || !contentEl) return;
      var agent = currentAgentData && currentAgentData.agent ? currentAgentData.agent : {};
      var color = agent.color || '#7c6aff';
      contentEl.style.setProperty('--agent-color', color);
      var backBtn = '<button type="button" class="topbar-btn" id="file-back-btn">← Back</button>';
      var rowCount = '';
      if (content.indexOf('|') !== -1 && (path.indexOf('leads.md') !== -1 || path.indexOf('backlog.md') !== -1)) {
        var tbl = parseMarkdownTable(content);
        rowCount = tbl.rows.length + ' row(s)';
      }
      headerEl.innerHTML = backBtn + ' <span>' + escapeHtml(name) + (rowCount ? ' · ' + rowCount : '') + '</span>';
      document.getElementById('file-back-btn').onclick = function() {
        document.getElementById('agent-file-panel').style.display = 'none';
        document.getElementById('agent-dashboard-panel').style.display = 'flex';
      };
      if (content.indexOf('|') !== -1 && (path.indexOf('leads.md') !== -1 || path.indexOf('backlog.md') !== -1)) {
        var tbl = parseMarkdownTable(content);
        var headerIdx = tbl.headers.indexOf('Status');
        var html = '<div style="display:flex;justify-content:flex-end;margin-bottom:12px;"><button type="button" class="topbar-btn" id="file-add-row-btn">+ Add Row</button></div><div class="table-wrap"><table id="file-data-table"><thead><tr>' + tbl.headers.map(function(h) { return '<th>' + escapeHtml(h) + '</th>'; }).join('') + '</tr></thead><tbody>';
        tbl.rows.forEach(function(row, ri) {
          html += '<tr>';
          row.forEach(function(cell, ci) {
            var isStatus = headerIdx >= 0 && ci === headerIdx;
            var pillClass = isStatus ? statusPillClass(cell) : '';
            var cellContent = isStatus ? '<span class="status-pill ' + pillClass + '">' + escapeHtml(cell) + '</span>' : escapeHtml(cell);
            html += '<td contenteditable="true" data-row="' + ri + '" data-col="' + ci + '">' + cellContent + '</td>';
          });
          html += '</tr>';
        });
        html += '</tbody></table></div>';
        contentEl.innerHTML = html;
        document.getElementById('file-add-row-btn').onclick = function() {
          var t = document.getElementById('file-data-table');
          if (!t || !t.tHead || !t.tBodies[0]) return;
          var colCount = t.tHead.rows[0].cells.length;
          var tr = document.createElement('tr');
          for (var c = 0; c < colCount; c++) {
            var td = document.createElement('td');
            td.contentEditable = 'true';
            td.dataset.row = String(t.tBodies[0].rows.length);
            td.dataset.col = String(c);
            tr.appendChild(td);
          }
          t.tBodies[0].appendChild(tr);
        };
        contentEl.querySelectorAll('#file-data-table td').forEach(function(td) {
          td.addEventListener('blur', function saveTable() {
            var table = document.getElementById('file-data-table');
            if (!table || !ws || ws.readyState !== WebSocket.OPEN) return;
            var path = contentEl.dataset.path;
            if (!path) return;
            var headers = [];
            for (var i = 0; i < table.tHead.rows[0].cells.length; i++) headers.push(table.tHead.rows[0].cells[i].textContent.trim());
            var rows = [];
            for (var r = 0; r < table.tBodies[0].rows.length; r++) {
              var row = [];
              for (var c = 0; c < table.tHead.rows[0].cells.length; c++) {
                row.push((table.tBodies[0].rows[r].cells[c].textContent || '').trim());
              }
              rows.push(row);
            }
            var sep = '| ' + headers.map(function() { return '------'; }).join(' | ') + ' |';
            var tableMd = '| ' + headers.join(' | ') + ' |\\n' + sep + '\\n' + rows.map(function(row) { return '| ' + row.join(' | ') + ' |'; }).join('\\n');
            var prefix = path.indexOf('leads.md') !== -1 ? '# Leads\\n\\n' : path.indexOf('backlog.md') !== -1 ? '# Backlog\\n\\n' : '';
            ws.send(JSON.stringify({ type: 'file:write', path: path, content: prefix + tableMd }));
          });
        });
      } else if (path.indexOf('memory') !== -1 && (path.indexOf('jordan') !== -1 || path.indexOf('alex') !== -1)) {
        contentEl.innerHTML = '<button type="button" class="topbar-btn" id="file-edit-btn">Edit</button><pre class="file-prose" style="white-space:pre-wrap;font-family:inherit;">' + escapeHtml(content) + '</pre><textarea id="file-edit-ta" style="display:none;width:100%;min-height:200px;background:#2C2C2C;color:#FFF;padding:12px;font-family:monospace;"></textarea>';
        document.getElementById('file-edit-btn').onclick = function() {
          var pre = contentEl.querySelector('.file-prose');
          var ta = contentEl.querySelector('#file-edit-ta');
          if (pre.style.display === 'none') {
            if (ws && ws.readyState === WebSocket.OPEN && contentEl.dataset.path) ws.send(JSON.stringify({ type: 'file:write', path: contentEl.dataset.path, content: ta.value }));
            pre.textContent = ta.value;
            pre.style.display = 'block';
            ta.style.display = 'none';
            this.textContent = 'Edit';
          } else {
            ta.value = pre.textContent;
            pre.style.display = 'none';
            ta.style.display = 'block';
            this.textContent = 'Save';
          }
        };
      } else {
        contentEl.innerHTML = '<button type="button" class="topbar-btn" id="file-edit-btn">Edit</button><pre class="file-raw" style="white-space:pre-wrap;">' + escapeHtml(content) + '</pre><textarea id="file-edit-ta" style="display:none;width:100%;min-height:200px;background:#2C2C2C;color:#FFF;padding:12px;font-family:monospace;"></textarea>';
        document.getElementById('file-edit-btn').onclick = function() {
          var pre = contentEl.querySelector('.file-raw');
          var ta = contentEl.querySelector('#file-edit-ta');
          if (pre.style.display === 'none') {
            if (ws && ws.readyState === WebSocket.OPEN && contentEl.dataset.path) ws.send(JSON.stringify({ type: 'file:write', path: contentEl.dataset.path, content: ta.value }));
            pre.textContent = ta.value;
            pre.style.display = 'block';
            ta.style.display = 'none';
            this.textContent = 'Edit';
          } else {
            ta.value = pre.textContent;
            pre.style.display = 'none';
            ta.style.display = 'block';
            this.textContent = 'Save';
          }
        };
      }
      contentEl.dataset.path = path;
      contentEl.dataset.rawContent = content;
    }

    function renderDirContent(msg) {
      var path = msg.path;
      var files = msg.files || [];
      var headerEl = document.getElementById('file-header');
      var contentEl = document.getElementById('file-content');
      if (!headerEl || !contentEl) return;
      var backBtn = '<button type="button" class="topbar-btn" id="file-back-btn">← Back</button>';
      headerEl.innerHTML = backBtn + ' <span>drafts/</span>';
      document.getElementById('file-back-btn').onclick = function() {
        document.getElementById('agent-file-panel').style.display = 'none';
        document.getElementById('agent-dashboard-panel').style.display = 'flex';
      };
      contentEl.innerHTML = '<ul style="list-style:none;padding:0;">' + files.map(function(f) {
        return '<li class="sidebar-file" style="padding:8px 0;" data-path="' + escapeHtml(f.path) + '" data-type="file">' + escapeHtml(f.name) + '</li>';
      }).join('') + '</ul>';
      contentEl.querySelectorAll('.sidebar-file').forEach(function(el) {
        el.addEventListener('click', function() {
          if (ws && ws.readyState === WebSocket.OPEN) {
            currentFilePath = el.dataset.path;
            ws.send(JSON.stringify({ type: 'file:read', path: el.dataset.path }));
          }
        });
      });
    }

    function skillToAgentMarkdown(skill) {
      var name = skill.name || skill.id || 'Skill';
      var desc = skill.trigger_description || skill.description || '';
      var sys = (skill.system_prompt || '').trim() || '';
      var inputs = skill.inputs || {};
      var required = inputs.required || [];
      var optional = inputs.optional || [];
      var constraints = skill.constraints || [];
      var criteria = skill.success_criteria || [];
      var handoff = skill.handoff || {};
      var doneWhen = (handoff.conditions || []).concat(typeof criteria === 'string' ? [criteria] : criteria).filter(Boolean);
      var out = '---\\nname: ' + name + '\\ndescription: ' + (desc || 'Trigger when relevant inputs are provided.').replace(/\\n/g, ' ') + '\\n---\\n\\n# ' + name + '\\n\\n';
      if (sys) out += sys + '\\n\\n';
      if (required.length > 0) {
        out += '## Required Context\\n';
        for (var r = 0; r < required.length; r++) {
          var ir = required[r];
          out += '- ' + (ir.name || '') + ': ' + (ir.description || '') + '\\n';
        }
        out += '\\n';
      }
      if (optional.length > 0) {
        out += '## Optional Context\\n';
        for (var o = 0; o < optional.length; o++) {
          var io = optional[o];
          var fallback = io.fallback ? ' (if absent: ' + io.fallback + ')' : '';
          out += '- ' + (io.name || '') + ': ' + (io.description || '') + fallback + '\\n';
        }
        out += '\\n';
      }
      if (constraints.length > 0) {
        out += '## Constraints\\n';
        for (var c = 0; c < constraints.length; c++) out += '- ' + constraints[c] + '\\n';
        out += '\\n';
      }
      if (doneWhen.length > 0) {
        out += '## Done When\\n';
        for (var d = 0; d < doneWhen.length; d++) out += '- ' + (typeof doneWhen[d] === 'string' ? doneWhen[d] : JSON.stringify(doneWhen[d])) + '\\n';
      }
      return out.trim();
    }

    function renderSkillViews(skill) {
      var name = skill.name || skill.id || 'Skill';
      var desc = skill.trigger_description || skill.description || '';
      var sys = (skill.system_prompt || '').trim() || '';
      var tag = skill.type || 'Private';
      var role = skill.role || '';
      var inputs = skill.inputs || {};
      var required = inputs.required || [];
      var optional = inputs.optional || [];
      var allInputs = required.concat(optional);
      var quickstartHtml = '<h2 class="skill-quickstart-title">Quickstart Inputs</h2><p class="skill-quickstart-sub">Fill in to customize the prompt</p>';
      for (var i = 0; i < allInputs.length; i++) {
        var inp = allInputs[i];
        var label = inp.name || ('Input ' + (i + 1));
        var ex = (inp.example !== undefined && inp.example !== null) ? String(inp.example) : '';
        var isLong = (inp.description && inp.description.length > 60) || (ex && ex.length > 80);
        if (isLong) quickstartHtml += '<div class="skill-quickstart-field"><label>' + escapeHtml(label) + '</label><textarea data-input="' + escapeHtml(inp.name || '') + '" placeholder="' + escapeHtml(ex) + '">' + escapeHtml(ex) + '</textarea></div>';
        else quickstartHtml += '<div class="skill-quickstart-field"><label>' + escapeHtml(label) + '</label><input type="text" data-input="' + escapeHtml(inp.name || '') + '" placeholder="' + escapeHtml(ex) + '" value="' + escapeHtml(ex) + '"/></div>';
      }
      if (allInputs.length === 0) quickstartHtml += '<p class="skill-quickstart-sub">No inputs defined for this skill.</p>';
      var rightTags = '<span class="tag">' + escapeHtml(role || 'Product') + '</span><span class="tag">' + escapeHtml(tag) + '</span>';
      var rightHtml = '<div class="detail-tags">' + rightTags + '</div><h1 class="detail-title">' + escapeHtml(name) + '</h1><p class="detail-desc">' + escapeHtml(desc) + '</p><div class="detail-system-label">SYSTEM</div><div class="detail-system-value">' + escapeHtml(sys) + '</div>';
      skillHumanView.innerHTML = '<div class="skill-dashboard-left">' + quickstartHtml + '</div><div class="skill-dashboard-right">' + rightHtml + '</div>';
      var agentMd = skillToAgentMarkdown(skill);
      var agentLabel = '<div class="agent-format-label">Agent skill</div>';
      skillAgentView.innerHTML = agentLabel + '<div class="agent-section"><div class="agent-value agent-skill-markdown">' + escapeHtml(agentMd).replace(/\\n/g, '<br>') + '</div></div>';
    }

    function setSkillViewMode(mode) {
      skillViewMode = mode;
      if (!topbarSkillToggle) return;
      topbarSkillToggle.querySelectorAll('button').forEach(function(b) { b.classList.toggle('active', b.dataset.mode === mode); });
      if (skillHumanView) skillHumanView.style.display = mode === 'human' ? 'flex' : 'none';
      if (skillAgentView) skillAgentView.style.display = mode === 'agent' ? 'block' : 'none';
    }

    function showSkillDetail(skill) {
      if (!skill) {
        skillDetailPlaceholder.style.display = 'block';
        skillDetailWrap.style.display = 'none';
        if (topbarSkillToggle) topbarSkillToggle.classList.remove('visible');
        selectedSkillId = null;
        currentSkill = null;
        renderSidebarSkills();
        return;
      }
      currentSkill = skill;
      selectedSkillId = skill.id || null;
      skillDetailPlaceholder.style.display = 'none';
      skillDetailWrap.style.display = 'block';
      renderSkillViews(skill);
      setSkillViewMode(skillViewMode);
      if (topbarSkillToggle) topbarSkillToggle.classList.add('visible');
      var skillsSection = document.querySelector('.sidebar-section[data-section="skills"]');
      if (skillsSection) skillsSection.classList.remove('collapsed');
      var expandedPrefixes = [];
      document.querySelectorAll('.skills-prefix-section:not(.collapsed)').forEach(function(s) {
        if (s.dataset.prefix) expandedPrefixes.push(s.dataset.prefix);
      });
      renderSidebarSkills();
      expandedPrefixes.forEach(function(prefix) {
        var section = document.querySelector('.skills-prefix-section[data-prefix="' + escapeHtml(prefix) + '"]');
        if (section) section.classList.remove('collapsed');
      });
      var selId = skill.id || null;
      if (selId) {
        var skillEl = document.querySelector('.sidebar-item[data-view="skill"][data-id="' + escapeHtml(selId) + '"]');
        if (skillEl) {
          var prefixSection = skillEl.closest('.skills-prefix-section');
          if (prefixSection) prefixSection.classList.remove('collapsed');
        }
      }
      topbarContext.textContent = skill.name || skill.id || 'Skill';
    }

    function showView(view, id) {
      currentView = view;
      var isChat = view === 'chat' || view === 'terminal';
      if (topbarSkillToggle) topbarSkillToggle.classList.toggle('visible', view === 'skill');
      var bottomBar = document.getElementById('bottom-bar');
      var mainEl = document.querySelector('.main');
      if (bottomBar) bottomBar.classList.toggle('visible', isChat);
      if (mainEl) mainEl.classList.toggle('has-chat-active', isChat);
      document.getElementById('view-terminal').classList.remove('active');
      document.getElementById('view-skill-detail').classList.remove('active');
      if (isChat) {
        document.getElementById('view-terminal').classList.add('active');
        topbarContext.textContent = 'Terminal';
        resetBottomBarPlaceholder();
      } else if (view === 'skill') {
        document.getElementById('view-skill-detail').classList.add('active');
        topbarContext.textContent = id || 'Skill';
      }
      updateSidebarSelection(view, id);
      updateSendButtonState();
    }

    function updateSidebarSelection(view, id) {
      document.querySelectorAll('.sidebar-header, .sidebar-item').forEach(function(el) { el.classList.remove('selected'); });
      if (view === 'chat' || view === 'terminal') {
        var chatHeader = document.querySelector('.sidebar-header[data-view="chat"]');
        if (chatHeader) chatHeader.classList.add('selected');
      } else if (view === 'skill' && id) {
        var skillEl = document.querySelector('.sidebar-item[data-id="' + escapeHtml(id) + '"]');
        if (skillEl) skillEl.classList.add('selected');
      }
    }

    document.querySelectorAll('.sidebar-header').forEach(function(h) {
      h.addEventListener('click', function(e) {
        if (h.dataset.view === 'chat') {
          e.stopPropagation();
          updateSidebarSelection('chat');
          showView('chat');
          return;
        }
        var section = h.closest('.sidebar-section');
        section.classList.toggle('collapsed');
      });
    });

    function resetBottomBarPlaceholder() {
      var inp = document.getElementById('terminal-input');
      if (inp) inp.placeholder = 'Run a command, or ask anything...';
    }
    document.querySelectorAll('.sidebar-item.agent-item').forEach(function(el) {
      el.addEventListener('click', function(e) {
        if (e.target.closest('.agent-chevron')) {
          e.preventDefault();
          e.stopPropagation();
          var block = el.closest('.sidebar-agent-block');
          if (!block) return;
          var filesEl = block.querySelector('.sidebar-agent-files');
          if (filesEl) filesEl.classList.toggle('expanded');
          return;
        }
        var id = el.dataset.agentId;
        if (!id || !ws || ws.readyState !== WebSocket.OPEN) return;
        selectedAgentId = id;
        ws.send(JSON.stringify({ type: 'agent:select', id: id }));
        showView('agent', id);
        document.querySelectorAll('.sidebar-item.agent-item .dot').forEach(function(d) { d.className = 'dot idle'; });
        var selDot = el.querySelector('.dot');
        if (selDot) { selDot.className = 'dot active'; selDot.style.background = ''; }
      });
    });
    function sendStdin() {
      var val = (terminalInput.value || '').trim();
      if (!val || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'stdin', data: val + '\\n' }));
      terminalInput.value = '';
      if (terminalInput.rows > 1) terminalInput.rows = 1;
    }
    terminalSend.addEventListener('click', sendStdin);
    terminalInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendStdin(); }
    });

    if (topbarSkillToggle) topbarSkillToggle.querySelectorAll('button').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var mode = btn.dataset.mode;
        if (mode) setSkillViewMode(mode);
      });
    });

    var navToggle = document.getElementById('topbar-nav-toggle');
    if (navToggle) {
      navToggle.addEventListener('click', function() {
        var layout = document.querySelector('.layout');
        if (layout) layout.classList.toggle('sidebar-collapsed');
      });
    }
    document.querySelectorAll('.topbar-btn[data-cmd], .topbar-login[data-cmd]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (btn.disabled) return;
        var cmd = btn.dataset.cmd;
        if (!cmd) return;
        showView('chat');
        terminalInput.value = cmd;
        terminalInput.focus();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stdin', data: cmd + '\\n' }));
          terminalInput.value = '';
        }
      });
    });

    connect();
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Raw WebSocket: accept handshake and frame handling
function acceptWebSocket(req: IncomingMessage, socket: SocketLike, head: Buffer): WsClient | null {
  const key = req.headers["sec-websocket-key"];
  if (!key || req.headers.upgrade?.toLowerCase() !== "websocket") return null;
  const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
  const response =
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`;
  socket.write(response);
  socket.write(head);

  function sendFrame(data: string) {
    const payload = Buffer.from(data, "utf8");
    const len = payload.length;
    let header: Buffer;
    if (len < 126) {
      header = Buffer.allocUnsafe(2);
      header[0] = 0x80 | 0x01;
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[0] = 0x80 | 0x01;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[0] = 0x80 | 0x01;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    socket.write(Buffer.concat([header, payload]));
  }

  return { send: sendFrame, socket };
}

function parseWsFrame(
  buffer: Buffer
): { opcode: number; payload: Buffer; consumed: number } | null {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let payloadLen = buffer[1] & 0x7f;
  let offset = 2;
  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  if (masked) offset += 4;
  if (buffer.length < offset + payloadLen) return null;
  let payload = buffer.slice(offset, offset + payloadLen);
  if (masked) {
    const maskKey = buffer.slice(offset - 4, offset);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
  }
  const consumed = offset + payloadLen;
  return { opcode, payload, consumed };
}

function listSkills(cwd: string): { id: string; name: string; role?: string; type?: string; agentId?: "sdr" | "pm" }[] {
  const corpusPath = resolve(cwd, CORPUS_DIR);
  if (!existsSync(corpusPath)) return [];
  const files = readdirSync(corpusPath).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const out: { id: string; name: string; role?: string; type?: string; agentId?: "sdr" | "pm" }[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(resolve(corpusPath, file), "utf-8");
      const parsed = yaml.load(raw) as { id?: string; name?: string; role?: string; type?: string };
      const id = parsed?.id ?? file.replace(/\.(yaml|yml)$/, "");
      const agentId = file.startsWith("sales-") ? "sdr" : file.startsWith("product-") ? "pm" : undefined;
      out.push({
        id,
        name: parsed?.name ?? id,
        role: parsed?.role,
        type: parsed?.type,
        agentId,
      });
    } catch {
      // skip invalid
    }
  }
  return out;
}

function getSkill(cwd: string, id: string): unknown {
  const corpusPath = resolve(cwd, CORPUS_DIR);
  if (!existsSync(corpusPath)) return null;
  for (const ext of [".yaml", ".yml"]) {
    const p = resolve(corpusPath, id + ext);
    if (existsSync(p)) {
      try {
        return yaml.load(readFileSync(p, "utf-8")) as unknown;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function ensureGitignore(cwd: string): void {
  const gitignorePath = resolve(cwd, ".gitignore");
  let lines: string[] = [];
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    lines = content.split(/\r?\n/);
  }
  const existing = new Set(lines.map((l) => l.trim()).filter(Boolean));
  if (existing.has(".bundl/")) return;
  lines.push(".bundl/");
  writeFileSync(gitignorePath, lines.join("\n") + (lines[lines.length - 1]?.endsWith("\n") ? "" : "\n"));
  console.log("  Added .bundl/ to .gitignore");
}

/** Migrate workspace files from .bundl/workspace/ to project root. Run on studio start. */
function migrateWorkspaceToProjectRoot(cwd: string): void {
  const migrations: { newPath: string; oldPaths: string[] }[] = [
    { newPath: "leads.md", oldPaths: [resolve(cwd, OLD_WORKSPACE_ROOT, "sdr", "leads.md")] },
    { newPath: "backlog.md", oldPaths: [resolve(cwd, OLD_WORKSPACE_ROOT, "pm", "backlog.md")] },
    { newPath: "memory/jordan.md", oldPaths: [resolve(cwd, OLD_WORKSPACE_ROOT, "sdr", "memory.md")] },
    { newPath: "memory/alex.md", oldPaths: [resolve(cwd, OLD_WORKSPACE_ROOT, "pm", "memory.md")] },
  ];
  for (const { newPath, oldPaths } of migrations) {
    const newFull = resolve(cwd, newPath);
    if (existsSync(newFull)) continue;
    for (const oldFull of oldPaths) {
      if (!existsSync(oldFull)) continue;
      try {
        const dir = resolve(newFull, "..");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const content = readFileSync(oldFull, "utf-8");
        writeFileSync(newFull, content);
        unlinkSync(oldFull);
        console.log("  Moved " + newPath + " to project root");
      } catch {
        // skip
      }
      break;
    }
  }
  const draftsNewPending = resolve(cwd, "drafts", "pending");
  const draftsNewApproved = resolve(cwd, "drafts", "approved");
  for (const agentId of ["sdr", "pm"] as const) {
    const oldDrafts = resolve(cwd, OLD_WORKSPACE_ROOT, agentId, "drafts");
    if (!existsSync(oldDrafts)) continue;
    if (!existsSync(draftsNewPending)) mkdirSync(draftsNewPending, { recursive: true });
    if (!existsSync(draftsNewApproved)) mkdirSync(draftsNewApproved, { recursive: true });
    try {
      const entries = readdirSync(oldDrafts, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        const src = resolve(oldDrafts, e.name);
        const dest = resolve(draftsNewPending, e.name);
        if (!existsSync(dest)) {
          const data = readFileSync(src);
          writeFileSync(dest, data);
          unlinkSync(src);
        }
      }
    } catch {
      // skip
    }
  }
}

/** Returns true if file exists in project root or old workspace location. */
function workspaceFileExists(cwd: string, agentId: string, filename: string): boolean {
  const newPath = resolve(cwd, filename);
  if (existsSync(newPath)) return true;
  const oldPath = resolve(cwd, OLD_WORKSPACE_ROOT, agentId, filename.split("/").pop() ?? filename);
  return existsSync(oldPath);
}

const LEADS_STUB = `# Leads

| Name | Company | Title | Email | Context | ICP Fit | Status | Last Action |
|------|---------|-------|-------|---------|---------|--------|-------------|
| Example Lead | Acme Corp | VP Sales | vp@acme.com | Series A, scaling SDR team | High | not contacted | - |
`;

const JORDAN_MEMORY_STUB = `# Jordan's Memory

## Tone preferences
_Not set yet. Jordan will learn as you work together._

## What works
_Jordan will log sequences that got replies here._

## Company context
_Jordan will remember company-specific details here._

## Sent log
_Jordan will track what was sent and when here._
`;

const BACKLOG_STUB = `# Backlog

| Item | Priority | Type | Effort | Impact | Status | Notes |
|------|----------|------|--------|--------|--------|-------|
| Example feature | High | Feature | M | High | not started | Add details here |
`;

const ALEX_MEMORY_STUB = `# Alex's Memory

## Product decisions
_Alex will log key decisions and rationale here._

## Stakeholder preferences
_Alex will remember what stakeholders care about._

## Cut items
_Alex will log what got cut and why._

## Documents written
_Alex will track PRDs and docs written here._
`;

/** Bootstrap workspace for an agent when selected and files don't exist in either location. Creates in project root. */
function bootstrapAgentWorkspace(cwd: string, agentId: string): string[] {
  const agent = getAgentById(agentId);
  if (!agent) return [];
  const paths = getWorkspacePaths(cwd, agentId);
  const created: string[] = [];
  if (agentId === "sdr") {
    if (!workspaceFileExists(cwd, agentId, "leads.md")) {
      writeFileSync(paths.leadsPath!, LEADS_STUB, "utf-8");
      created.push("leads.md");
    }
    if (!existsSync(paths.memoryPath)) {
      mkdirSync(resolve(paths.memoryPath, ".."), { recursive: true });
      writeFileSync(paths.memoryPath, JORDAN_MEMORY_STUB, "utf-8");
      created.push("memory/jordan.md");
    }
  } else if (agentId === "pm") {
    if (!workspaceFileExists(cwd, agentId, "backlog.md")) {
      writeFileSync(paths.backlogPath!, BACKLOG_STUB, "utf-8");
      created.push("backlog.md");
    }
    if (!existsSync(paths.memoryPath)) {
      mkdirSync(resolve(paths.memoryPath, ".."), { recursive: true });
      writeFileSync(paths.memoryPath, ALEX_MEMORY_STUB, "utf-8");
      created.push("memory/alex.md");
    }
  }
  if (!existsSync(paths.draftsPending)) {
    mkdirSync(paths.draftsPending, { recursive: true });
    writeFileSync(join(paths.draftsPending, ".gitkeep"), "", "utf-8");
    created.push("drafts/pending/");
  }
  if (!existsSync(paths.draftsApproved)) {
    mkdirSync(paths.draftsApproved, { recursive: true });
    writeFileSync(join(paths.draftsApproved, ".gitkeep"), "", "utf-8");
    created.push("drafts/approved/");
  }
  return created;
}

function getAgentById(id: string): (typeof AGENTS)[number] | undefined {
  return AGENTS.find((a) => a.id === id);
}

/** Parse handoffs.md for pending count per agent (by name) and total. */
function parseHandoffsPending(cwd: string): { total: number; byAgent: Record<string, number> } {
  const byAgent: Record<string, number> = {};
  let total = 0;
  const p = resolve(cwd, "handoffs.md");
  if (!existsSync(p)) return { total: 0, byAgent };
  try {
    const content = readFileSync(p, "utf-8");
    const blocks = content.split(/\n---\n/);
    for (const block of blocks) {
      if (!/Status:\s*pending/im.test(block)) continue;
      const m = block.match(/##\s*[^\n]+\s+(\w+)\s*→\s*(\w+)/);
      if (m) {
        const to = m[2] ?? "";
        if (to) {
          byAgent[to] = (byAgent[to] ?? 0) + 1;
          total++;
        }
      }
    }
  } catch {
    // ignore
  }
  return { total, byAgent };
}

const HANDOFFS_STUB = `# Handoffs

_Cross-agent coordination log._
_Agents read this on startup and action pending items._

<!-- New handoffs added below by agents -->

---
`;

/** Create AGENTS.md, company.md, handoffs.md, employees/, memory/, drafts/, and per-employee files from onboarding payload. */
function applyOnboardingFiles(
  cwd: string,
  payload: {
    company_name: string;
    what_you_do?: string;
    icp?: string;
    stage?: string;
    tools?: string[];
    tone?: string;
    hired: string[];
    api_key?: { key: string; provider: PreferredProvider } | null;
  }
): void {
  const root = resolve(cwd);
  const bundlDir = resolve(cwd, ".bundl");
  const corpusDir = resolve(cwd, ".bundl", "corpus");
  const employeesDir = resolve(cwd, "employees");
  const memoryDir = resolve(cwd, "memory");
  const draftsPending = resolve(cwd, "drafts", "pending");
  const draftsApproved = resolve(cwd, "drafts", "approved");

  if (!existsSync(bundlDir)) mkdirSync(bundlDir, { recursive: true });
  if (!existsSync(corpusDir)) mkdirSync(corpusDir, { recursive: true });
  if (!existsSync(employeesDir)) mkdirSync(employeesDir, { recursive: true });
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
  if (!existsSync(draftsPending)) mkdirSync(draftsPending, { recursive: true });
  if (!existsSync(draftsApproved)) mkdirSync(draftsApproved, { recursive: true });

  const workspaceName = payload.company_name || "Workspace";
  const bundlYaml = `workspace_name: ${workspaceName.replace(/:/g, "-")}\n`;
  const bundlYamlPath = resolve(bundlDir, "bundl.yaml");
  if (!existsSync(bundlYamlPath)) writeFileSync(bundlYamlPath, bundlYaml, "utf-8");

  let pkgVersion = "0.0.0";
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    pkgVersion = pkg?.version ?? "0.0.0";
  } catch {
    // ignore
  }

  const ts = new Date().toISOString();
  const employeesList = payload.hired
    .map((id) => {
      const agent = getAgentById(id);
      return agent ? `- ${agent.name} (${agent.role}) — employees/${agent.name.toLowerCase()}.md` : null;
    })
    .filter(Boolean) as string[];

  const agentsMd = `---
# AGENTS.md
Generated by Bundl CLI v${pkgVersion}
${ts}

## Workspace
This is a Bundl AI Employee workspace.
Managed by Bundl CLI.

## Employees
${employeesList.join("\n")}

## Startup sequence
Every agent reads on every session:
1. company.md
2. employees/[own name].md
3. handoffs.md
4. Own workspace files
5. Own memory file

## Coordination
Agents share data via workspace files.
Agents coordinate via handoffs.md.
Each agent owns specific files.
No agent writes to another agent's owned files.

## Approval gates
Always require human approval:
- Sending any email or message
- Updating external systems (CRM, email tools)
- Publishing any document externally
- Any action tagged EXTERNAL in corpus
---
`;
  writeFileSync(resolve(root, "AGENTS.md"), agentsMd, "utf-8");

  const toolsStr = (payload.tools && payload.tools.length > 0 ? payload.tools : ["(none)"]).join(", ");
  const companyMd = `# Company

Name: ${payload.company_name || ""}
What we do: ${payload.what_you_do || ""}
ICP: ${payload.icp || ""}
Stage: ${payload.stage || ""}
Team size: (not set)

Tools: ${toolsStr}

Tone and voice: ${payload.tone || ""}

Current focus:
- (Add your top 3 priorities here)

Off limits:
- Never fabricate data or metrics
- Never commit to specific timelines
- Never discuss internal financials
`;
  writeFileSync(resolve(root, "company.md"), companyMd, "utf-8");

  if (!existsSync(resolve(root, "handoffs.md"))) writeFileSync(resolve(root, "handoffs.md"), HANDOFFS_STUB, "utf-8");

  for (const id of payload.hired) {
    const agent = getAgentById(id);
    if (!agent) continue;
    const empPath = resolve(employeesDir, `${agent.name.toLowerCase()}.md`);
    const owns = agent.files.filter((f) => !f.endsWith("/")).map((f) => f.replace(/\/$/, ""));
    const ownsStr = owns.length > 0 ? owns.join("\n") : "(workspace files for this role)";
    const empMd = `# ${agent.name} — ${agent.role}

Hired: ${ts.split("T")[0]}
Goal: (set in onboarding)

## Skills
.bundl/corpus/${agent.prefix || ""}*

## Owns
${ownsStr}

## Can read
company.md
AGENTS.md
handoffs.md
employees/${agent.name.toLowerCase()}.md

## Approval gates
Always get human approval before sending email, updating CRM, or publishing externally.
`;
    writeFileSync(empPath, empMd, "utf-8");

    const memPath = resolve(memoryDir, `${agent.name.toLowerCase()}.md`);
    const memoryStub =
      id === "sdr"
        ? JORDAN_MEMORY_STUB
        : id === "pm"
          ? ALEX_MEMORY_STUB
          : `# ${agent.name}'s Memory\n\n## Preferences learned\n_Not set yet._\n\n## What works\n_${agent.name} will log successful patterns here._\n\n## Activity log\n_${agent.name} will track actions here._\n`;
    if (!existsSync(memPath)) writeFileSync(memPath, memoryStub, "utf-8");

    if (id === "sdr" && !existsSync(resolve(root, "leads.md"))) writeFileSync(resolve(root, "leads.md"), LEADS_STUB, "utf-8");
    if (id === "pm" && !existsSync(resolve(root, "backlog.md"))) writeFileSync(resolve(root, "backlog.md"), BACKLOG_STUB, "utf-8");
  }

  writeFileSync(join(draftsPending, ".gitkeep"), "", "utf-8");
  writeFileSync(join(draftsApproved, ".gitkeep"), "", "utf-8");

  if (payload.api_key?.key && payload.api_key.provider) {
    const updates: Partial<StudioCredentials> = {
      [payload.api_key.provider === "anthropic" ? "anthropic_api_key" : "openai_api_key"]: payload.api_key.key,
      preferred_provider: payload.api_key.provider,
    };
    saveStudioCredentials(updates);
  }
  ensureGitignore(cwd);
}

function countTableRows(cwd: string, filePath: string): number {
  const full = resolve(cwd, filePath);
  if (!existsSync(full)) return 0;
  const content = readFileSync(full, "utf-8");
  const lines = content.split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\|.+\|\s*$/.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return 0;
  let count = 0;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (/^\s*\|.+\|\s*$/.test(lines[i]) && lines[i].trim() !== "|------|") count++;
  }
  return count;
}

function countDrafts(cwd: string, dir: "pending" | "approved"): number {
  const draftsPath = resolve(cwd, "drafts", dir);
  if (!existsSync(draftsPath)) return 0;
  const entries = readdirSync(draftsPath, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name !== ".gitkeep").length;
}

function countByStatus(cwd: string, filePath: string, statusColumn: string): Record<string, number> {
  const parsed = (() => {
    const full = resolve(cwd, filePath);
    if (!existsSync(full)) return null;
    const raw = readFileSync(full, "utf-8");
    return parseMarkdownTable(raw);
  })();
  if (!parsed) return {};
  const { header, rows } = parsed;
  const statusIdx = header.findIndex((h) => h.toLowerCase() === statusColumn.toLowerCase());
  if (statusIdx < 0) return {};
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const s = (row[statusIdx] ?? "").trim().toLowerCase();
    if (!s) continue;
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}

function getAgentStats(cwd: string, agentId: string): Record<string, number> {
  const agent = getAgentById(agentId);
  if (!agent) return {};
  const paths = getWorkspacePaths(cwd, agentId);
  const out: Record<string, number> = {};
  if (agentId === "sdr") {
    const total = paths.leadsPath && existsSync(paths.leadsPath) ? countTableRows(cwd, "leads.md") : 0;
    const byStatus = countByStatus(cwd, "leads.md", "Status");
    const contacted = (byStatus["contacted"] ?? 0) + (byStatus["replied"] ?? 0) + (byStatus["qualified"] ?? 0) + (byStatus["closed"] ?? 0);
    const replies = byStatus["replied"] ?? 0;
    const sent = countDrafts(cwd, "approved");
    out["Total Leads"] = total;
    out["Contacted"] = contacted;
    out["Replies"] = replies;
    out["Sent"] = sent;
    out["Queue"] = total;
    out["Drafts"] = countDrafts(cwd, "pending");
    out["Memory"] = existsSync(paths.memoryPath) ? 1 : 0;
  } else if (agentId === "pm") {
    const total = paths.backlogPath && existsSync(paths.backlogPath) ? countTableRows(cwd, "backlog.md") : 0;
    const byStatus = countByStatus(cwd, "backlog.md", "Status");
    const inProgress = byStatus["in progress"] ?? 0;
    const done = byStatus["done"] ?? 0;
    const drafts = countDrafts(cwd, "pending");
    const approved = countDrafts(cwd, "approved");
    out["Total Backlog"] = total;
    out["In Progress"] = inProgress;
    out["Done"] = done;
    out["Drafts"] = drafts;
    out["Approved"] = approved;
    out["Backlog"] = total;
    out["In Draft"] = drafts;
    out["Published"] = 0;
    out["Memory"] = existsSync(paths.memoryPath) ? 1 : 0;
  }
  return out;
}

function readFileSafe(cwd: string, path: string): { content: string; modified?: number; size?: number } | null {
  const full = resolve(cwd, path);
  if (!existsSync(full)) return null;
  try {
    const content = readFileSync(full, "utf-8");
    const st = statSync(full);
    return { content, modified: Math.floor(st.mtimeMs / 1000), size: st.size };
  } catch {
    return null;
  }
}

function writeFileSafe(cwd: string, path: string, content: string): boolean {
  const full = resolve(cwd, path);
  try {
    const dir = resolve(full, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(full, content, "utf-8");
    return true;
  } catch {
    return false;
  }
}

function listDirSafe(cwd: string, path: string): { name: string; path: string; type: "file" | "dir" }[] {
  const full = resolve(cwd, path);
  if (!existsSync(full)) return [];
  try {
    const entries = readdirSync(full, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      path: path + (path.endsWith("/") ? "" : "/") + e.name,
      type: e.isDirectory() ? "dir" : "file",
    }));
  } catch {
    return [];
  }
}

type SkillDoc = { name?: string; description?: string; system_prompt?: string; constraints?: string | string[] };

/** Load skills from flat .bundl/corpus/ by filename prefix: sdr → sales-*, pm → product-*. */
function loadAgentCorpus(cwd: string, agentId: string): SkillDoc[] {
  const corpusPath = resolve(cwd, CORPUS_DIR);
  if (!existsSync(corpusPath)) return [];
  const prefix = CORPUS_PREFIX[agentId] ?? "";
  const allFiles = readdirSync(corpusPath).filter((f) => (f.endsWith(".yaml") || f.endsWith(".yml")) && f.startsWith(prefix));
  const skills: SkillDoc[] = [];
  for (const file of allFiles) {
    try {
      const raw = readFileSync(resolve(corpusPath, file), "utf-8");
      const parsed = yaml.load(raw) as SkillDoc;
      if (parsed) skills.push(parsed);
    } catch {
      // skip invalid
    }
  }
  return skills;
}

function readIfExists(cwd: string, relPath: string): string | null {
  const full = resolve(cwd, relPath);
  try {
    if (existsSync(full)) return readFileSync(full, "utf-8");
  } catch {
    // ignore
  }
  return null;
}

/** Startup context every agent reads: company, AGENTS, own employee file, handoffs, memory, primary workspace file. */
function loadStartupContext(cwd: string, agentId: string): string {
  const agent = getAgentById(agentId);
  if (!agent) return "";
  const name = agent.name.toLowerCase();
  const parts: string[] = [];
  const company = readIfExists(cwd, "company.md");
  if (company) parts.push(company);
  const agentsMd = readIfExists(cwd, "AGENTS.md");
  if (agentsMd) parts.push(agentsMd);
  const emp = readIfExists(cwd, `employees/${name}.md`);
  if (emp) parts.push(emp);
  const handoffs = readIfExists(cwd, "handoffs.md");
  if (handoffs) parts.push(handoffs);
  const memory = readIfExists(cwd, `memory/${name}.md`);
  if (memory) parts.push(memory);
  const paths = getWorkspacePaths(cwd, agentId);
  if (agentId === "sdr" && paths.leadsPath && existsSync(paths.leadsPath)) {
    parts.push("### leads.md\n" + readFileSync(paths.leadsPath, "utf-8"));
  } else if (agentId === "pm" && paths.backlogPath && existsSync(paths.backlogPath)) {
    parts.push("### backlog.md\n" + readFileSync(paths.backlogPath, "utf-8"));
  }
  return parts.join("\n\n---\n\n");
}

function loadWorkspaceContext(cwd: string, agentId: string): string {
  const paths = getWorkspacePaths(cwd, agentId);
  const parts: string[] = [];
  if (paths.leadsPath && existsSync(paths.leadsPath)) {
    try {
      parts.push("### leads.md\n" + readFileSync(paths.leadsPath, "utf-8"));
    } catch {
      // skip
    }
  }
  if (paths.backlogPath && existsSync(paths.backlogPath)) {
    try {
      parts.push("### backlog.md\n" + readFileSync(paths.backlogPath, "utf-8"));
    } catch {
      // skip
    }
  }
  if (existsSync(paths.memoryPath)) {
    try {
      parts.push("### memory\n" + readFileSync(paths.memoryPath, "utf-8"));
    } catch {
      // skip
    }
  }
  return parts.join("\n\n");
}

const JORDAN_CAPABILITIES = `PROSPECTING:
- Read and parse leads.md on every session start (use read_file).
- Score each lead 1-10 against ICP: company size/stage, title (budget holder or influencer), stated need, timeline, no red flags.
- Prioritize leads by score, flag missing context, suggest leads to disqualify with reasoning.

OUTREACH DRAFTING:
- Draft 3-email sequences per lead (Email 1: pattern interrupt; 2: problem reframe; 3: math/social proof, soft CTA). Use write_file to save to drafts/pending/[company]-sequence.md.
- Draft LinkedIn connection messages (under 300 chars), cold call talk tracks with objection branches, follow-up emails from reply context.
- All drafts to drafts/pending/; never send without approval.

QUALIFICATION:
- Score inbound leads against ICP; write discovery call prep briefs; suggest PROCEED / DO NOT PROCEED / ESCALATE; flag disqualify with one-line reason.

PIPELINE HYGIENE:
- Update Status and Last Action in leads.md via update_leads. Move stages: not contacted → contacted → replied → qualified → disqualified → closed.
- Flag leads with no activity in 7+ days; give pipeline summary on request.

MEMORY: Use update_memory for tone feedback, what got replies, company context.`;

const JORDAN_RULES = `- Always read leads.md before any outreach (read_file).
- Save drafts to drafts/pending/ only; never send.
- Never fabricate lead information; if context missing, say so.
- Update leads.md status after every action (update_leads).
- Be an employee: focus on pipeline work; decline off-topic politely.`;

const ALEX_CAPABILITIES = `BACKLOG MANAGEMENT:
- Read backlog.md on every session start (read_file). Score by impact (High/Med/Low) and effort (S/M/L/XL); group related items; suggest cuts; add items from user description.
- Update status: not started → in progress → done → cut via update_backlog.

DOCUMENT WRITING:
- Write full PRDs from one-line brief: Problem, Goals, Non-goals, User stories, Success metrics, Open questions, Out of scope. Save to drafts/pending/prd-[feature].md.
- Write user stories, sprint review summaries, competitive analysis (drafts/pending/competitive-[name].md), executive roadmap updates.

PRIORITIZATION: MoSCoW on request; suggest quarterly roadmap; flag dependencies; write prioritization rationale.

SYNTHESIS: Turn feedback into backlog items; summarize sprint for stakeholders; executive update from roadmap state.

MEMORY: Use update_memory for PRDs written, decisions, what got cut, stakeholder preferences.`;

const ALEX_RULES = `- Always read backlog.md before planning (read_file).
- Save documents to drafts/pending/ only.
- Never make up research or metrics; flag assumptions.
- Update backlog.md status after every action (update_backlog).
- Be a PM: focus on product work; decline off-topic politely.`;

const BASELINE_SKILLS: Record<string, string> = {
  sdr: `You are Jordan, an AI SDR. ${JORDAN_CAPABILITIES}\n\n${JORDAN_RULES}`,
  pm: `You are Alex, an AI PM. ${ALEX_CAPABILITIES}\n\n${ALEX_RULES}`,
};

function buildSystemPrompt(cwd: string, agentId: string, workspaceName: string): string {
  const agent = getAgentById(agentId);
  if (!agent) return "";
  const startupContext = loadStartupContext(cwd, agentId);
  const skills = loadAgentCorpus(cwd, agentId);
  const workspaceContext = loadWorkspaceContext(cwd, agentId);
  const paths = getWorkspacePaths(cwd, agentId);
  let memoryBlock = "";
  if (existsSync(paths.memoryPath)) {
    try {
      memoryBlock = readFileSync(paths.memoryPath, "utf-8");
    } catch {
      // skip
    }
  }
  let skillsBlock: string;
  if (skills.length > 0) {
    skillsBlock = skills
      .map((s) => {
        const name = s.name ?? "Skill";
        const desc = s.description ?? "";
        const sys = s.system_prompt ?? "";
        const constraints = Array.isArray(s.constraints) ? s.constraints.join(", ") : (s.constraints ?? "");
        return `## ${name}\n${desc}\n\n${sys}\n\nConstraints: ${constraints}`;
      })
      .join("\n\n---\n\n");
  } else {
    skillsBlock = BASELINE_SKILLS[agentId] ?? "";
  }
  return `You are ${agent.name}, an AI ${agent.role} at ${workspaceName}.

--- 
STARTUP CONTEXT (read on every session):
${startupContext || "(No startup files yet.)"}

---
CORPUS / SKILLS:
${skillsBlock}

YOUR MEMORY:
${memoryBlock || "(No memory yet.)"}

YOUR WORKSPACE:
${workspaceContext || "(No workspace files loaded yet.)"}

Use read_file, write_file, update_leads/update_backlog, list_files, update_memory as needed. Stay focused on pipeline (Jordan) or product (Alex) work.

After using any tool (e.g. read_file on .md files): always send a clear response to the user. Summarize what you found, answer their question, or confirm what you did. Never end your turn immediately after a tool call without replying.`;
}

/** No longer used: draft creation is via write_file tool. Kept for compatibility. */
function parseWriteFileCommands(_fullText: string, _cwd: string, _agentId: string): string[] {
  return [];
}

/** Parse markdown table into header and rows (array of cell arrays). */
function parseMarkdownTable(content: string): { header: string[]; rows: string[][] } | null {
  const lines = content.split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\|.+\|\s*$/.test(lines[i]) && !/^[\s\-:|]+$/.test(lines[i].replace(/\|/g, "").trim())) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return null;
  const header = lines[headerIdx]
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
  const rows: string[][] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!/^\s*\|.+\|\s*$/.test(lines[i])) continue;
    if (/^[\s\-:|]+$/.test(lines[i].replace(/\|/g, "").trim())) continue;
    const cells = lines[i].split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length === header.length) rows.push(cells);
  }
  return { header, rows };
}

/** Serialize header + rows back to markdown table (no title). */
function serializeMarkdownTable(header: string[], rows: string[][]): string {
  const sep = "| " + header.map(() => "------").join(" | ") + " |";
  const headerLine = "| " + header.join(" | ") + " |";
  const rowLines = rows.map((r) => "| " + r.join(" | ") + " |");
  return headerLine + "\n" + sep + "\n" + rowLines.join("\n");
}

/** Update one cell in a markdown table file. Row matched by first column value (case-insensitive), column by header name. */
function updateTableCell(cwd: string, filePath: string, firstColValue: string, field: string, value: string): boolean {
  const full = resolve(cwd, filePath);
  if (!existsSync(full)) return false;
  const raw = readFileSync(full, "utf-8");
  const before = raw.match(/^[\s\S]*?(?=\n\|)/)?.[0] ?? ""; // title and any intro
  const tablePart = raw.slice(before.length);
  const parsed = parseMarkdownTable(tablePart);
  if (!parsed) return false;
  const { header, rows } = parsed;
  const colIdx = header.findIndex((h) => h.toLowerCase() === field.toLowerCase());
  if (colIdx < 0) return false;
  const rowIdx = rows.findIndex((r) => (r[0] ?? "").toLowerCase() === firstColValue.toLowerCase());
  if (rowIdx < 0) return false;
  rows[rowIdx][colIdx] = value;
  const newTable = serializeMarkdownTable(header, rows);
  writeFileSync(full, before + newTable, "utf-8");
  return true;
}

const READ_FILE_TOOL = {
  name: "read_file",
  description: "Read a file from the workspace.",
  input_schema: {
    type: "object" as const,
    properties: { path: { type: "string" as const, description: "Relative path e.g. leads.md, drafts/pending/acme.md" } },
    required: ["path"],
  },
};

const WRITE_FILE_TOOL = {
  name: "write_file",
  description: "Write content to a file. Use for drafts, updates, new documents. Saves to path; use drafts/pending/ for drafts.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "Relative path e.g. drafts/pending/acme-sequence.md" },
      content: { type: "string" as const, description: "Full file content" },
      description: { type: "string" as const, description: "One line summary for approval queue" },
    },
    required: ["path", "content", "description"],
  },
};

const UPDATE_LEADS_TOOL = {
  name: "update_leads",
  description: "Update a lead's status or field in leads.md. Use lead name (first column) to identify the row.",
  input_schema: {
    type: "object" as const,
    properties: {
      name: { type: "string" as const, description: "Lead name or company to identify the row" },
      field: { type: "string" as const, description: "Column name e.g. Status, Last Action" },
      value: { type: "string" as const, description: "New value" },
    },
    required: ["name", "field", "value"],
  },
};

const UPDATE_BACKLOG_TOOL = {
  name: "update_backlog",
  description: "Update a backlog item's status or field in backlog.md. Use item name (first column) to identify the row.",
  input_schema: {
    type: "object" as const,
    properties: {
      item: { type: "string" as const, description: "Item name to identify the row" },
      field: { type: "string" as const, description: "Column name e.g. Status, Priority" },
      value: { type: "string" as const, description: "New value" },
    },
    required: ["item", "field", "value"],
  },
};

const LIST_FILES_TOOL = {
  name: "list_files",
  description: "List files in a directory.",
  input_schema: {
    type: "object" as const,
    properties: { dir: { type: "string" as const, description: "Relative path e.g. drafts/pending" } },
    required: ["dir"],
  },
};

const UPDATE_MEMORY_TOOL = {
  name: "update_memory",
  description: "Save something important to remember for future sessions.",
  input_schema: {
    type: "object" as const,
    properties: { content: { type: "string" as const, description: "What to remember, one clear sentence" } },
    required: ["content"],
  },
};

const WRITE_HANDOFF_TOOL = {
  name: "write_handoff",
  description: "Create a handoff to another agent. They will see it on startup and can action it.",
  input_schema: {
    type: "object" as const,
    properties: {
      to: { type: "string" as const, description: "Agent name to hand off to, e.g. Alex or Jordan" },
      type: { type: "string" as const, description: "Handoff type: onboarding, feedback, escalation, or task" },
      context: { type: "string" as const, description: "Context or message for the recipient" },
      action: { type: "string" as const, description: "What the recipient should do" },
    },
    required: ["to", "type", "context", "action"],
  },
};

const ANTHROPIC_TOOLS_SDR = [READ_FILE_TOOL, WRITE_FILE_TOOL, UPDATE_LEADS_TOOL, LIST_FILES_TOOL, UPDATE_MEMORY_TOOL, WRITE_HANDOFF_TOOL];
const ANTHROPIC_TOOLS_PM = [READ_FILE_TOOL, WRITE_FILE_TOOL, UPDATE_BACKLOG_TOOL, LIST_FILES_TOOL, UPDATE_MEMORY_TOOL, WRITE_HANDOFF_TOOL];

function getAnthropicToolsForAgent(agentId: string): readonly AnthropicTool[] {
  return agentId === "pm" ? ANTHROPIC_TOOLS_PM : ANTHROPIC_TOOLS_SDR;
}

export type ToolResult = {
  result: string;
  preview: string;
  fileCreated?: { path: string; description: string };
  fileUpdated?: string;
  memoryUpdated?: boolean;
};

function executeTool(cwd: string, agentId: string, name: string, input: unknown): ToolResult {
  const preview = (r: string) => r.substring(0, 100);
  try {
    if (name === "read_file") {
      const pathArg = (input as { path?: string })?.path;
      if (typeof pathArg !== "string") return { result: "Missing path.", preview: "read_file" };
      const safe = safePath(pathArg);
      const full = join(cwd, safe);
      const content = readFileSync(full, "utf-8");
      return { result: content, preview: "read " + safe };
    }
    if (name === "write_file") {
      const obj = input as { path?: string; content?: string; description?: string };
      const pathArg = typeof obj?.path === "string" ? obj.path : "draft.md";
      const content = typeof obj?.content === "string" ? obj.content : "";
      const description = typeof obj?.description === "string" ? obj.description : pathArg;
      const safe = safePath(pathArg);
      const full = join(cwd, safe);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf-8");
      const result = `Written to ${safe}`;
      const out: ToolResult = { result, preview: "write " + safe };
      if (safe.includes("drafts/pending")) out.fileCreated = { path: safe, description };
      return out;
    }
    if (name === "update_leads" && agentId === "sdr") {
      const obj = input as { name?: string; field?: string; value?: string };
      const nameVal = typeof obj?.name === "string" ? obj.name : "";
      const field = typeof obj?.field === "string" ? obj.field : "";
      const value = typeof obj?.value === "string" ? obj.value : "";
      if (!nameVal || !field) return { result: "Missing name or field.", preview: "update_leads" };
      const ok = updateTableCell(cwd, "leads.md", nameVal, field, value);
      const result = ok ? `Updated leads.md: ${nameVal} → ${field}: ${value}` : "Lead not found or column invalid.";
      return { result, preview: result.substring(0, 80), fileUpdated: ok ? "leads.md" : undefined };
    }
    if (name === "update_backlog" && agentId === "pm") {
      const obj = input as { item?: string; field?: string; value?: string };
      const item = typeof obj?.item === "string" ? obj.item : "";
      const field = typeof obj?.field === "string" ? obj.field : "";
      const value = typeof obj?.value === "string" ? obj.value : "";
      if (!item || !field) return { result: "Missing item or field.", preview: "update_backlog" };
      const ok = updateTableCell(cwd, "backlog.md", item, field, value);
      const result = ok ? `Updated backlog.md: ${item} → ${field}: ${value}` : "Item not found or column invalid.";
      return { result, preview: result.substring(0, 80), fileUpdated: ok ? "backlog.md" : undefined };
    }
    if (name === "list_files") {
      const dirArg = (input as { dir?: string })?.dir;
      if (typeof dirArg !== "string") return { result: "Missing dir.", preview: "list_files" };
      const safe = safePath(dirArg);
      const full = join(cwd, safe);
      const entries = readdirSync(full, { withFileTypes: true });
      const names = entries.map((e) => e.name).join("\n");
      return { result: names || "(empty)", preview: "list " + safe };
    }
    if (name === "update_memory") {
      const obj = input as { content?: string };
      const content = typeof obj?.content === "string" ? obj.content.trim() : "";
      if (!content) return { result: "No content to save.", preview: "memory", memoryUpdated: false };
      const paths = getWorkspacePaths(cwd, agentId);
      const dateStr = new Date().toISOString().split("T")[0];
      mkdirSync(dirname(paths.memoryPath), { recursive: true });
      appendFileSync(paths.memoryPath, `\n- ${dateStr}: ${content}`, "utf-8");
      return { result: "Saved to memory.", preview: "memory updated", memoryUpdated: true };
    }
    if (name === "write_handoff") {
      const obj = input as { to?: string; type?: string; context?: string; action?: string };
      const to = typeof obj?.to === "string" ? obj.to.trim() : "";
      const type = typeof obj?.type === "string" ? obj.type.trim() : "task";
      const context = typeof obj?.context === "string" ? obj.context.trim() : "";
      const action = typeof obj?.action === "string" ? obj.action.trim() : "";
      if (!to || !context) return { result: "Missing to or context.", preview: "write_handoff" };
      const agent = getAgentById(agentId);
      const fromName = agent?.name ?? "Agent";
      const handoffsPath = resolve(cwd, "handoffs.md");
      const ts = new Date().toISOString();
      const block = `

---
## ${ts} ${fromName} → ${to}
Type: ${type}
Priority: Med
Status: pending

${fromName} says:
${context}

Action needed:
${action}
---
`;
      appendFileSync(handoffsPath, block, "utf-8");
      return { result: `Handoff to ${to} recorded.`, preview: "handoff written" };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Access denied";
    return { result: msg, preview: name + " failed" };
  }
  return { result: "Unknown tool.", preview: "unknown" };
}

type ToolCall = { id: string; name: string; input: unknown };

type AnthropicTool = { name: string; description: string; input_schema: object };

function callAnthropicStreaming(
  apiKey: string,
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string | { type: string; text?: string; id?: string; name?: string; input?: unknown }[] }[],
  onToken: (token: string) => void,
  onDone: (fullText: string, toolCalls?: ToolCall[]) => void,
  onError: (message: string) => void,
  tools: readonly AnthropicTool[]
): void {
  const body = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    stream: true,
    system: systemPrompt,
    messages,
    tools,
    tool_choice: { type: "auto" as const },
  });
  const req = https.request(
    {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
      },
    },
    (res) => {
      let buffer = "";
      let fullText = "";
      const toolCalls: ToolCall[] = [];
      let currentTool: { id: string; name: string; inputJson: string } | null = null;
      let errBody = "";
      res.on("data", (chunk: Buffer) => {
        const str = chunk.toString("utf-8");
        if (res.statusCode !== 200) {
          errBody += str;
          return;
        }
        buffer += str;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6);
          if (jsonStr === "[DONE]" || jsonStr.trim() === "") continue;
          try {
            const data = JSON.parse(jsonStr) as {
              type?: string;
              delta?: { type?: string; text?: string; partial_json?: string };
              content_block?: { type?: string; id?: string; name?: string };
            };
            const toolBlock = data.type === "content_block_start" && data.content_block?.type === "tool_use" ? data.content_block : null;
            if (toolBlock && toolBlock.id && toolBlock.name) {
              currentTool = { id: toolBlock.id, name: toolBlock.name, inputJson: "" };
            } else if (data.type === "content_block_delta" && data.delta) {
              if (data.delta.type === "text_delta" && typeof data.delta.text === "string") {
                fullText += data.delta.text;
                onToken(data.delta.text);
              } else if (data.delta.type === "input_json_delta" && typeof data.delta.partial_json === "string" && currentTool) {
                currentTool.inputJson += data.delta.partial_json;
              }
            } else if (data.type === "content_block_stop" && currentTool) {
              try {
                const input = currentTool.inputJson ? (JSON.parse(currentTool.inputJson) as unknown) : {};
                toolCalls.push({ id: currentTool.id, name: currentTool.name, input });
              } catch {
                // skip
              }
              currentTool = null;
            }
          } catch {
            // skip
          }
        }
      });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          try {
            const j = JSON.parse(errBody) as { error?: { message?: string } };
            onError((j?.error?.message ?? errBody) || `HTTP ${res.statusCode}`);
          } catch {
            onError(errBody || `HTTP ${res.statusCode}`);
          }
          return;
        }
        if (buffer.startsWith("data: ")) {
          try {
            const data = JSON.parse(buffer.slice(6)) as { delta?: { text?: string; partial_json?: string }; content_block?: { type?: string; id?: string; name?: string } };
            if (data.delta?.text) {
              fullText += data.delta.text;
              onToken(data.delta.text);
            }
            const toolBlock = data.content_block?.type === "tool_use" ? data.content_block : null;
            if (toolBlock && toolBlock.id && toolBlock.name && !currentTool) {
              currentTool = { id: toolBlock.id, name: toolBlock.name, inputJson: "" };
            }
          } catch {
            // skip
          }
        }
        if (currentTool) {
          try {
            const input = currentTool.inputJson ? (JSON.parse(currentTool.inputJson) as unknown) : {};
            toolCalls.push({ id: currentTool.id, name: currentTool.name, input });
          } catch {
            // skip
          }
        }
        onDone(fullText, toolCalls.length ? toolCalls : undefined);
      });
      res.on("error", (err) => onError(err.message));
    }
  );
  req.on("error", (err) => onError(err.message));
  req.write(body);
  req.end();
}

function toOpenAITool(t: { name: string; description: string; input_schema: object }): { type: "function"; function: { name: string; description: string; parameters: object } } {
  return { type: "function" as const, function: { name: t.name, description: t.description, parameters: t.input_schema } };
}
const OPENAI_TOOLS_SDR = ANTHROPIC_TOOLS_SDR.map(toOpenAITool);
const OPENAI_TOOLS_PM = ANTHROPIC_TOOLS_PM.map(toOpenAITool);
function getOpenAIToolsForAgent(agentId: string): readonly { type: "function"; function: { name: string; description: string; parameters: object } }[] {
  return agentId === "pm" ? OPENAI_TOOLS_PM : OPENAI_TOOLS_SDR;
}

function callOpenAIStreaming(
  apiKey: string,
  systemPrompt: string,
  messages: { role: "user" | "assistant"; content: string | { type: string; text?: string; id?: string; name?: string; input?: unknown }[] }[],
  onToken: (token: string) => void,
  onDone: (fullText: string, toolCalls?: ToolCall[]) => void,
  onError: (message: string) => void,
  openAITools: readonly { type: "function"; function: { name: string; description: string; parameters: object } }[]
): void {
  const openAIMessages: { role: "system" | "user" | "assistant" | "tool"; content?: string; tool_calls?: unknown[]; tool_call_id?: string }[] = [{ role: "system", content: systemPrompt }];
  for (const m of messages) {
    if (typeof m.content === "string") {
      openAIMessages.push({ role: m.role as "user" | "assistant", content: m.content });
    } else if (Array.isArray(m.content)) {
      const textParts = m.content.filter((b) => b.type === "text").map((b) => (b as { text?: string }).text).filter(Boolean).join("");
      const toolUse = m.content.filter((b) => b.type === "tool_use") as { id: string; name: string; input?: unknown }[];
      const toolResult = m.content.filter((b) => b.type === "tool_result") as unknown as { tool_use_id: string; content: string }[];
      if (m.role === "assistant" && (textParts || toolUse.length)) {
        openAIMessages.push({
          role: "assistant",
          content: textParts || "",
          tool_calls: toolUse.length ? toolUse.map((t) => ({ id: t.id, type: "function" as const, function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) } })) : undefined,
        });
      }
      for (const tr of toolResult) {
        openAIMessages.push({ role: "tool", tool_call_id: tr.tool_use_id, content: tr.content });
      }
    }
  }
  const body = JSON.stringify({
    model: "gpt-4o",
    max_tokens: 4096,
    stream: true,
    messages: openAIMessages,
    tools: openAITools,
  });
  const req = https.request(
    {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    },
    (res) => {
      let buffer = "";
      let fullText = "";
      const toolCallsByIndex: Map<number, { id: string; name: string; args: string }> = new Map();
      let errBody = "";
      res.on("data", (chunk: Buffer) => {
        const str = chunk.toString("utf-8");
        if (res.statusCode !== 200) {
          errBody += str;
          return;
        }
        buffer += str;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]" || jsonStr === "") continue;
          try {
            const data = JSON.parse(jsonStr) as {
              choices?: Array<{
                delta?: {
                  content?: string;
                  tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
                };
              }>;
            };
            const delta = data.choices?.[0]?.delta;
            if (delta?.content) {
              fullText += delta.content;
              onToken(delta.content);
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                let cur = toolCallsByIndex.get(idx);
                if (!cur && tc.id) {
                  cur = { id: tc.id, name: tc.function?.name ?? "", args: "" };
                  toolCallsByIndex.set(idx, cur);
                }
                if (cur && typeof tc.function?.arguments === "string") cur.args += tc.function.arguments;
              }
            }
          } catch {
            // skip
          }
        }
      });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          try {
            const j = JSON.parse(errBody) as { error?: { message?: string } };
            onError((j?.error?.message ?? errBody) || `HTTP ${res.statusCode}`);
          } catch {
            onError(errBody || `HTTP ${res.statusCode}`);
          }
          return;
        }
        if (buffer.startsWith("data: ")) {
          const jsonStr = buffer.slice(6).trim();
          if (jsonStr !== "[DONE]" && jsonStr !== "") {
            try {
              const data = JSON.parse(jsonStr) as { choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }> };
              const delta = data.choices?.[0]?.delta;
              if (delta?.content) {
                fullText += delta.content;
                onToken(delta.content);
              }
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  let cur = toolCallsByIndex.get(idx);
                  if (!cur && tc.id) {
                    cur = { id: tc.id, name: tc.function?.name ?? "", args: "" };
                    toolCallsByIndex.set(idx, cur);
                  }
                  if (cur && typeof tc.function?.arguments === "string") cur.args += tc.function.arguments;
                }
              }
            } catch {
              // skip
            }
          }
        }
        const toolCalls: ToolCall[] = [];
        for (let i = 0; i < toolCallsByIndex.size; i++) {
          const cur = toolCallsByIndex.get(i);
          if (cur?.id && cur.name) {
            try {
              const input = cur.args ? (JSON.parse(cur.args) as unknown) : {};
              toolCalls.push({ id: cur.id, name: cur.name, input });
            } catch {
              // skip
            }
          }
        }
        onDone(fullText, toolCalls.length ? toolCalls : undefined);
      });
      res.on("error", (err) => onError(err.message));
    }
  );
  req.on("error", (err) => onError(err.message));
  req.write(body);
  req.end();
}

/** New stack: server.js (backend) + Vite (frontend). Single command. */
async function runStudioLauncher(): Promise<number> {
  const cwd = process.cwd();
  const serverPath = resolve(cwd, "server.js");
  const viteConfigPath = resolve(cwd, "vite.config.js");
  if (!existsSync(serverPath)) {
    console.error("  server.js not found in current directory. Run from the project that has server.js (agent project).");
    return 1;
  }
  showBanner();
  const serverChild = spawn(process.execPath, [serverPath], {
    cwd,
    stdio: "ignore",
    env: process.env,
  });
  serverChild.on("error", (err) => {
    console.error("  Backend failed to start:", err.message);
  });
  await new Promise<void>((r) => setTimeout(r, 800));
  if (serverChild.exitCode != null && serverChild.exitCode !== 0) {
    return serverChild.exitCode;
  }
  const viteChild = spawn("npx", ["vite"], {
    cwd,
    stdio: "inherit",
    env: process.env,
    shell: true,
  });
  const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const { exec } = await import("node:child_process");
  exec(openCmd + " http://localhost:5173", () => {});
  console.log("");
  console.log("  Backend → http://localhost:8787");
  console.log("  Studio  → http://localhost:5173");
  console.log("  Ctrl+C to stop both.");
  console.log("");
  return new Promise<number>(() => {
    viteChild.on("exit", (code, signal) => {
      try {
        serverChild.kill(signal ?? "SIGTERM");
      } catch {
        // ignore
      }
      process.exit(code != null ? code : 0);
    });
  });
}

export async function runStudio(): Promise<number> {
  const cwd = process.cwd();
  if (existsSync(resolve(cwd, "server.js")) && existsSync(resolve(cwd, "vite.config.js"))) {
    return runStudioLauncher();
  }
  showBanner();
  ensureGitignore(cwd);
  migrateWorkspaceToProjectRoot(cwd);
  const config = readConfig(cwd);
  const workspaceName = config?.workspace_name ?? "—";
  const skillCount = listSkills(cwd).length;

  const clients: WsClient[] = [];
  let shell: ChildProcess | null = null;
  let wsBuffer = Buffer.alloc(0);

  function broadcast(obj: object) {
    const s = JSON.stringify(obj);
    clients.forEach((c) => {
      try {
        c.send(s);
      } catch {
        // drop dead client
      }
    });
  }

  function spawnShell() {
    if (shell) {
      try {
        shell.kill();
      } catch {
        // ignore
      }
      shell = null;
    }
    shell = spawn("sh", [], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    shell.stdout?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      process.stdout.write(s);
      broadcast({ type: "stdout", data: s });
    });
    shell.stderr?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      process.stderr.write(s);
      broadcast({ type: "stderr", data: s });
    });
    shell.on("exit", (code) => {
      broadcast({ type: "shell:exit", code: code ?? undefined });
      setTimeout(spawnShell, 1000);
    });
  }

  function broadcastDraftCounts() {
    const pending = countDrafts(cwd, "pending");
    const approved = countDrafts(cwd, "approved");
    broadcast({ type: "draft:counts", pending, approved });
  }

  function broadcastHandoffCounts() {
    const { total, byAgent } = parseHandoffsPending(cwd);
    broadcast({ type: "handoff:counts", total, byAgent });
  }

  const pendingDir = resolve(cwd, "drafts", "pending");
  const approvedDir = resolve(cwd, "drafts", "approved");
  if (existsSync(resolve(cwd, "drafts"))) {
    if (existsSync(pendingDir)) {
      try {
        watch(pendingDir, { recursive: false }, () => broadcastDraftCounts());
      } catch {
        // ignore
      }
    }
    if (existsSync(approvedDir)) {
      try {
        watch(approvedDir, { recursive: false }, () => broadcastDraftCounts());
      } catch {
        // ignore
      }
    }
  }
  const handoffsPath = resolve(cwd, "handoffs.md");
  if (existsSync(handoffsPath)) {
    try {
      watch(handoffsPath, () => broadcastHandoffCounts());
    } catch {
      // ignore
    }
  }

  const FAVICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#000"/><text x="16" y="22" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">[b]</text></svg>';

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url?.split("?")[0] ?? "";
    if (url === "/favicon.ico" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      res.end(FAVICON_SVG);
      return;
    }
    if (url === "/" && req.method === "GET") {
      const creds = getCredentials();
      const loggedIn = !!creds;
      const studioUrl = `http://${HOST}:${PORT}`;
      const html = getDashboardHtml(workspaceName, skillCount, loggedIn, creds?.user_email ?? null, studioUrl);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on("upgrade", (req: IncomingMessage, socket: SocketLike, head: Buffer) => {
    const client = acceptWebSocket(req, socket, head);
    if (!client) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy?.();
      return;
    }
    clients.push(client);
    client.send(JSON.stringify({ type: "banner", data: getBannerText() }));
    client.send(JSON.stringify({ type: "skill:list", data: listSkills(cwd) }));

    socket.on("data", (chunk: Buffer) => {
      wsBuffer = Buffer.concat([wsBuffer, chunk]);
      for (;;) {
        const result = parseWsFrame(wsBuffer);
        if (!result) break;
        wsBuffer = wsBuffer.subarray(result.consumed);
        if (result.opcode === 0x08) {
          const idx = clients.indexOf(client);
          if (idx !== -1) clients.splice(idx, 1);
          socket.destroy?.();
          return;
        }
        if (result.opcode !== 0x01) continue;
        const raw = result.payload.toString("utf8");
        try {
          const msg = JSON.parse(raw) as {
            type: string;
            id?: string;
            path?: string;
            content?: string;
            data?: string;
          };
          if (msg.type === "skill:list") {
            client.send(JSON.stringify({ type: "skill:list", data: listSkills(cwd) }));
          } else if (msg.type === "skill:get" && msg.id) {
            client.send(JSON.stringify({ type: "skill:get", data: getSkill(cwd, msg.id) }));
          } else if (msg.type === "stdin" && typeof msg.data === "string" && shell?.stdin) {
            shell.stdin.write(msg.data + "\n");
            process.stdout.write(msg.data + "\n");
          } else if (msg.type === "config:set") {
            const payload = msg as unknown as { anthropic_api_key?: string; openai_api_key?: string; preferred_provider?: PreferredProvider };
            const updates: Partial<StudioCredentials> = {};
            if (typeof payload.anthropic_api_key === "string") updates.anthropic_api_key = payload.anthropic_api_key;
            if (typeof payload.openai_api_key === "string") updates.openai_api_key = payload.openai_api_key;
            if (payload.preferred_provider === "anthropic" || payload.preferred_provider === "openai") updates.preferred_provider = payload.preferred_provider;
            if (Object.keys(updates).length > 0) saveStudioCredentials(updates);
            client.send(JSON.stringify({ type: "config:saved" }));
          }
        } catch {
          // ignore
        }
      }
    });

    socket.on("close", () => {
      const idx = clients.indexOf(client);
      if (idx !== -1) clients.splice(idx, 1);
    });
  });

  server.listen(PORT, HOST, () => {
    console.log("");
    console.log("  bundl studio running at http://localhost:" + PORT);
    console.log("  Terminal mirroring active — all output visible here and in browser");
    console.log("");
  });

  spawnShell();

  const openCmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  const { exec } = await import("node:child_process");
  exec(openCmd + " http://" + HOST + ":" + PORT, () => {});

  process.on("SIGINT", () => {
    if (shell) {
      try {
        shell.kill();
      } catch {
        // ignore
      }
    }
    server.close();
    process.exit(0);
  });

  return 0;
}
