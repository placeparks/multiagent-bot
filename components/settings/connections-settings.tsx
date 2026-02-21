'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Bot, ArrowRight, Loader2, RefreshCw, Check } from 'lucide-react'

interface AgentEntry {
  id: string
  name: string
  status: string
  linked: boolean
  role: string
}

interface ConnectionsSettingsProps {
  onConfigChange: () => void
}

export function ConnectionsSettings({ onConfigChange }: ConnectionsSettingsProps) {
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [savingRole, setSavingRole] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Track local role edits keyed by agent id
  const [roleEdits, setRoleEdits] = useState<Record<string, string>>({})
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const fetchAgents = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/instance/config/connections')
      if (!res.ok) throw new Error((await res.json()).error)
      const data = await res.json()
      setAgents(data.otherAgents)
      // Seed role edits from server data
      const edits: Record<string, string> = {}
      data.otherAgents.forEach((a: AgentEntry) => { edits[a.id] = a.role })
      setRoleEdits(edits)
    } catch (err: any) {
      setError(err.message || 'Failed to load agents')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAgents()
    return () => {
      // Clear any pending debounce timers on unmount
      Object.values(debounceTimers.current).forEach(clearTimeout)
    }
  }, [])

  const toggle = async (agentId: string, currentlyLinked: boolean) => {
    setToggling(agentId)
    setError(null)
    try {
      const res = await fetch('/api/instance/config/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetInstanceId: agentId,
          action: currentlyLinked ? 'remove' : 'add',
          role: roleEdits[agentId] || undefined,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setAgents(prev =>
        prev.map(a => a.id === agentId ? { ...a, linked: !currentlyLinked } : a)
      )
      onConfigChange()
    } catch (err: any) {
      setError(err.message || 'Failed to update connection')
    } finally {
      setToggling(null)
    }
  }

  const saveRole = async (agentId: string, role: string) => {
    const agent = agents.find(a => a.id === agentId)
    if (!agent?.linked) return  // Only save role for linked agents
    setSavingRole(agentId)
    try {
      const res = await fetch('/api/instance/config/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetInstanceId: agentId,
          action: 'update_role',
          role: role || undefined,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setAgents(prev =>
        prev.map(a => a.id === agentId ? { ...a, role } : a)
      )
      onConfigChange()
    } catch (err: any) {
      setError(err.message || 'Failed to save role')
    } finally {
      setSavingRole(null)
    }
  }

  const handleRoleChange = (agentId: string, value: string) => {
    setRoleEdits(prev => ({ ...prev, [agentId]: value }))
    // Debounce auto-save by 1.2s
    if (debounceTimers.current[agentId]) clearTimeout(debounceTimers.current[agentId])
    debounceTimers.current[agentId] = setTimeout(() => {
      saveRole(agentId, value)
    }, 1200)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 rounded-full border-2 border-red-500/30 border-t-red-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="text-xs text-white/30 font-mono mt-1">
            Allow this agent to delegate tasks to other agents you own.
          </p>
        </div>
        <button
          onClick={fetchAgents}
          className="text-white/20 hover:text-white/50 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400 font-mono">
          {error}
        </div>
      )}

      {agents.length === 0 ? (
        <Card className="border border-white/5 bg-white/[0.02] text-white">
          <CardContent className="py-10 text-center">
            <Bot className="w-8 h-8 text-white/10 mx-auto mb-3" />
            <p className="text-sm text-white/30 font-mono">No other agents found</p>
            <p className="text-xs text-white/15 font-mono mt-1">
              Deploy a second agent to enable agent-to-agent connections.
            </p>
          </CardContent>
        </Card>
      ) : (
        agents.map(agent => (
          <Card key={agent.id} className="border border-red-500/15 bg-white/[0.02] text-white overflow-hidden">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-all duration-300 shrink-0 ${
                    agent.linked
                      ? 'border-red-500/30 bg-red-500/10'
                      : 'border-white/10 bg-white/[0.03]'
                  }`}>
                    {toggling === agent.id ? (
                      <Loader2 className="h-4 w-4 text-white/40 animate-spin" />
                    ) : (
                      <Bot className={`h-4 w-4 ${agent.linked ? 'text-red-400' : 'text-white/30'}`} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{agent.name}</p>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider ${
                        agent.status === 'RUNNING'
                          ? 'bg-green-500/10 text-green-400/70 border border-green-500/20'
                          : 'bg-white/5 text-white/20 border border-white/10'
                      }`}>
                        {agent.status.toLowerCase()}
                      </span>
                    </div>

                    {agent.linked && (
                      <div className="mt-1.5">
                        <p className="text-[10px] text-red-400/50 font-mono flex items-center gap-1 mb-1">
                          <ArrowRight className="w-2.5 h-2.5" />
                          Specialist role (used for auto-routing)
                        </p>
                        <div className="relative flex items-center gap-1.5">
                          <Input
                            value={roleEdits[agent.id] ?? ''}
                            onChange={e => handleRoleChange(agent.id, e.target.value)}
                            placeholder="e.g. Python/backend specialist, copywriter..."
                            className="h-7 text-xs bg-white/[0.03] border-white/10 text-white/70 placeholder:text-white/20 font-mono focus-visible:ring-red-500/30"
                          />
                          {savingRole === agent.id ? (
                            <Loader2 className="w-3 h-3 text-white/30 animate-spin shrink-0" />
                          ) : (roleEdits[agent.id] ?? '') === agent.role && agent.role ? (
                            <Check className="w-3 h-3 text-green-400/50 shrink-0" />
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <Switch
                  checked={agent.linked}
                  disabled={toggling === agent.id}
                  onCheckedChange={() => toggle(agent.id, agent.linked)}
                  className="ml-3 shrink-0"
                />
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <p className="text-[11px] text-white/15 font-mono text-center pt-1">
        Set a role so the coordinator auto-routes tasks without being told. Connections are one-directional.
      </p>
    </div>
  )
}
