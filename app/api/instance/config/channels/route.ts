import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { applyChannelUpdate, ChannelConfigUpdate } from '@/lib/deploy/config-updater'
import { getActiveInstance } from '@/lib/get-active-instance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_CHANNEL_TYPES: string[] = [
  'WHATSAPP', 'TELEGRAM', 'DISCORD', 'SLACK', 'SIGNAL',
  'GOOGLE_CHAT', 'IMESSAGE', 'MATRIX', 'MSTEAMS',
]

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await getActiveInstance(session.user.email)
    if (!result?.instance) {
      return NextResponse.json({ error: 'No instance found' }, { status: 404 })
    }

    const body: ChannelConfigUpdate = await req.json()

    if (body.add?.length) {
      for (const ch of body.add) {
        if (!VALID_CHANNEL_TYPES.includes(ch.type)) {
          return NextResponse.json({ error: `Invalid channel type: ${ch.type}` }, { status: 400 })
        }
      }
    }

    await applyChannelUpdate(result.instance.id, body)

    return NextResponse.json({
      success: true,
      message: 'Channel configuration updated. Instance is restarting...',
    })
  } catch (error: any) {
    console.error('Channel config update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
