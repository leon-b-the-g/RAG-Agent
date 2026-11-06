import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
/** The kit source with `export` stripped, so the built page can call it while animating. */
export const kitScript = () => readFileSync(join(HERE, "iso-kit.mjs"), "utf8").replace(/^export /gm, "");
