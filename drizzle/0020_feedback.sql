-- Suggestions board (same statements as lib/feedback-schema.mjs).
CREATE TABLE IF NOT EXISTS feedback_posts(
    id TEXT PRIMARY KEY,
    author_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('feature','bug')),
    title TEXT NOT NULL CHECK(length(title) BETWEEN 8 AND 120),
    body TEXT NOT NULL DEFAULT '' CHECK(length(body) <= 5000),
    private INTEGER NOT NULL DEFAULT 0 CHECK(private IN (0,1)),
    status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','under_review','planned','in_progress','done','declined','duplicate')),
    duplicate_of TEXT REFERENCES feedback_posts(id) ON DELETE SET NULL CHECK(duplicate_of IS NULL OR duplicate_of != id),
    attachment_id TEXT, attachment_path TEXT,
    vote_count INTEGER NOT NULL DEFAULT 0 CHECK(vote_count >= 0),
    paid_vote_count INTEGER NOT NULL DEFAULT 0 CHECK(paid_vote_count >= 0),
    comment_count INTEGER NOT NULL DEFAULT 0 CHECK(comment_count >= 0),
    report_count INTEGER NOT NULL DEFAULT 0 CHECK(report_count >= 0),
    pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
    hidden_at INTEGER, hidden_by TEXT,
    status_changed_at INTEGER, last_activity_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS feedback_posts_activity ON feedback_posts(last_activity_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS feedback_posts_status ON feedback_posts(status,type);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS feedback_votes(
    post_id TEXT NOT NULL REFERENCES feedback_posts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    is_paid INTEGER NOT NULL DEFAULT 0 CHECK(is_paid IN (0,1)),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(post_id,user_id));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS feedback_comments(
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES feedback_posts(id) ON DELETE CASCADE,
    author_id TEXT, author_name TEXT NOT NULL,
    body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 3000),
    is_team INTEGER NOT NULL DEFAULT 0 CHECK(is_team IN (0,1)),
    pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
    hidden_at INTEGER, hidden_by TEXT,
    created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS feedback_comments_post ON feedback_comments(post_id,created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS feedback_reports(
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES feedback_posts(id) ON DELETE CASCADE,
    comment_id TEXT REFERENCES feedback_comments(id) ON DELETE CASCADE,
    reporter_id TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '' CHECK(length(reason) <= 300),
    resolved_at INTEGER, resolved_by TEXT,
    created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS feedback_reports_once ON feedback_reports(reporter_id,post_id,COALESCE(comment_id,''));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS feedback_notifications(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    post_id TEXT NOT NULL REFERENCES feedback_posts(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    read_at INTEGER,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id,post_id,status));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS feedback_visits(user_id TEXT PRIMARY KEY,seen_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS feedback_rate_limits(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS platform_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS feedback_vote_added AFTER INSERT ON feedback_votes BEGIN
    UPDATE feedback_posts SET vote_count=vote_count+1,paid_vote_count=paid_vote_count+NEW.is_paid,last_activity_at=MAX(last_activity_at,NEW.created_at) WHERE id=NEW.post_id;
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS feedback_vote_removed AFTER DELETE ON feedback_votes BEGIN
    UPDATE feedback_posts SET vote_count=MAX(0,vote_count-1),paid_vote_count=MAX(0,paid_vote_count-OLD.is_paid) WHERE id=OLD.post_id;
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS feedback_comment_added AFTER INSERT ON feedback_comments WHEN NEW.hidden_at IS NULL BEGIN
    UPDATE feedback_posts SET comment_count=comment_count+1,last_activity_at=MAX(last_activity_at,NEW.created_at) WHERE id=NEW.post_id;
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS feedback_comment_hidden AFTER UPDATE OF hidden_at ON feedback_comments WHEN OLD.hidden_at IS NULL AND NEW.hidden_at IS NOT NULL BEGIN
    UPDATE feedback_posts SET comment_count=MAX(0,comment_count-1) WHERE id=NEW.post_id;
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS feedback_comment_shown AFTER UPDATE OF hidden_at ON feedback_comments WHEN OLD.hidden_at IS NOT NULL AND NEW.hidden_at IS NULL BEGIN
    UPDATE feedback_posts SET comment_count=comment_count+1 WHERE id=NEW.post_id;
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS feedback_report_added AFTER INSERT ON feedback_reports WHEN NEW.resolved_at IS NULL BEGIN
    UPDATE feedback_posts SET report_count=report_count+1 WHERE id=NEW.post_id;
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS feedback_report_resolved AFTER UPDATE OF resolved_at ON feedback_reports WHEN OLD.resolved_at IS NULL AND NEW.resolved_at IS NOT NULL BEGIN
    UPDATE feedback_posts SET report_count=MAX(0,report_count-1) WHERE id=NEW.post_id;
  END;
