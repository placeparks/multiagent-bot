'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, ChevronDown, Plus, CheckCircle, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface AgentInfo {
  id: string
  name: string
  status: string
  agentName: string | null
  isActive: boolean
}

interface AgentListData {
  activeInstanceId: string | null
  instances: AgentInfo[]
  plan: string | null
  limit: number
  remaining: number
}

export default function AgentSwitcher() {
  const router = useRouter()
  const [data, setData] = useState<AgentListData | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [showNewDialog, setShowNewDialog] = useState(false)
  const [newAgentName, setNewAgentName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/instance/list')
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function switchAgent(instanceId: string) {
    if (switching) return
    setSwitching(true)
    setOpen(false)
    try {
      await fetch('/api/instance/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId }),
      })
      window.location.reload()
    } finally {
      setSwitching(false)
    }
  }

  async function createAgent() {
    if (creating) return
    setCreating(true)
    setCreateError('')
    try {
      const res = await fetch('/api/instance/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newAgentName.trim() || 'My Agent' }),
      })
      const json = await res.json()
      if (!res.ok) {
        setCreateError(json.error || 'Failed to create agent')
        return
      }
      setShowNewDialog(false)
      setNewAgentName('')
      window.location.href = '/dashboard/settings'
    } finally {
      setCreating(false)
    }
  }

  if (loading || !data) {
    return <div className="h-8 w-36 rounded bg-zinc-800/50 animate-pulse" />
  }

  const active = data.instances.find(i => i.isActive)
  const displayName = active?.agentName || active?.name || 'My Agent'
  const statusColor =
    active?.status === 'RUNNING' ? 'bg-green-500' :
    active?.status === 'DEPLOYING' ? 'bg-yellow-500' :
    active?.status === 'ERROR' ? 'bg-red-500' : 'bg-zinc-500'

  return (
    <>
      {/* Dropdown */}
      <div className="relative" ref={dropdownRef}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(o => !o)}
          className="border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-white gap-2 max-w-[200px]"
        >
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
          <Bot className="w-3.5 h-3.5 flex-shrink-0 text-red-400" />
          <span className="truncate text-sm">{displayName}</span>
          {switching
            ? <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" />
            : <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
          }
        </Button>

        {open && (
          <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-md border border-zinc-700 bg-zinc-900 shadow-xl py-1">
            <p className="px-3 py-1.5 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              Your Agents
            </p>
            <div className="border-t border-zinc-700 mb-1" />

            {data.instances.map(inst => {
              const label = inst.agentName || inst.name
              const color =
                inst.status === 'RUNNING' ? 'bg-green-500' :
                inst.status === 'DEPLOYING' ? 'bg-yellow-500' :
                inst.status === 'ERROR' ? 'bg-red-500' : 'bg-zinc-500'
              return (
                <button
                  key={inst.id}
                  onClick={() => !inst.isActive && switchAgent(inst.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-zinc-800 transition-colors ${inst.isActive ? 'text-white' : 'text-zinc-400'}`}
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
                  <span className="flex-1 truncate">{label}</span>
                  {inst.isActive && <CheckCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                </button>
              )
            })}

            {data.remaining > 0 && (
              <>
                <div className="border-t border-zinc-700 mt-1 mb-1" />
                <button
                  onClick={() => { setOpen(false); setShowNewDialog(true) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-zinc-800 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Agent</span>
                  <span className="ml-auto text-xs text-zinc-500">{data.remaining} left</span>
                </button>
              </>
            )}

            {data.remaining === 0 && data.limit > 0 && (
              <>
                <div className="border-t border-zinc-700 mt-1" />
                <p className="px-3 py-2 text-xs text-zinc-500">
                  Agent limit reached ({data.limit}/{data.limit})
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* New Agent modal */}
      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowNewDialog(false)}
          />
          {/* Panel */}
          <div className="relative z-10 w-full max-w-md mx-4 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-red-400" />
                <h2 className="text-white font-semibold text-lg">New Agent</h2>
              </div>
              <button
                onClick={() => setShowNewDialog(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-zinc-400 text-sm mb-5">
              Deploy a new AI agent. It copies your AI provider settings — configure
              channels and skills after creation.
            </p>

            <div className="space-y-2 mb-4">
              <Label htmlFor="agent-name" className="text-zinc-300">Agent Name</Label>
              <Input
                id="agent-name"
                placeholder="e.g. Support Bot"
                value={newAgentName}
                onChange={e => setNewAgentName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createAgent()}
                className="bg-zinc-800 border-zinc-600 text-white placeholder:text-zinc-500"
                autoFocus
              />
            </div>

            {createError && (
              <p className="text-sm text-red-400 mb-4">{createError}</p>
            )}

            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowNewDialog(false)}
                className="border-zinc-600 text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </Button>
              <Button
                onClick={createAgent}
                disabled={creating}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {creating ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Deploying...</>
                ) : (
                  'Deploy Agent'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
