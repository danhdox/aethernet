import type { ChainProfile, HexAddress } from "@aethernet/shared-types";
import type { X402FacilitatorConfig } from "./index.js";

export interface X402FacilitatorProfile {
  network: string;
  verifyUrl: string;
  settleUrl: string;
  apiKey?: string;
  usdcAddress?: HexAddress;
  asset: "USDC";
  enabled: boolean;
}

export function buildFacilitatorProfiles(input: {
  chainProfiles: ChainProfile[];
  verifyUrl: string;
  settleUrl: string;
  apiKey?: string;
}): X402FacilitatorProfile[] {
  return input.chainProfiles.map((profile) => ({
    network: profile.caip2,
    verifyUrl: input.verifyUrl,
    settleUrl: input.settleUrl,
    apiKey: input.apiKey,
    usdcAddress: profile.usdcAddress,
    asset: "USDC",
    enabled: profile.supports?.payments !== false,
  }));
}

export function resolveFacilitatorProfile(
  network: string,
  profiles: X402FacilitatorProfile[],
): X402FacilitatorProfile {
  const found = profiles.find((profile) => profile.network === network && profile.enabled);
  if (!found) {
    throw new Error(`X402_PROFILE_NOT_FOUND: ${network}`);
  }
  return found;
}

export function facilitatorConfigFromProfile(profile: X402FacilitatorProfile): X402FacilitatorConfig {
  return {
    verifyUrl: profile.verifyUrl,
    settleUrl: profile.settleUrl,
    apiKey: profile.apiKey,
  };
}
