import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_MODEL,
  MODEL_IDS,
  getModelDefinition,
  isReasoningSettingForModel,
  isSupportedModel,
  type ChatModel,
  type ModelProvider,
  type ReasoningSetting,
} from "./config";
import { UserVisibleError } from "./errors";
import { isModelProviderConfigured } from "./llm/runtime";

type ServerSupabaseClient = Pick<SupabaseClient, "from" | "rpc">;

const MODEL_SETTINGS_COLUMNS = [
  "model_id",
  "enabled",
  "reasoning_setting",
  "revision",
  "updated_at",
  "updated_by",
].join(",");

const REASONING_LABELS: Readonly<Record<ReasoningSetting, string>> = {
  disabled: "Deaktiviert",
  enabled: "Aktiviert",
  high: "Hoch",
  max: "Maximal",
};

export type ModelSettingsSource = "database" | "fallback";

export type ModelRunProvenance = {
  model: ChatModel;
  provider: ModelProvider;
  upstreamModel: string;
  reasoning: ReasoningSetting;
  settingsRevision: number | null;
  settingsSource: ModelSettingsSource;
};

export type ModelSetting = {
  id: ChatModel;
  enabled: boolean;
  reasoning: ReasoningSetting;
  revision: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type ModelSettingsSnapshot = {
  models: ModelSetting[];
  source: ModelSettingsSource;
};

export type ModelSettingMutation = Pick<ModelSetting, "id" | "enabled" | "reasoning"> & {
  revision: number;
};

export type PublicModelDto = {
  id: ChatModel;
  label: string;
};

export type AdminModelDto = {
  id: ChatModel;
  label: string;
  enabled: boolean;
  alwaysEnabled: boolean;
  reasoning: ReasoningSetting;
  reasoningOptions: Array<{ value: ReasoningSetting; label: string }>;
  providerConfigured: boolean;
  revision: number;
  updatedAt: string | null;
};

function unavailableSettingsError(): UserVisibleError {
  return new UserVisibleError("Die Modellkonfiguration konnte nicht geladen werden.", 503);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === [...expected].sort()[index]);
}

function normalizeStoredRow(value: unknown): ModelSetting | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value.model_id;
  const reasoning = value.reasoning_setting;
  const revision = value.revision;
  const updatedAt = value.updated_at;
  const updatedBy = value.updated_by;
  if (
    typeof id !== "string"
    || !isSupportedModel(id)
    || typeof value.enabled !== "boolean"
    || typeof reasoning !== "string"
    || !isReasoningSettingForModel(id, reasoning)
    || typeof revision !== "number"
    || !Number.isSafeInteger(revision)
    || revision <= 0
    || typeof updatedAt !== "string"
    || (updatedBy !== null && typeof updatedBy !== "string")
  ) {
    return null;
  }

  const definition = getModelDefinition(id);
  if (definition.alwaysEnabled && !value.enabled) {
    return null;
  }

  return {
    id,
    enabled: value.enabled,
    reasoning,
    revision,
    updatedAt,
    updatedBy,
  };
}

function normalizeStoredRows(value: unknown): ModelSetting[] | null {
  if (!Array.isArray(value) || value.length !== MODEL_IDS.length) {
    return null;
  }

  const byId = new Map<ChatModel, ModelSetting>();
  for (const item of value) {
    const setting = normalizeStoredRow(item);
    if (!setting || byId.has(setting.id)) {
      return null;
    }
    byId.set(setting.id, setting);
  }

  if (MODEL_IDS.some((id) => !byId.has(id))) {
    return null;
  }
  return MODEL_IDS.map((id) => byId.get(id)!);
}

export function flashOnlyModelSettings(): ModelSettingsSnapshot {
  const definition = getModelDefinition(DEFAULT_MODEL);
  return {
    source: "fallback",
    models: [{
      id: definition.id,
      enabled: true,
      reasoning: definition.defaultReasoning,
      revision: null,
      updatedAt: null,
      updatedBy: null,
    }],
  };
}

export async function readModelSettings(
  supabase: ServerSupabaseClient,
): Promise<ModelSettingsSnapshot> {
  const { data, error } = await supabase
    .from("model_settings")
    .select(MODEL_SETTINGS_COLUMNS);

  if (error) {
    throw unavailableSettingsError();
  }

  const models = normalizeStoredRows(data);
  if (!models) {
    throw unavailableSettingsError();
  }

  return { models, source: "database" };
}

export async function readEffectiveModelSettings(
  supabase: ServerSupabaseClient,
): Promise<ModelSettingsSnapshot> {
  try {
    return await readModelSettings(supabase);
  } catch {
    return flashOnlyModelSettings();
  }
}

export function parseModelSettingsPatch(body: unknown): ModelSettingMutation[] {
  if (!isRecord(body) || !hasExactKeys(body, ["models"]) || !Array.isArray(body.models)) {
    throw new UserVisibleError("Die Modellkonfiguration ist ungültig.", 400);
  }
  if (body.models.length !== MODEL_IDS.length) {
    throw new UserVisibleError("Die Modellkonfiguration muss den vollständigen Katalog enthalten.", 400);
  }

  const byId = new Map<ChatModel, ModelSettingMutation>();
  for (const value of body.models) {
    if (!isRecord(value) || !hasExactKeys(value, ["id", "enabled", "reasoning", "revision"])) {
      throw new UserVisibleError("Die Modellkonfiguration enthält ungültige Felder.", 400);
    }

    const id = value.id;
    const reasoning = value.reasoning;
    if (
      typeof id !== "string"
      || !isSupportedModel(id)
      || typeof value.enabled !== "boolean"
      || typeof reasoning !== "string"
      || !isReasoningSettingForModel(id, reasoning)
      || typeof value.revision !== "number"
      || !Number.isSafeInteger(value.revision)
      || value.revision <= 0
      || byId.has(id)
    ) {
      throw new UserVisibleError("Die Modellkonfiguration enthält ungültige Werte.", 400);
    }
    if (getModelDefinition(id).alwaysEnabled && !value.enabled) {
      throw new UserVisibleError("Das Standardmodell kann nicht deaktiviert werden.", 400);
    }

    byId.set(id, { id, enabled: value.enabled, reasoning, revision: value.revision });
  }

  if (MODEL_IDS.some((id) => !byId.has(id))) {
    throw new UserVisibleError("Die Modellkonfiguration muss den vollständigen Katalog enthalten.", 400);
  }
  return MODEL_IDS.map((id) => byId.get(id)!);
}

export function assertConfiguredModelsCanBeEnabled(
  current: ModelSettingsSnapshot,
  requested: readonly ModelSettingMutation[],
  isConfigured: (model: ChatModel) => boolean = isModelProviderConfigured,
): void {
  const currentById = new Map(current.models.map((setting) => [setting.id, setting]));
  for (const setting of requested) {
    if (setting.enabled && !currentById.get(setting.id)?.enabled && !isConfigured(setting.id)) {
      throw new UserVisibleError(
        `${getModelDefinition(setting.id).label} kann ohne konfigurierten Provider nicht aktiviert werden.`,
        400,
      );
    }
  }
}

export async function updateModelSettings(options: {
  supabase: ServerSupabaseClient;
  adminUserId: string;
  current: ModelSettingsSnapshot;
  requested: readonly ModelSettingMutation[];
}): Promise<ModelSettingsSnapshot> {
  if (options.current.source !== "database") {
    throw unavailableSettingsError();
  }

  const currentById = new Map(options.current.models.map((setting) => [setting.id, setting]));
  const changed = options.requested.filter((setting) => {
    const previous = currentById.get(setting.id);
    return !previous
      || previous.enabled !== setting.enabled
      || previous.reasoning !== setting.reasoning;
  });

  if (changed.length === 0) {
    return options.current;
  }

  const changes = changed.map((setting) => {
    return {
      model_id: setting.id,
      enabled: setting.enabled,
      reasoning_setting: setting.reasoning,
      expected_revision: setting.revision,
    };
  });
  const { error } = await options.supabase.rpc("update_model_settings", {
    p_admin_user_id: options.adminUserId,
    p_changes: changes,
  });

  if (error) {
    if (typeof error === "object" && error.code === "40001") {
      throw new UserVisibleError(
        "Die Modellkonfiguration wurde zwischenzeitlich geändert. Bitte neu laden.",
        409,
      );
    }
    throw new UserVisibleError("Die Modellkonfiguration konnte nicht gespeichert werden.", 503);
  }
  return readModelSettings(options.supabase);
}

export function publicEnabledModelDtos(snapshot: ModelSettingsSnapshot): PublicModelDto[] {
  return snapshot.models.flatMap((setting) => {
    const definition = getModelDefinition(setting.id);
    if (
      !setting.enabled
      || (!definition.alwaysEnabled && !isModelProviderConfigured(setting.id))
    ) {
      return [];
    }
    return [{ id: setting.id, label: definition.label }];
  });
}

export function adminModelDtos(snapshot: ModelSettingsSnapshot): AdminModelDto[] {
  return snapshot.models.map((setting) => {
    if (setting.revision === null) {
      throw unavailableSettingsError();
    }
    const definition = getModelDefinition(setting.id);
    return {
      id: setting.id,
      label: definition.label,
      enabled: setting.enabled,
      alwaysEnabled: definition.alwaysEnabled,
      reasoning: setting.reasoning,
      reasoningOptions: definition.reasoningOptions.map((value) => ({
        value,
        label: REASONING_LABELS[value],
      })),
      providerConfigured: isModelProviderConfigured(setting.id),
      revision: setting.revision,
      updatedAt: setting.updatedAt,
    };
  });
}

export function enabledModelSetting(
  snapshot: ModelSettingsSnapshot,
  model: ChatModel,
): ModelSetting {
  const setting = snapshot.models.find((candidate) => candidate.id === model);
  if (!setting?.enabled) {
    throw new UserVisibleError("Das ausgewählte Modell ist derzeit nicht aktiviert.", 400);
  }

  const definition = getModelDefinition(model);
  if (!definition.alwaysEnabled && !isModelProviderConfigured(model)) {
    throw new UserVisibleError("Das ausgewählte Modell ist derzeit nicht verfügbar.", 503);
  }
  return setting;
}
