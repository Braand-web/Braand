CREATE TABLE IF NOT EXISTS account_blocks(user_id TEXT PRIMARY KEY,reason TEXT NOT NULL,created_by TEXT NOT NULL,created_at INTEGER NOT NULL);
-- Additive index. The API always rechecks live resource scope and permissions.
CREATE INDEX IF NOT EXISTS resources_project_context ON resources(workspace_id,kind,status,json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.projectId'),updated_at DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS agent_context_fts USING fts5(resource_id UNINDEXED,workspace_id,title,content,tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS agent_context_fts_insert AFTER INSERT ON resources WHEN NEW.kind IN ('knowledge','deliverable','brand','skill') AND NEW.status!='deleted' BEGIN
 INSERT INTO agent_context_fts(rowid,resource_id,workspace_id,title,content) VALUES(NEW.rowid,NEW.id,NEW.workspace_id,NEW.title,COALESCE(json_extract(CASE WHEN json_valid(NEW.data) THEN NEW.data ELSE '{}' END,'$.content'),json_extract(CASE WHEN json_valid(NEW.data) THEN NEW.data ELSE '{}' END,'$.objective'),''));
END;
CREATE TRIGGER IF NOT EXISTS agent_context_fts_delete AFTER DELETE ON resources BEGIN
 DELETE FROM agent_context_fts WHERE rowid=OLD.rowid;
END;
CREATE TRIGGER IF NOT EXISTS agent_context_fts_update AFTER UPDATE ON resources BEGIN
 DELETE FROM agent_context_fts WHERE rowid=OLD.rowid;
 INSERT INTO agent_context_fts(rowid,resource_id,workspace_id,title,content) SELECT NEW.rowid,NEW.id,NEW.workspace_id,NEW.title,COALESCE(json_extract(CASE WHEN json_valid(NEW.data) THEN NEW.data ELSE '{}' END,'$.content'),json_extract(CASE WHEN json_valid(NEW.data) THEN NEW.data ELSE '{}' END,'$.objective'),'') WHERE NEW.kind IN ('knowledge','deliverable','brand','skill') AND NEW.status!='deleted';
END;
INSERT OR REPLACE INTO agent_context_fts(rowid,resource_id,workspace_id,title,content)
 SELECT rowid,id,workspace_id,title,COALESCE(json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.content'),json_extract(CASE WHEN json_valid(data) THEN data ELSE '{}' END,'$.objective'),'') FROM resources r WHERE kind IN ('knowledge','deliverable','brand','skill') AND status!='deleted';

CREATE TABLE IF NOT EXISTS agent_event_deliveries(subscription_id TEXT NOT NULL,event_id TEXT NOT NULL,payload_digest TEXT NOT NULL,status TEXT NOT NULL,resource_id TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(subscription_id,event_id));
