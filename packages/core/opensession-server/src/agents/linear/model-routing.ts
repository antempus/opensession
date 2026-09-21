/**
 * Model selection for Linear-triggered agent sessions.
 *
 * Chooses the model id from the issue's labels: the first configured
 * `integrations.linear.modelLabels` rule whose label matches an issue label
 * (case-insensitive) wins; else `integrations.linear.fallbackModel`; else the
 * instance's global default. Registry order breaks ties, so it's deterministic.
 * Model-only (no effort) by design — the resolved id can still be a `dial/<tier>`
 * preset that bundles effort.
 */
import { configuredIntegration } from "../../server/config";
import { getDefaultModel } from "../../server/models";

export interface LinearModelLabel {
  label: string;
  model: string;
}

interface LinearModelConfig {
  modelLabels?: LinearModelLabel[];
  fallbackModel?: string;
}

export function resolveLinearModel(
  labels: string[],
  cfg: LinearModelConfig = configuredIntegration("linear") as LinearModelConfig,
  defaultModel: () => string = getDefaultModel,
): string {
  const wanted = new Set(labels.map((l) => l.toLowerCase()));
  const rules = Array.isArray(cfg.modelLabels) ? cfg.modelLabels : [];
  for (const r of rules) {
    if (
      r &&
      typeof r.label === "string" &&
      typeof r.model === "string" &&
      wanted.has(r.label.toLowerCase())
    ) {
      return r.model;
    }
  }
  const fallback =
    typeof cfg.fallbackModel === "string" && cfg.fallbackModel.trim()
      ? cfg.fallbackModel.trim()
      : "";
  return fallback || defaultModel();
}
