const getBackendBaseUrl = () => {
  const explicit = import.meta.env.VITE_BACKEND_BASE_URL as string | undefined;
  const supabase = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  return (explicit || supabase || "").replace(/\/+$/, "");
};

const getFunctionPrefix = () => {
  const explicit = import.meta.env.VITE_BACKEND_FUNCTION_PREFIX as string | undefined;
  return (explicit || "/functions/v1").replace(/\/+$/, "");
};

const getApiKey = () => {
  const explicit = import.meta.env.VITE_BACKEND_API_KEY as string | undefined;
  const supabase = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  return explicit || supabase || "";
};

export const buildFunctionUrl = (functionName: string) => {
  const base = getBackendBaseUrl();
  const prefix = getFunctionPrefix();
  return `${base}${prefix}/${functionName}`;
};

interface InvokeFunctionOptions {
  timeoutMs?: number;
}

export async function invokeFunction<T = unknown>(
  functionName: string,
  body: Record<string, unknown>,
  options: InvokeFunctionOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const apiKey = getApiKey();

  try {
    const res = await fetch(buildFunctionUrl(functionName), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}`, apikey: apiKey } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errorMessage =
        (payload as { error?: string; message?: string }).error ||
        (payload as { error?: string; message?: string }).message ||
        `Request failed (${res.status})`;
      throw new Error(errorMessage);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
