import crypto from "node:crypto";
import { z } from "zod";
import type {
  HexAddress,
  X402Requirement,
  X402Settlement,
} from "@aethernet/shared-types";
import type {
  FacilitatorSettlementResult,
  SignedPaymentPayload,
  X402FacilitatorConfig,
} from "./index.js";

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

const verifyResponseSchema = z
  .object({
    valid: z.boolean().optional(),
    success: z.boolean().optional(),
    canSettle: z.boolean().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
    code: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const settleResponseSchema = z
  .object({
    success: z.boolean().optional(),
    txHash: z.string().regex(TX_HASH_PATTERN).optional(),
    transactionHash: z.string().regex(TX_HASH_PATTERN).optional(),
    network: z.string().optional(),
    payer: z.string().regex(ADDRESS_PATTERN).optional(),
    payee: z.string().regex(ADDRESS_PATTERN).optional(),
    amount: z.string().optional(),
    settledAt: z.string().optional(),
    timestamp: z.string().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
    code: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

interface AdapterOptions {
  config: X402FacilitatorConfig;
}

interface HttpOutcome {
  ok: boolean;
  status: number;
  body: unknown;
}

interface VerifyAndSettleInput {
  expectedResource: string;
  requirement: X402Requirement;
  payload: SignedPaymentPayload;
}

export class X402FacilitatorAdapter {
  private readonly config: X402FacilitatorConfig;

  constructor(options: AdapterOptions) {
    this.config = options.config;
  }

  async verifyAndSettle(input: VerifyAndSettleInput): Promise<FacilitatorSettlementResult> {
    const accepted = this.pickRequirementForPayload(input.requirement, input.payload);
    if (!accepted) {
      return {
        success: false,
        status: 402,
        error: "No matching payment requirement for provided payload",
      };
    }

    const idempotencyKey = this.createIdempotencyKey(input.expectedResource, input.payload);

    const verifyBody = {
      x402Version: 2,
      paymentPayload: input.payload,
      paymentRequirements: accepted,
    };

    const verifyOutcome = await this.postWithRetry(this.config.verifyUrl, verifyBody, {
      idempotencyKey,
      operation: "verify",
    });

    const verifyParse = verifyResponseSchema.safeParse(normalizeObject(verifyOutcome.body));
    if (!verifyParse.success) {
      return {
        success: false,
        status: 502,
        error: `Invalid facilitator verify response schema: ${verifyParse.error.issues[0]?.message ?? "unknown issue"}`,
        verifyResponse: verifyOutcome.body,
      };
    }

    const verifyError = inferFailure(verifyParse.data);
    if (!verifyOutcome.ok || verifyError) {
      return {
        success: false,
        status: verifyOutcome.status,
        error: verifyError ?? `Facilitator verify failed (${verifyOutcome.status})`,
        verifyResponse: verifyOutcome.body,
      };
    }

    const settleBody = {
      x402Version: 2,
      paymentPayload: input.payload,
      paymentRequirements: accepted,
      verification: verifyParse.data,
    };

    const settleOutcome = await this.postWithRetry(this.config.settleUrl, settleBody, {
      idempotencyKey,
      operation: "settle",
    });

    const settleParse = settleResponseSchema.safeParse(normalizeObject(settleOutcome.body));
    if (!settleParse.success) {
      return {
        success: false,
        status: 502,
        error: `Invalid facilitator settle response schema: ${settleParse.error.issues[0]?.message ?? "unknown issue"}`,
        verifyResponse: verifyOutcome.body,
        settleResponse: settleOutcome.body,
      };
    }

    const settleError = inferFailure(settleParse.data);
    if (!settleOutcome.ok || settleError) {
      return {
        success: false,
        status: settleOutcome.status,
        error: settleError ?? `Facilitator settle failed (${settleOutcome.status})`,
        verifyResponse: verifyOutcome.body,
        settleResponse: settleOutcome.body,
      };
    }

    return {
      success: true,
      status: settleOutcome.status,
      settlement: normalizeSettlement(settleParse.data, input.payload),
      verifyResponse: verifyOutcome.body,
      settleResponse: settleOutcome.body,
    };
  }

  private async postWithRetry(
    url: string,
    body: unknown,
    options: { idempotencyKey: string; operation: "verify" | "settle" },
  ): Promise<HttpOutcome> {
    const maxRetries = this.config.maxRetries ?? 2;
    const retryDelayMs = this.config.retryDelayMs ?? 150;

    let attempt = 0;
    while (true) {
      const outcome = await this.post(url, body, options.idempotencyKey, options.operation);
      const shouldRetry =
        (!outcome.ok && RETRYABLE_STATUS.has(outcome.status)) || outcome.status === 0;

      if (!shouldRetry || attempt >= maxRetries) {
        return outcome;
      }

      attempt += 1;
      const jitter = Math.floor(Math.random() * 20);
      await wait(retryDelayMs * attempt + jitter);
    }
  }

  private async post(
    url: string,
    body: unknown,
    idempotencyKey: string,
    operation: "verify" | "settle",
  ): Promise<HttpOutcome> {
    const timeoutMs = this.config.timeoutMs ?? 10_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const idempotencyHeader = this.config.idempotencyHeaderName ?? "Idempotency-Key";
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
          [idempotencyHeader]: `${idempotencyKey}:${operation}`,
          ...(this.config.headers ?? {}),
        },
        body: JSON.stringify(body),
      });

      return {
        ok: response.ok,
        status: response.status,
        body: await parseResponseBody(response),
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        body: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private pickRequirementForPayload(
    requirement: X402Requirement,
    payload: SignedPaymentPayload,
  ): X402Requirement["accepts"][number] | null {
    return (
      requirement.accepts.find((entry) => {
        return (
          entry.scheme === payload.scheme &&
          entry.network === payload.network &&
          entry.resource === payload.resource &&
          entry.payToAddress.toLowerCase() === payload.payToAddress.toLowerCase() &&
          entry.maxAmountRequired === payload.amount
        );
      }) ?? null
    );
  }

  private createIdempotencyKey(resource: string, payload: SignedPaymentPayload): string {
    const digest = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          resource,
          network: payload.network,
          payer: payload.payer.toLowerCase(),
          payee: payload.payToAddress.toLowerCase(),
          amount: payload.amount,
          nonce: payload.nonce,
        }),
      )
      .digest("hex");

    return `x402-${digest}`;
  }
}

function inferFailure(body: {
  valid?: boolean;
  success?: boolean;
  error?: string;
  message?: string;
  code?: string | number;
}): string | undefined {
  if (body.valid === false || body.success === false) {
    if (typeof body.error === "string") return body.error;
    if (typeof body.message === "string") return body.message;
    return "Facilitator reported failure";
  }

  if (typeof body.error === "string") {
    return body.error;
  }

  if (typeof body.message === "string" && body.code !== undefined) {
    return `${String(body.code)}: ${body.message}`;
  }

  return undefined;
}

function normalizeSettlement(
  body: {
    txHash?: string;
    transactionHash?: string;
    network?: string;
    payer?: string;
    payee?: string;
    amount?: string;
    settledAt?: string;
    timestamp?: string;
  },
  payload: SignedPaymentPayload,
): X402Settlement {
  return {
    x402Version: 2,
    success: true,
    network: body.network ?? payload.network,
    payer: (body.payer ?? payload.payer) as HexAddress,
    payee: (body.payee ?? payload.payToAddress) as HexAddress,
    amount: body.amount ?? payload.amount,
    txHash: body.txHash ?? body.transactionHash,
    settledAt: body.settledAt ?? body.timestamp ?? new Date().toISOString(),
  };
}

function normalizeObject(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object") {
    return body as Record<string, unknown>;
  }

  return {};
}

async function parseResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
