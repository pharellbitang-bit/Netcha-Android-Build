-- Durable relay schema for the Netcha E2EE lab.
-- PostgreSQL only. The relay stores public keys, routing metadata and ciphertext.
-- It MUST NOT store plaintext, private keys, attachment keys or group master keys.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS e2ee_devices (
  account_id TEXT NOT NULL,
  device_id INTEGER NOT NULL CHECK (device_id BETWEEN 1 AND 5),
  identity_type TEXT NOT NULL DEFAULT 'aci' CHECK (identity_type IN ('aci','pni')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  registration_id INTEGER NOT NULL DEFAULT 0,
  encrypted_device_name BYTEA,
  device_type TEXT CHECK (device_type IN ('mobile','desktop','tablet','web')),
  identity_public_key JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, device_id, identity_type)
);

CREATE TABLE IF NOT EXISTS e2ee_account_identities (
  account_id TEXT NOT NULL,
  identity_type TEXT NOT NULL DEFAULT 'aci' CHECK (identity_type IN ('aci','pni')),
  identity_public_key JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,identity_type)
);

CREATE TABLE IF NOT EXISTS e2ee_prekeys (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  device_id INTEGER NOT NULL,
  identity_type TEXT NOT NULL DEFAULT 'aci',
  key_type TEXT NOT NULL CHECK (key_type IN ('ecSignedPreKey','kemLastResortPreKey','ecPreKey','kemOneTimePreKey')),
  key_id BIGINT NOT NULL,
  public_key TEXT NOT NULL,
  signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ,
  UNIQUE(account_id, device_id, identity_type, key_type, key_id),
  FOREIGN KEY(account_id,device_id,identity_type)
    REFERENCES e2ee_devices(account_id,device_id,identity_type) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS e2ee_prekeys_available
  ON e2ee_prekeys(account_id,device_id,identity_type,key_type,id)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS e2ee_mailbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_message_id TEXT NOT NULL,
  sender_account_id TEXT NOT NULL,
  sender_device_id INTEGER NOT NULL,
  target_account_id TEXT NOT NULL,
  target_device_id INTEGER NOT NULL,
  identity_type TEXT NOT NULL DEFAULT 'aci',
  message_type TEXT NOT NULL,
  content_kind TEXT NOT NULL DEFAULT 'message' CHECK (content_kind IN ('message','receipt')),
  delivery_class TEXT NOT NULL DEFAULT 'user-visible' CHECK (delivery_class IN ('user-visible','background-sync','ephemeral')),
  timestamp_ms BIGINT NOT NULL DEFAULT 0,
  ciphertext TEXT NOT NULL,
  operation_epoch_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  UNIQUE(target_account_id,target_device_id,client_message_id)
);
CREATE INDEX IF NOT EXISTS e2ee_mailbox_pending
  ON e2ee_mailbox(target_account_id,target_device_id,created_at)
  WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS e2ee_groups (
  group_id TEXT PRIMARY KEY,
  state_version BIGINT NOT NULL DEFAULT 0,
  encrypted_state JSONB NOT NULL,
  sender_key_epoch BIGINT NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS e2ee_group_members (
  group_id TEXT NOT NULL REFERENCES e2ee_groups(group_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member','invited')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  joined_version BIGINT NOT NULL,
  removed_version BIGINT,
  PRIMARY KEY(group_id,account_id)
);
CREATE TABLE IF NOT EXISTS e2ee_group_changes (
  group_id TEXT NOT NULL REFERENCES e2ee_groups(group_id) ON DELETE CASCADE,
  version BIGINT NOT NULL,
  actor_account_id TEXT NOT NULL,
  encrypted_change JSONB NOT NULL,
  sender_key_epoch BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(group_id,version)
);
CREATE TABLE IF NOT EXISTS e2ee_group_envelopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id TEXT NOT NULL REFERENCES e2ee_groups(group_id) ON DELETE CASCADE,
  state_version BIGINT NOT NULL,
  sender_key_epoch BIGINT NOT NULL,
  sender_account_id TEXT NOT NULL,
  sender_device_id INTEGER NOT NULL,
  target_account_id TEXT NOT NULL,
  target_device_id INTEGER NOT NULL,
  client_message_id TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  UNIQUE(target_account_id,target_device_id,client_message_id)
);
CREATE INDEX IF NOT EXISTS e2ee_group_mailbox_pending
  ON e2ee_group_envelopes(target_account_id,target_device_id,created_at)
  WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS e2ee_attachments (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key TEXT NOT NULL UNIQUE,
  owner_account_id TEXT NOT NULL,
  conversation_scope TEXT NOT NULL,
  ciphertext_size BIGINT NOT NULL CHECK(ciphertext_size > 0),
  content_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS e2ee_attachments_owner ON e2ee_attachments(owner_account_id,conversation_scope);
