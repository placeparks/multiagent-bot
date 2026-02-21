import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { storeDecision, getDecisions } from '@/lib/memory/stores/decisions'

async function verifyAccess(instanceId: string, req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (session?.user?.email) {
    const instance = await prisma.instance.findFirst({
      where: { id: instanceId, user: { email: session.user.email } },
    })
    if (instance) return true
  }
  const auth = req.headers.get('Authorization')
  if (auth?.startsWith('Bearer ')) {
    const key = auth.slice(7)
    const cfg = await (prisma as any).memoryConfig.findFirst({ where: { instanceId, memoryApiKey: key } })
    if (cfg) return true
  }
  return false
}

export async function GET(req: NextRequest, { params }: { params: { instanceId: string } }) {
  const { instanceId } = params
  if (!(await verifyAccess(instanceId, req)))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')
  const tagsParam = url.searchParams.get('tags')
  const tags = tagsParam ? tagsParam.split(',').map(t => t.trim()).filter(Boolean) : undefined
  const since = url.searchParams.get('since') ? new Date(url.searchParams.get('since')!) : undefined

  const decisions = await getDecisions(instanceId, { tags, since, limit, offset })
  return NextResponse.json({ decisions })
}

export async function POST(req: NextRequest, { params }: { params: { instanceId: string } }) {
  const { instanceId } = params
  if (!(await verifyAccess(instanceId, req)))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { context, decision, reasoning, alternativesConsidered, tags, senderId } = body

  if (!context || !decision || !Array.isArray(reasoning)) {
    return NextResponse.json(
      { error: 'context, decision, and reasoning[] are required' },
      { status: 400 }
    )
  }

  const row = await storeDecision({
    instanceId,
    senderId,
    context,
    decision,
    reasoning,
    alternativesConsidered,
    tags,
  })

  return NextResponse.json({ id: row.id })
}
