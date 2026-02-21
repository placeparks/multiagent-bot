import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getProvider } from '@/lib/deploy'
import { getActiveInstance } from '@/lib/get-active-instance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await getActiveInstance(session.user.email)
    if (!result?.instance) {
      return NextResponse.json({ error: 'No instance found' }, { status: 404 })
    }

    await getProvider().restart(result.instance.id)

    return NextResponse.json({ success: true, message: 'Instance restarted successfully' })
  } catch (error: any) {
    console.error('Restart instance error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
