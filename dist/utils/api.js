/**
 * Bundl API client. All requests to bundl.ai only.
 * Never include AI provider keys in any request to bundl.ai.
 * Corpus content (YAML text) is the only sensitive data sent to bundl.ai.
 */
import axios from "axios";
import { getCredentials } from "./auth.js";
const BASE_URL = "https://bundl.ai/api/v1";
/** Shared HTTP client (no baseURL). Do not send AI provider keys to bundl.ai. */
export const api = axios.create({
    timeout: 30_000,
    headers: { "Content-Type": "application/json" },
});
function getAuthHeaders() {
    const creds = getCredentials();
    if (!creds?.api_key)
        return {};
    return { Authorization: `Bearer ${creds.api_key}` };
}
function handleApiError(err) {
    if (axios.isAxiosError(err)) {
        const e = err;
        const status = e.response?.status;
        const msg = e.response?.data?.message ?? e.message;
        if (status === 401)
            throw new Error("Credentials expired. Please re-authenticate.");
        if (status === 403)
            throw new Error("No access to this workspace.");
        if (status === 429)
            throw new Error("Rate limited. Please retry later.");
    }
    if (err instanceof Error) {
        if (err.message.includes("ECONNREFUSED") || err.message.includes("ENOTFOUND") || err.message.includes("network")) {
            throw new Error("Network error. Check your connection and try again.");
        }
        throw err;
    }
    throw new Error("Request failed. Check your connection and try again.");
}
export async function syncCorpus(workspaceId, files) {
    try {
        const { data } = await axios.post(`${BASE_URL}/workspaces/${workspaceId}/corpus/sync`, { files }, { headers: { ...getAuthHeaders(), "Content-Type": "application/json" }, timeout: 30_000 });
        return data;
    }
    catch (err) {
        handleApiError(err);
    }
}
export async function getWorkspaceStatus(workspaceId) {
    try {
        const { data } = await axios.get(`${BASE_URL}/workspaces/${workspaceId}/status`, { headers: getAuthHeaders(), timeout: 10_000 });
        return data;
    }
    catch (err) {
        handleApiError(err);
    }
}
export async function pollAuthStatus(state) {
    try {
        const { data } = await axios.get(`${BASE_URL}/auth/status`, { params: { state }, headers: getAuthHeaders(), timeout: 10_000 });
        return data;
    }
    catch (err) {
        handleApiError(err);
    }
}
//# sourceMappingURL=api.js.map