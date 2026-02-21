import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/instance/select — set the active agent for the current user */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { instanceId } = await req.json()
  if (!instanceId) {
    return NextResponse.json({ error: 'instanceId required' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { instances: { select: { id: true } } },
  })

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Verify the instance belongs to this user
  const owns = user.instances.some(i => i.id === instanceId)
  if (!owns) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { activeInstanceId: instanceId },
  })

  return NextResponse.json({ success: true, activeInstanceId: instanceId })
}
