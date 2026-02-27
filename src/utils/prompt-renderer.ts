import type { CorpusInputs, InputField } from "../schema/corpus.js";

/** Rendered user_prompt template format for API storage. */
const TEMPLATE_HEADER =
  "Execute this workflow with the following context:\n\n";

export function renderUserPromptTemplate(inputs: CorpusInputs): string {
  const lines: string[] = [TEMPLATE_HEADER];

  for (const i of inputs.required ?? []) {
    const label = i.source?.human ?? i.name;
    lines.push(`${label}: {{${i.name}}}`);
  }
  if ((inputs.required ?? []).length > 0) lines.push("");

  for (const i of inputs.optional ?? []) {
    const label = i.source?.human ?? i.name;
    lines.push(`${label}: {{${i.name}}} (optional)`);
  }

  return lines.join("\n").trim();
}

const OPTIONAL_SUFFIX = " (optional)";
const VAR_REGEX = /\{\{(\w+)\}\}/g;

/**
 * Parse a user_prompt template back into required/optional inputs.
 * Used during bundl pull to reconstruct the inputs schema from API.
 */
export function parseUserPromptToInputs(userPrompt: string): CorpusInputs {
  const required: InputField[] = [];
  const optional: InputField[] = [];

  const raw = (userPrompt || "").replace(TEMPLATE_HEADER, "").trim();
  const lines = raw.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    const isOptional = line.endsWith(OPTIONAL_SUFFIX);
    const text = isOptional ? line.slice(0, -OPTIONAL_SUFFIX.length).trim() : line.trim();
    const colon = text.indexOf(":");
    const label = colon >= 0 ? text.slice(0, colon).trim() : text;
    const rest = colon >= 0 ? text.slice(colon + 1).trim() : "";
    const match = rest.match(VAR_REGEX);
    const name = match ? match[0].slice(2, -2) : label.toLowerCase().replace(/\s+/g, "_");

    const field: InputField = {
      name,
      description: label,
      example: "",
      source: { agent: name, human: label },
    };
    if (isOptional) {
      field.fallback = "Not provided";
      optional.push(field);
    } else {
      required.push(field);
    }
  }

  return { required, optional };
}
