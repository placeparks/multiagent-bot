import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getActiveInstance } from '@/lib/get-active-instance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CHANNELS = new Set(['telegram'])

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const channel = (searchParams.get('channel') || 'telegram').toLowerCase()

    if (!CHANNELS.has(channel)) {
      return NextResponse.json({ error: 'Unsupported channel' }, { status: 400 })
    }

    const result = await getActiveInstance(session.user.email)
    if (!result?.instance) {
      return NextResponse.json({ error: 'No instance found' }, { status: 404 })
    }

    const { instance } = result

    if (!instance.containerId) {
      return NextResponse.json({ error: 'Instance has no Railway service ID' }, { status: 400 })
    }

    const pairingApiUrl = instance.serviceUrl
      ? `${instance.serviceUrl.replace('18789', '18800')}/pairing/list/${channel}`
      : null

    if (!pairingApiUrl) {
      return NextResponse.json({ error: 'Instance URL not configured' }, { status: 400 })
    }

    try {
      const response = await fetch(pairingApiUrl, { method: 'GET' })
      const result2 = await response.json()

      if (!response.ok) {
        throw new Error(result2.error || 'Failed to list pairing requests')
      }

      return NextResponse.json({
        success: true,
        channel,
        requests: result2.requests || [],
        raw: result2.raw,
      })
    } catch (error: any) {
      const cliCommand = `openclaw pairing list ${channel}`
      return NextResponse.json(
        { error: error.message || 'Failed to connect to OpenClaw instance', cliCommand, channel, requests: [] },
        { status: 500 }
      )
    }
  } catch (error: any) {
    console.error('Pairing list error:', error)
    return NextResponse.json({ error: error.message || 'Failed to list pairing requests' }, { status: 500 })
  }
}
