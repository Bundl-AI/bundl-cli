import { z } from "zod";

/** Source of an input (agent-provided or human-provided identifier). */
export const InputFieldSourceSchema = z.object({
  agent: z.string(),
  human: z.string(),
});

/** Single input field: name, description, example, source; optional inputs may have fallback. */
export const InputFieldSchema = z.object({
  name: z.string(),
  description: z.string(),
  example: z.string(),
  source: InputFieldSourceSchema,
  fallback: z.string().optional(),
});

/** Inputs: required and optional arrays of InputField (optional may have fallback). */
export const CorpusInputsSchema = z.object({
  required: z.array(InputFieldSchema),
  optional: z.array(InputFieldSchema),
});

export const CorpusTypeSchema = z.enum(["workflow", "document", "constraint"]);
export const CorpusLoadSchema = z.enum(["always", "on-demand"]);

/** Handoff: conditions, escalate_to, handoff_message. */
export const HandoffSchema = z.object({
  conditions: z.array(z.string()),
  escalate_to: z.string(),
  handoff_message: z.string(),
});

/** Surfaces: human and agent visibility. */
export const SurfacesSchema = z.object({
  human: z.boolean(),
  agent: z.boolean(),
});

/** Bundl corpus schema: full definition for an agent corpus entry. */
export const CorpusSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  category: z.string(),
  version: z.string(),
  type: CorpusTypeSchema,
  load: CorpusLoadSchema,
  trigger_description: z.string(),
  inputs: CorpusInputsSchema,
  system_prompt: z.string(),
  example_output: z.string(),
  tools: z.array(z.string()),
  constraints: z.array(z.string()),
  handoff: HandoffSchema,
  success_criteria: z.array(z.string()),
  surfaces: SurfacesSchema,
});

// TypeScript types inferred from zod schemas
export type InputFieldSource = z.infer<typeof InputFieldSourceSchema>;
export type InputField = z.infer<typeof InputFieldSchema>;
export type CorpusInputs = z.infer<typeof CorpusInputsSchema>;
export type CorpusType = z.infer<typeof CorpusTypeSchema>;
export type CorpusLoad = z.infer<typeof CorpusLoadSchema>;
export type Handoff = z.infer<typeof HandoffSchema>;
export type Surfaces = z.infer<typeof SurfacesSchema>;
export type Corpus = z.infer<typeof CorpusSchema>;
