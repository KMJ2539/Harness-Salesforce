import { sharingMissing } from "./sharing-missing.js";
import { hardcodedId } from "./hardcoded-id.js";
import { dynamicSoqlUnsafe } from "./dynamic-soql-unsafe.js";
import type { LintRule } from "../types.js";

export const APEX_RULES: LintRule[] = [sharingMissing, hardcodedId, dynamicSoqlUnsafe];
