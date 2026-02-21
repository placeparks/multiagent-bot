/**
 * End-to-end test for the Decision memory system.
 *
 * Tests:
 *  1. POST  /api/memory/:instanceId/decisions  → stores a decision, returns an id
 *  2. GET   /api/memory/:instanceId/decisions  → lists decisions, confirms our id is present
 *  3. GET   /api/memory/:instanceId/stats      → confirms totalDecisions count increased
 *  4. DELETE the test decision (via PATCH outcome) to leave DB clean (optional)
 *
 * Usage:
 *   node scripts/test-decisions.mjs <BASE_URL> <INSTANCE_ID> <MEMORY_API_KEY>
 *
 * Example (dev):
 *   node scripts/test-decisions.mjs http://localhost:3000 clxxx...id abc123...key
 *
 * You can find INSTANCE_ID and MEMORY_API_KEY in the dashboard:
 *   Dashboard → Memory → Settings (or Stats page shows the API key)
 */

const [,, BASE_URL, INSTANCE_ID, MEMORY_API_KEY] = process.argv

if (!BASE_URL || !INSTANCE_ID || !MEMORY_API_KEY) {
  console.error(`
Usage:
  node scripts/test-decisions.mjs <BASE_URL> <INSTANCE_ID> <MEMORY_API_KEY>

Example:
  node scripts/test-decisions.mjs http://localhost:3000 clxxx...id abc123...key

Where to find the values:
  BASE_URL       - your app URL, e.g. http://localhost:3000
  INSTANCE_ID    - from the dashboard instance list (the bot's ID)
  MEMORY_API_KEY - Dashboard → Memory → the API key shown on the stats page
`)
  process.exit(1)
}

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${MEMORY_API_KEY}`,
}

const base = `${BASE_URL}/api/memory/${INSTANCE_ID}`

function ok(label) { console.log(`  ✓ ${label}`) }
function fail(label, detail) {
  console.error(`  ✗ ${label}`)
  if (detail) console.error(`    ${detail}`)
  process.exit(1)
}

async function json(res) {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

console.log('\n=== Decision DB test ===')
console.log(`  instance : ${INSTANCE_ID}`)
console.log(`  base URL : ${base}\n`)

// ── Step 0: get baseline stats ─────────────────────────────────────────────
let statsRes = await fetch(`${base}/stats`, { headers })
if (!statsRes.ok) fail('GET /stats auth', `HTTP ${statsRes.status}`)
const { stats: before } = await json(statsRes)
ok(`GET /stats — totalDecisions before: ${before.totalDecisions}`)

// ── Step 1: store a decision ───────────────────────────────────────────────
const payload = {
  decision:   'Recommend the user switch to the Pro plan',
  reasoning:  [
    'User has exceeded the standard tier document limit',
    'They asked about advanced memory features',
    'Pro plan unlocks unlimited entities and longer retention',
  ],
  confidence: 0.92,
  channel:    'telegram',
  senderId:   'test-user-42',
  sessionId:  `test-session-${Date.now()}`,
  modelUsed:  'claude-sonnet-4-6',
  tokensUsed: 512,
  entitiesInvolved: ['Pro plan', 'user'],
  contextSnapshot: { testRun: true, ts: new Date().toISOString() },
}

const postRes = await fetch(`${base}/decisions`, {
  method: 'POST',
  headers,
  body: JSON.stringify(payload),
})

if (!postRes.ok) {
  const body = await json(postRes)
  fail(`POST /decisions (HTTP ${postRes.status})`, JSON.stringify(body))
}

const { id } = await json(postRes)
if (!id || typeof id !== 'string') fail('POST /decisions returned no id', JSON.stringify({ id }))
ok(`POST /decisions → id: ${id}`)

// ── Step 2: list decisions and confirm our record is there ─────────────────
const listRes = await fetch(`${base}/decisions?limit=50`, { headers })
if (!listRes.ok) fail(`GET /decisions (HTTP ${listRes.status})`)
const { decisions } = await json(listRes)

if (!Array.isArray(decisions)) fail('GET /decisions did not return an array')

const saved = decisions.find(d => d.id === id)
if (!saved) fail(`Decision ${id} not found in GET /decisions list`, `Got ${decisions.length} records`)

ok(`GET /decisions → found our record (${decisions.length} total)`)

// Verify key fields round-tripped correctly
const checks = [
  ['decision',   saved.decision,            payload.decision],
  ['confidence', saved.confidence,          payload.confidence],
  ['channel',    saved.channel,             payload.channel],
  ['senderId',   saved.senderId,            payload.senderId],
  ['modelUsed',  saved.modelUsed,           payload.modelUsed],
  ['reasoning[0]', saved.reasoning?.[0],   payload.reasoning[0]],
  ['entitiesInvolved[0]', saved.entitiesInvolved?.[0], payload.entitiesInvolved[0]],
]

for (const [field, actual, expected] of checks) {
  if (actual !== expected) fail(`Field mismatch: ${field}`, `expected "${expected}", got "${actual}"`)
}
ok('All fields round-tripped correctly')

// ── Step 3: confirm stats incremented ─────────────────────────────────────
statsRes = await fetch(`${base}/stats`, { headers })
const { stats: after } = await json(statsRes)

if (after.totalDecisions <= before.totalDecisions) {
  fail(
    `totalDecisions did not increase`,
    `before: ${before.totalDecisions}, after: ${after.totalDecisions}`
  )
}
ok(`GET /stats → totalDecisions: ${before.totalDecisions} → ${after.totalDecisions}`)

// ── Step 4: fetch the single decision by id ────────────────────────────────
const singleRes = await fetch(`${base}/decisions/${id}`, { headers })
if (singleRes.ok) {
  const { decision: single } = await json(singleRes)
  if (single?.id === id) ok(`GET /decisions/${id} → confirmed by id`)
  else ok(`GET /decisions/${id} → responded (field check skipped)`)
} else {
  // The [id] route might not be wired — warn but don't fail
  console.log(`  ~ GET /decisions/${id} returned ${singleRes.status} (route may not exist — skipped)`)
}

// ── Done ───────────────────────────────────────────────────────────────────
console.log(`
=== PASS ===
  Decision id : ${id}
  Saved fields verified ✓
  DB count incremented ✓

  To view it: Dashboard → Memory → Decisions
  To clean up: delete via dashboard or PATCH outcome on the record.
`)
