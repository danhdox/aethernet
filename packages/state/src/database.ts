import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ulid } from "ulid";
import type {
  AgentState,
  AgentRegistryRef,
  AuditEntry,
  AuthNonceRecord,
  ChildLineageRecord,
  HexAddress,
  MemoryEpisode,
  MemoryEpisodeWrite,
  MemoryFact,
  MemoryFactWrite,
  RuntimeAlertRecord,
  RuntimeIncidentCode,
  RuntimeIncidentRecord,
  RuntimeIncidentSeverity,
  RollbackPoint,
  SelfModMutation,
  SurvivalTier,
  SurvivalSnapshot,
  TurnTelemetryRecord,
  WalletKeystoreMeta,
  XmtpConversationRef,
  XmtpConsentState,
} from "@aethernet/shared-types";
import { CREATE_BASE_TABLES, SCHEMA_VERSION } from "./schema.js";

interface KvRow {
  value: string;
}

interface EmergencyRow {
  enabled: number;
  reason: string | null;
  updated_at: string;
}

interface CountRow {
  count: number;
}

export type ChildStatus = "creating" | "running" | "stopped" | "deleted";

export interface ChildRecord {
  id: string;
  name: string;
  address: string | null;
  sandboxId: string | null;
  status: ChildStatus;
  genesisPrompt: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface DatabaseOptions {
  dbPath: string;
}

export class AethernetDatabase {
  private readonly db: Database.Database;

  constructor(options: DatabaseOptions) {
    const dir = path.dirname(options.dbPath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new Database(options.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  runMigrations(): void {
    this.db.exec(CREATE_BASE_TABLES);

    const current = this.db
      .prepare("SELECT MAX(version) as version FROM schema_version")
      .get() as { version?: number };

    const currentVersion = current.version ?? 0;

    if (currentVersion < 4) {
      this.ensureRuntimeIncidentCodeColumn();
    }

    if (currentVersion >= SCHEMA_VERSION) {
      return;
    }

    const tx = this.db.transaction(() => {
      for (let version = currentVersion + 1; version <= SCHEMA_VERSION; version++) {
        this.db
          .prepare("INSERT INTO schema_version(version, applied_at) VALUES (?, ?)")
          .run(version, new Date().toISOString());
      }
    });

    tx();
  }

  private ensureRuntimeIncidentCodeColumn(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(runtime_incidents)")
      .all() as Array<{ name: string }>;
    const hasCode = columns.some((column) => column.name === "code");
    if (!hasCode) {
      this.db.exec("ALTER TABLE runtime_incidents ADD COLUMN code TEXT NOT NULL DEFAULT 'ACTION_FAILED'");
    }
  }

  close(): void {
    this.db.close();
  }

  getKV(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get(key) as KvRow | undefined;
    return row?.value ?? null;
  }

  setKV(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO kv(key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, new Date().toISOString());
  }

  getJsonKV<T>(key: string): T | null {
    const value = this.getKV(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  }

  setJsonKV(key: string, value: unknown): void {
    this.setKV(key, JSON.stringify(value));
  }

  setIdentity(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO identity(key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, new Date().toISOString());
  }

  getIdentity(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM identity WHERE key = ?")
      .get(key) as KvRow | undefined;
    return row?.value ?? null;
  }

  setAgentState(state: AgentState): void {
    this.setKV("agent_state", state);
    this.setKV("last_state_update", new Date().toISOString());
  }

  getAgentState(): AgentState {
    return (this.getKV("agent_state") as AgentState | null) ?? "setup";
  }

  setEmergencyStop(enabled: boolean, reason?: string): void {
    this.db
      .prepare(
        `UPDATE emergency_state
         SET enabled = ?, reason = ?, updated_at = ?
         WHERE id = 1`,
      )
      .run(enabled ? 1 : 0, reason ?? null, new Date().toISOString());
  }

  getEmergencyState(): { enabled: boolean; reason: string | null; updatedAt: string } {
    const row = this.db
      .prepare("SELECT enabled, reason, updated_at FROM emergency_state WHERE id = 1")
      .get() as EmergencyRow;

    return {
      enabled: row.enabled === 1,
      reason: row.reason,
      updatedAt: row.updated_at,
    };
  }

  insertAudit(entry: Omit<AuditEntry, "id"> & { id?: string }): string {
    const id = entry.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO audit_entries(id, timestamp, category, action, details)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, entry.timestamp, entry.category, entry.action, redactText(entry.details) ?? null);
    return id;
  }

  listAudit(limit = 50): AuditEntry[] {
    return this.db
      .prepare(
        `SELECT id, timestamp, category, action, details
         FROM audit_entries
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(limit) as AuditEntry[];
  }

  insertTurn(input: {
    id?: string;
    timestamp?: string;
    state: AgentState;
    input?: string;
    output?: string;
    metadata?: Record<string, unknown>;
  }): string {
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO turns(id, timestamp, state, input, output, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.timestamp ?? new Date().toISOString(),
        input.state,
        redactText(input.input) ?? null,
        redactText(input.output) ?? null,
        JSON.stringify(redactUnknown(input.metadata ?? {})),
      );
    return id;
  }

  getRecentTurns(limit = 20): Array<{
    id: string;
    timestamp: string;
    state: AgentState;
    input: string | null;
    output: string | null;
    metadata: Record<string, unknown>;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, timestamp, state, input, output, metadata
         FROM turns
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      timestamp: string;
      state: AgentState;
      input: string | null;
      output: string | null;
      metadata: string;
    }>;

    return rows.map((row) => ({
      ...row,
      metadata: safeParseJson(row.metadata),
    }));
  }

  upsertConstitutionHash(pathValue: string, hash: string, algorithm = "sha256"): void {
    this.db
      .prepare(
        `INSERT INTO constitution_hashes(path, hash, algorithm, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, algorithm = excluded.algorithm, updated_at = excluded.updated_at`,
      )
      .run(pathValue, hash, algorithm, new Date().toISOString());
  }

  getConstitutionHash(pathValue: string): string | null {
    const row = this.db
      .prepare("SELECT hash FROM constitution_hashes WHERE path = ?")
      .get(pathValue) as { hash: string } | undefined;
    return row?.hash ?? null;
  }

  insertMessage(input: {
    id?: string;
    sender: string;
    receiver: string;
    content: string;
    threadId?: string;
    receivedAt?: string;
  }): string {
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO messages(id, sender, receiver, thread_id, content, received_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sender,
        input.receiver,
        input.threadId ?? null,
        input.content,
        input.receivedAt ?? new Date().toISOString(),
      );
    return id;
  }

  pollMessages(limit = 25): Array<{
    id: string;
    sender: string;
    receiver: string;
    threadId?: string;
    content: string;
    receivedAt: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, sender, receiver, thread_id as threadId, content, received_at as receivedAt
         FROM messages
         WHERE processed_at IS NULL
         ORDER BY received_at ASC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      sender: string;
      receiver: string;
      threadId?: string;
      content: string;
      receivedAt: string;
    }>;

    return rows;
  }

  markMessageProcessed(id: string): void {
    this.db
      .prepare("UPDATE messages SET processed_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  countMessages(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM messages WHERE processed_at IS NULL")
      .get() as { count: number };
    return row.count;
  }

  health(): { schemaVersion: number; turnCount: number; messageCount: number } {
    const versionRow = this.db
      .prepare("SELECT MAX(version) as version FROM schema_version")
      .get() as { version?: number };
    const turnCountRow = this.db.prepare("SELECT COUNT(*) as count FROM turns").get() as {
      count: number;
    };
    const messageCountRow = this.db
      .prepare("SELECT COUNT(*) as count FROM messages")
      .get() as { count: number };

    return {
      schemaVersion: versionRow.version ?? 0,
      turnCount: turnCountRow.count,
      messageCount: messageCountRow.count,
    };
  }

  insertPaymentEvent(input: {
    id?: string;
    direction: "inbound" | "outbound";
    network: string;
    amount: string;
    asset: string;
    txHash?: string;
    metadata?: Record<string, unknown>;
    timestamp?: string;
  }): string {
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO payment_events(id, timestamp, direction, network, amount, asset, tx_hash, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.timestamp ?? new Date().toISOString(),
        input.direction,
        input.network,
        input.amount,
        input.asset,
        input.txHash ?? null,
        JSON.stringify(redactUnknown(input.metadata ?? {})),
      );

    return id;
  }

  listPaymentEvents(limit = 50): Array<{
    id: string;
    timestamp: string;
    direction: "inbound" | "outbound";
    network: string;
    amount: string;
    asset: string;
    txHash: string | null;
    metadata: Record<string, unknown>;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, timestamp, direction, network, amount, asset, tx_hash as txHash, metadata
         FROM payment_events
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      timestamp: string;
      direction: "inbound" | "outbound";
      network: string;
      amount: string;
      asset: string;
      txHash: string | null;
      metadata: string;
    }>;

    return rows.map((row) => ({
      ...row,
      metadata: safeParseJson(row.metadata),
    }));
  }

  insertRegistryEntry(input: {
    agentId: number;
    chainId: number;
    registryAddress: HexAddress;
    ownerAddress: HexAddress;
    agentUri?: string;
    txHash?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO registry_entries(
          agent_id, chain_id, registry_address, owner_address, agent_uri, tx_hash, registered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.agentId,
        input.chainId,
        input.registryAddress,
        input.ownerAddress,
        input.agentUri ?? null,
        input.txHash ?? null,
        new Date().toISOString(),
      );
  }

  upsertRegistryEntry(input: {
    agentId: number;
    chainId: number;
    registryAddress: HexAddress;
    ownerAddress: HexAddress;
    agentUri?: string;
    txHash?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO registry_entries(
          agent_id, chain_id, registry_address, owner_address, agent_uri, tx_hash, registered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent_id, chain_id) DO UPDATE SET
           registry_address = excluded.registry_address,
           owner_address = excluded.owner_address,
           agent_uri = excluded.agent_uri,
           tx_hash = excluded.tx_hash,
           registered_at = excluded.registered_at`,
      )
      .run(
        input.agentId,
        input.chainId,
        input.registryAddress,
        input.ownerAddress,
        input.agentUri ?? null,
        input.txHash ?? null,
        new Date().toISOString(),
      );
  }

  getRegistryEntry(agentId: number, chainId: number): AgentRegistryRef & {
    ownerAddress: HexAddress;
    agentUri: string | null;
    txHash: string | null;
    registeredAt: string;
  } | null {
    const row = this.db
      .prepare(
        `SELECT agent_id, chain_id, registry_address, owner_address, agent_uri, tx_hash, registered_at
         FROM registry_entries
         WHERE agent_id = ? AND chain_id = ?`,
      )
      .get(agentId, chainId) as {
      agent_id: number;
      chain_id: number;
      registry_address: string;
      owner_address: string;
      agent_uri: string | null;
      tx_hash: string | null;
      registered_at: string;
    } | undefined;

    if (!row) {
      return null;
    }

    return {
      agentId: row.agent_id,
      chainId: row.chain_id,
      registryAddress: row.registry_address as HexAddress,
      ownerAddress: row.owner_address as HexAddress,
      agentUri: row.agent_uri,
      txHash: row.tx_hash,
      registeredAt: row.registered_at,
    };
  }

  listRegistryEntries(): AgentRegistryRef[] {
    const rows = this.db
      .prepare(
        `SELECT agent_id, chain_id, registry_address
         FROM registry_entries
         ORDER BY registered_at DESC`,
      )
      .all() as Array<{
      agent_id: number;
      chain_id: number;
      registry_address: string;
    }>;

    return rows.map((row) => ({
      agentId: row.agent_id,
      chainId: row.chain_id,
      registryAddress: row.registry_address as HexAddress,
    }));
  }

  insertReputationEntry(input: {
    fromAddress: HexAddress;
    toAgentId: number;
    chainId: number;
    score: number;
    comment?: string;
    txHash?: string;
  }): string {
    const id = ulid();
    this.db
      .prepare(
        `INSERT INTO reputation_entries(id, from_address, to_agent_id, chain_id, score, comment, tx_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.fromAddress,
        input.toAgentId,
        input.chainId,
        input.score,
        input.comment ?? null,
        input.txHash ?? null,
        new Date().toISOString(),
      );

    return id;
  }

  listReputationEntries(toAgentId: number, chainId?: number): Array<{
    id: string;
    fromAddress: string;
    chainId: number;
    score: number;
    comment: string | null;
    txHash: string | null;
    createdAt: string;
  }> {
    const rows = chainId
      ? this.db
          .prepare(
            `SELECT id, from_address, chain_id, score, comment, tx_hash, created_at
             FROM reputation_entries
             WHERE to_agent_id = ? AND chain_id = ?
             ORDER BY created_at DESC`,
          )
          .all(toAgentId, chainId)
      : this.db
          .prepare(
            `SELECT id, from_address, chain_id, score, comment, tx_hash, created_at
             FROM reputation_entries
             WHERE to_agent_id = ?
             ORDER BY created_at DESC`,
          )
          .all(toAgentId);

    return (rows as Array<{
      id: string;
      from_address: string;
      chain_id: number;
      score: number;
      comment: string | null;
      tx_hash: string | null;
      created_at: string;
    }>).map((row) => ({
      id: row.id,
      fromAddress: row.from_address,
      chainId: row.chain_id,
      score: row.score,
      comment: row.comment,
      txHash: row.tx_hash,
      createdAt: row.created_at,
    }));
  }

  insertChild(input: {
    id?: string;
    name: string;
    address?: string;
    sandboxId?: string;
    status: ChildStatus;
    genesisPrompt: string;
    metadata?: Record<string, unknown>;
  }): string {
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO children(id, name, address, sandbox_id, status, genesis_prompt, created_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.address ?? null,
        input.sandboxId ?? null,
        input.status,
        input.genesisPrompt,
        new Date().toISOString(),
        JSON.stringify(input.metadata ?? {}),
      );

    return id;
  }

  updateChildStatusByIdentifier(identifier: string, status: ChildStatus): boolean {
    const result = this.db
      .prepare(
        `UPDATE children
         SET status = ?
         WHERE id = ? OR sandbox_id = ?`,
      )
      .run(status, identifier, identifier);

    return result.changes > 0;
  }

  getChild(identifier: string): ChildRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, name, address, sandbox_id as sandboxId, status, genesis_prompt as genesisPrompt, created_at as createdAt, metadata
         FROM children
         WHERE id = ? OR sandbox_id = ?`,
      )
      .get(identifier, identifier) as
      | {
          id: string;
          name: string;
          address: string | null;
          sandboxId: string | null;
          status: string;
          genesisPrompt: string;
          createdAt: string;
          metadata: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      ...row,
      status: normalizeChildStatus(row.status),
      metadata: safeParseJson(row.metadata),
    };
  }

  listChildren(status?: ChildStatus): ChildRecord[] {
    const query =
      status === undefined
        ? `SELECT id, name, address, sandbox_id as sandboxId, status, genesis_prompt as genesisPrompt, created_at as createdAt, metadata
           FROM children ORDER BY created_at DESC`
        : `SELECT id, name, address, sandbox_id as sandboxId, status, genesis_prompt as genesisPrompt, created_at as createdAt, metadata
           FROM children WHERE status = ? ORDER BY created_at DESC`;

    const rows = status
      ? (this.db.prepare(query).all(status) as Array<{
          id: string;
          name: string;
          address: string | null;
          sandboxId: string | null;
          status: string;
          genesisPrompt: string;
          createdAt: string;
          metadata: string;
        }>)
        : (this.db.prepare(query).all() as Array<{
          id: string;
          name: string;
          address: string | null;
          sandboxId: string | null;
          status: string;
          genesisPrompt: string;
          createdAt: string;
          metadata: string;
        }>);

    return rows.map((row) => ({
      ...row,
      status: normalizeChildStatus(row.status),
      metadata: safeParseJson(row.metadata),
    }));
  }

  countChildren(status?: ChildStatus): number {
    if (!status) {
      const row = this.db
        .prepare("SELECT COUNT(*) as count FROM children")
        .get() as { count: number };
      return row.count;
    }

    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM children WHERE status = ?")
      .get(status) as { count: number };
    return row.count;
  }

  upsertWalletKeystoreMeta(meta: {
    address: HexAddress;
    path: string;
    encrypted: boolean;
    createdAt: string;
    updatedAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO wallet_keystore_meta(id, address, path, encrypted, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           address = excluded.address,
           path = excluded.path,
           encrypted = excluded.encrypted,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
      )
      .run(meta.address, meta.path, meta.encrypted ? 1 : 0, meta.createdAt, meta.updatedAt);
  }

  getWalletKeystoreMeta(): WalletKeystoreMeta | null {
    const row = this.db
      .prepare(
        `SELECT address, path, encrypted, created_at as createdAt, updated_at as updatedAt
         FROM wallet_keystore_meta
         WHERE id = 1`,
      )
      .get() as
      | {
          address: string;
          path: string;
          encrypted: number;
          createdAt: string;
          updatedAt: string;
        }
      | undefined;

    if (!row || !row.path) {
      return null;
    }

    return {
      address: row.address as HexAddress,
      path: row.path,
      encrypted: row.encrypted === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  createUnlockSession(input: {
    id?: string;
    address: HexAddress;
    expiresAt: string;
  }): string {
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO unlock_sessions(id, address, created_at, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, NULL)`,
      )
      .run(id, input.address, new Date().toISOString(), input.expiresAt);
    return id;
  }

  revokeUnlockSessions(address?: HexAddress): number {
    const now = new Date().toISOString();
    const result = address
      ? this.db
          .prepare(
            `UPDATE unlock_sessions
             SET revoked_at = ?
             WHERE address = ? AND revoked_at IS NULL`,
          )
          .run(now, address)
      : this.db
          .prepare(
            `UPDATE unlock_sessions
             SET revoked_at = ?
             WHERE revoked_at IS NULL`,
          )
          .run(now);
    return result.changes;
  }

  getActiveUnlockSession(address: HexAddress, nowIso = new Date().toISOString()): {
    id: string;
    address: HexAddress;
    createdAt: string;
    expiresAt: string;
    revokedAt: string | null;
  } | null {
    const row = this.db
      .prepare(
        `SELECT id, address, created_at as createdAt, expires_at as expiresAt, revoked_at as revokedAt
         FROM unlock_sessions
         WHERE address = ? AND revoked_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(address, nowIso) as
      | {
          id: string;
          address: string;
          createdAt: string;
          expiresAt: string;
          revokedAt: string | null;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      ...row,
      address: row.address as HexAddress,
    };
  }

  insertAuthNonce(input: {
    token: string;
    address: HexAddress;
    agentId: number;
    agentRegistry: string;
    issuedAt: string;
    expiresAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO auth_nonces(token, address, agent_id, agent_registry, issued_at, expires_at, consumed_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        input.token,
        input.address,
        input.agentId,
        input.agentRegistry,
        input.issuedAt,
        input.expiresAt,
      );
  }

  consumeAuthNonce(token: string, nowIso = new Date().toISOString()): AuthNonceRecord | null {
    const row = this.db
      .prepare(
        `SELECT token, address, agent_id as agentId, agent_registry as agentRegistry, issued_at as issuedAt, expires_at as expiresAt, consumed_at as consumedAt
         FROM auth_nonces
         WHERE token = ?`,
      )
      .get(token) as
      | {
          token: string;
          address: string;
          agentId: number;
          agentRegistry: string;
          issuedAt: string;
          expiresAt: string;
          consumedAt: string | null;
        }
      | undefined;

    if (!row) {
      return null;
    }

    if (row.consumedAt || row.expiresAt <= nowIso) {
      return null;
    }

    this.db
      .prepare("UPDATE auth_nonces SET consumed_at = ? WHERE token = ?")
      .run(nowIso, token);

    return {
      token: row.token,
      address: row.address as HexAddress,
      agentId: row.agentId,
      agentRegistry: row.agentRegistry,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      consumedAt: nowIso,
    };
  }

  cleanupAuthData(nowIso = new Date().toISOString()): void {
    this.db
      .prepare("DELETE FROM auth_nonces WHERE expires_at <= ?")
      .run(nowIso);
    this.db
      .prepare("DELETE FROM auth_request_replay WHERE expires_at <= ?")
      .run(nowIso);
  }

  hasReplayFingerprint(fingerprint: string, nowIso = new Date().toISOString()): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count
         FROM auth_request_replay
         WHERE request_fingerprint = ? AND expires_at > ?`,
      )
      .get(fingerprint, nowIso) as CountRow;
    return row.count > 0;
  }

  recordReplayFingerprint(fingerprint: string, expiresAt: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO auth_request_replay(request_fingerprint, created_at, expires_at)
         VALUES (?, ?, ?)`,
      )
      .run(fingerprint, new Date().toISOString(), expiresAt);
  }

  upsertXmtpConversation(input: {
    id: string;
    peerInboxId?: string;
    type: "dm" | "group";
    consentState?: XmtpConsentState;
    updatedAt?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO xmtp_conversations(id, peer_inbox_id, type, consent_state, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           peer_inbox_id = excluded.peer_inbox_id,
           type = excluded.type,
           consent_state = excluded.consent_state,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.id,
        input.peerInboxId ?? null,
        input.type,
        input.consentState ?? null,
        input.updatedAt ?? new Date().toISOString(),
      );
  }

  listXmtpConversations(limit = 50): XmtpConversationRef[] {
    return this.db
      .prepare(
        `SELECT id, peer_inbox_id as peerInboxId, type, consent_state as consentState, updated_at as updatedAt
         FROM xmtp_conversations
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(limit) as XmtpConversationRef[];
  }

  insertXmtpMessage(input: {
    id: string;
    conversationId: string;
    senderInboxId: string;
    content: string;
    sentAt: string;
    metadata?: Record<string, unknown>;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO xmtp_messages(id, conversation_id, sender_inbox_id, content, sent_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.conversationId,
        input.senderInboxId,
        input.content,
        input.sentAt,
        JSON.stringify(input.metadata ?? {}),
      );
  }

  listXmtpMessages(input: {
    conversationId?: string;
    since?: string;
    limit?: number;
  } = {}): Array<{
    id: string;
    conversationId: string;
    senderInboxId: string;
    content: string;
    sentAt: string;
    metadata: Record<string, unknown>;
  }> {
    const limit = input.limit ?? 100;
    const since = input.since ?? "1970-01-01T00:00:00.000Z";
    const rows = input.conversationId
      ? (this.db
          .prepare(
            `SELECT id, conversation_id as conversationId, sender_inbox_id as senderInboxId, content, sent_at as sentAt, metadata
             FROM xmtp_messages
             WHERE conversation_id = ? AND sent_at >= ?
             ORDER BY sent_at ASC
             LIMIT ?`,
          )
          .all(input.conversationId, since, limit) as Array<{
          id: string;
          conversationId: string;
          senderInboxId: string;
          content: string;
          sentAt: string;
          metadata: string;
        }>)
      : (this.db
          .prepare(
            `SELECT id, conversation_id as conversationId, sender_inbox_id as senderInboxId, content, sent_at as sentAt, metadata
             FROM xmtp_messages
             WHERE sent_at >= ?
             ORDER BY sent_at ASC
             LIMIT ?`,
          )
          .all(since, limit) as Array<{
          id: string;
          conversationId: string;
          senderInboxId: string;
          content: string;
          sentAt: string;
          metadata: string;
        }>);

    return rows.map((row) => ({
      ...row,
      metadata: safeParseJson(row.metadata),
    }));
  }

  insertSurvivalSnapshot(input: Omit<SurvivalSnapshot, "id"> & { id?: string }): string {
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO survival_snapshots(id, tier, estimated_usd, reason, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.tier, input.estimatedUsd, input.reason, input.timestamp);
    return id;
  }

  getLatestSurvivalSnapshot(): SurvivalSnapshot | null {
    const row = this.db
      .prepare(
        `SELECT id, tier, estimated_usd as estimatedUsd, reason, timestamp
         FROM survival_snapshots
         ORDER BY timestamp DESC
         LIMIT 1`,
      )
      .get() as SurvivalSnapshot | undefined;

    return row ?? null;
  }

  insertHeartbeatRun(input: {
    id?: string;
    taskName: string;
    status: "started" | "completed" | "failed";
    details?: string;
    startedAt?: string;
    finishedAt?: string;
  }): string {
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO heartbeat_runs(id, task_name, status, details, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.taskName,
        input.status,
        input.details ?? null,
        input.startedAt ?? new Date().toISOString(),
        input.finishedAt ?? null,
      );
    return id;
  }

  updateHeartbeatRun(id: string, status: "completed" | "failed", details?: string): void {
    this.db
      .prepare(
        `UPDATE heartbeat_runs
         SET status = ?, details = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(status, details ?? null, new Date().toISOString(), id);
  }

  insertSelfModMutation(input: Omit<SelfModMutation, "id"> & { id?: string }): string {
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO self_mod_mutations(id, path, before_hash, after_hash, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.path,
        input.beforeHash ?? null,
        input.afterHash,
        input.reason ?? null,
        input.createdAt,
      );
    return id;
  }

  listSelfModMutations(limit = 50): SelfModMutation[] {
    return this.db
      .prepare(
        `SELECT id, path, before_hash as beforeHash, after_hash as afterHash, reason, created_at as createdAt
         FROM self_mod_mutations
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit) as SelfModMutation[];
  }

  insertRollbackPoint(input: Omit<RollbackPoint, "id"> & { id?: string }): string {
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO self_mod_rollbacks(id, mutation_id, path, rollback_hash, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.mutationId, input.path, input.rollbackHash, input.createdAt);
    return id;
  }

  listRollbackPoints(limit = 50): RollbackPoint[] {
    return this.db
      .prepare(
        `SELECT id, mutation_id as mutationId, path, rollback_hash as rollbackHash, created_at as createdAt
         FROM self_mod_rollbacks
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit) as RollbackPoint[];
  }

  insertLineageEdge(input: Omit<ChildLineageRecord, "createdAt"> & { createdAt?: string }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO lineage_edges(parent_child_id, child_child_id, parent_address, child_address, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.parentChildId,
        input.childChildId,
        input.parentAddress,
        input.childAddress ?? null,
        input.reason ?? null,
        input.createdAt ?? new Date().toISOString(),
      );
  }

  listLineage(childId?: string): ChildLineageRecord[] {
    const rows = childId
      ? this.db
          .prepare(
            `SELECT parent_child_id as parentChildId, child_child_id as childChildId, parent_address as parentAddress, child_address as childAddress, reason, created_at as createdAt
             FROM lineage_edges
             WHERE parent_child_id = ? OR child_child_id = ?
             ORDER BY created_at DESC`,
          )
          .all(childId, childId)
      : this.db
          .prepare(
            `SELECT parent_child_id as parentChildId, child_child_id as childChildId, parent_address as parentAddress, child_address as childAddress, reason, created_at as createdAt
             FROM lineage_edges
             ORDER BY created_at DESC`,
          )
          .all();

    return rows as ChildLineageRecord[];
  }

  insertProviderEvent(input: {
    id?: string;
    provider: string;
    event: string;
    metadata?: Record<string, unknown>;
    timestamp?: string;
  }): string {
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO provider_events(id, provider, event, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.provider,
        input.event,
        JSON.stringify(redactUnknown(input.metadata ?? {})),
        input.timestamp ?? new Date().toISOString(),
      );
    return id;
  }

  listProviderEvents(limit = 100): Array<{
    id: string;
    provider: string;
    event: string;
    metadata: Record<string, unknown>;
    timestamp: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, provider, event, metadata, timestamp
         FROM provider_events
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      provider: string;
      event: string;
      metadata: string;
      timestamp: string;
    }>;
    return rows.map((row) => ({
      ...row,
      metadata: safeParseJson(row.metadata),
    }));
  }

  insertRuntimeIncident(input: {
    id?: string;
    code: RuntimeIncidentCode;
    severity: RuntimeIncidentSeverity;
    category: string;
    message: string;
    metadata?: Record<string, unknown>;
    timestamp?: string;
  }): string {
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO runtime_incidents(id, code, severity, category, message, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.code,
        input.severity,
        input.category,
        redactText(input.message) ?? "runtime incident",
        JSON.stringify(redactUnknown(input.metadata ?? {})),
        input.timestamp ?? new Date().toISOString(),
      );
    return id;
  }

  listRuntimeIncidents(limit = 100): RuntimeIncidentRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, code, severity, category, message, metadata, timestamp
         FROM runtime_incidents
         ORDER BY timestamp DESC
         LIMIT ?`,
      ).all(limit) as Array<{
      id: string;
      code: RuntimeIncidentCode;
      severity: RuntimeIncidentSeverity;
      category: string;
      message: string;
      metadata: string;
      timestamp: string;
    }>;
    return rows.map((row) => ({
      ...row,
      metadata: safeParseJson(row.metadata),
    }));
  }

  insertAlertEvent(input: {
    id?: string;
    code: RuntimeIncidentCode;
    severity: RuntimeIncidentSeverity;
    route: RuntimeAlertRecord["route"];
    message: string;
    metadata?: Record<string, unknown>;
    timestamp?: string;
  }): string {
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO runtime_alerts(id, code, severity, route, message, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.code,
        input.severity,
        input.route,
        redactText(input.message) ?? "runtime alert",
        JSON.stringify(redactUnknown(input.metadata ?? {})),
        input.timestamp ?? new Date().toISOString(),
      );
    return id;
  }

  listAlertEvents(limit = 100): RuntimeAlertRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, code, severity, route, message, metadata, timestamp
         FROM runtime_alerts
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      code: RuntimeIncidentCode;
      severity: RuntimeIncidentSeverity;
      route: RuntimeAlertRecord["route"];
      message: string;
      metadata: string;
      timestamp: string;
    }>;

    return rows.map((row) => ({
      ...row,
      metadata: safeParseJson(row.metadata),
    }));
  }

  insertTurnTelemetry(input: {
    id?: string;
    turnId: string;
    survivalTier: SurvivalTier;
    estimatedUsd: number;
    queueDepth: number;
    spendProxyUsd: number;
    actionsTotal: number;
    actionFailures: number;
    brainDurationMs: number;
    brainFailures: number;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }): string {
    const id = input.id ?? ulid();
    this.db
      .prepare(
        `INSERT INTO runtime_turn_telemetry(
          id, turn_id, survival_tier, estimated_usd, queue_depth, spend_proxy_usd,
          actions_total, action_failures, brain_duration_ms, brain_failures, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.turnId,
        input.survivalTier,
        input.estimatedUsd,
        input.queueDepth,
        input.spendProxyUsd,
        input.actionsTotal,
        input.actionFailures,
        input.brainDurationMs,
        input.brainFailures,
        JSON.stringify(redactUnknown(input.metadata ?? {})),
        input.createdAt ?? new Date().toISOString(),
      );
    return id;
  }

  listTurnTelemetry(limit = 200): TurnTelemetryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
          id,
          turn_id as turnId,
          survival_tier as survivalTier,
          estimated_usd as estimatedUsd,
          queue_depth as queueDepth,
          spend_proxy_usd as spendProxyUsd,
          actions_total as actionsTotal,
          action_failures as actionFailures,
          brain_duration_ms as brainDurationMs,
          brain_failures as brainFailures,
          metadata,
          created_at as createdAt
        FROM runtime_turn_telemetry
        ORDER BY created_at DESC
        LIMIT ?`,
      )
      .all(limit) as Array<Omit<TurnTelemetryRecord, "metadata"> & { metadata: string }>;

    return rows.map((row) => ({
      ...row,
      metadata: safeParseJson(row.metadata),
    }));
  }

  upsertMemoryFact(input: MemoryFactWrite): string {
    const id = ulid();
    const updatedAt = new Date().toISOString();
    const confidence = Number.isFinite(input.confidence ?? NaN) ? Number(input.confidence) : 0.5;
    const source = input.source?.trim() || "runtime";
    this.db
      .prepare(
        `INSERT INTO memory_facts(id, key, value, confidence, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           confidence = excluded.confidence,
           source = excluded.source,
           updated_at = excluded.updated_at`,
      )
      .run(id, input.key, input.value, confidence, source, updatedAt);

    return id;
  }

  listMemoryFacts(limit = 200): MemoryFact[] {
    return this.db
      .prepare(
        `SELECT id, key, value, confidence, source, updated_at as updatedAt
         FROM memory_facts
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(limit) as MemoryFact[];
  }

  insertMemoryEpisode(input: MemoryEpisodeWrite): string {
    const id = ulid();
    this.db
      .prepare(
        `INSERT INTO memory_episodes(id, summary, outcome, action_type, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.summary,
        input.outcome ?? null,
        input.actionType ?? null,
        JSON.stringify(input.metadata ?? {}),
        new Date().toISOString(),
      );

    return id;
  }

  listMemoryEpisodes(limit = 200): MemoryEpisode[] {
    const rows = this.db
      .prepare(
        `SELECT id, summary, outcome, action_type as actionType, metadata, created_at as createdAt
         FROM memory_episodes
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      summary: string;
      outcome: string | null;
      actionType: string | null;
      metadata: string;
      createdAt: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      summary: row.summary,
      outcome: row.outcome,
      actionType: row.actionType,
      metadata: safeParseJson(row.metadata),
      createdAt: row.createdAt,
    }));
  }
}

function normalizeChildStatus(value: string): ChildStatus {
  if (value === "creating" || value === "running" || value === "stopped" || value === "deleted") {
    return value;
  }

  return "running";
}

const REDACTED = "[REDACTED]";
const SECRET_KEY_PATTERN = /(api[_-]?key|private[_-]?key|passphrase|authorization|auth[_-]?header|secret|token|ciphertext|salt|iv|tag|signature)/i;
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._-]+/gi,
  /\b0x[a-fA-F0-9]{64}\b/g,
  /(x-erc8128-signature|x-request-signature)\s*:\s*[^,\s]+/gi,
  /(x-erc8128-nonce|x-request-nonce)\s*:\s*[^,\s]+/gi,
];

function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redactText(value) ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        next[key] = REDACTED;
        continue;
      }
      next[key] = redactUnknown(entry);
    }
    return next;
  }

  return value;
}

function redactText(value?: string | null): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  let redacted = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED);
  }
  return redacted;
}

function safeParseJson(input: string): Record<string, unknown> {
  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch {
    return {};
  }
}
