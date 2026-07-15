import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_MODEL,
  MODEL_IDS,
  getModelDefinition,
  isDynamicModelId,
  isReasoningSettingForModel,
  isSupportedModel,
  type ChatModel,
  type ModelProvider,
  type ReasoningSetting,
} from "./config";
import { UserVisibleError } from "./errors";
import { isModelProviderConfigured, isProviderConfigured } from "./llm/runtime";

type ServerSupabaseClient = Pick<SupabaseClient, "from" | "rpc">;

const MODEL_SETTINGS_COLUMNS = [
  "model_id",
  "display_name",
  "provider",
  "upstream_model",
  "is_dynamic",
  "always_enabled",
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
  model: string;
  provider: ModelProvider;
  upstreamModel: string;
  reasoning: ReasoningSetting;
  settingsRevision: number | null;
  settingsSource: ModelSettingsSource;
};

export type BuiltinModelSetting = {
  id: ChatModel;
  displayName: null;
  provider: ModelProvider;
  upstreamModel: string;
  isDynamic: false;
  alwaysEnabled: boolean;
  enabled: boolean;
  reasoning: ReasoningSetting;
  revision: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type DynamicModelSetting = {
  id: string;
  displayName: string;
  provider: "laozhang";
  upstreamModel: string;
  isDynamic: true;
  alwaysEnabled: false;
  enabled: boolean;
  reasoning: "disabled";
  revision: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type ModelSetting = BuiltinModelSetting | DynamicModelSetting;

export type ModelSettingsSnapshot = {
  models: ModelSetting[];
  source: ModelSettingsSource;
};

export type ModelSettingMutation = Pick<BuiltinModelSetting, "id" | "enabled" | "reasoning"> & {
  revision: number;
};

export type PublicModelDto = {
  id: string;
  label: string;
};

export type AdminModelDto = {
  id: string;
  label: string;
  enabled: boolean;
  alwaysEnabled: boolean;
  reasoning: ReasoningSetting | null;
  reasoningOptions: Array<{ value: ReasoningSetting; label: string }>;
  providerConfigured: boolean;
  revision: number;
  updatedAt: string | null;
  provider?: string;
  upstreamModel?: string;
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

function normalizeBuiltinRow(value: unknown): BuiltinModelSetting | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value.model_id;
  const reasoning = value.reasoning_setting;
  const revision = value.revision;
  const updatedAt = value.updated_at;
  const updatedBy = value.updated_by;
  const isDynamic = value.is_dynamic === true;
  if (
    isDynamic
    || typeof id !== "string"
    || !isSupportedModel(id)
    || typeof value.enabled !== "boolean"
    || typeof reasoning !== "string"
    || !isReasoningSettingForModel(id, reasoning)
    || typeof revision !== "number"
    || !Number.isSafeInteger(revision)
    || revision <= 0
    || typeof updatedAt !== "string"
    || (updatedBy !== null && typeof updatedBy !== "string")
    || typeof value.provider !== "string"
    || typeof value.upstream_model !== "string"
  ) {
    return null;
  }

  const definition = getModelDefinition(id);
  if (definition.alwaysEnabled && !value.enabled) {
    return null;
  }

  if (value.provider !== definition.provider
    || value.upstream_model !== definition.upstreamModel
    || value.always_enabled !== definition.alwaysEnabled
  ) {
    return null;
  }

  return {
    id,
    displayName: null,
    provider: value.provider as ModelProvider,
    upstreamModel: value.upstream_model,
    isDynamic: false as const,
    alwaysEnabled: definition.alwaysEnabled,
    enabled: value.enabled,
    reasoning,
    revision,
    updatedAt,
    updatedBy,
  };
}

function normalizeDynamicRow(value: unknown): DynamicModelSetting | null {
  if (!isRecord(value)) {
    return null;
  }

  const modelId = value.model_id;
  const displayName = value.display_name;
  const provider = value.provider;
  const upstreamModel = value.upstream_model;
  const isDynamic = value.is_dynamic === true;
  const alwaysEnabled = value.always_enabled === true;
  const enabled = value.enabled;
  const reasoning = value.reasoning_setting;
  const revision = value.revision;
  const updatedAt = value.updated_at;
  const updatedBy = value.updated_by;
  if (
    !isDynamic
    || typeof modelId !== "string"
    || !isDynamicModelId(modelId)
    || typeof displayName !== "string"
    || !isValidDynamicDisplayName(displayName)
    || provider !== "laozhang"
    || typeof upstreamModel !== "string"
    || !isValidUpstreamModelId(upstreamModel)
    || alwaysEnabled
    || typeof enabled !== "boolean"
    || reasoning !== "disabled"
    || typeof revision !== "number"
    || !Number.isSafeInteger(revision)
    || revision <= 0
    || typeof updatedAt !== "string"
    || (updatedBy !== null && typeof updatedBy !== "string")
  ) {
    return null;
  }

  return {
    id: modelId,
    displayName: displayName.trim(),
    provider: "laozhang",
    upstreamModel: upstreamModel.trim(),
    isDynamic: true as const,
    alwaysEnabled: false as const,
    enabled,
    reasoning: "disabled" as const,
    revision,
    updatedAt,
    updatedBy,
  };
}

function normalizeStoredRows(value: unknown): ModelSetting[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const builtinById = new Map<ChatModel, BuiltinModelSetting>();
  const dynamicModels: DynamicModelSetting[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }

    if (item.is_dynamic === true) {
      const dynamic = normalizeDynamicRow(item);
      if (!dynamic) {
        return null;
      }
      dynamicModels.push(dynamic);
    } else {
      const builtin = normalizeBuiltinRow(item);
      if (!builtin || builtinById.has(builtin.id)) {
        return null;
      }
      builtinById.set(builtin.id, builtin);
    }
  }

  if (MODEL_IDS.some((id) => !builtinById.has(id))) {
    return null;
  }

  const builtinModels = MODEL_IDS.map((id) => builtinById.get(id)!);
  return [...builtinModels, ...dynamicModels];
}

export function flashOnlyModelSettings(): ModelSettingsSnapshot {
  const definition = getModelDefinition(DEFAULT_MODEL);
  return {
    source: "fallback",
    models: [{
      id: definition.id,
      displayName: null,
      provider: definition.provider,
      upstreamModel: definition.upstreamModel,
      isDynamic: false as const,
      alwaysEnabled: definition.alwaysEnabled,
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
    const currentSetting = currentById.get(setting.id);
    if (setting.enabled && !currentSetting?.enabled && !isConfigured(setting.id as ChatModel)) {
      throw new UserVisibleError(
        `${getModelDefinition(setting.id as ChatModel).label} kann ohne konfigurierten Provider nicht aktiviert werden.`,
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
    const previous = currentById.get(setting.id) as BuiltinModelSetting | undefined;
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
    if (!setting.enabled || (!setting.alwaysEnabled && !isProviderConfigured(setting.provider))) {
      return [];
    }

    if (setting.isDynamic) {
      return [{ id: setting.id, label: setting.displayName }];
    }

    const definition = getModelDefinition(setting.id);
    return [{ id: setting.id, label: definition.label }];
  });
}

export function adminModelDtos(snapshot: ModelSettingsSnapshot): AdminModelDto[] {
  return snapshot.models.map((setting) => {
    if (setting.revision === null) {
      throw unavailableSettingsError();
    }

    if (setting.isDynamic) {
      return {
        id: setting.id,
        label: setting.displayName,
        enabled: setting.enabled,
        alwaysEnabled: false,
        reasoning: "disabled",
        reasoningOptions: [{ value: "disabled", label: "Deaktiviert" }],
        providerConfigured: isProviderConfigured("laozhang"),
        revision: setting.revision,
        updatedAt: setting.updatedAt,
        provider: "laozhang",
        upstreamModel: setting.upstreamModel,
      };
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
  model: string,
): ModelSetting {
  const setting = snapshot.models.find((candidate) => candidate.id === model);
  if (!setting?.enabled) {
    throw new UserVisibleError("Das ausgewählte Modell ist derzeit nicht aktiviert.", 400);
  }

  if (setting.isDynamic) {
    if (!isProviderConfigured("laozhang")) {
      throw new UserVisibleError("Das ausgewählte Modell ist derzeit nicht verfügbar.", 503);
    }
    return setting;
  }

  const definition = getModelDefinition(setting.id);
  if (!definition.alwaysEnabled && !isModelProviderConfigured(setting.id)) {
    throw new UserVisibleError("Das ausgewählte Modell ist derzeit nicht verfügbar.", 503);
  }
  return setting;
}

const DYNAMIC_MODEL_DISPLAY_NAME_MAX_LENGTH = 120;
const DYNAMIC_MODEL_UPSTREAM_MAX_LENGTH = 120;

export function isValidDynamicDisplayName(value: string): boolean {
  return (
    typeof value === "string"
    && value.trim().length > 0
    && value.trim().length <= DYNAMIC_MODEL_DISPLAY_NAME_MAX_LENGTH
    && !/[\x00-\x1f\x7f]/u.test(value)
  );
}

export function isValidUpstreamModelId(value: string): boolean {
  return (
    typeof value === "string"
    && value.trim().length > 0
    && value.trim().length <= DYNAMIC_MODEL_UPSTREAM_MAX_LENGTH
    && !/[\x00-\x1f\x7f]/u.test(value)
  );
}

export type CreateDynamicModelInput = {
  displayName: string;
  upstreamModel: string;
};

export function parseCreateDynamicModelBody(body: unknown): CreateDynamicModelInput {
  if (!isRecord(body) || !hasExactKeys(body, ["displayName", "upstreamModel"])) {
    throw new UserVisibleError("Die Anfrage muss displayName und upstreamModel enthalten.", 400);
  }

  if (typeof body.displayName !== "string" || !isValidDynamicDisplayName(body.displayName)) {
    throw new UserVisibleError("Der Anzeigename ist ungültig.", 400);
  }

  if (typeof body.upstreamModel !== "string" || !isValidUpstreamModelId(body.upstreamModel)) {
    throw new UserVisibleError("Die Modell-ID ist ungültig.", 400);
  }

  return {
    displayName: body.displayName.trim(),
    upstreamModel: body.upstreamModel.trim(),
  };
}

function generateOpaqueModelId(): string {
  return `laozhang:${randomUUID()}`;
}

export async function createDynamicModel(options: {
  supabase: ServerSupabaseClient;
  adminUserId: string;
  input: CreateDynamicModelInput;
}): Promise<DynamicModelSetting> {
  const modelId = generateOpaqueModelId();

  const { error } = await options.supabase.rpc("create_dynamic_model", {
    p_model_id: modelId,
    p_display_name: options.input.displayName,
    p_upstream_model: options.input.upstreamModel,
    p_created_by: options.adminUserId,
  });

  if (error) {
    const pgError = error as { code?: string; message?: string };
    if (pgError.code === "23505") {
      throw new UserVisibleError(
        "Ein Modell mit derselben LaoZhang-Modell-ID ist bereits konfiguriert.",
        409,
      );
    }
    throw new UserVisibleError("Das Modell konnte nicht angelegt werden.", 503);
  }

  const snapshot = await readModelSettings(options.supabase);
  const created = snapshot.models.find(
    (m): m is DynamicModelSetting => m.isDynamic && m.id === modelId,
  );
  if (!created) {
    throw new UserVisibleError("Das Modell wurde angelegt, konnte aber nicht geladen werden.", 503);
  }

  return created;
}

export function parseDynamicModelEnablePatch(body: unknown): { enabled: boolean } {
  if (!isRecord(body) || !hasExactKeys(body, ["enabled"])) {
    throw new UserVisibleError("Der PATCH-Body muss enabled enthalten.", 400);
  }

  if (typeof body.enabled !== "boolean") {
    throw new UserVisibleError("enabled muss ein Boolean sein.", 400);
  }

  return { enabled: body.enabled };
}
