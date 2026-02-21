import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateEmbedding, embeddingToSql } from '@/lib/memory/embeddings'
import { ragSearchByText, ragSearchByVector } from '@/lib/memory/stores/documents'
import { getDecisions } from '@/lib/memory/stores/decisions'
import { getEpisodes } from '@/lib/memory/stores/episodes'
import { getProfile } from '@/lib/memory/stores/profiles'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function verifyAccess(instanceId: string, req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const instance = await prisma.instance.findFirst({
      where: { id: instanceId, user: { email: session.user.email } },
    })
    if (instance) return true
  }

  const key = req.nextUrl.searchParams.get('key')
  const auth = req.headers.get('Authorization')
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  const token = key || bearer
  if (token) {
    const cfg = await (prisma as any).memoryConfig.findFirst({
      where: { instanceId, memoryApiKey: token },
    })
    if (cfg) return true
  }

  return false
}

async function runSearch(instanceId: string, req: NextRequest, body?: any) {
  const q = (body?.query ?? req.nextUrl.searchParams.get('q') ?? '').trim()
  if (!q) return NextResponse.json({ error: 'query is required' }, { status: 400 })

  const topK = Math.min(Math.max(parseInt(String(body?.topK ?? req.nextUrl.searchParams.get('topK') ?? '5'), 10) || 5, 1), 20)
  const senderId = (body?.senderId ?? req.nextUrl.searchParams.get('senderId') ?? 'default').trim()

  const includeDocs = body?.includeDocs !== false
  const includeDecisions = body?.includeDecisions !== false
  const includeEpisodes = body?.includeEpisodes !== false
  const includeProfile = body?.includeProfile !== false

  let documents: any[] = []
  if (includeDocs) {
    const emb = await generateEmbedding(q)
    if (emb) {
      documents = await ragSearchByVector(instanceId, embeddingToSql(emb), topK)
    } else {
      documents = await ragSearchByText(instanceId, q, topK)
    }
  }

  const [decisions, episodes, profile] = await Promise.all([
    includeDecisions ? getDecisions(instanceId, { limit: topK }) : Promise.resolve([] as any[]),
    includeEpisodes ? getEpisodes(instanceId, { limit: topK, senderId: senderId !== 'default' ? senderId : undefined }) : Promise.resolve([] as any[]),
    includeProfile ? getProfile(instanceId, senderId) : Promise.resolve(null),
  ])

  return NextResponse.json({
    query: q,
    results: {
      profile,
      decisions,
      episodes,
      documents,
    },
  })
}

export async function GET(req: NextRequest, { params }: { params: { instanceId: string } }) {
  const { instanceId } = params
  if (!(await verifyAccess(instanceId, req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runSearch(instanceId, req)
}

export async function POST(req: NextRequest, { params }: { params: { instanceId: string } }) {
  const { instanceId } = params
  if (!(await verifyAccess(instanceId, req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  return runSearch(instanceId, req, body)
}
