CREATE TABLE vault_credentials(
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL,
 origin TEXT NOT NULL, label TEXT NOT NULL, method TEXT NOT NULL CHECK(method='password'),
 cipher TEXT NOT NULL, usage_permission TEXT NOT NULL CHECK(usage_permission IN ('auto','ask')),
 version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, last_used_at INTEGER
);
CREATE INDEX vault_owner ON vault_credentials(workspace_id,user_id);
CREATE TABLE vault_login_log(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,credential_id TEXT,origin TEXT NOT NULL,session_id TEXT,result TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE vault_capture_tokens(digest TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE INDEX vault_capture_owner ON vault_capture_tokens(workspace_id,user_id,expires_at);
