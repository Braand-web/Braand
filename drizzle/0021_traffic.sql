-- Traffic measured by Braand (same statements as lib/traffic-core.mjs).
CREATE TABLE IF NOT EXISTS traffic_daily(day TEXT NOT NULL,scope TEXT NOT NULL,key TEXT NOT NULL,dim TEXT NOT NULL,value TEXT NOT NULL,n INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,scope,key,dim,value));
CREATE TABLE IF NOT EXISTS traffic_visitors(day TEXT NOT NULL,scope TEXT NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(day,scope,key,hash));
