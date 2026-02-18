export const SCHEMA_VERSION = 2;

export const CREATE_BASE_TABLES = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS identity (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  state TEXT NOT NULL,
  input TEXT,
  output TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS audit_entries (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT
);

CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  direction TEXT NOT NULL,
  network TEXT NOT NULL,
  amount TEXT NOT NULL,
  asset TEXT NOT NULL,
  tx_hash TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS registry_entries (
  agent_id INTEGER NOT NULL,
  chain_id INTEGER NOT NULL,
  registry_address TEXT NOT NULL,
  owner_address TEXT NOT NULL,
  agent_uri TEXT,
  tx_hash TEXT,
  registered_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, chain_id)
);

CREATE TABLE IF NOT EXISTS reputation_entries (
  id TEXT PRIMARY KEY,
  from_address TEXT NOT NULL,
  to_agent_id INTEGER NOT NULL,
  chain_id INTEGER NOT NULL,
  score INTEGER NOT NULL,
  comment TEXT,
  tx_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender TEXT NOT NULL,
  receiver TEXT NOT NULL,
  thread_id TEXT,
  content TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS children (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  sandbox_id TEXT,
  status TEXT NOT NULL,
  genesis_prompt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS constitution_hashes (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emergency_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wallet_keystore_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  address TEXT NOT NULL,
  path TEXT NOT NULL,
  encrypted INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS unlock_sessions (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  token TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  agent_id INTEGER NOT NULL,
  agent_registry TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_request_replay (
  request_fingerprint TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS xmtp_conversations (
  id TEXT PRIMARY KEY,
  peer_inbox_id TEXT,
  type TEXT NOT NULL,
  consent_state TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS xmtp_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_inbox_id TEXT NOT NULL,
  content TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS survival_snapshots (
  id TEXT PRIMARY KEY,
  tier TEXT NOT NULL,
  estimated_usd REAL NOT NULL,
  reason TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS heartbeat_runs (
  id TEXT PRIMARY KEY,
  task_name TEXT NOT NULL,
  status TEXT NOT NULL,
  details TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS self_mod_mutations (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  before_hash TEXT,
  after_hash TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS self_mod_rollbacks (
  id TEXT PRIMARY KEY,
  mutation_id TEXT NOT NULL,
  path TEXT NOT NULL,
  rollback_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lineage_edges (
  parent_child_id TEXT NOT NULL,
  child_child_id TEXT NOT NULL,
  parent_address TEXT NOT NULL,
  child_address TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (parent_child_id, child_child_id)
);

CREATE TABLE IF NOT EXISTS provider_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_incidents (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  timestamp TEXT NOT NULL
);

INSERT OR IGNORE INTO emergency_state(id, enabled, reason) VALUES (1, 0, NULL);
INSERT OR IGNORE INTO wallet_keystore_meta(id, address, path, encrypted, created_at, updated_at)
VALUES (1, '0x0000000000000000000000000000000000000000', '', 1, datetime('now'), datetime('now'));

CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_entries(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_received ON messages(received_at);
CREATE INDEX IF NOT EXISTS idx_children_status ON children(status);
CREATE INDEX IF NOT EXISTS idx_unlock_sessions_expires ON unlock_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_nonces_expires ON auth_nonces(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_request_replay_expires ON auth_request_replay(expires_at);
CREATE INDEX IF NOT EXISTS idx_xmtp_messages_conversation ON xmtp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_survival_snapshots_timestamp ON survival_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_heartbeat_runs_task ON heartbeat_runs(task_name);
CREATE INDEX IF NOT EXISTS idx_provider_events_timestamp ON provider_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_runtime_incidents_timestamp ON runtime_incidents(timestamp);
`;
