
  ---
  The Design: Structured Memory with Reasoning Chains

  Most systems store what happened. This one stores what was decided, why, and what resulted. That's the difference between a bot that remembers
   and a bot that learns.

  ---
  Three Layers — No Vectors, No AI Extraction, $0 Extra Cost

  ---
  Layer 1 — Identity Profile (per user, always injected)

  Not key-value pairs. A living profile the agent builds and updates:

  {
    "name": "Alice Chen",
    "role": "Marketing Director, Acme Corp",
    "communication_style": "Direct, data-driven, bullet points only",
    "timezone": "PST",
    "current_focus": "Q1 2026 marketing campaign",
    "relationship_since": "2025-10-01",
    "preferences": ["no small talk", "data before opinion", "weekly summaries"]
  }

  One profile per senderId. Always in context. Agent PATCHes it when new info surfaces.

  ---
  Layer 2 — Decision Journal (the innovative part)

  Not free-form notes. Structured entries with full reasoning chains:

  {
    "context":   "Email deliverability dropped to 87% after domain change",
    "decision":  "Switch from SendGrid to Mailchimp for all marketing emails",
    "reasoning": [
      "Mailchimp reputation better for low-volume senders",
      "Cost: $50/mo vs $400/mo — same feature set",
      "Migration ~4 hours — acceptable tradeoff"
    ],
    "alternatives_considered": ["Fix SendGrid SPF/DKIM config", "Move to AWS SES"],
    "tags":     ["email", "vendor", "cost"],
    "outcome":  "Open rates 18% → 31%. Saved $350/mo.",     ← updated later
    "outcome_date": "2026-02-01"
  }

  Last 5 decisions always injected. Older ones: agent queries GET /decisions?tags=email on demand. SQL tag match — no vectors, no approximation.

  ---
  Layer 3 — Episode Timeline (compressed context)

  Agent writes 1–2 sentence summaries of significant exchanges. Not raw logs:

  2026-01-20 [marketing]: Alice presented Q4 (lead gen -18%).
                          Agreed on content marketing focus for Q1.
  2025-12-15 [budget]:    2026 marketing budget set at $180k, 60% digital.
  2025-11-10 [hiring]:    Team growing 5→12. Async hiring process approved.

  Last 7 episodes always injected. Queryable by date range for deeper history.

  ---
  What the Agent Sees Every Conversation

  [MEMORY — Alice Chen]

  PROFILE:
  Role: Marketing Director, Acme Corp | Timezone: PST
  Style: Direct, data-driven, bullet points only
  Focus: Q1 2026 marketing campaign

  DECISION HISTORY:
  ──────────────────────────────────────────────
  2026-01-15  #email #vendor  ✓ WORKED
  Decided: Switched SendGrid → Mailchimp
  Because: Deliverability 87%, Mailchimp $350/mo cheaper
  Result: Open rates 18%→31%, saved $350/mo ✓
  ──────────────────────────────────────────────
  2025-11-20  #hiring #process  ✓ WORKED
  Decided: Async-first hiring process
  Because: Team across 3 timezones, sync calls inefficient
  Result: Time-to-hire -40% ✓
  ──────────────────────────────────────────────
  (Search older: /decisions?tags=X)

  RECENT EPISODES:
  • 2026-01-20: Q4 review — lead gen down 18%, agreed Q1 = content marketing
  • 2026-01-10: Set up 3-email welcome sequence. Alice approved copy + timing.
  • 2025-12-15: Budget planning — $180k total, 60% digital

  KNOWLEDGE BASE:
  --- Q1_Strategy.pdf ---
  [content...]
  [/MEMORY]

  ~1,200 tokens. Always accurate. Never guessed.

  ---
  Why This Doesn't Hallucinate

  The agent wrote every line above during past conversations. Nothing was inferred, mined, or similarity-matched. When it reads "Outcome: Open  
  rates 18%→31%" it knows that's exact — because it wrote it. No "I think we decided..." — it's "We decided X because A, B, C — and it worked." 

  ---
  What Gets Deleted

  ┌─────────────────────────────────┬───────────────────────────────────┐
  │           File/Table            │               Gone?               │
  ├─────────────────────────────────┼───────────────────────────────────┤
  │ log-miner.ts                    │ Yes — never ran on Railway anyway │
  ├─────────────────────────────────┼───────────────────────────────────┤
  │ entity-extractor.ts             │ Yes — all Haiku calls             │
  ├─────────────────────────────────┼───────────────────────────────────┤
  │ consolidation.ts                │ Yes                               │
  ├─────────────────────────────────┼───────────────────────────────────┤
  │ importance-scorer.ts            │ Yes                               │
  ├─────────────────────────────────┼───────────────────────────────────┤
  │ memory_events table             │ Yes                               │
  ├─────────────────────────────────┼───────────────────────────────────┤
  │ entities + entity_relationships │ Yes                               │
  ├─────────────────────────────────┼───────────────────────────────────┤
  │ decisions table (current)       │ Yes — replaced                    │
  ├─────────────────────────────────┼───────────────────────────────────┤
  │ vercel.json crons               │ Yes                               │
  └─────────────────────────────────┴───────────────────────────────────┘

  What Stays

  ┌─────────────────────────────────────────┬────────────────────────┐
  │                Component                │         Status         │
  ├─────────────────────────────────────────┼────────────────────────┤
  │ knowledge_documents + document_chunks   │ Untouched              │
  ├─────────────────────────────────────────┼────────────────────────┤
  │ Document upload → chunking → embeddings │ Untouched              │
  ├─────────────────────────────────────────┼────────────────────────┤
  │ RAG search (vector + full-text)         │ Untouched              │
  ├─────────────────────────────────────────┼────────────────────────┤
  │ buildMemoryDigest                       │ Rebuilt (simpler)      │
  ├─────────────────────────────────────────┼────────────────────────┤
  │ Dashboard                               │ Rebuilt for new schema │
  └─────────────────────────────────────────┴────────────────────────┘

  New Tables

  memory_profiles  — one per (instanceId, senderId), JSONB fields
  memory_decisions — structured: decision, reasoning[], alternatives[], tags[], outcome
  memory_episodes  — summary text, tags[], happenedAt date

  No vector columns. No pgvector for memory at all.

  ---
  The Outcome Loop (what makes it get smarter over time)

  When a user later says "that Mailchimp switch worked great" — the agent patches the decision outcome. In 6 months when someone asks about     
  email providers, the agent doesn't just remember the decision — it knows it worked, and why. This is what separates advisors from assistants. 

  ---
  Shall I implement this? I'll start by deleting the dead pipeline files, then create the new schema + API + digest builder.

✻ Sautéed for 4m 19s

❯ yes 

● Now let me read the current schema and all files I need to understand before touching anything.

● Searched for 3 patterns, read 2 files (ctrl+o to expand)

● Good. Let me now read the remaining files I need to understand before rewriting, then execute everything.

● Read 3 files (ctrl+o to expand)

● Let me check the migrations setup before touching the schema.

● Read 2 files (ctrl+o to expand)

● Good. Now I have everything. Let me execute all tasks in order.

● Step 1 — Delete all dead files

● Bash(rm -f \
        "D:/bot-saas-main/bot-saas-main/lib/memory/processing/log-miner.ts" \…)
  ⎿  done

● Bash(# Remove empty directories left behind
      rmdir "D:/bot-saas-main/bot-saas-main/app/api/memory/cron/consolidate" 2>/dev/null…)
  ⎿  done    

● Now empty vercel.json crons and update the schema.    
    
● Write(vercel.json)                                             
  ⎿  Added 1 line, removed 10 lines
       1  {                                    
       2 -  "crons": [
       3 -    {
       4 -      "path": "/api/memory/cron/mine",                                                                                                       5 -      "schedule": "*/15 * * * *"
       6 -    },                                                                                                                                       7 -    {
       8 -      "path": "/api/memory/cron/consolidate",                                                                                         
       9 -      "schedule": "0 3 * * *"
      10 -    }                                                                                                                                       11 -  ]                                                                                                                                   
       2 +  "crons": []
       3  }

● Read 1 file (ctrl+o to expand)    

● Now I'll replace the entire memory section of the schema with the new models:
                                            
● Update(prisma\schema.prisma)              
  ⎿  Added 56 lines, removed 114 lines                           
      225  //  NEXUS MEMORY SYSTEM             
      226  // ─────────────────────────────────────────────
      227                            
      228 -model MemoryEvent {
      229 -  id             String          @id @default(cuid())                                                                                
      230 -  instanceId     String                                                                                                                    231 -  sessionId      String?                                                                                                             
      232 -  eventType      MemoryEventType                                                                                                     
      233 -  channel        String?
      234 -  senderId       String?
      235 -  content        String          @db.Text                                                                                            
      236 -  summary        String?         @db.Text                                                                                            
      237 -  embedding      Unsupported("vector(1536)")?                                                                                        
      238 -  importance     Float           @default(0.5)                                                                                       
      239 -  consolidatedAt DateTime?                                                                                                           
      240 -  expiresAt      DateTime?                                                                                                           
      241 -  metadata       Json?                                                                                                               
      228 +// Per-user/sender identity profile. One row per (instanceId, senderId).                                                             
      229 +// senderId = 'default' for single-user bots.                                                                                        
      230 +model MemoryProfile {                                                                                                                
      231 +  id                 String   @id @default(cuid())                                                                                   
      232 +  instanceId         String                                                                                                          
      233 +  senderId           String   @default("default")                                                                                    
      234 +  name               String?                                                                                                         
      235 +  role               String?                                                                                                         
      236 +  communicationStyle String?                                                                                                         
      237 +  timezone           String?                                                                                                         
      238 +  currentFocus       String?  @db.Text                                                                                               
      239 +  relationshipContext String? @db.Text                                                                                               
      240 +  preferences        String[]                                                                                                        
      241 +  metadata           Json?                                                                                                           
      242
      243 -  createdAt      DateTime        @default(now())                                                                                     
      243 +  createdAt          DateTime @default(now())                                                                                        
      244 +  updatedAt          DateTime @updatedAt                                                                                             
      245
      246 +  @@unique([instanceId, senderId])                                                                                                   
      247    @@index([instanceId])
      246 -  @@index([instanceId, senderId])                                                                                                    
      247 -  @@index([instanceId, createdAt])                                                                                                   
      248 -  @@map("memory_events")                                                                                                             
      248 +  @@map("memory_profiles")                                                                                                           
      249  }
      250
      251 -enum MemoryEventType {                                                                                                               
      252 -  CONVERSATION                                                                                                                       
      253 -  DECISION                                                                                                                           
      254 -  TASK_COMPLETED                                                                                                                     
      255 -  FEEDBACK                                                                                                                           
      256 -  ERROR                                                                                                                              
      257 -}                                                                                                                                    
      251 +// Structured decision journal with full reasoning chains + outcomes.                                                                
      252 +// Agent writes these during conversations. Queryable by tags or date range.                                                         
      253 +model MemoryDecision {                                                                                                               
      254 +  id                     String    @id @default(cuid())                                                                              
      255 +  instanceId             String                                                                                                      
      256 +  senderId               String?                                                                                                     
      257 +  context                String    @db.Text                                                                                          
      258 +  decision               String    @db.Text                                                                                          
      259 +  reasoning              String[]                                                                                                    
      260 +  alternativesConsidered String[]                                                                                                    
      261 +  tags                   String[]                                                                                                    
      262 +  outcome                String?   @db.Text                                                                                          
      263 +  outcomeAt              DateTime?                                                                                                   
      264
      259 -model Entity {                                                                                                                       
      260 -  id               String               @id @default(cuid())                                                                         
      261 -  instanceId       String                                                                                                            
      262 -  type             EntityType                                                                                                        
      263 -  name             String                                                                                                            
      264 -  aliases          String[]                                                                                                          
      265 -  summary          String?              @db.Text                                                                                     
      266 -  embedding        Unsupported("vector(1536)")?                                                                                      
      267 -  importance       Float                @default(0.5)                                                                                
      268 -  interactionCount Int                  @default(0)                                                                                  
      269 -  lastSeen         DateTime?                                                                                                         
      270 -  metadata         Json?                                                                                                             
      265 +  createdAt              DateTime  @default(now())                                                                                   
      266 +  updatedAt              DateTime  @updatedAt                                                                                        
      267
      272 -  createdAt        DateTime             @default(now())                                                                              
      273 -  updatedAt        DateTime             @updatedAt                                                                                   
      274 -                                                                                                                                     
      275 -  relationshipsA   EntityRelationship[] @relation("EntityA")                                                                         
      276 -  relationshipsB   EntityRelationship[] @relation("EntityB")                                                                         
      277 -                                                                                                                                     
      278 -  @@unique([instanceId, name])                                                                                                       
      268    @@index([instanceId])
      280 -  @@map("entities")                                                                                                                  
      269 +  @@index([instanceId, createdAt])                                                                                                   
      270 +  @@map("memory_decisions")                                                                                                          
      271  }
      272
      283 -enum EntityType {                                                                                                                    
      284 -  PERSON                                                                                                                             
      285 -  ORGANIZATION                                                                                                                       
      286 -  TOPIC                                                                                                                              
      287 -  PRODUCT                                                                                                                            
      288 -  LOCATION                                                                                                                           
      289 -  OTHER                                                                                                                              
      290 -}                                                                                                                                    
      273 +// Compressed episode summaries — 1-2 sentence snapshots of significant exchanges.                                                   
      274 +// Agent writes these to capture context without storing raw logs.                                                                   
      275 +model MemoryEpisode {                                                                                                                
      276 +  id         String   @id @default(cuid())                                                                                           
      277 +  instanceId String                                                                                                                  
      278 +  senderId   String?                                                                                                                 
      279 +  summary    String   @db.Text                                                                                                       
      280 +  tags       String[]                                                                                                                
      281 +  happenedAt DateTime @default(now())                                                                                                
      282 +  createdAt  DateTime @default(now())                                                                                                
      283
      292 -model EntityRelationship {                                                                                                           
      293 -  id               String   @id @default(cuid())                                                                                     
      294 -  entityAId        String                                                                                                            
      295 -  entityBId        String                                                                                                            
      296 -  relationshipType String                                                                                                            
      297 -  confidence       Float    @default(0.8)                                                                                            
      298 -  notes            String?                                                                                                           
      299 -  since            DateTime?                                                                                                         
      300 -                                                                                                                                     
      301 -  createdAt        DateTime @default(now())                                                                                          
      302 -                                                                                                                                     
      303 -  entityA          Entity   @relation("EntityA", fields: [entityAId], references: [id], onDelete: Cascade)                           
      304 -  entityB          Entity   @relation("EntityB", fields: [entityBId], references: [id], onDelete: Cascade)                           
      305 -                                                                                                                                     
      306 -  @@unique([entityAId, entityBId, relationshipType])                                                                                 
      307 -  @@map("entity_relationships")                                                                                                      
      308 -}                                                                                                                                    
      309 -                                                                                                                                     
      310 -model Decision {                                                                                                                     
      311 -  id                String   @id @default(cuid())                                                                                    
      312 -  instanceId        String                                                                                                           
      313 -  sessionId         String?                                                                                                          
      314 -  channel           String?                                                                                                          
      315 -  senderId          String?                                                                                                          
      316 -  decision          String   @db.Text                                                                                                
      317 -  reasoning         String[]                                                                                                         
      318 -  confidence        Float    @default(0.7)                                                                                           
      319 -  entitiesInvolved  String[]                                                                                                         
      320 -  documentsUsed     String[]                                                                                                         
      321 -  memoriesUsed      String[]                                                                                                         
      322 -  modelUsed         String?                                                                                                          
      323 -  tokensUsed        Int?                                                                                                             
      324 -  contextSnapshot   Json?                                                                                                            
      325 -  outcome           String?  @db.Text                                                                                                
      326 -  outcomeAt         DateTime?                                                                                                        
      327 -  embedding         Unsupported("vector(1536)")?                                                                                     
      328 -                                                                                                                                     
      329 -  createdAt         DateTime @default(now())                                                                                         
      330 -  updatedAt         DateTime @updatedAt                                                                                              
      331 -                                                                                                                                     
      284    @@index([instanceId])
      333 -  @@index([instanceId, createdAt])                                                                                                   
      334 -  @@map("decisions")                                                                                                                 
      285 +  @@index([instanceId, happenedAt])                                                                                                  
      286 +  @@map("memory_episodes")                                                                                                           
      287  }
      288
      289  model KnowledgeDocument {
     ...
      331    @@map("document_chunks")
      332  }
      333
      334 +// Per-instance memory config: API key for agent auth + doc storage limit.                                                           
      335  model MemoryConfig {
      383 -  id              String     @id @default(cuid())                                                                                    
      384 -  instanceId      String     @unique                                                                                                 
      385 -  tier            MemoryTier @default(STANDARD)                                                                                      
      386 -  retentionDays   Int?                                                                                                               
      387 -  maxEntities     Int        @default(100)                                                                                           
      388 -  maxDocumentsMB  Float      @default(500)                                                                                           
      389 -  eventsThisMonth Int        @default(0)                                                                                             
      390 -  documentsUsedMB Float      @default(0)                                                                                             
      391 -  memoryApiKey    String     @unique                                                                                                 
      392 -  lastLogMinedAt  DateTime?                                                                                                          
      393 -  lastDigestAt    DateTime?                                                                                                          
      394 -  digestContent   String?    @db.Text                                                                                                
      336 +  id             String   @id @default(cuid())                                                                                       
      337 +  instanceId     String   @unique                                                                                                    
      338 +  memoryApiKey   String   @unique                                                                                                    
      339 +  maxDocumentsMB Float    @default(500)                                                                                              
      340 +  lastDigestAt   DateTime?                                                                                                           
      341 +  digestContent  String?  @db.Text                                                                                                   
      342
      396 -  createdAt       DateTime   @default(now())                                                                                         
      397 -  updatedAt       DateTime   @updatedAt                                                                                              
      343 +  createdAt      DateTime @default(now())                                                                                            
      344 +  updatedAt      DateTime @updatedAt                                                                                                 
      345
      346    @@map("memory_configs")
      347  }
      401 -                                                                                                                                     
      402 -enum MemoryTier {                                                                                                                    
      403 -  STANDARD                                                                                                                           
      404 -  PRO                                                                                                                                
      405 -}                                                                                                                                    

● Now create the migration SQL:             
    
● Bash(mkdir -p "D:/bot-saas-main/bot-saas-main/prisma/migrations/0002_nexus_memory_v2")
  ⎿  Done    
                              
● Write(prisma\migrations\0002_nexus_memory_v2\migration.sql)
  ⎿  Wrote 76 lines to prisma\migrations\0002_nexus_memory_v2\migration.sql
      1 -- Nexus Memory v2 Migration                                                                                                                  2 -- Drops the old complex memory tables (episodic, entity, decision with vectors)
      3 -- and replaces them with simple structured tables that need no pgvector.                                                                     4                                               
      5 -- ── Drop old tables ────────────────────────────────────────────────────────                                                          
      6 DROP TABLE IF EXISTS memory_events CASCADE;                                                                                                   7 DROP TABLE IF EXISTS entity_relationships CASCADE;
      8 DROP TABLE IF EXISTS entities CASCADE;                                                                                                        9 DROP TABLE IF EXISTS decisions CASCADE;                                                                                                 
     … +66 lines (ctrl+o to expand)                                                                                                             
  
● Step 3 — New store files, types, index, digest builder               
    
● Write(lib\memory\types.ts)              
  ⎿  Wrote 99 lines to lib\memory\types.ts
       1 // ── Profile ──────────────────────────────────────────────────────────────────
       2 
       3 export interface ProfileData {
       4   instanceId: string                                                                                                                          5   senderId?: string
       6   name?: string                                                                                                                               7   role?: string
       8   communicationStyle?: string                                                                                                          
       9   timezone?: string
      10   currentFocus?: string
     … +89 lines (ctrl+o to expand)

● Write(lib\memory\stores\profiles.ts)    
  ⎿  Wrote 53 lines to lib\memory\stores\profiles.ts   
       1 import { prisma } from '@/lib/prisma'
       2 import { ProfileData, ProfileRow } from '../types'
       3                           
       4 export async function upsertProfile(data: ProfileData): Promise<ProfileRow> {
       5   const senderId = data.senderId ?? 'default'
       6   return (prisma as any).memoryProfile.upsert({                                                                                               7     where: {
       8       instanceId_senderId: { instanceId: data.instanceId, senderId },                                                                  
       9     },
      10     update: {
     … +43 lines (ctrl+o to expand)

● Write(lib\memory\stores\decisions.ts)   
  ⎿  Wrote 52 lines to lib\memory\stores\decisions.ts
       1 import { prisma } from '@/lib/prisma'        
       2 import { DecisionData, DecisionRow } from '../types'
       3                             
       4 export async function storeDecision(data: DecisionData): Promise<DecisionRow> {
       5   return (prisma as any).memoryDecision.create({
       6     data: {                                                                                                                                   7       instanceId: data.instanceId,
       8       senderId: data.senderId,                                                                                                         
       9       context: data.context,   
      10       decision: data.decision,
     … +42 lines (ctrl+o to expand)

● Write(lib\memory\stores\episodes.ts)   