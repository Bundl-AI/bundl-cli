/**
 * Claude Code provider (local / IDE integration).
 */

export const name = "claude-code";

export async function healthCheck(): Promise<boolean> {
  // TODO: check Claude Code availability
  return true;
}
