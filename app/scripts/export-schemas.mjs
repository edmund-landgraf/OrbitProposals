import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SchemaCatalog } from "../packages/shapes/dist/index.js";
import { z } from "zod";

const root = fileURLToPath(new URL("../dist/schemas/", import.meta.url));
await mkdir(root, { recursive: true });
for (const [name, schema] of Object.entries(SchemaCatalog)) {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12" });
  await writeFile(join(root, `${name}.json`), `${JSON.stringify(json, null, 2)}\n`);
}
console.log(`Exported ${Object.keys(SchemaCatalog).length} JSON schemas.`);
