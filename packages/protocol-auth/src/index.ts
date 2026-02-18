import {
  buildSIWAResponse,
  createReceipt,
  createSIWANonce,
  verifySIWA,
  verifyAuthenticatedRequest,
  type SIWAResponse,
} from "@buildersgarden/siwa";
import {
  createPublicClient,
  defineChain,
  http,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import type { ChainProfile, HexAddress, SIWAReceipt } from "@aethernet/shared-types";

export interface SiwaAuthServiceOptions {
  chainProfile: ChainProfile;
  expectedDomain: string;
  receiptSecret: string;
  nonceSecret?: string;
  nonceStore?: NonceStore;
}

export interface NonceIssueInput {
  address: HexAddress;
  agentId: number;
  agentRegistry?: string;
}

export interface VerifySignInInput {
  message: string;
  signature: string;
  nonceToken?: string;
  nonceValidator?: (nonce: string) => boolean | Promise<boolean>;
}

export interface NonceStore {
  insertNonce(input: {
    token: string;
    address: HexAddress;
    agentId: number;
    agentRegistry: string;
    issuedAt: string;
    expiresAt: string;
  }): void;
  consumeNonce(token: string): boolean;
}

export class SiwaAuthService {
  readonly chainProfile: ChainProfile;
  readonly expectedDomain: string;
  private readonly client: any;
  private readonly receiptSecret: string;
  private readonly nonceSecret?: string;
  private readonly nonceStore?: NonceStore;

  constructor(options: SiwaAuthServiceOptions) {
    this.chainProfile = options.chainProfile;
    this.expectedDomain = options.expectedDomain;
    this.receiptSecret = options.receiptSecret;
    this.nonceSecret = options.nonceSecret;
    this.nonceStore = options.nonceStore;
    this.client = createPublicClient({
      chain: toViemChain(options.chainProfile),
      transport: http(options.chainProfile.rpcUrl),
    });
  }

  async issueNonce(input: NonceIssueInput): Promise<{
    status: "nonce_issued" | "error";
    nonce?: string;
    nonceToken?: string;
    issuedAt?: string;
    expirationTime?: string;
    response?: SIWAResponse;
  }> {
    const agentRegistry =
      input.agentRegistry ??
      `eip155:${this.chainProfile.chainId}:${this.chainProfile.identityRegistry}`;

    const result = await createSIWANonce(
      {
        address: input.address,
        agentId: input.agentId,
        agentRegistry,
      },
      this.client,
      { secret: this.nonceSecret },
    );

    if (result.status !== "nonce_issued") {
      return {
        status: "error",
        response: result,
      };
    }

    if (this.nonceStore && result.nonceToken && result.issuedAt && result.expirationTime) {
      this.nonceStore.insertNonce({
        token: result.nonceToken,
        address: input.address,
        agentId: input.agentId,
        agentRegistry,
        issuedAt: result.issuedAt,
        expiresAt: result.expirationTime,
      });
    }

    return {
      status: "nonce_issued",
      nonce: result.nonce,
      nonceToken: result.nonceToken,
      issuedAt: result.issuedAt,
      expirationTime: result.expirationTime,
    };
  }

  async verifySignIn(input: VerifySignInInput): Promise<{
    ok: boolean;
    response: SIWAResponse;
    receipt?: SIWAReceipt;
  }> {
    const nonceValidation = input.nonceValidator
      ? input.nonceValidator
      : input.nonceToken
        ? { nonceToken: input.nonceToken, secret: this.nonceSecret ?? this.receiptSecret }
        : () => false;

    if (input.nonceToken && this.nonceStore) {
      const consumed = this.nonceStore.consumeNonce(input.nonceToken);
      if (!consumed) {
        return {
          ok: false,
          response: {
            message: "Invalid or replayed nonce",
            code: "NONCE_REPLAY",
            status: "error",
          } as unknown as SIWAResponse,
        };
      }
    }

    const verification = await verifySIWA(
      input.message,
      input.signature,
      this.expectedDomain,
      nonceValidation,
      this.client,
    );

    const response = buildSIWAResponse(verification);

    if (!verification.valid) {
      return { ok: false, response };
    }

    const receiptResult = createReceipt(
      {
        address: verification.address,
        agentId: verification.agentId,
        agentRegistry: verification.agentRegistry,
        chainId: verification.chainId,
        verified: verification.verified,
      },
      {
        secret: this.receiptSecret,
      },
    );

    return {
      ok: true,
      response,
      receipt: {
        token: receiptResult.receipt,
        address: verification.address as HexAddress,
        agentId: verification.agentId,
        chainId: verification.chainId,
        agentRegistry: verification.agentRegistry,
        issuedAt: new Date().toISOString(),
        expiresAt: receiptResult.expiresAt,
      },
    };
  }

  async verifyAuthenticatedHttpRequest(
    request: Request,
    verifyOnchain = true,
  ): Promise<{ valid: boolean; agent?: { address: string; agentId: number; chainId: number }; error?: string }> {
    const result = await verifyAuthenticatedRequest(request, {
      receiptSecret: this.receiptSecret,
      verifyOnchain,
      publicClient: this.client,
    });

    if (!result.valid) {
      return { valid: false, error: result.error };
    }

    return {
      valid: true,
      agent: {
        address: result.agent.address,
        agentId: result.agent.agentId,
        chainId: result.agent.chainId,
      },
    };
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
      default: {
        http: [profile.rpcUrl],
      },
      public: {
        http: [profile.rpcUrl],
      },
    },
  });
}
