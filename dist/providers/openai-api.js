/**
 * OpenAI API provider.
 */
import { api } from "../utils/api.js";
export const name = "openai-api";
export async function healthCheck() {
    // TODO: validate API key and optional ping
    return true;
}
export function getClient() {
    return api;
}
//# sourceMappingURL=openai-api.js.map