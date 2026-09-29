import type { WorldDef, WorldId } from "../types";
import { WORLD_ALPEN } from "./alpen";
import { WORLD_CYBER } from "./cyber";
import { WORLD_FINANZAMT } from "./finanzamt";
import { WORLD_PRATER } from "./prater";
import { WORLD_WACHAU } from "./wachau";
import { WORLD_WIEN } from "./wien";

export const WORLDS: Record<WorldId, WorldDef> = {
  wien: WORLD_WIEN,
  alpen: WORLD_ALPEN,
  finanzamt: WORLD_FINANZAMT,
  prater: WORLD_PRATER,
  wachau: WORLD_WACHAU,
  cyber: WORLD_CYBER,
};

export { WORLD_IDS } from "../types";
