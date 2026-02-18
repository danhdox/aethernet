import type { BrainConfig, BrainProvider } from "@aethernet/shared-types";
import { OpenAiBrainProvider } from "./openai.js";

export function createBrainProvider(config: BrainConfig): BrainProvider {
  if (config.provider === "openai") {
    return new OpenAiBrainProvider(config);
  }

  throw new Error(`Unsupported brain provider: ${config.provider}`);
}
