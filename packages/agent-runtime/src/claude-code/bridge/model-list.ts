import type { AvailableModel } from "@bb/domain";
import { listClaudeCodeModels } from "../model-list.js";

export function listClaudeCodeBridgeModels(): AvailableModel[] {
  return listClaudeCodeModels();
}
