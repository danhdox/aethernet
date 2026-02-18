import type {
  BrainAction,
  BrainConfig,
  BrainProvider,
  BrainTurnInput,
  BrainTurnOutput,
} from "@aethernet/shared-types";

const EMPTY_TURN: BrainTurnOutput = {
  summary: "No actionable output generated.",
  nextActions: [{ type: "noop", reason: "empty_output" }],
  integrity: "malformed",
};

const ALLOWED_ACTIONS = new Set([
  "send_message",
  "replicate",
  "self_modify",
  "record_fact",
  "record_episode",
  "invoke_tool",
  "sleep",
  "noop",
]);

export class OpenAiBrainProvider implements BrainProvider {
  readonly name = "openai";
  private readonly config: BrainConfig;

  constructor(config: BrainConfig) {
    this.config = config;
  }

  async generateTurn(input: BrainTurnInput): Promise<BrainTurnOutput> {
    const apiKey = process.env[this.config.apiKeyEnv];
    if (!apiKey) {
      return {
        summary: `Brain skipped: missing API key env ${this.config.apiKeyEnv}.`,
        nextActions: [{ type: "noop", reason: "missing_api_key" }],
        integrity: "malformed",
      };
    }

    const system = [
      "You are the autonomous brain for Aethernet.",
      "Return strict JSON only.",
      "Allowed action types: send_message, replicate, self_modify, record_fact, record_episode, invoke_tool, sleep, noop.",
      "Never output arbitrary shell commands.",
      "Prefer minimal, safe actions with clear reasons.",
    ].join("\n");

    const body = JSON.stringify({
      model: this.config.model,
      temperature: this.config.temperature,
      max_output_tokens: this.config.maxOutputTokens,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: system }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify(input) }],
        },
      ],
    });

    const maxAttempts = Math.max(1, this.config.maxRetries + 1);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await fetch(this.config.apiUrl, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body,
        });

        if (!response.ok) {
          const shouldRetry = isRetriableStatus(response.status) && attempt < maxAttempts;
          if (shouldRetry) {
            await sleep(backoffMs(this.config.retryBackoffMs, attempt));
            continue;
          }
          return {
            summary: `Brain request failed (${response.status}).`,
            nextActions: [{ type: "noop", reason: "request_failed" }],
            integrity: "malformed",
          };
        }

        const payload = (await response.json()) as Record<string, unknown>;
        const text = extractText(payload);
        if (!text) {
          return EMPTY_TURN;
        }

        const parsed = parseJsonObject(text);
        if (!parsed) {
          return {
            summary: "Brain output was not valid JSON.",
            nextActions: [{ type: "noop", reason: "invalid_json" }],
            integrity: "malformed",
          };
        }

        return sanitizeOutput(parsed);
      } catch (error) {
        const lastAttempt = attempt >= maxAttempts;
        if (lastAttempt) {
          return {
            summary: `Brain request failed: ${error instanceof Error ? error.message : String(error)}`,
            nextActions: [{ type: "noop", reason: "request_exception" }],
            integrity: "malformed",
          };
        }
        await sleep(backoffMs(this.config.retryBackoffMs, attempt));
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      summary: "Brain request aborted after retries.",
      nextActions: [{ type: "noop", reason: "retry_exhausted" }],
      integrity: "malformed",
    };
  }
}

function extractText(payload: Record<string, unknown>): string | null {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const output = payload.output;
  if (!Array.isArray(output)) {
    return null;
  }

  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string" && text.trim()) {
        chunks.push(text);
      }
    }
  }

  return chunks.length ? chunks.join("\n") : null;
}

function parseJsonObject(input: string): Record<string, unknown> | null {
  const trimmed = input.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function sanitizeOutput(raw: Record<string, unknown>): BrainTurnOutput {
  const summary = typeof raw.summary === "string" && raw.summary.trim()
    ? raw.summary.trim()
    : "Autonomy turn generated without summary.";

  const rawActions = Array.isArray(raw.nextActions) ? raw.nextActions : [];
  const nextActions: BrainAction[] = [];
  for (const item of rawActions) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const type = normalizeActionType(obj.type);
    if (!type) continue;
    const reason = typeof obj.reason === "string" ? obj.reason : undefined;
    const params = isRecord(obj.params) ? obj.params : undefined;
    nextActions.push({ type, reason, params });
  }

  const memoryWrites = isRecord(raw.memoryWrites) ? raw.memoryWrites : undefined;
  const facts = Array.isArray(memoryWrites?.facts)
    ? memoryWrites?.facts
        .filter(isRecord)
        .map((entry) => ({
          key: typeof entry.key === "string" ? entry.key : "",
          value: typeof entry.value === "string" ? entry.value : "",
          confidence: Number.isFinite(Number(entry.confidence))
            ? Number(entry.confidence)
            : undefined,
          source: typeof entry.source === "string" ? entry.source : undefined,
        }))
        .filter((entry) => entry.key && entry.value)
    : undefined;

  const episodes = Array.isArray(memoryWrites?.episodes)
    ? memoryWrites?.episodes
        .filter(isRecord)
        .map((entry) => ({
          summary: typeof entry.summary === "string" ? entry.summary : "",
          outcome: typeof entry.outcome === "string" ? entry.outcome : undefined,
          actionType: typeof entry.actionType === "string" ? entry.actionType : undefined,
          metadata: isRecord(entry.metadata) ? entry.metadata : undefined,
        }))
        .filter((entry) => entry.summary)
    : undefined;

  const sleepMs = Number.isFinite(Number(raw.sleepMs)) ? Number(raw.sleepMs) : undefined;

  return {
    summary,
    nextActions: nextActions.length ? nextActions : [{ type: "noop", reason: "no_actions" }],
    memoryWrites: facts || episodes ? { facts, episodes } : undefined,
    sleepMs,
    integrity: "ok",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeActionType(value: unknown): BrainAction["type"] | null {
  if (typeof value !== "string" || !ALLOWED_ACTIONS.has(value)) {
    return null;
  }
  return value as BrainAction["type"];
}

function isRetriableStatus(status: number): boolean {
  return status === 408
    || status === 409
    || status === 425
    || status === 429
    || status === 500
    || status === 502
    || status === 503
    || status === 504;
}

function backoffMs(base: number, attempt: number): number {
  const boundedBase = Math.max(100, Math.floor(base));
  const value = boundedBase * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(value, 30_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
