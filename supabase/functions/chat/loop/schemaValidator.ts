// Pure JSON-Schema + OpenAI tool-shape validator.
// Lifted from chat/index.ts (step 2 of the split). No behavior change.

export interface ToolDefLike {
  type?: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: unknown;
  };
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateJsonSchema(node: unknown, path = "$"): ValidationResult {
  if (node === null || node === undefined) return { valid: true };
  if (typeof node !== "object") return { valid: true };
  const n = node as Record<string, unknown>;

  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    const arr = n[key];
    if (arr !== undefined) {
      if (!Array.isArray(arr) || arr.length === 0) {
        return { valid: false, reason: `${path}.${key} must be a non-empty array` };
      }
      for (let i = 0; i < arr.length; i++) {
        const r = validateJsonSchema(arr[i], `${path}.${key}[${i}]`);
        if (!r.valid) return r;
      }
    }
  }

  const t = n.type;
  if (t === "array") {
    if (!n.items || typeof n.items !== "object") {
      return { valid: false, reason: `${path}: type=array missing 'items' schema` };
    }
    const r = validateJsonSchema(n.items, `${path}.items`);
    if (!r.valid) return r;
  }
  if (t === "object") {
    if (n.properties !== undefined) {
      if (typeof n.properties !== "object" || n.properties === null) {
        return { valid: false, reason: `${path}.properties must be an object` };
      }
      for (const [k, v] of Object.entries(n.properties as Record<string, unknown>)) {
        const r = validateJsonSchema(v, `${path}.properties.${k}`);
        if (!r.valid) return r;
      }
    }
    if (n.required !== undefined) {
      if (!Array.isArray(n.required) || !n.required.every((x) => typeof x === "string")) {
        return { valid: false, reason: `${path}.required must be string[]` };
      }
      const props = (n.properties as Record<string, unknown>) || {};
      for (const r of n.required as string[]) {
        if (!(r in props)) {
          return { valid: false, reason: `${path}.required references missing property '${r}'` };
        }
      }
    }
  }
  if (Array.isArray(n.enum) && n.enum.length === 0) {
    return { valid: false, reason: `${path}.enum is empty` };
  }
  return { valid: true };
}

/**
 * Validate a single OpenAI tool definition (top-level shape + recursive schema).
 * Malformed tools are dropped individually so one broken schema can never break
 * the whole tool list.
 */
export function isValidToolSchema(tool: ToolDefLike): ValidationResult {
  try {
    if (!tool || tool.type !== "function") return { valid: false, reason: "missing type:function" };
    const fn = tool.function;
    if (!fn || typeof fn.name !== "string" || fn.name.length === 0) return { valid: false, reason: "missing function.name" };
    if (typeof fn.description !== "string") return { valid: false, reason: "missing description" };
    const params = fn.parameters as Record<string, unknown> | undefined;
    if (!params || typeof params !== "object") return { valid: false, reason: "missing parameters object" };
    if (params.type !== "object") return { valid: false, reason: "parameters.type must be 'object'" };
    const r = validateJsonSchema(params, `${fn.name}.parameters`);
    if (!r.valid) return r;
    JSON.stringify(tool);
    return { valid: true };
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
