ALTER TABLE browser_sessions ADD COLUMN execution_source TEXT NOT NULL DEFAULT 'interactive' CHECK(execution_source IN ('interactive','background'));
--> statement-breakpoint
ALTER TABLE browser_sessions ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE browser_permissions (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 user_id TEXT NOT NULL,
 visit TEXT NOT NULL DEFAULT 'ask' CHECK(visit IN ('allow','ask','deny')),
 submit TEXT NOT NULL DEFAULT 'ask' CHECK(submit IN ('allow','ask','deny')),
 download TEXT NOT NULL DEFAULT 'ask' CHECK(download IN ('allow','ask','deny')),
 upload TEXT NOT NULL DEFAULT 'ask' CHECK(upload IN ('ask','deny')),
 credentials TEXT NOT NULL DEFAULT 'ask' CHECK(credentials IN ('allow','ask','deny')),
 version INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,user_id)
);
