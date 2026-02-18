import crypto from "node:crypto";
import {
  createPublicClient,
  defineChain,
  formatUnits,
  http,
  parseAbi,
  verifyMessage,
  type Address,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import type {
  ChainProfile,
  HexAddress,
  X402Requirement,
  X402Settlement,
} from "@aethernet/shared-types";
import { X402FacilitatorAdapter } from "./facilitator.js";

export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
export const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";

const BALANCE_OF_ABI = parseAbi([
  "function balanceOf(address account) external view returns (uint256)",
]);

export interface SignedPaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  resource: string;
  payer: HexAddress;
  payToAddress: HexAddress;
  amount: string;
  timestamp: string;
  nonce: string;
  signature: Hex;
}

export interface X402FacilitatorConfig {
  verifyUrl: string;
  settleUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  maxRetries?: number;
  retryDelayMs?: number;
  idempotencyHeaderName?: string;
}

export interface FacilitatorSettlementResult {
  success: boolean;
  status: number;
  settlement?: X402Settlement;
  error?: string;
  verifyResponse?: unknown;
  settleResponse?: unknown;
}

export async function getUsdcBalance(
  chainProfile: ChainProfile,
  walletAddress: HexAddress,
): Promise<string> {
  if (!chainProfile.usdcAddress) {
    return "0";
  }

  const client = createPublicClient({
    chain: toViemChain(chainProfile),
    transport: http(chainProfile.rpcUrl),
  });

  const balanceRaw = await client.readContract({
    address: chainProfile.usdcAddress as Address,
    abi: BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [walletAddress as Address],
  });

  return formatUnits(balanceRaw, 6);
}

export function buildPaymentRequiredHeader(requirement: X402Requirement): string {
  return Buffer.from(JSON.stringify(requirement)).toString("base64");
}

export function parsePaymentRequired(header: string | null): X402Requirement | null {
  if (!header) return null;

  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf-8")) as X402Requirement;
  } catch {
    return null;
  }
}

export async function x402Fetch(
  url: string,
  account: PrivateKeyAccount,
  init: RequestInit = {},
): Promise<{ status: number; data: unknown; settlement?: X402Settlement }> {
  const firstResponse = await fetch(url, init);
  if (firstResponse.status !== 402) {
    return {
      status: firstResponse.status,
      data: await parseResponseBody(firstResponse),
    };
  }

  const requirement =
    parsePaymentRequired(firstResponse.headers.get(PAYMENT_REQUIRED_HEADER)) ??
    ((await parseResponseBody(firstResponse)) as X402Requirement | null);

  if (!requirement?.accepts?.length) {
    throw new Error("x402: missing payment requirements in 402 response");
  }

  const accepted = requirement.accepts[0];
  const payload = await createSignedPaymentPayload(url, account, accepted);

  const secondResponse = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      [PAYMENT_SIGNATURE_HEADER]: Buffer.from(JSON.stringify(payload)).toString("base64"),
    },
  });

  const settlement = parsePaymentResponse(secondResponse.headers.get(PAYMENT_RESPONSE_HEADER));

  return {
    status: secondResponse.status,
    data: await parseResponseBody(secondResponse),
    settlement,
  };
}

export async function verifyPaymentSignature(
  headerValue: string,
  expectedResource: string,
): Promise<{ valid: boolean; payload?: SignedPaymentPayload; error?: string }> {
  const payload = decodePaymentSignatureHeader(headerValue);
  if (!payload) {
    return { valid: false, error: "Invalid PAYMENT-SIGNATURE format" };
  }

  if (payload.resource !== expectedResource) {
    return { valid: false, error: "Resource mismatch" };
  }

  const canonical = paymentCanonicalMessage(payload);
  const valid = await verifyMessage({
    address: payload.payer as Address,
    message: canonical,
    signature: payload.signature,
  });

  if (!valid) {
    return { valid: false, error: "Signature verification failed" };
  }

  return {
    valid: true,
    payload,
  };
}

export async function facilitatorVerifyAndSettle(input: {
  paymentSignatureHeader: string;
  expectedResource: string;
  requirement: X402Requirement;
  facilitator: X402FacilitatorConfig;
}): Promise<FacilitatorSettlementResult> {
  const verification = await verifyPaymentSignature(
    input.paymentSignatureHeader,
    input.expectedResource,
  );

  if (!verification.valid || !verification.payload) {
    return {
      success: false,
      status: 402,
      error: verification.error ?? "Invalid payment signature",
    };
  }

  const adapter = new X402FacilitatorAdapter({
    config: input.facilitator,
  });

  return adapter.verifyAndSettle({
    expectedResource: input.expectedResource,
    requirement: input.requirement,
    payload: verification.payload,
  });
}

export function buildSettlementHeader(settlement: X402Settlement): string {
  return Buffer.from(JSON.stringify(settlement)).toString("base64");
}

export function parsePaymentResponse(headerValue: string | null): X402Settlement | undefined {
  if (!headerValue) return undefined;

  try {
    return JSON.parse(Buffer.from(headerValue, "base64").toString("utf-8")) as X402Settlement;
  } catch {
    return undefined;
  }
}

export function decodePaymentSignatureHeader(headerValue: string): SignedPaymentPayload | null {
  try {
    return JSON.parse(Buffer.from(headerValue, "base64").toString("utf-8")) as SignedPaymentPayload;
  } catch {
    return null;
  }
}

async function createSignedPaymentPayload(
  resource: string,
  account: PrivateKeyAccount,
  requirement: X402Requirement["accepts"][number],
): Promise<SignedPaymentPayload> {
  const payloadBase = {
    x402Version: 2,
    scheme: requirement.scheme,
    network: requirement.network,
    resource,
    payer: account.address,
    payToAddress: requirement.payToAddress,
    amount: requirement.maxAmountRequired,
    timestamp: new Date().toISOString(),
    nonce: crypto.randomUUID(),
  };

  const signature = await account.signMessage({
    message: paymentCanonicalMessage({
      ...payloadBase,
      signature: "0x" as Hex,
    }),
  });

  return {
    ...payloadBase,
    signature,
  };
}

function paymentCanonicalMessage(payload: SignedPaymentPayload): string {
  return [
    "x402:v2",
    payload.scheme,
    payload.network,
    payload.resource,
    payload.payer.toLowerCase(),
    payload.payToAddress.toLowerCase(),
    payload.amount,
    payload.timestamp,
    payload.nonce,
  ].join("|");
}

async function parseResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

function toViemChain(profile: ChainProfile) {
  if (profile.chainId === 8453) {
    return base;
  }

  if (profile.chainId === 84532) {
    return baseSepolia;
  }

  return defineChain({
    id: profile.chainId,
    name: profile.name,
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [profile.rpcUrl] },
      public: { http: [profile.rpcUrl] },
    },
  });
}

export * from "./facilitator.js";
export * from "./profiles.js";
