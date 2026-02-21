'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Bot, Plus, Trash2, KeyRound } from 'lucide-react'

interface MultiAgentSettingsProps {
  config: any
  onConfigChange: () => void
}

interface SpecialistAgent {
  id: string
  name: string
  role: string
  channel: string
  accountId: string
  peerId: string
}

interface EnvVariable {
  name: string
  value: string
  description: string
}

export function MultiAgentSettings({ config, onConfigChange }: MultiAgentSettingsProps) {
  const [enabled, setEnabled] = useState(false)
  const [agents, setAgents] = useState<SpecialistAgent[]>([])
  const [variables, setVariables] = useState<EnvVariable[]>([])
  const [savingAgents, setSavingAgents] = useState(false)
  const [savingVars, setSavingVars] = useState(false)

  useEffect(() => {
    const cfg = config?.nativeMultiAgent
    setEnabled(!!cfg?.enabled)
    setAgents(
      (cfg?.agents ?? []).map((a: any) => ({
        id: a.id ?? '',
        name: a.name ?? '',
        role: a.role ?? '',
        channel: a.bindings?.[0]?.channel ?? '',
        accountId: a.bindings?.[0]?.accountId ?? '',
        peerId: a.bindings?.[0]?.peerId ?? '',
      }))
    )
    setVariables(
      (config?.variables ?? []).map((v: any) => ({
        name: v.name ?? '',
        value: '',
        description: v.description ?? '',
      }))
    )
  }, [config])

  const addAgent = () => {
    setAgents(prev => [...prev, { id: '', name: '', role: '', channel: '', accountId: '', peerId: '' }])
  }

  const removeAgent = (idx: number) => {
    setAgents(prev => prev.filter((_, i) => i !== idx))
  }

  const updateAgent = (idx: number, field: keyof SpecialistAgent, value: string) => {
    setAgents(prev => prev.map((a, i) => (i === idx ? { ...a, [field]: value } : a)))
  }

  const addVariable = () => {
    setVariables(prev => [...prev, { name: '', value: '', description: '' }])
  }

  const removeVariable = (idx: number) => {
    setVariables(prev => prev.filter((_, i) => i !== idx))
  }

  const updateVariable = (idx: number, field: keyof EnvVariable, value: string) => {
    setVariables(prev => prev.map((v, i) => (i === idx ? { ...v, [field]: value } : v)))
  }

  const saveMultiAgent = async () => {
    setSavingAgents(true)
    try {
      const body = {
        enabled,
        agents: agents
          .filter(a => a.id.trim() && a.name.trim())
          .map(a => ({
            id: a.id.trim(),
            name: a.name.trim(),
            role: a.role.trim() || undefined,
            bindings:
              a.channel.trim() || a.accountId.trim() || a.peerId.trim()
                ? [
                    {
                      channel: a.channel.trim() || undefined,
                      accountId: a.accountId.trim() || undefined,
                      peerId: a.peerId.trim() || undefined,
                    },
                  ]
                : [],
          })),
      }
      const res = await fetch('/api/instance/config/multi-agent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save')
      onConfigChange()
    } catch (err: any) {
      alert(err.message || 'Failed to save multi-agent settings')
    } finally {
      setSavingAgents(false)
    }
  }

  const saveVariables = async () => {
    setSavingVars(true)
    try {
      const body = {
        variables: variables
          .filter(v => v.name.trim() && v.value.trim())
          .map(v => ({
            name: v.name.trim(),
            value: v.value.trim(),
            description: v.description.trim() || undefined,
          })),
      }
      const res = await fetch('/api/instance/config/variables', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save')
      onConfigChange()
      setVariables(prev => prev.map(v => ({ ...v, value: '' })))
    } catch (err: any) {
      alert(err.message || 'Failed to save variables')
    } finally {
      setSavingVars(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border border-red-500/15 bg-white/[0.02] text-white overflow-hidden">
        <CardContent className="py-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg border border-red-500/30 bg-red-500/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-red-400" />
              </div>
              <div>
                <p className="text-sm font-medium">Native Multi-Agent (OpenClaw)</p>
                <p className="text-[10px] text-white/30 font-mono">One instance, multiple internal specialist agents</p>
              </div>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="space-y-3">
            {agents.map((agent, idx) => (
              <div key={idx} className="rounded-lg border border-white/10 p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input value={agent.id} onChange={e => updateAgent(idx, 'id', e.target.value)} placeholder="agent id (e.g. dev)" className="h-8 text-xs" />
                  <Input value={agent.name} onChange={e => updateAgent(idx, 'name', e.target.value)} placeholder="display name" className="h-8 text-xs" />
                  <Input value={agent.role} onChange={e => updateAgent(idx, 'role', e.target.value)} placeholder="role (e.g. backend specialist)" className="h-8 text-xs sm:col-span-2" />
                  <Input value={agent.channel} onChange={e => updateAgent(idx, 'channel', e.target.value)} placeholder="binding channel (optional)" className="h-8 text-xs" />
                  <Input value={agent.accountId} onChange={e => updateAgent(idx, 'accountId', e.target.value)} placeholder="binding accountId (optional)" className="h-8 text-xs" />
                  <Input value={agent.peerId} onChange={e => updateAgent(idx, 'peerId', e.target.value)} placeholder="binding peerId (optional)" className="h-8 text-xs sm:col-span-2" />
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => removeAgent(idx)} className="h-7 text-xs text-red-400 hover:text-red-300">
                  <Trash2 className="h-3 w-3 mr-1" />
                  Remove Agent
                </Button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={addAgent} className="h-8 text-xs border-red-500/20 text-red-400">
              <Plus className="h-3 w-3 mr-1" />
              Add Specialist
            </Button>
            <Button type="button" size="sm" onClick={saveMultiAgent} disabled={savingAgents} className="h-8 text-xs bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30">
              {savingAgents ? 'Saving...' : 'Save Multi-Agent'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-red-500/15 bg-white/[0.02] text-white overflow-hidden">
        <CardContent className="py-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg border border-red-500/30 bg-red-500/10 flex items-center justify-center">
              <KeyRound className="h-4 w-4 text-red-400" />
            </div>
            <div>
              <p className="text-sm font-medium">Project Variables (Name/Value)</p>
              <p className="text-[10px] text-white/30 font-mono">Saved to memory knowledge base for retrieval</p>
            </div>
          </div>

          <div className="space-y-2">
            {variables.map((v, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
                <Input value={v.name} onChange={e => updateVariable(idx, 'name', e.target.value)} placeholder="VARIABLE_NAME" className="h-8 text-xs" />
                <Input value={v.value} onChange={e => updateVariable(idx, 'value', e.target.value)} placeholder="value (required to save)" className="h-8 text-xs" />
                <div className="flex gap-2">
                  <Input value={v.description} onChange={e => updateVariable(idx, 'description', e.target.value)} placeholder="description (optional)" className="h-8 text-xs" />
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeVariable(idx)} className="h-8 px-2 text-red-400 hover:text-red-300">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={addVariable} className="h-8 text-xs border-red-500/20 text-red-400">
              <Plus className="h-3 w-3 mr-1" />
              Add Variable
            </Button>
            <Button type="button" size="sm" onClick={saveVariables} disabled={savingVars} className="h-8 text-xs bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30">
              {savingVars ? 'Saving...' : 'Save Variables'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

