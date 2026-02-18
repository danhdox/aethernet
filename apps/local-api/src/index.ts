import http from "node:http";
import crypto from "node:crypto";
import express, { type NextFunction } from "express";
import type { Request as ExpressRequest, Response } from "express";
import type {
  AgentRuntimeMetrics,
  ChainProfile,
  X402Requirement,
  X402Settlement,
} from "@aethernet/shared-types";
import { AethernetRuntime } from "@aethernet/core-runtime";
import { SiwaAuthService } from "@aethernet/protocol-auth";
import { Erc8004Client, findChainProfile } from "@aethernet/protocol-identity";
import { recoverMessageAddress } from "viem";
import {
  facilitatorVerifyAndSettle,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  buildPaymentRequiredHeader,
  buildSettlementHeader,
  type X402FacilitatorConfig,
} from "@aethernet/protocol-payments";

export interface LocalApiOptions {
  runtime: AethernetRuntime;
  chainProfile: ChainProfile;
  port?: number;
  receiptSecret: string;
  nonceSecret?: string;
  expectedDomain?: string;
  facilitator?: X402FacilitatorConfig;
}

export interface LocalApiServer {
  app: express.Express;
  server: http.Server;
  stop(): Promise<void>;
}

type AuthenticatedRequest = ExpressRequest & {
  agent?: {
    address: string;
    agentId: number;
    chainId: number;
  };
};

export async function startLocalApi(options: LocalApiOptions): Promise<LocalApiServer> {
  const app = express();
  app.set("runtime", options.runtime);
  app.use(express.json());
  app.use((req, _res, next) => {
    _res.setHeader("Access-Control-Allow-Origin", "*");
    _res.setHeader(
      "Access-Control-Allow-Headers",
      [
        "Content-Type",
        "Authorization",
        "X-ERC8128-Nonce",
        "X-ERC8128-Timestamp",
        "X-ERC8128-Signature",
        "X-Request-Nonce",
        "X-Request-Timestamp",
        "X-Request-Signature",
        PAYMENT_SIGNATURE_HEADER,
      ].join(", "),
    );
    _res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    _res.setHeader(
      "Access-Control-Expose-Headers",
      [PAYMENT_REQUIRED_HEADER, PAYMENT_RESPONSE_HEADER].join(", "),
    );

    if (req.method === "OPTIONS") {
      _res.status(204).send("");
      return;
    }
    next();
  });

  const port = options.port ?? options.runtime.config.localApiPort;
  const expectedDomain = options.expectedDomain ?? `localhost:${port}`;

  const authService = new SiwaAuthService({
    chainProfile: options.chainProfile,
    expectedDomain,
    receiptSecret: options.receiptSecret,
    nonceSecret: options.nonceSecret,
    nonceStore: {
      insertNonce: (input) => {
        options.runtime.db.insertAuthNonce({
          token: input.token,
          address: input.address,
          agentId: input.agentId,
          agentRegistry: input.agentRegistry,
          issuedAt: input.issuedAt,
          expiresAt: input.expiresAt,
        });
      },
      consumeNonce: (token) => options.runtime.db.consumeAuthNonce(token) !== null,
    },
  });

  const protectRequest: express.RequestHandler = async (req, res, next) => {
    await verifySiwaRequest(req, res, next, authService);
  };

  app.get("/v1/agent/status", (_req, res) => {
    res.json({ status: "ok", agent: options.runtime.status() });
  });

  app.get("/v1/agent/health", (_req, res) => {
    const status = options.runtime.status();
    const health = options.runtime.db.health();
    res.json({
      ok: true,
      status,
      db: health,
      children: options.runtime.db.listChildren(),
      providerEvents: options.runtime.db.listProviderEvents(50),
      incidents: options.runtime.db.listRuntimeIncidents(50),
    });
  });

  app.get("/v1/agent/ready", (_req, res) => {
    const readiness = buildReadiness(options.runtime);
    if (!readiness.ready) {
      res.status(503).json({ ok: false, ...readiness });
      return;
    }

    res.json({ ok: true, ...readiness });
  });

  app.get("/v1/agent/metrics", (_req, res) => {
    res.json(buildMetrics(options.runtime));
  });

  app.get("/v1/agent/children", protectRequest, (_req, res) => {
    res.json({ children: options.runtime.db.listChildren() });
  });

  app.get("/v1/identity/registry", protectRequest, (_req, res) => {
    res.json({ entries: options.runtime.db.listRegistryEntries() });
  });

  app.get("/v1/identity/query", protectRequest, async (req, res) => {
    const agentId = Number(req.query.agentId);
    const chainFilter = req.query.chain;
    const chainInput = chainFilter === undefined ? undefined : chainFilter.toString();
    const parsedChainInput = chainInput ?? options.runtime.config.chainDefault;

    if (Number.isNaN(agentId)) {
      res.status(400).json({ error: "agentId is required and must be a number" });
      return;
    }

    try {
      const chainProfile = findChainProfile(
        parsedChainInput,
        options.runtime.config.chainProfiles,
      );
      const client = new Erc8004Client(chainProfile);
      const result = await client.queryAgent(agentId);
      res.json({
        ok: true,
        query: result,
        chain: {
          chainId: chainProfile.chainId,
          caip2: chainProfile.caip2,
        },
      });
    } catch (error) {
      res.status(502).json({ error: formatError(error) });
    }
  });

  app.get("/v1/identity/reputation", protectRequest, (req, res) => {
    const agentId = Number(req.query.agentId);
    const chainIdRaw = req.query.chainId;
    const chainId = chainIdRaw === undefined ? undefined : Number(chainIdRaw);

    if (Number.isNaN(agentId)) {
      res.status(400).json({ error: "agentId is required" });
      return;
    }

    if (chainIdRaw !== undefined && Number.isNaN(chainId)) {
      res.status(400).json({ error: "chainId must be numeric" });
      return;
    }

    const entries = options.runtime.db.listReputationEntries(
      agentId,
      chainIdRaw === undefined ? undefined : chainId,
    );
    res.json({ entries });
  });

  app.post("/v1/agent/stop", protectRequest, (req, res) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "manual stop";
    options.runtime.emergencyStop(reason);
    res.json({
      stopped: true,
      reason,
      actor: requestActor(req),
    });
  });

  app.post("/v1/agent/clear-stop", protectRequest, (_req, res) => {
    options.runtime.clearEmergencyStop();
    res.json({ stopped: false, resumed: true });
  });

  app.post("/v1/agent/children/:id/stop", protectRequest, (req, res) => {
    const childIdentifier = req.params.id;
    try {
      options.runtime.updateChildStatusByIdentifier(childIdentifier, "stopped");
      res.json({ ok: true, child: childIdentifier, status: "stopped" });
    } catch (error) {
      res.status(404).json({ error: formatError(error) });
    }
  });

  app.post("/v1/agent/children/:id/resume", protectRequest, (req, res) => {
    const childIdentifier = req.params.id;
    try {
      options.runtime.resumeChild(childIdentifier);
      res.json({ ok: true, child: childIdentifier, status: "running" });
    } catch (error) {
      res.status(404).json({ error: formatError(error) });
    }
  });

  app.delete("/v1/agent/children/:id", protectRequest, async (req, res) => {
    try {
      const childIdentifier = req.params.id;
      const destroyRaw = req.query.destroy;
      const destroyValue = Array.isArray(destroyRaw) ? destroyRaw[0] : destroyRaw;
      const destroySandbox = destroyValue?.toString().toLowerCase() !== "false";
      await options.runtime.terminateChild(childIdentifier, destroySandbox);
      res.json({ ok: true, child: childIdentifier, destroyed: destroySandbox });
    } catch (error) {
      res.status(404).json({ error: formatError(error) });
    }
  });

  app.post("/v1/auth/nonce", async (req, res) => {
    try {
      const address = req.body?.address;
      const agentId = Number(req.body?.agentId);
      const agentRegistry = req.body?.agentRegistry;

      if (typeof address !== "string" || Number.isNaN(agentId)) {
        res.status(400).json({ error: "address and numeric agentId are required" });
        return;
      }

      const response = await authService.issueNonce({
        address: address as `0x${string}`,
        agentId,
        agentRegistry,
      });

      if (response.status === "error") {
        res.status(400).json(response.response);
        return;
      }

      res.json(response);
    } catch (error) {
      res.status(500).json({ error: formatError(error) });
    }
  });

  app.post("/v1/auth/verify", async (req, res) => {
    try {
      const message = req.body?.message;
      const signature = req.body?.signature;
      const nonceToken = req.body?.nonceToken;

      if (typeof message !== "string" || typeof signature !== "string") {
        res.status(400).json({ error: "message and signature are required" });
        return;
      }

      const verification = await authService.verifySignIn({
        message,
        signature,
        nonceToken,
      });

      if (!verification.ok) {
        res.status(401).json(verification.response);
        return;
      }

      res.json({
        authenticated: true,
        response: verification.response,
        receipt: verification.receipt,
      });
    } catch (error) {
      res.status(500).json({ error: formatError(error) });
    }
  });

  app.get("/v1/auth/receipt", async (req, res) => {
    try {
      const fetchRequest = expressToFetchRequest(req);
      const result = await authService.verifyAuthenticatedHttpRequest(fetchRequest, true);

      if (!result.valid) {
        res.status(401).json({ valid: false, error: result.error });
        return;
      }

      res.json({ valid: true, agent: result.agent });
    } catch (error) {
      res.status(500).json({ error: formatError(error) });
    }
  });

  const handleProtectedResource: express.RequestHandler = async (req, res) => {
    try {
      if (options.chainProfile.supports?.payments === false) {
        res.status(503).json({ error: `Payments are not enabled on ${options.chainProfile.caip2}` });
        return;
      }

      const resource = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
      const requirement: X402Requirement = {
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: options.chainProfile.caip2,
            maxAmountRequired: "0.01",
            resource,
            payToAddress: options.runtime.getAddress() as X402Requirement["accepts"][number]["payToAddress"],
            usdcAddress: options.chainProfile.usdcAddress,
            asset: "USDC",
            requiredDeadlineSeconds: 300,
            description: "Paid protected echo endpoint",
          },
        ],
      };

      const paymentSignature = req.get(PAYMENT_SIGNATURE_HEADER);
      if (!paymentSignature) {
        res.status(402);
        res.setHeader(PAYMENT_REQUIRED_HEADER, buildPaymentRequiredHeader(requirement));
        res.json(requirement);
        return;
      }

      if (!options.facilitator) {
        res.status(503).json({
          error: "x402 facilitator is not configured",
        });
        return;
      }

      const outcome = await facilitatorVerifyAndSettle({
        paymentSignatureHeader: paymentSignature,
        expectedResource: resource,
        requirement,
        facilitator: options.facilitator,
      });

      if (!outcome.success || !outcome.settlement) {
        options.runtime.db.insertPaymentEvent({
          direction: "inbound",
          network: requirement.accepts[0]?.network ?? options.chainProfile.caip2,
          amount: requirement.accepts[0]?.maxAmountRequired ?? "0",
          asset: requirement.accepts[0]?.asset ?? "USDC",
          metadata: {
            status: "rejected",
            reason: outcome.error ?? "x402 facilitator rejected payment",
          },
        });

        res.status(402);
        res.setHeader(PAYMENT_REQUIRED_HEADER, buildPaymentRequiredHeader(requirement));
        res.json({ ...requirement, error: outcome.error ?? "x402 facilitator rejected payment" });
        return;
      }

      options.runtime.db.insertPaymentEvent({
        direction: "inbound",
        network: outcome.settlement.network,
        amount: outcome.settlement.amount,
        asset: requirement.accepts[0]?.asset ?? "USDC",
        txHash: outcome.settlement.txHash,
        metadata: {
          status: "settled",
          payer: outcome.settlement.payer,
          payee: outcome.settlement.payee,
        },
      });

      res.setHeader(PAYMENT_RESPONSE_HEADER, buildSettlementHeader(outcome.settlement));
      res.json({
        ok: true,
        settlement: outcome.settlement,
        message: req.query.message ?? "paid access granted",
      });
    } catch (error) {
      res.status(500).json({ error: formatError(error) });
    }
  };

  app.get("/v1/x402/protected/echo", protectRequest, handleProtectedResource);
  app.get("/v1/x402/protected/*", protectRequest, handleProtectedResource);

  app.post("/v1/messages/send", protectRequest, async (req, res) => {
    const { from, to, content, threadId } = req.body ?? {};
    if (typeof to !== "string" || typeof content !== "string") {
      res.status(400).json({ error: "to and content are required" });
      return;
    }

    try {
      const result = await options.runtime.sendMessage({ to, content, threadId });
      res.status(201).json({ id: result.id, from: from ?? options.runtime.getAddress() });
    } catch (error) {
      res.status(500).json({ error: formatError(error) });
    }
  });

  app.post("/v1/messages", protectRequest, async (req, res) => {
    const { from, to, content, threadId } = req.body ?? {};
    if (typeof to !== "string" || typeof content !== "string") {
      res.status(400).json({ error: "to and content are required" });
      return;
    }

    try {
      const result = await options.runtime.sendMessage({ to, content, threadId });
      res.status(201).json({ id: result.id, from: from ?? options.runtime.getAddress() });
    } catch (error) {
      res.status(500).json({ error: formatError(error) });
    }
  });

  app.post("/v1/messages/poll", protectRequest, async (req, res) => {
    const limit = Number(req.body?.limit ?? 25);
    const since = typeof req.body?.since === "string" ? req.body.since : undefined;
    const messages = await options.runtime.pollMessageInbox({ limit, since });
    res.json({ messages });
  });

  app.get("/v1/messages/poll", protectRequest, async (req, res) => {
    const limit = Number(req.query.limit ?? 25);
    const sinceRaw = req.query.since;
    const since = Array.isArray(sinceRaw)
      ? typeof sinceRaw[0] === "string"
        ? sinceRaw[0]
        : undefined
      : typeof sinceRaw === "string"
        ? sinceRaw
        : undefined;
    const messages = await options.runtime.pollMessageInbox({ limit, since });
    res.json({ messages });
  });

  app.get("/v1/messages/threads", protectRequest, async (req, res) => {
    const limit = Number(req.query.limit ?? 100);
    const threads = await options.runtime.listMessageThreads(limit);
    res.json({ threads });
  });

  app.get("/v1/x402/events", protectRequest, (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    const events = options.runtime.db.listPaymentEvents(limit);
    res.json({ events });
  });

  app.get("/v1/agent/alerts", protectRequest, (_req, res) => {
    const incidents = options.runtime.db.listRuntimeIncidents(200);
    const critical = incidents.filter((incident) => incident.severity === "critical");
    const warning = incidents.filter((incident) => incident.severity === "warning");
    const error = incidents.filter((incident) => incident.severity === "error");

    res.json({
      counts: {
        total: incidents.length,
        critical: critical.length,
        warning: warning.length,
        error: error.length,
      },
      incidents,
    });
  });

  const server = await new Promise<http.Server>((resolve) => {
    const srv = app.listen(port, () => resolve(srv));
  });

  options.runtime.db.insertAudit({
    timestamp: new Date().toISOString(),
    category: "runtime",
    action: "local_api_started",
    details: `port=${port}`,
  });

  return {
    app,
    server,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

function expressToFetchRequest(req: ExpressRequest): Request {
  const headers = new Headers();
  Object.entries(req.headers).forEach(([key, value]) => {
    if (value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => headers.append(key, entry));
      return;
    }
    headers.set(key, value);
  });

  const bodyAllowed = req.method !== "GET" && req.method !== "HEAD";
  const body = bodyAllowed ? JSON.stringify(req.body ?? {}) : undefined;
  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;

  return new Request(url, {
    method: req.method,
    headers,
    body,
  });
}

function buildReadiness(runtime: AethernetRuntime): {
  ready: boolean;
  reason: string[];
  status: string;
  walletUnlocked: boolean;
  childCount: number;
  queuedMessages: number;
  criticalIncidents: number;
} {
  const status = runtime.status();
  const reason: string[] = [];
  const emergency = runtime.db.getEmergencyState();
  const criticalIncidents = runtime.db
    .listRuntimeIncidents(200)
    .filter((incident) => incident.severity === "critical").length;
  const queuedMessages = runtime.db.countMessages();

  if (emergency.enabled) {
    reason.push(`emergency_stop:${emergency.reason ?? "no reason"}`);
  }

  if (status.state === "dead") {
    reason.push("survival_tier:dead");
  }

  if (criticalIncidents > 0) {
    reason.push(`runtime_critical_incidents:${criticalIncidents}`);
  }

  if (status.estimatedUsd !== undefined && status.estimatedUsd <= 0) {
    reason.push(`wallet_balance_estimate:${status.estimatedUsd}`);
  }

  const ready = reason.length === 0;

  return {
    ready,
    reason,
    status: status.state,
    walletUnlocked: runtime.isWalletUnlocked(),
    childCount: status.childCount ?? 0,
    queuedMessages,
    criticalIncidents,
  };
}

function buildMetrics(runtime: AethernetRuntime): AgentRuntimeMetrics {
  const health = runtime.db.health();
  const paymentEvents = runtime.db.listPaymentEvents(2000);
  const incidents = runtime.db.listRuntimeIncidents(2000);

  const counts = {
    children: {
      total: runtime.db.countChildren(),
      creating: runtime.db.countChildren("creating"),
      running: runtime.db.countChildren("running"),
      stopped: runtime.db.countChildren("stopped"),
      deleted: runtime.db.countChildren("deleted"),
    },
    incidents: {
      info: incidents.filter((incident) => incident.severity === "info").length,
      warning: incidents.filter((incident) => incident.severity === "warning").length,
      error: incidents.filter((incident) => incident.severity === "error").length,
      critical: incidents.filter((incident) => incident.severity === "critical").length,
    },
    messages: {
      total: health.messageCount,
      queued: runtime.db.countMessages(),
    },
    payments: {
      inbound: paymentEvents.filter((event) => event.direction === "inbound").length,
      outbound: paymentEvents.filter((event) => event.direction === "outbound").length,
    },
  };

  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: health.schemaVersion,
    turns: health.turnCount,
    messagesTotal: counts.messages.total,
    queuedMessages: counts.messages.queued,
    paymentEvents: {
      total: counts.payments.inbound + counts.payments.outbound,
      inbound: counts.payments.inbound,
      outbound: counts.payments.outbound,
    },
    incidents: {
      total: incidents.length,
      info: counts.incidents.info,
      warning: counts.incidents.warning,
      error: counts.incidents.error,
      critical: counts.incidents.critical,
    },
    children: counts.children,
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function requestActor(req: ExpressRequest): string | undefined {
  const typed = req as AuthenticatedRequest;
  return typed.agent?.address;
}

async function verifySiwaRequest(
  req: ExpressRequest,
  res: Response,
  next: NextFunction,
  authService: SiwaAuthService,
): Promise<void> {
  try {
    const result = await authService.verifyAuthenticatedHttpRequest(expressToFetchRequest(req), true);
    if (!result.valid) {
      res.status(401).json({ valid: false, error: result.error });
      return;
    }

    const typed = req as AuthenticatedRequest;
    if (result.agent) {
      const replayValidation = await verifyReplayGuard(req, result.agent.address);
      if (!replayValidation.ok) {
        res.status(401).json({ valid: false, error: replayValidation.error });
        return;
      }

      if (replayValidation.fingerprint) {
        const runtime = (req.app.get("runtime") ?? null) as AethernetRuntime | null;
        if (runtime) {
          runtime.db.cleanupAuthData();
          if (runtime.db.hasReplayFingerprint(replayValidation.fingerprint)) {
            res.status(409).json({ valid: false, error: "Replay request detected" });
            return;
          }
          runtime.db.recordReplayFingerprint(replayValidation.fingerprint, replayValidation.expiresAt!);
        }
      }

      typed.agent = {
        address: result.agent.address,
        agentId: result.agent.agentId,
        chainId: result.agent.chainId,
      };
    }

    next();
  } catch (error) {
    res.status(401).json({ error: formatError(error) });
  }
}

async function verifyReplayGuard(
  req: ExpressRequest,
  expectedAddress: string,
): Promise<{
  ok: boolean;
  fingerprint?: string;
  expiresAt?: string;
  error?: string;
}> {
  const nonce = req.get("X-ERC8128-Nonce") ?? req.get("X-Request-Nonce");
  const timestamp = req.get("X-ERC8128-Timestamp") ?? req.get("X-Request-Timestamp");
  const signature = req.get("X-ERC8128-Signature") ?? req.get("X-Request-Signature");
  if (!nonce || !timestamp || !signature) {
    return {
      ok: false,
      error:
        "Missing ERC-8128 envelope headers: X-ERC8128-Nonce, X-ERC8128-Timestamp, X-ERC8128-Signature",
    };
  }

  const ts = Date.parse(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, error: "Invalid request timestamp" };
  }

  const now = Date.now();
  const maxSkewMs = 5 * 60 * 1000;
  if (Math.abs(now - ts) > maxSkewMs) {
    return { ok: false, error: "Request timestamp outside allowed skew window" };
  }

  const body = req.body === undefined ? "" : JSON.stringify(req.body);
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  const canonical = [
    "erc8128:v1",
    req.method.toUpperCase(),
    req.originalUrl,
    String(ts),
    nonce,
    bodyHash,
  ].join("|");

  try {
    const recovered = await recoverMessageAddress({
      message: canonical,
      signature: signature as `0x${string}`,
    });
    if (recovered.toLowerCase() !== expectedAddress.toLowerCase()) {
      return { ok: false, error: "ERC-8128 signature address mismatch" };
    }
  } catch (error) {
    return { ok: false, error: `Invalid ERC-8128 signature: ${formatError(error)}` };
  }

  const fingerprint = crypto.createHash("sha256").update(canonical).digest("hex");
  return {
    ok: true,
    fingerprint,
    expiresAt: new Date(ts + maxSkewMs).toISOString(),
  };
}
