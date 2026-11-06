import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolve the renderer's Vite aliases when running API integration tests in Node.
const src = new URL("../web/src/", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const alias = specifier.startsWith("@/");
    if (alias || (specifier.startsWith(".") && context.parentURL?.startsWith(src.href))) {
      const url = alias ? new URL(specifier.slice(2), src) : new URL(specifier, context.parentURL);
      const path = fileURLToPath(url);
      for (const candidate of [path, `${path}.ts`, `${path}/index.ts`]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
