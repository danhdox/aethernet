import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { exec as execCb, execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type {
  ComputeProvider,
  CreateSandboxInput,
  FundingResult,
  ProviderCapabilityMatrix,
  ProvisionedSandbox,
  SandboxLogInput,
  SandboxStatus,
  SandboxExecInput,
  SandboxExecResult,
  SandboxWriteFileInput,
  WalletFundingInput,
} from "@aethernet/shared-types";

const execAsync = promisify(execCb);
const execFileAsync = promisify(execFileCb);

export interface ApiProviderOptions {
  apiUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface SelfHostProviderOptions {
  rootDir?: string;
}

export interface KubernetesProviderOptions {
  namespace?: string;
  image?: string;
  command?: string;
  context?: string;
  kubeconfig?: string;
  podNamePrefix?: string;
  execTimeoutMs?: number;
}

export class ApiComputeProvider implements ComputeProvider {
  public readonly name = "api";
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options: ApiProviderOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async createSandbox(input: CreateSandboxInput): Promise<ProvisionedSandbox> {
    const payload = {
      name: input.name,
      vcpu: input.vcpu,
      memoryMb: input.memoryMb,
      diskGb: input.diskGb,
      region: input.region,
    };
    const res = await this.request<{ id: string; name?: string; status?: string; createdAt?: string }>(
      "/v1/sandboxes",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );

    return {
      id: res.id,
      name: res.name ?? input.name,
      status: normalizeSandboxStatus(res.status),
      createdAt: res.createdAt ?? new Date().toISOString(),
    };
  }

  async exec(input: SandboxExecInput): Promise<SandboxExecResult> {
    const response = await this.request<{
      stdout?: string;
      stderr?: string;
      exitCode?: number;
      exit_code?: number;
    }>(`/v1/sandboxes/${input.sandboxId}/exec`, {
      method: "POST",
      body: JSON.stringify({
        command: input.command,
        timeout: input.timeoutMs ?? this.timeoutMs,
      }),
    });

    return {
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
      exitCode: response.exitCode ?? response.exit_code ?? 0,
    };
  }

  async writeFile(input: SandboxWriteFileInput): Promise<void> {
    await this.request(`/v1/sandboxes/${input.sandboxId}/files/upload/json`, {
      method: "POST",
      body: JSON.stringify({ path: input.path, content: input.content }),
    });
  }

  async fundWallet(input: WalletFundingInput): Promise<FundingResult> {
    const res = await this.request<{ txHash: string; network?: string }>(
      "/v1/wallet/fund",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );

    return {
      txHash: res.txHash,
      network: (res.network as FundingResult["network"]) ?? input.network,
      amount: input.amount,
      asset: input.asset,
    };
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    await this.request(`/v1/sandboxes/${sandboxId}`, {
      method: "DELETE",
    });
  }

  async getSandboxStatus(sandboxId: string): Promise<SandboxStatus> {
    const status = await this.request<{ status?: string; updatedAt?: string; updated_at?: string }>(
      `/v1/sandboxes/${sandboxId}`,
      {
        method: "GET",
      },
    );
    return {
      sandboxId,
      status: normalizeSandboxStatus(status.status),
      updatedAt: status.updatedAt ?? status.updated_at ?? new Date().toISOString(),
    };
  }

  async getSandboxLogs(input: SandboxLogInput): Promise<string> {
    const result = await this.request<{ logs?: string; output?: string }>(
      `/v1/sandboxes/${input.sandboxId}/logs?tail=${input.tail ?? 200}`,
      {
        method: "GET",
      },
    );

    return result.logs ?? result.output ?? "";
  }

  private async request<T = unknown>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.apiUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiKey,
          ...(init.headers ?? {}),
        },
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Provider API request failed (${response.status}): ${body}`);
      }

      if (response.status === 204) {
        return {} as T;
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class SelfHostComputeProvider implements ComputeProvider {
  public readonly name = "selfhost";
  private readonly rootDir: string;

  constructor(options: SelfHostProviderOptions = {}) {
    this.rootDir = options.rootDir ?? path.join(os.homedir(), ".aethernet", "sandboxes");
    fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
  }

  async createSandbox(input: CreateSandboxInput): Promise<ProvisionedSandbox> {
    const id = `sandbox_${Math.random().toString(16).slice(2, 10)}`;
    const sandboxDir = this.sandboxDir(id);
    fs.mkdirSync(sandboxDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(sandboxDir, "metadata.json"),
      JSON.stringify(
        {
          id,
          name: input.name,
          status: "running",
          createdAt: new Date().toISOString(),
          input,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    fs.writeFileSync(path.join(sandboxDir, "sandbox.log"), "", { mode: 0o600 });

    return {
      id,
      name: input.name,
      status: "running",
      createdAt: new Date().toISOString(),
    };
  }

  async exec(input: SandboxExecInput): Promise<SandboxExecResult> {
    const sandboxDir = this.requireSandboxDir(input.sandboxId);
    const command = input.command;
    const timeoutMs = input.timeoutMs ?? 30_000;
    const result = await execAsync(command, {
      cwd: sandboxDir,
      timeout: timeoutMs,
      shell: "/bin/zsh",
    });
    this.appendLog(
      input.sandboxId,
      [
        `[exec] ${new Date().toISOString()}`,
        `$ ${command}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: 0,
    };
  }

  async writeFile(input: SandboxWriteFileInput): Promise<void> {
    const sandboxDir = this.requireSandboxDir(input.sandboxId);
    const target = path.join(sandboxDir, input.path.replace(/^\/+/, ""));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, input.content, { mode: 0o600 });
    this.appendLog(
      input.sandboxId,
      `[write] ${new Date().toISOString()} ${input.path} (${Buffer.byteLength(input.content)} bytes)`,
    );
  }

  async fundWallet(input: WalletFundingInput): Promise<FundingResult> {
    const txHash = `0x${Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64)}`;
    this.appendLog(
      input.sandboxId ?? "global",
      `[fund] ${new Date().toISOString()} to=${input.toAddress} amount=${input.amount} ${input.asset} network=${input.network} tx=${txHash}`,
    );
    return {
      txHash,
      network: input.network,
      amount: input.amount,
      asset: input.asset,
    };
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const sandboxDir = this.sandboxDir(sandboxId);
    if (!fs.existsSync(sandboxDir)) {
      return;
    }
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  }

  async getSandboxStatus(sandboxId: string): Promise<SandboxStatus> {
    const exists = fs.existsSync(this.sandboxDir(sandboxId));
    return {
      sandboxId,
      status: exists ? "running" : "deleted",
      updatedAt: new Date().toISOString(),
    };
  }

  async getSandboxLogs(input: SandboxLogInput): Promise<string> {
    const logPath = path.join(this.sandboxDir(input.sandboxId), "sandbox.log");
    if (!fs.existsSync(logPath)) {
      return "";
    }
    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n");
    const tail = input.tail ?? 200;
    return lines.slice(-tail).join("\n");
  }

  private sandboxDir(sandboxId: string): string {
    return path.join(this.rootDir, sandboxId);
  }

  private requireSandboxDir(sandboxId: string): string {
    const sandboxDir = this.sandboxDir(sandboxId);
    if (!fs.existsSync(sandboxDir)) {
      throw new Error(`Sandbox ${sandboxId} does not exist`);
    }
    return sandboxDir;
  }

  private appendLog(sandboxId: string, line: string): void {
    const dir = sandboxId === "global" ? this.rootDir : this.sandboxDir(sandboxId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const logPath = path.join(dir, "sandbox.log");
    fs.appendFileSync(logPath, `${line}\n`, { encoding: "utf-8" });
  }
}

export class KubernetesComputeProvider implements ComputeProvider {
  public readonly name = "kubernetes";
  private readonly namespace: string;
  private readonly image: string;
  private readonly command: string;
  private readonly context?: string;
  private readonly kubeconfigPath?: string;
  private readonly podNamePrefix: string;
  private readonly execTimeoutMs: number;
  private readonly manifestDir: string;
  private readonly providerLabel = "aethernet-provider";

  constructor(options: KubernetesProviderOptions = {}) {
    this.namespace = options.namespace ?? "aethernet";
    this.image = options.image ?? "node:20-alpine";
    this.command = options.command ?? "sleep infinity";
    this.context = options.context;
    this.kubeconfigPath = options.kubeconfig;
    this.podNamePrefix = options.podNamePrefix ?? "aethernet-sandbox";
    this.execTimeoutMs = options.execTimeoutMs ?? 30_000;
    this.manifestDir = path.join(os.homedir(), ".aethernet", "kubernetes");
    fs.mkdirSync(this.manifestDir, { recursive: true, mode: 0o700 });
  }

  async createSandbox(input: CreateSandboxInput): Promise<ProvisionedSandbox> {
    const id = `sandbox-${randomUUID().slice(0, 8)}`;
    const podName = `${this.podNamePrefix}-${id}`;
    const manifestPath = this.sandboxManifestPath(podName);
    const manifest = this.buildPodManifest({
      podName,
      input,
      memoryMb: input.memoryMb,
      vcpu: input.vcpu,
      diskGb: input.diskGb,
      region: input.region,
    });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });

    await this.kube(["apply", "-f", manifestPath]);
    await this.waitForPodPhase(podName, ["Running"], 5_000, 6);

    return {
      id,
      name: input.name,
      status: "running",
      createdAt: new Date().toISOString(),
    };
  }

  async exec(input: SandboxExecInput): Promise<SandboxExecResult> {
    const result = await this.kubeExec(["exec", this.resolvePodReference(input.sandboxId), ...this.baseNamespaceArgs(), "--", "sh", "-lc", input.command], {
      timeoutMs: input.timeoutMs ?? this.execTimeoutMs,
    });
    const statusCode = result.exitCode ?? 0;

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: statusCode,
    };
  }

  async writeFile(input: SandboxWriteFileInput): Promise<void> {
    const podReference = this.resolvePodReference(input.sandboxId);
    const normalizedPath = input.path.startsWith("/") ? input.path : `/${input.path}`;
    const remoteDir = path.posix.dirname(normalizedPath);
    await this.kubeExec([
      "exec",
      podReference,
      ...this.baseNamespaceArgs(),
      "--",
      "sh",
      "-lc",
      `mkdir -p ${JSON.stringify(remoteDir)}`,
    ]);

    const temporarySource = path.join(os.tmpdir(), `aethernet-k8s-${randomUUID()}.txt`);
    fs.writeFileSync(temporarySource, input.content, { mode: 0o600 });
    try {
      await this.kube([
        ...this.baseNamespaceArgs(),
        "cp",
        temporarySource,
        `${podReference}:${normalizedPath}`,
      ]);
    } finally {
      if (fs.existsSync(temporarySource)) {
        fs.rmSync(temporarySource);
      }
    }
  }

  async fundWallet(input: WalletFundingInput): Promise<FundingResult> {
    const txHash = `0x${Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64)}`;
    return {
      txHash,
      network: input.network,
      amount: input.amount,
      asset: input.asset,
    };
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    await this.kube([
      "delete",
      "pod",
      this.resolvePodReference(sandboxId),
      "--ignore-not-found=true",
      "--wait=true",
      ...this.baseNamespaceArgs(),
    ]);
    const manifestPath = this.sandboxManifestPath(this.resolvePodName(sandboxId));
    if (fs.existsSync(manifestPath)) {
      fs.unlinkSync(manifestPath);
    }
  }

  async getSandboxStatus(sandboxId: string): Promise<SandboxStatus> {
    try {
      const status = await this.getPodStatus(this.resolvePodName(sandboxId));
      return {
        sandboxId,
        status: normalizeSandboxStatus(status.phase),
        updatedAt: status.updatedAt,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return {
          sandboxId,
          status: "deleted",
          updatedAt: new Date().toISOString(),
        };
      }
      throw error;
    }
  }

  async getSandboxLogs(input: SandboxLogInput): Promise<string> {
    const output = await this.kube(["logs", this.resolvePodReference(input.sandboxId), ...this.baseNamespaceArgs(), `--tail=${input.tail ?? 200}`]);
    return output;
  }

  private buildPodManifest(input: {
    podName: string;
    input: CreateSandboxInput;
    vcpu: number;
    memoryMb: number;
    diskGb: number;
    region?: string;
  }): object {
    return {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: input.podName,
        namespace: this.namespace,
        labels: {
          [this.providerLabel]: "true",
          "aethernet.runtime.name": input.input.name,
          "aethernet.runtime.id": input.podName,
          "aethernet.runtime.region": input.region ?? "default",
          "aethernet.runtime.provider": "kubernetes",
        },
      },
      spec: {
        restartPolicy: "Never",
        containers: [
          {
            name: "agent",
            image: this.image,
            command: ["sh", "-lc", this.command],
            resources: {
              requests: {
                cpu: `${Math.max(1, input.vcpu) * 1000}m`,
                memory: `${Math.max(1, input.memoryMb)}Mi`,
              },
              limits: {
                cpu: `${Math.max(1, input.vcpu) * 1000}m`,
                memory: `${Math.max(1, input.memoryMb)}Mi`,
              },
            },
            volumeMounts: [
              {
                name: "workspace",
                mountPath: "/workspace",
              },
            ],
          },
        ],
        volumes: [
          {
            name: "workspace",
            emptyDir: {
              medium: "Memory",
              sizeLimit: `${Math.max(1, Math.floor(input.diskGb * 1024))}Mi`,
            },
          },
        ],
      },
    };
  }

  private async getPodStatus(podName: string): Promise<{ phase: string; updatedAt: string }> {
    const podStatus = await this.kubeJson<{
      status?: {
        phase?: string;
        conditions?: Array<{ type?: string; lastTransitionTime?: string }>;
      };
    }>([
      "get",
      "pod",
      podName,
      ...this.baseNamespaceArgs(),
      "-o",
      "json",
    ]);

    const phase = podStatus.status?.phase ?? "Unknown";
    const updatedAt = podStatus.status?.conditions?.[0]?.lastTransitionTime ?? new Date().toISOString();

    return {
      phase,
      updatedAt,
    };
  }

  private async waitForPodPhase(
    podName: string,
    desired: string[],
    delayMs: number,
    retries: number,
  ): Promise<void> {
    let attempts = 0;
    while (attempts < retries) {
      try {
        const podStatus = await this.getPodStatus(podName);
        if (desired.includes(podStatus.phase)) {
          return;
        }
      } catch {
        // Pod may not be ready immediately. continue until timeout.
      }
      attempts += 1;
      await this.sleep(delayMs);
    }
  }

  private async kube(command: string[]): Promise<string> {
    const args = this.baseKubectlArgs().concat(command);
    const { stdout, stderr } = await execFileAsync("kubectl", args, {
      timeout: this.execTimeoutMs,
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
    });
    if (stderr && !stdout) {
      // kubectl can emit useful stderr on success in some flows, preserve for callers that inspect logs.
    }
    return stdout ?? "";
  }

  private async kubeJson<T>(command: string[]): Promise<T> {
    const raw = await this.kube(command);
    return JSON.parse(raw) as T;
  }

  private async kubeExec(
    command: string[],
    options?: { timeoutMs?: number },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const args = this.baseKubectlArgs().concat(command);
    try {
      const { stdout, stderr } = await execFileAsync("kubectl", args, {
        timeout: options?.timeoutMs ?? this.execTimeoutMs,
        encoding: "utf-8",
        maxBuffer: 20 * 1024 * 1024,
      });
      return { stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 };
    } catch (error) {
      const raw = error as { code?: number; stdout?: string; stderr?: string };
      return {
        stdout: raw.stdout ?? "",
        stderr: raw.stderr ?? `${error instanceof Error ? error.message : String(error)}`,
        exitCode: Number.isFinite(raw.code ?? NaN) ? (raw.code as number) : 1,
      };
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private baseKubectlArgs(): string[] {
    const args = [];
    if (this.context) {
      args.push("--context", this.context);
    }
    if (this.kubeconfigPath) {
      args.push("--kubeconfig", this.kubeconfigPath);
    }
    return args;
  }

  private baseNamespaceArgs(): string[] {
    return ["-n", this.namespace];
  }

  private resolvePodName(sandboxId: string): string {
    if (sandboxId.startsWith(`${this.podNamePrefix}-`)) {
      return sandboxId;
    }
    return `${this.podNamePrefix}-${sandboxId}`;
  }

  private resolvePodReference(sandboxId: string): string {
    return this.resolvePodName(sandboxId);
  }

  private sandboxManifestPath(podName: string): string {
    return path.join(this.manifestDir, `${podName}.json`);
  }
}

export class InMemoryComputeProvider implements ComputeProvider {
  public readonly name = "in-memory";
  private readonly sandboxes = new Map<string, ProvisionedSandbox>();

  async createSandbox(input: CreateSandboxInput): Promise<ProvisionedSandbox> {
    const id = `sandbox_${Math.random().toString(16).slice(2, 10)}`;
    const sandbox: ProvisionedSandbox = {
      id,
      name: input.name,
      status: "running",
      createdAt: new Date().toISOString(),
    };
    this.sandboxes.set(id, sandbox);
    return sandbox;
  }

  async exec(input: SandboxExecInput): Promise<SandboxExecResult> {
    if (!this.sandboxes.has(input.sandboxId)) {
      throw new Error(`Sandbox ${input.sandboxId} does not exist`);
    }

    return {
      stdout: `Executed: ${input.command}`,
      stderr: "",
      exitCode: 0,
    };
  }

  async writeFile(input: SandboxWriteFileInput): Promise<void> {
    if (!this.sandboxes.has(input.sandboxId)) {
      throw new Error(`Sandbox ${input.sandboxId} does not exist`);
    }
  }

  async fundWallet(input: WalletFundingInput): Promise<FundingResult> {
    return {
      txHash: `0xmock${Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64)}`,
      network: input.network,
      amount: input.amount,
      asset: input.asset,
    };
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return;
    }
    this.sandboxes.set(sandboxId, {
      ...sandbox,
      status: "deleted",
    });
  }

  async getSandboxStatus(sandboxId: string): Promise<SandboxStatus> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox ${sandboxId} does not exist`);
    }
    return {
      sandboxId,
      status: sandbox.status,
      updatedAt: new Date().toISOString(),
    };
  }

  async getSandboxLogs(input: SandboxLogInput): Promise<string> {
    if (!this.sandboxes.has(input.sandboxId)) {
      throw new Error(`Sandbox ${input.sandboxId} does not exist`);
    }
    return `[in-memory] no persisted logs for ${input.sandboxId}`;
  }
}

export function providerCapabilityMatrix(provider: ComputeProvider): ProviderCapabilityMatrix {
  return {
    canCreateSandbox: typeof provider.createSandbox === "function",
    canDestroySandbox: typeof provider.destroySandbox === "function",
    canExec: typeof provider.exec === "function",
    canWriteFile: typeof provider.writeFile === "function",
    canFundWallet: typeof provider.fundWallet === "function",
    canGetStatus: typeof provider.getSandboxStatus === "function",
    canGetLogs: typeof provider.getSandboxLogs === "function",
  };
}

function normalizeSandboxStatus(
  status: string | undefined,
): ProvisionedSandbox["status"] {
  if (
    status === "creating" ||
    status === "running" ||
    status === "stopped" ||
    status === "deleted"
  ) {
    return status;
  }

  if (status === "Running") {
    return "running";
  }

  if (status === "Succeeded" || status === "Failed" || status === "Error" || status === "CrashLoopBackOff") {
    return "stopped";
  }

  if (status === "Unknown" || status === "Terminating") {
    return "deleted";
  }

  return "creating";
}
