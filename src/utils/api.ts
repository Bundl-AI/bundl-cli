/**
 * Bundl API client. All requests go to Next.js API routes.
 * Uses getValidToken() for auth. No direct Supabase.
 */

import axios from "axios";
import { getValidToken, clearCredentials } from "./auth.js";
import { BUNDL_API_URL } from "./config.js";

/** Legacy axios instance for providers; uses token via interceptor. */
export const api = axios.create({
  baseURL: BUNDL_API_URL.replace(/\/$/, ""),
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
});
api.interceptors.request.use(async (config) => {
  const token = await getValidToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(
  (r) => r,
  (err) => Promise.reject(err)
);

export type WorkspacePlan = "free" | "starter" | "team";

export type Workspace = {
  id: string;
  name: string;
  plan?: WorkspacePlan;
};

export type CompanyPrompt = {
  id: string;
  slug?: string;
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  system_prompt?: string;
  user_prompt?: string;
  example_output?: string;
  agent_config?: Record<string, unknown>;
  updated_at?: string;
  created_at?: string;
};

export type WorkspacePromptsResponse = {
  companyPrompts: CompanyPrompt[];
  directoryItems?: unknown[];
};

export type PromptPayload = {
  title: string;
  description: string;
  category: string;
  tags: string[];
  system_prompt: string;
  user_prompt: string;
  example_output: string;
  library_status: "private" | "public";
  is_bundl_skill: true;
  agent_config: Record<string, unknown>;
};

async function apiRequest<T>(method: string, path: string, body?: object): Promise<T> {
  const token = await getValidToken();
  if (!token) throw new Error("Not authenticated. Run bundl login first.");

  const url = path.startsWith("http") ? path : `${BUNDL_API_URL.replace(/\/$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Do not clear credentials on 401 here. Backend may return 401 for other reasons
  // (e.g. token format not accepted). Clearing caused instant logout after whoami.
  // Only getValidToken() clears when refresh fails (expired refresh_token).
  if (res.status === 401) {
    throw new Error("Session expired. Run bundl login again.");
  }
  if (res.status === 402) {
    const e = new Error("Billing error. Visit bundl.ai/company to upgrade.") as Error & {
      status: number;
    };
    e.status = 402;
    throw e;
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type CheckoutSessionParams = {
  workspaceId: string;
  plan: "starter" | "team";
  interval: "monthly" | "yearly";
  seats?: number;
};

export async function createCheckoutSession(
  workspaceId: string,
  plan: "starter" | "team",
  interval: "monthly" | "yearly",
  seats?: number
): Promise<{ url: string }> {
  const token = await getValidToken();
  if (!token) throw new Error("Not authenticated. Run bundl login first.");

  const url = `${BUNDL_API_URL.replace(/\/$/, "")}/api/billing/checkout`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspaceId, plan, interval, seats }),
  });

  if (res.status === 401) {
    clearCredentials();
    throw new Error("Session expired. Run bundl login again.");
  }
  if (res.status === 402) {
    throw new Error("Billing error. Visit bundl.ai/company to upgrade.");
  }
  if (!res.ok) {
    throw new Error("Could not create checkout session. Try bundl.ai/company");
  }
  return res.json() as Promise<{ url: string }>;
}

export async function createPortalSession(): Promise<{ url: string }> {
  const token = await getValidToken();
  if (!token) throw new Error("Not authenticated. Run bundl login first.");

  const url = `${BUNDL_API_URL.replace(/\/$/, "")}/api/billing/portal`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (res.status === 401) {
    clearCredentials();
    throw new Error("Session expired. Run bundl login again.");
  }
  if (res.status === 402) {
    throw new Error("Billing error. Visit bundl.ai/company to upgrade.");
  }
  if (!res.ok) {
    throw new Error("Could not open management portal. Try bundl.ai/company");
  }
  return res.json() as Promise<{ url: string }>;
}

export async function getMyWorkspace(): Promise<Workspace> {
  const data = await apiRequest<{ workspaces?: Workspace[] } | Workspace[]>(
    "GET",
    "/api/workspaces/me?primary=true"
  );
  const list = Array.isArray(data) ? data : (data as { workspaces?: Workspace[] }).workspaces ?? [];
  const first = list[0];
  if (!first?.id) {
    throw new Error("No workspace found. Make sure you have a Bundl account at bundl.ai");
  }
  return first as Workspace;
}

export async function getWorkspacePrompts(
  workspaceId: string
): Promise<WorkspacePromptsResponse> {
  return apiRequest<WorkspacePromptsResponse>(
    "GET",
    `/api/workspaces/${workspaceId}/prompts`
  );
}

export async function createWorkspacePrompt(
  workspaceId: string,
  prompt: PromptPayload
): Promise<CompanyPrompt> {
  return apiRequest<CompanyPrompt>(
    "POST",
    `/api/workspaces/${workspaceId}/prompts`,
    prompt
  );
}

export async function updateWorkspacePrompt(
  workspaceId: string,
  promptId: string,
  prompt: PromptPayload
): Promise<CompanyPrompt> {
  return apiRequest<CompanyPrompt>(
    "PUT",
    `/api/workspaces/${workspaceId}/prompts/${promptId}`,
    prompt
  );
}
