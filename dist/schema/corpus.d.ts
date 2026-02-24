import { z } from "zod";
/** Source of an input (agent-provided or human-provided identifier). */
export declare const InputFieldSourceSchema: z.ZodObject<{
    agent: z.ZodString;
    human: z.ZodString;
}, "strip", z.ZodTypeAny, {
    agent: string;
    human: string;
}, {
    agent: string;
    human: string;
}>;
/** Single input field: name, description, example, source; optional inputs may have fallback. */
export declare const InputFieldSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    example: z.ZodString;
    source: z.ZodObject<{
        agent: z.ZodString;
        human: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        agent: string;
        human: string;
    }, {
        agent: string;
        human: string;
    }>;
    fallback: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    description: string;
    example: string;
    source: {
        agent: string;
        human: string;
    };
    fallback?: string | undefined;
}, {
    name: string;
    description: string;
    example: string;
    source: {
        agent: string;
        human: string;
    };
    fallback?: string | undefined;
}>;
/** Inputs: required and optional arrays of InputField (optional may have fallback). */
export declare const CorpusInputsSchema: z.ZodObject<{
    required: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        example: z.ZodString;
        source: z.ZodObject<{
            agent: z.ZodString;
            human: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            agent: string;
            human: string;
        }, {
            agent: string;
            human: string;
        }>;
        fallback: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description: string;
        example: string;
        source: {
            agent: string;
            human: string;
        };
        fallback?: string | undefined;
    }, {
        name: string;
        description: string;
        example: string;
        source: {
            agent: string;
            human: string;
        };
        fallback?: string | undefined;
    }>, "many">;
    optional: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        example: z.ZodString;
        source: z.ZodObject<{
            agent: z.ZodString;
            human: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            agent: string;
            human: string;
        }, {
            agent: string;
            human: string;
        }>;
        fallback: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description: string;
        example: string;
        source: {
            agent: string;
            human: string;
        };
        fallback?: string | undefined;
    }, {
        name: string;
        description: string;
        example: string;
        source: {
            agent: string;
            human: string;
        };
        fallback?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    required: {
        name: string;
        description: string;
        example: string;
        source: {
            agent: string;
            human: string;
        };
        fallback?: string | undefined;
    }[];
    optional: {
        name: string;
        description: string;
        example: string;
        source: {
            agent: string;
            human: string;
        };
        fallback?: string | undefined;
    }[];
}, {
    required: {
        name: string;
        description: string;
        example: string;
        source: {
            agent: string;
            human: string;
        };
        fallback?: string | undefined;
    }[];
    optional: {
        name: string;
        description: string;
        example: string;
        source: {
            agent: string;
            human: string;
        };
        fallback?: string | undefined;
    }[];
}>;
export declare const CorpusTypeSchema: z.ZodEnum<["workflow", "document", "constraint"]>;
export declare const CorpusLoadSchema: z.ZodEnum<["always", "on-demand"]>;
/** Handoff: conditions, escalate_to, handoff_message. */
export declare const HandoffSchema: z.ZodObject<{
    conditions: z.ZodArray<z.ZodString, "many">;
    escalate_to: z.ZodString;
    handoff_message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    conditions: string[];
    escalate_to: string;
    handoff_message: string;
}, {
    conditions: string[];
    escalate_to: string;
    handoff_message: string;
}>;
/** Surfaces: human and agent visibility. */
export declare const SurfacesSchema: z.ZodObject<{
    human: z.ZodBoolean;
    agent: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    agent: boolean;
    human: boolean;
}, {
    agent: boolean;
    human: boolean;
}>;
/** Bundl corpus schema: full definition for an agent corpus entry. */
export declare const CorpusSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    role: z.ZodString;
    category: z.ZodString;
    version: z.ZodString;
    type: z.ZodEnum<["workflow", "document", "constraint"]>;
    load: z.ZodEnum<["always", "on-demand"]>;
    trigger_description: z.ZodString;
    inputs: z.ZodObject<{
        required: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            description: z.ZodString;
            example: z.ZodString;
            source: z.ZodObject<{
                agent: z.ZodString;
                human: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                agent: string;
                human: string;
            }, {
                agent: string;
                human: string;
            }>;
            fallback: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            description: string;
            example: string;
            source: {
                agent: string;
                human: string;
            };
            fallback?: string | undefined;
        }, {
            name: string;
            description: string;
            example: string;
            source: {
                agent: string;
                human: string;
            };
            fallback?: string | undefined;
        }>, "many">;
        optional: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            description: z.ZodString;
            example: z.ZodString;
            source: z.ZodObject<{
                agent: z.ZodString;
                human: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                agent: string;
                human: string;
            }, {
                agent: string;
                human: string;
            }>;
            fallback: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            description: string;
            example: string;
            source: {
                agent: string;
                human: string;
            };
            fallback?: string | undefined;
        }, {
            name: string;
            description: string;
            example: string;
            source: {
                agent: string;
                human: string;
            };
            fallback?: string | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        required: {
            name: string;
            description: string;
            example: string;
            source: {
                agent: string;
                human: string;
            };
            fallback?: string | undefined;
        }[];
        optional: {
            name: string;
            description: string;
            example: string;
            source: {
                agent: string;
                human: string;
            };
            fallback?: string | undefined;
        }[];
    }, {
        required: {
            name: string;
            description: string;
            example: string;
            source: {
                agent: string;
                human: string;
            };
            fallback?: string | undefined;
        }[];
        optional: {
            name: string;
            description: string;
            example: string;
            source: {
                agent: string;
                human: string;
            };
            fallback?: string | undefined;
        }[];
    }>;
    system_prompt: z.ZodString;
    example_output: z.ZodString;
    tools: z.ZodArray<z.ZodString, "many">;
    constraints: z.ZodArray<z.ZodString, "many">;
    handoff: z.ZodObject<{
        conditions: z.ZodArray<z.ZodString, "many">;
        escalate_to: z.ZodString;
        handoff_message: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        conditions: string[];
        escalate_to: string;
        handoff_message: string;
    }, {
        conditions: string[];
        escalate_to: string;
        handoff_message: string;
    }>;
    success_criteria: z.ZodArray<z.ZodString, "many">;
    surfaces: z.ZodObject<{
        human: z.ZodBoolean;
        agent: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        agent: boolean;
        human: boolean;
    }, {
        agent: boolean;
        human: boolean;
    }>;
}, "strip", z.ZodTypeAny, {
    role: string;
    version: string;
    type: "workflow" | "document" | "constraint";
    name: string;
    id: string;
    category: string;
    load: "always" | "on-demand";
    trigger_description: string;
    inputs: {
        required: {
            name: string;
            description: string;
            example: string;
            source: {
                agent: string;
                human: string;
            };
            fallback?: string | undefined;
        }[];
        optional: {
            name: string;
            description: string;
            example: string;
            source: {
                agent: string;
                human: string;
            };
            fallback?: string | undefined;
        }[];
    };
    system_prompt: string;
    example_output: string;
    tools: string[];
    constraints: string[];
    handoff: {
        conditions: string[];
        escalate_to: string;
        handoff_message: string;
    };
    success_criteria: string[];
    surfaces: {
        agent: boolean;
        human: boolean;
    };
}, {
    role: string;
    version: string;
    type: "workflow" | "document" | "constraint";
    name: string;
    id: string;
    category: string;
    load: "always" | "on-demand";
    trigger_description: string;
    inputs: {
        required: {
            name: string;
            description: string;
            example: string;
            source: {
                agent: string;
                human: string;
            };
            fallback?: string | undefined;
        }[];
        optional: {
            name: string;
            description: string;
            example: string;
            source: {
                agent: string;
                human: string;
            };
            fallback?: string | undefined;
        }[];
    };
    system_prompt: string;
    example_output: string;
    tools: string[];
    constraints: string[];
    handoff: {
        conditions: string[];
        escalate_to: string;
        handoff_message: string;
    };
    success_criteria: string[];
    surfaces: {
        agent: boolean;
        human: boolean;
    };
}>;
export type InputFieldSource = z.infer<typeof InputFieldSourceSchema>;
export type InputField = z.infer<typeof InputFieldSchema>;
export type CorpusInputs = z.infer<typeof CorpusInputsSchema>;
export type CorpusType = z.infer<typeof CorpusTypeSchema>;
export type CorpusLoad = z.infer<typeof CorpusLoadSchema>;
export type Handoff = z.infer<typeof HandoffSchema>;
export type Surfaces = z.infer<typeof SurfacesSchema>;
export type Corpus = z.infer<typeof CorpusSchema>;
//# sourceMappingURL=corpus.d.ts.map