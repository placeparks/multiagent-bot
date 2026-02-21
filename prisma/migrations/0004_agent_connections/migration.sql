-- Migration: Agent-to-agent connections
-- Allows an agent to delegate tasks to another agent via OpenClaw's tools.agentToAgent

CREATE TABLE IF NOT EXISTS "agent_links" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "sourceInstanceId" TEXT NOT NULL,
  "targetInstanceId" TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_links_sourceInstanceId_fkey"
    FOREIGN KEY ("sourceInstanceId") REFERENCES "instances"("id") ON DELETE CASCADE,
  CONSTRAINT "agent_links_targetInstanceId_fkey"
    FOREIGN KEY ("targetInstanceId") REFERENCES "instances"("id") ON DELETE CASCADE,
  CONSTRAINT "agent_links_unique"
    UNIQUE ("sourceInstanceId", "targetInstanceId")
);

CREATE INDEX IF NOT EXISTS "agent_links_sourceInstanceId_idx" ON "agent_links"("sourceInstanceId");
CREATE INDEX IF NOT EXISTS "agent_links_targetInstanceId_idx" ON "agent_links"("targetInstanceId");
