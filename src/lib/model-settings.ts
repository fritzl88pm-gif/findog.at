import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MAX_PROVIDER_KEY_CHARS,
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
import { isModelProviderConfigured } from "./llm/runtime";
import {
  decryptOpenAICompatibleApiKey,
  encryptOpenAICompatibleApiKey,
} from "./openai-compatible-credentials";

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
  "base_url",
  "access_scope",
  "api_key_ciphertext",
  "image_asset_id",
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

const MODEL_TEXT_MAX_LENGTH = 120;
const BASE_URL_MAX_LENGTH = 2048;
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MODEL_DEFAULT_POLICY_COLUMNS = "model_id,revision,updated_at,updated_by";

export type ModelSettingsSource = "database" | "fallback";
export type OpenAICompatibleAccessScope = "disabled" | "admins" | "all";

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
  provider: "deepseek" | "zai";
  upstreamModel: string;
  isDynamic: false;
  alwaysEnabled: boolean;
  enabled: boolean;
  reasoning: ReasoningSetting;
  imageAssetId?: string | null;
  revision: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type DynamicModelSetting = {
  id: string;
  displayName: string | null;
  provider: "openai_compatible";
  upstreamModel: string;
  baseUrl: string;
  accessScope: OpenAICompatibleAccessScope;
  apiKeyCiphertext: string;
  isDynamic: true;
  alwaysEnabled: false;
  enabled: boolean;
  reasoning: "disabled";
  imageAssetId?: string | null;
  revision: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type ModelSetting = BuiltinModelSetting | DynamicModelSetting;
export type ModelSettingsSnapshot = { models: ModelSetting[]; source: ModelSettingsSource };
export type ModelSettingMutation = Pick<BuiltinModelSetting, "id" | "enabled" | "reasoning"> & {
  revision: number;
};
export type PublicModelDto = { id: string; label: string; imageAssetId?: string | null };
export type AdminModelDto = {
  id: string;
  label: string;
  displayName?: string | null;
  enabled: boolean;
  alwaysEnabled: boolean;
  reasoning: ReasoningSetting | null;
  reasoningOptions: Array<{ value: ReasoningSetting; label: string }>;
  providerConfigured: boolean;
  revision: number;
  updatedAt: string | null;
  provider?: string;
  upstreamModel?: string;
  baseUrl?: string;
  accessScope?: OpenAICompatibleAccessScope;
  imageAssetId: string | null;
};

export type ModelDefaultPolicy = {
  modelId: string;
  revision: number;
  updatedAt: string;
  updatedBy: string | null;
};

export type OpenAICompatibleModelInput = {
  upstreamModel: string;
  displayName: string | null;
  baseUrl: string;
  apiKey?: string;
  accessScope: OpenAICompatibleAccessScope;
};

function unavailableSettingsError(): UserVisibleError {
  return new UserVisibleError("Die Modellkonfiguration konnte nicht geladen werden.", 503);
}

function revisionConflictError(): UserVisibleError {
  return new UserVisibleError(
    "Die Modellkonfiguration wurde zwischenzeitlich geändert. Bitte neu laden.",
    409,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isPositiveRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function normalizeImageAssetId(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : undefined;
}

function isValidModelText(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0
    && trimmed.length <= MODEL_TEXT_MAX_LENGTH
    && !CONTROL_CHARACTERS.test(value);
}

export function isValidDynamicDisplayName(value: string): boolean {
  return isValidModelText(value);
}

export function isValidUpstreamModelId(value: string): boolean {
  return isValidModelText(value);
}

function parseDisplayName(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !isValidDynamicDisplayName(value)) {
    throw new UserVisibleError("Der Anzeigename ist ungültig.", 400);
  }
  return value.trim();
}

function parseAccessScope(value: unknown): OpenAICompatibleAccessScope {
  if (value !== "disabled" && value !== "admins" && value !== "all") {
    throw new UserVisibleError("Die Verfügbarkeit ist ungültig.", 400);
  }
  return value;
}

export function normalizeOpenAICompatibleBaseUrl(value: string): string {
  if (!value.trim() || value.length > BASE_URL_MAX_LENGTH || CONTROL_CHARACTERS.test(value)) {
    throw new UserVisibleError("Die Basis-URL ist ungültig.", 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new UserVisibleError("Die Basis-URL ist ungültig.", 400);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new UserVisibleError("Die Basis-URL ist ungültig.", 400);
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  const normalized = `${parsed.origin}${pathname === "/" ? "" : pathname}`;
  if (normalized.length > BASE_URL_MAX_LENGTH) {
    throw new UserVisibleError("Die Basis-URL ist ungültig.", 400);
  }
  return normalized;
}

function parseApiKey(value: unknown, required: boolean): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new UserVisibleError("Der API-Key ist erforderlich.", 400);
    }
    return undefined;
  }
  if (typeof value !== "string") {
    throw new UserVisibleError("Der API-Key ist ungültig.", 400);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) {
      throw new UserVisibleError("Der API-Key ist erforderlich.", 400);
    }
    return undefined;
  }
  if (trimmed.length > MAX_PROVIDER_KEY_CHARS || CONTROL_CHARACTERS.test(value)) {
    throw new UserVisibleError("Der API-Key ist ungültig.", 400);
  }
  return trimmed;
}

function parseOpenAICompatibleBody(body: unknown, requireApiKey: boolean): OpenAICompatibleModelInput {
  const allowed = ["upstreamModel", "displayName", "baseUrl", "apiKey", "accessScope"];
  if (!isRecord(body) || !hasOnlyKeys(body, allowed)) {
    throw new UserVisibleError("Die Anfrage enthält ungültige Felder.", 400);
  }
  if (typeof body.upstreamModel !== "string" || !isValidUpstreamModelId(body.upstreamModel)) {
    throw new UserVisibleError("Die Modell-ID ist ungültig.", 400);
  }
  if (typeof body.baseUrl !== "string") {
    throw new UserVisibleError("Die Basis-URL ist ungültig.", 400);
  }
  return {
    upstreamModel: body.upstreamModel.trim(),
    displayName: parseDisplayName(body.displayName),
    baseUrl: normalizeOpenAICompatibleBaseUrl(body.baseUrl),
    apiKey: parseApiKey(body.apiKey, requireApiKey),
    accessScope: parseAccessScope(body.accessScope),
  };
}

export function parseCreateOpenAICompatibleModelBody(body: unknown): OpenAICompatibleModelInput & { apiKey: string } {
  return parseOpenAICompatibleBody(body, true) as OpenAICompatibleModelInput & { apiKey: string };
}

export function parseUpdateOpenAICompatibleModelBody(body: unknown): OpenAICompatibleModelInput & { revision: number } {
  if (!isRecord(body) || !hasOnlyKeys(body, ["upstreamModel", "displayName", "baseUrl", "apiKey", "accessScope", "revision"])) {
    throw new UserVisibleError("Die Anfrage enthält ungültige Felder.", 400);
  }
  if (!isPositiveRevision(body.revision)) {
    throw new UserVisibleError("Die Revision ist ungültig.", 400);
  }
  const { revision, ...modelBody } = body;
  return { ...parseOpenAICompatibleBody(modelBody, false), revision };
}

export function parseDeleteOpenAICompatibleModelBody(body: unknown): { revision: number } {
  if (!isRecord(body) || !hasExactKeys(body, ["revision"]) || !isPositiveRevision(body.revision)) {
    throw new UserVisibleError("Die Revision ist ungültig.", 400);
  }
  return { revision: body.revision };
}

function normalizeBuiltinRow(value: Record<string, unknown>): BuiltinModelSetting | null {
  const id = value.model_id;
  const reasoning = value.reasoning_setting;
  const revision = value.revision;
  const updatedAt = value.updated_at;
  const updatedBy = value.updated_by;
  const imageAssetId = normalizeImageAssetId(value.image_asset_id);
  if (
    value.is_dynamic === true
    || typeof id !== "string"
    || !isSupportedModel(id)
    || typeof value.enabled !== "boolean"
    || typeof reasoning !== "string"
    || !isReasoningSettingForModel(id, reasoning)
    || !isPositiveRevision(revision)
    || typeof updatedAt !== "string"
    || (updatedBy !== null && typeof updatedBy !== "string")
    || typeof value.provider !== "string"
    || typeof value.upstream_model !== "string"
    || imageAssetId === undefined
  ) {
    return null;
  }
  const definition = getModelDefinition(id);
  if (
    (definition.alwaysEnabled && !value.enabled)
    || value.provider !== definition.provider
    || value.upstream_model !== definition.upstreamModel
    || value.always_enabled !== definition.alwaysEnabled
  ) {
    return null;
  }
  return {
    id,
    displayName: null,
    provider: definition.provider,
    upstreamModel: value.upstream_model,
    isDynamic: false,
    alwaysEnabled: definition.alwaysEnabled,
    enabled: value.enabled,
    reasoning,
    imageAssetId,
    revision,
    updatedAt,
    updatedBy,
  };
}

function normalizeDynamicRow(value: Record<string, unknown>): DynamicModelSetting | null {
  const modelId = value.model_id;
  const displayName = value.display_name;
  const upstreamModel = value.upstream_model;
  const baseUrl = value.base_url;
  const accessScope = value.access_scope;
  const ciphertext = value.api_key_ciphertext;
  const revision = value.revision;
  const updatedAt = value.updated_at;
  const updatedBy = value.updated_by;
  const imageAssetId = normalizeImageAssetId(value.image_asset_id);
  if (
    value.is_dynamic !== true
    || typeof modelId !== "string"
    || !isDynamicModelId(modelId)
    || (displayName !== null && (typeof displayName !== "string" || !isValidDynamicDisplayName(displayName)))
    || value.provider !== "openai_compatible"
    || typeof upstreamModel !== "string"
    || !isValidUpstreamModelId(upstreamModel)
    || typeof baseUrl !== "string"
    || normalizeOpenAICompatibleBaseUrl(baseUrl) !== baseUrl
    || (accessScope !== "disabled" && accessScope !== "admins" && accessScope !== "all")
    || typeof ciphertext !== "string"
    || !ciphertext
    || value.always_enabled === true
    || value.enabled !== (accessScope !== "disabled")
    || value.reasoning_setting !== "disabled"
    || !isPositiveRevision(revision)
    || typeof updatedAt !== "string"
    || (updatedBy !== null && typeof updatedBy !== "string")
    || imageAssetId === undefined
  ) {
    return null;
  }
  return {
    id: modelId,
    displayName: displayName === null ? null : displayName.trim(),
    provider: "openai_compatible",
    upstreamModel: upstreamModel.trim(),
    baseUrl,
    accessScope,
    apiKeyCiphertext: ciphertext,
    isDynamic: true,
    alwaysEnabled: false,
    enabled: accessScope !== "disabled",
    reasoning: "disabled",
    imageAssetId,
    revision,
    updatedAt,
    updatedBy,
  };
}

function normalizeStoredRows(value: unknown): ModelSetting[] | null {
  if (!Array.isArray(value)) return null;
  const builtinById = new Map<ChatModel, BuiltinModelSetting>();
  const dynamicModels: DynamicModelSetting[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (item.is_dynamic === true) {
      const dynamic = normalizeDynamicRow(item);
      if (!dynamic) return null;
      dynamicModels.push(dynamic);
    } else {
      const builtin = normalizeBuiltinRow(item);
      if (!builtin || builtinById.has(builtin.id)) return null;
      builtinById.set(builtin.id, builtin);
    }
  }
  if (MODEL_IDS.some((id) => !builtinById.has(id))) return null;
  return [...MODEL_IDS.map((id) => builtinById.get(id)!), ...dynamicModels];
}

export async function readModelSettings(supabase: ServerSupabaseClient): Promise<ModelSettingsSnapshot> {
  const { data, error } = await supabase.from("model_settings").select(MODEL_SETTINGS_COLUMNS);
  if (error) throw unavailableSettingsError();
  const models = normalizeStoredRows(data);
  if (!models) throw unavailableSettingsError();
  return { models, source: "database" };
}

export async function readEffectiveModelSettings(supabase: ServerSupabaseClient): Promise<ModelSettingsSnapshot> {
  return readModelSettings(supabase);
}

function normalizeDefaultPolicy(value: unknown): ModelDefaultPolicy | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) return null;
  const row = value[0];
  if (
    typeof row.model_id !== "string"
    || (!isSupportedModel(row.model_id) && !isDynamicModelId(row.model_id))
    || !isPositiveRevision(row.revision)
    || typeof row.updated_at !== "string"
    || (row.updated_by !== null && typeof row.updated_by !== "string")
  ) return null;
  return {
    modelId: row.model_id,
    revision: row.revision,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function readModelDefaultPolicy(
  supabase: ServerSupabaseClient,
): Promise<ModelDefaultPolicy> {
  const { data, error } = await supabase
    .from("model_default_policy")
    .select(MODEL_DEFAULT_POLICY_COLUMNS)
    .eq("id", true);
  if (error) throw unavailableSettingsError();
  const policy = normalizeDefaultPolicy(data);
  if (!policy) throw unavailableSettingsError();
  return policy;
}

export function globalDefaultModelSetting(
  snapshot: ModelSettingsSnapshot,
  policy: ModelDefaultPolicy,
): ModelSetting {
  const setting = enabledModelSetting(snapshot, policy.modelId, false);
  if (setting.isDynamic && setting.accessScope !== "all") throw unavailableSettingsError();
  return setting;
}

export function parseDefaultModelPatch(body: unknown): { modelId: string; revision: number } {
  if (
    !isRecord(body)
    || !hasExactKeys(body, ["modelId", "revision"])
    || typeof body.modelId !== "string"
    || (!isSupportedModel(body.modelId) && !isDynamicModelId(body.modelId))
    || !isPositiveRevision(body.revision)
  ) {
    throw new UserVisibleError("Die Standardmodell-Konfiguration ist ungültig.", 400);
  }
  return { modelId: body.modelId, revision: body.revision };
}

export async function updateGlobalDefaultModel(options: {
  supabase: ServerSupabaseClient;
  adminUserId: string;
  modelId: string;
  revision: number;
}): Promise<ModelDefaultPolicy> {
  const target = enabledModelSetting(await readModelSettings(options.supabase), options.modelId, false);
  if (target.isDynamic && target.accessScope !== "all") {
    throw new UserVisibleError(
      "Das Standardmodell muss aktiviert und für alle Benutzer verfügbar sein.",
      400,
    );
  }
  const { error } = await options.supabase.rpc("update_global_default_model", {
    p_admin_user_id: options.adminUserId,
    p_model_id: options.modelId,
    p_expected_revision: options.revision,
  });
  if (error) {
    if (typeof error === "object" && error.code === "40001") throw revisionConflictError();
    if (typeof error === "object" && (error.code === "23503" || error.code === "23514")) {
      throw new UserVisibleError(
        "Das Standardmodell muss aktiviert und für alle Benutzer verfügbar sein.",
        400,
      );
    }
    throw new UserVisibleError("Das Standardmodell konnte nicht gespeichert werden.", 503);
  }
  return readModelDefaultPolicy(options.supabase);
}

export function parseModelImagePatch(body: unknown): { imageAssetId: string | null; revision: number } {
  const imageAssetId = isRecord(body) ? normalizeImageAssetId(body.imageAssetId) : undefined;
  if (
    !isRecord(body)
    || !hasExactKeys(body, ["imageAssetId", "revision"])
    || imageAssetId === undefined
    || !isPositiveRevision(body.revision)
  ) {
    throw new UserVisibleError("Die Modellbild-Konfiguration ist ungültig.", 400);
  }
  return { imageAssetId, revision: body.revision };
}

export async function updateModelImage(options: {
  supabase: ServerSupabaseClient;
  adminUserId: string;
  modelId: string;
  imageAssetId: string | null;
  revision: number;
}): Promise<ModelSetting> {
  if (!isSupportedModel(options.modelId) && !isDynamicModelId(options.modelId)) {
    throw new UserVisibleError("Das Modell wurde nicht gefunden.", 404);
  }
  const { error } = await options.supabase.rpc("update_model_image", {
    p_admin_user_id: options.adminUserId,
    p_model_id: options.modelId,
    p_expected_revision: options.revision,
    p_image_asset_id: options.imageAssetId,
  });
  if (error) {
    if (typeof error === "object" && error.code === "40001") throw revisionConflictError();
    if (typeof error === "object" && error.code === "23503") {
      throw new UserVisibleError("Das ausgewählte Bild wurde nicht gefunden.", 404);
    }
    throw new UserVisibleError("Das Modellbild konnte nicht gespeichert werden.", 503);
  }
  const snapshot = await readModelSettings(options.supabase);
  const setting = snapshot.models.find((candidate) => candidate.id === options.modelId);
  if (!setting) throw new UserVisibleError("Das Modell konnte nicht geladen werden.", 503);
  return setting;
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
    const { id, reasoning } = value;
    if (
      typeof id !== "string" || !isSupportedModel(id)
      || typeof value.enabled !== "boolean"
      || typeof reasoning !== "string" || !isReasoningSettingForModel(id, reasoning)
      || !isPositiveRevision(value.revision) || byId.has(id)
    ) {
      throw new UserVisibleError("Die Modellkonfiguration enthält ungültige Werte.", 400);
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
    if (setting.enabled && !currentSetting?.enabled && !isConfigured(setting.id)) {
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
  if (options.current.source !== "database") throw unavailableSettingsError();
  const currentById = new Map(options.current.models.map((setting) => [setting.id, setting]));
  const changed = options.requested.filter((setting) => {
    const previous = currentById.get(setting.id) as BuiltinModelSetting | undefined;
    return !previous || previous.enabled !== setting.enabled || previous.reasoning !== setting.reasoning;
  });
  if (changed.length === 0) return options.current;
  const { error } = await options.supabase.rpc("update_model_settings", {
    p_admin_user_id: options.adminUserId,
    p_changes: changed.map((setting) => ({
      model_id: setting.id,
      enabled: setting.enabled,
      reasoning_setting: setting.reasoning,
      expected_revision: setting.revision,
    })),
  });
  if (error) {
    if (typeof error === "object" && error.code === "40001") throw revisionConflictError();
    if (typeof error === "object" && error.code === "23514") {
      throw new UserVisibleError("Zuerst muss ein anderes Standardmodell gewählt werden.", 409);
    }
    throw new UserVisibleError("Die Modellkonfiguration konnte nicht gespeichert werden.", 503);
  }
  return readModelSettings(options.supabase);
}

function dynamicCredentialConfigured(setting: DynamicModelSetting): boolean {
  try {
    return Boolean(decryptOpenAICompatibleApiKey(setting.apiKeyCiphertext));
  } catch {
    return false;
  }
}

function dynamicVisible(setting: DynamicModelSetting, isAdmin: boolean): boolean {
  return setting.accessScope === "all" || (isAdmin && setting.accessScope === "admins");
}

export function publicEnabledModelDtos(snapshot: ModelSettingsSnapshot, isAdmin = false): PublicModelDto[] {
  return snapshot.models.flatMap((setting) => {
    if (!setting.enabled) return [];
    if (setting.isDynamic) {
      if (!dynamicVisible(setting, isAdmin) || !dynamicCredentialConfigured(setting)) return [];
      return [{
        id: setting.id,
        label: setting.displayName ?? setting.upstreamModel,
        imageAssetId: setting.imageAssetId ?? null,
      }];
    }
    if (!isModelProviderConfigured(setting.id)) return [];
    return [{
      id: setting.id,
      label: getModelDefinition(setting.id).label,
      imageAssetId: setting.imageAssetId ?? null,
    }];
  });
}

export function adminModelDtos(snapshot: ModelSettingsSnapshot): AdminModelDto[] {
  return snapshot.models.map((setting) => {
    if (setting.revision === null) throw unavailableSettingsError();
    if (setting.isDynamic) {
      return {
        id: setting.id,
        label: setting.displayName ?? setting.upstreamModel,
        displayName: setting.displayName,
        enabled: setting.enabled,
        alwaysEnabled: false,
        reasoning: "disabled",
        reasoningOptions: [{ value: "disabled", label: "Deaktiviert" }],
        providerConfigured: dynamicCredentialConfigured(setting),
        revision: setting.revision,
        updatedAt: setting.updatedAt,
        provider: "openai_compatible",
        upstreamModel: setting.upstreamModel,
        baseUrl: setting.baseUrl,
        accessScope: setting.accessScope,
        imageAssetId: setting.imageAssetId ?? null,
      };
    }
    const definition = getModelDefinition(setting.id);
    return {
      id: setting.id,
      label: definition.label,
      enabled: setting.enabled,
      alwaysEnabled: definition.alwaysEnabled,
      reasoning: setting.reasoning,
      reasoningOptions: definition.reasoningOptions.map((value) => ({ value, label: REASONING_LABELS[value] })),
      providerConfigured: isModelProviderConfigured(setting.id),
      revision: setting.revision,
      updatedAt: setting.updatedAt,
      imageAssetId: setting.imageAssetId ?? null,
    };
  });
}

export function enabledModelSetting(
  snapshot: ModelSettingsSnapshot,
  model: string,
  isAdmin = false,
): ModelSetting {
  const setting = snapshot.models.find((candidate) => candidate.id === model);
  if (!setting?.enabled) {
    throw new UserVisibleError("Das ausgewählte Modell ist derzeit nicht aktiviert.", 400);
  }
  if (setting.isDynamic) {
    if (!dynamicVisible(setting, isAdmin)) {
      throw new UserVisibleError("Das ausgewählte Modell ist nicht verfügbar.", 403);
    }
    if (!dynamicCredentialConfigured(setting)) {
      throw new UserVisibleError("Das ausgewählte Modell ist derzeit nicht verfügbar.", 503);
    }
    return setting;
  }
  if (!isModelProviderConfigured(setting.id)) {
    throw new UserVisibleError("Das ausgewählte Modell ist derzeit nicht verfügbar.", 503);
  }
  return setting;
}

function generateOpaqueModelId(): string {
  return `openai:${randomUUID()}`;
}

export async function createOpenAICompatibleModel(options: {
  supabase: ServerSupabaseClient;
  adminUserId: string;
  input: OpenAICompatibleModelInput & { apiKey: string };
}): Promise<DynamicModelSetting> {
  const modelId = generateOpaqueModelId();
  const { error } = await options.supabase.rpc("create_openai_compatible_model", {
    p_model_id: modelId,
    p_upstream_model: options.input.upstreamModel,
    p_display_name: options.input.displayName,
    p_base_url: options.input.baseUrl,
    p_access_scope: options.input.accessScope,
    p_api_key_ciphertext: encryptOpenAICompatibleApiKey(options.input.apiKey),
    p_admin_user_id: options.adminUserId,
  });
  if (error) {
    const pgError = error as { code?: string };
    if (pgError.code === "23505") {
      throw new UserVisibleError("Diese Modell-ID ist bereits konfiguriert.", 409);
    }
    throw new UserVisibleError("Das Modell konnte nicht angelegt werden.", 503);
  }
  const snapshot = await readModelSettings(options.supabase);
  const created = snapshot.models.find((setting): setting is DynamicModelSetting => setting.isDynamic && setting.id === modelId);
  if (!created) throw new UserVisibleError("Das Modell wurde angelegt, konnte aber nicht geladen werden.", 503);
  return created;
}

export async function updateOpenAICompatibleModel(options: {
  supabase: ServerSupabaseClient;
  adminUserId: string;
  modelId: string;
  input: OpenAICompatibleModelInput & { revision: number };
}): Promise<DynamicModelSetting> {
  if (!isDynamicModelId(options.modelId)) {
    throw new UserVisibleError("Das Modell wurde nicht gefunden.", 404);
  }
  const { error } = await options.supabase.rpc("update_openai_compatible_model", {
    p_model_id: options.modelId,
    p_expected_revision: options.input.revision,
    p_upstream_model: options.input.upstreamModel,
    p_display_name: options.input.displayName,
    p_base_url: options.input.baseUrl,
    p_access_scope: options.input.accessScope,
    p_api_key_ciphertext: options.input.apiKey
      ? encryptOpenAICompatibleApiKey(options.input.apiKey)
      : null,
    p_admin_user_id: options.adminUserId,
  });
  if (error) {
    if (typeof error === "object" && error.code === "40001") throw revisionConflictError();
    if (typeof error === "object" && error.code === "23514") {
      throw new UserVisibleError("Zuerst muss ein anderes Standardmodell gewählt werden.", 409);
    }
    if (typeof error === "object" && error.code === "23505") {
      throw new UserVisibleError("Diese Modell-ID ist bereits konfiguriert.", 409);
    }
    throw new UserVisibleError("Das Modell konnte nicht gespeichert werden.", 503);
  }
  const snapshot = await readModelSettings(options.supabase);
  const updated = snapshot.models.find((setting): setting is DynamicModelSetting => setting.isDynamic && setting.id === options.modelId);
  if (!updated) throw new UserVisibleError("Das Modell konnte nicht geladen werden.", 503);
  return updated;
}

export async function deleteOpenAICompatibleModel(options: {
  supabase: ServerSupabaseClient;
  adminUserId: string;
  modelId: string;
  revision: number;
}): Promise<void> {
  if (!isDynamicModelId(options.modelId)) {
    throw new UserVisibleError("Das Modell wurde nicht gefunden.", 404);
  }
  const { error } = await options.supabase.rpc("delete_openai_compatible_model", {
    p_model_id: options.modelId,
    p_expected_revision: options.revision,
    p_admin_user_id: options.adminUserId,
  });
  if (error) {
    if (typeof error === "object" && error.code === "40001") throw revisionConflictError();
    if (typeof error === "object" && error.code === "23514") {
      throw new UserVisibleError("Zuerst muss ein anderes Standardmodell gewählt werden.", 409);
    }
    throw new UserVisibleError("Das Modell konnte nicht gelöscht werden.", 503);
  }
}
