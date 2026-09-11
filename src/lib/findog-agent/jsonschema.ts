/**
 * Tiny JSON-Schema subset used to validate tool arguments.
 *
 * Tool arguments come from an untrusted model, so they are validated against the
 * exact schema that was advertised to the provider before any adapter runs.
 */

export type FindogAgentJsonSchema = {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  properties?: Record<string, FindogAgentJsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: FindogAgentJsonSchema;
  enum?: Array<string | number | boolean>;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
};

export type FindogAgentArgumentValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateNode(
  schema: FindogAgentJsonSchema,
  value: unknown,
  path: string,
): string | null {
  switch (schema.type) {
    case "object": {
      if (!isPlainObject(value)) {
        return `"${path}" muss ein Objekt sein.`;
      }
      const properties = schema.properties ?? {};
      for (const required of schema.required ?? []) {
        if (!(required in value)) {
          return `Das Pflichtfeld "${path}${required}" fehlt.`;
        }
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in properties)) {
            return `Das Feld "${path}${key}" ist nicht erlaubt.`;
          }
        }
      }
      for (const [key, childSchema] of Object.entries(properties)) {
        if (!(key in value)) {
          continue;
        }
        const error = validateNode(childSchema, value[key], `${path}${key}.`);
        if (error) {
          return error;
        }
      }
      return null;
    }
    case "array": {
      if (!Array.isArray(value)) {
        return `"${path.slice(0, -1)}" muss eine Liste sein.`;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        return `"${path.slice(0, -1)}" benötigt mindestens ${schema.minItems} Einträge.`;
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        return `"${path.slice(0, -1)}" erlaubt höchstens ${schema.maxItems} Einträge.`;
      }
      if (schema.items) {
        for (let index = 0; index < value.length; index += 1) {
          const error = validateNode(schema.items, value[index], `${path}${index}.`);
          if (error) {
            return error;
          }
        }
      }
      return null;
    }
    case "string": {
      if (typeof value !== "string") {
        return `"${path.slice(0, -1)}" muss eine Zeichenkette sein.`;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        return `"${path.slice(0, -1)}" ist zu kurz.`;
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        return `"${path.slice(0, -1)}" ist zu lang.`;
      }
      break;
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return `"${path.slice(0, -1)}" muss eine ganze Zahl sein.`;
      }
      break;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `"${path.slice(0, -1)}" muss eine Zahl sein.`;
      }
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        return `"${path.slice(0, -1)}" muss true oder false sein.`;
      }
      break;
    }
    default:
      break;
  }

  if (schema.enum && !schema.enum.some((entry) => entry === value)) {
    return `"${path.slice(0, -1)}" hat keinen erlaubten Wert.`;
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return `"${path.slice(0, -1)}" liegt unter dem erlaubten Wert.`;
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return `"${path.slice(0, -1)}" liegt über dem erlaubten Wert.`;
    }
  }
  return null;
}

export function validateFindogAgentArguments(
  schema: FindogAgentJsonSchema,
  value: unknown,
): FindogAgentArgumentValidation {
  const error = validateNode(schema, value, "");
  if (error) {
    return { ok: false, message: error };
  }
  return { ok: true, value: value as Record<string, unknown> };
}
