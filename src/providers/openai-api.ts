/**
 * OpenAI API provider.
 */

import { api } from "../utils/api.js";

export const name = "openai-api";

export async function healthCheck(): Promise<boolean> {
  // TODO: validate API key and optional ping
  return true;
}

export function getClient() {
  return api;
}
