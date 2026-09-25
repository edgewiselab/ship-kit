// Single source for the Ship Kit version (read from package.json), shown in reports and the probe user-agent.
import { readFileSync } from "node:fs";

let v = "0.0.0";
try { v = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version || v; } catch {}
export const VERSION = v;
