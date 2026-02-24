import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CorpusSchema } from "./corpus.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "corpus.json");
const jsonSchema = zodToJsonSchema(CorpusSchema, {
    name: "BundlCorpus",
    $refStrategy: "none",
});
writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2), "utf-8");
console.log("Wrote", outPath);
//# sourceMappingURL=generate-json-schema.js.map