/**
 * Bundl workspace credentials only. AI provider keys are NEVER stored here.
 * Credentials are ONLY used for requests to bundl.ai endpoints.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
const BUNDL_DIR = resolve(homedir(), ".bundl");
const CREDENTIALS_FILE = resolve(BUNDL_DIR, "credentials");
export function getCredentials() {
    try {
        if (!existsSync(CREDENTIALS_FILE))
            return null;
        const raw = readFileSync(CREDENTIALS_FILE, "utf-8");
        const data = JSON.parse(raw);
        if (!data.api_key || !data.workspace_id)
            return null;
        return data;
    }
    catch {
        return null;
    }
}
export function saveCredentials(data) {
    mkdirSync(BUNDL_DIR, { recursive: true });
    writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2), "utf-8");
    try {
        chmodSync(CREDENTIALS_FILE, 0o600);
    }
    catch {
        // ignore on platforms where chmod fails
    }
}
export function clearCredentials() {
    try {
        if (existsSync(CREDENTIALS_FILE)) {
            writeFileSync(CREDENTIALS_FILE, "{}", "utf-8");
        }
    }
    catch {
        // ignore
    }
}
export function isAuthenticated() {
    return getCredentials() !== null;
}
//# sourceMappingURL=auth.js.map