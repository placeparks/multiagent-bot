'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Bot, X, ChevronRight, ChevronLeft, Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import ProviderConfig from '@/components/forms/provider-config'
import ChannelSelector from '@/components/forms/channel-selector'
import SkillsConfig from '@/components/forms/skills-config'

interface NewAgentWizardProps {
  open: boolean
  onClose: () => void
}

type Step = 1 | 2 | 3 | 4 | 5

const STEP_LABELS = ['Name', 'Provider', 'Channel', 'Skills', 'Deploy']

const defaultSkills = {
  webSearchEnabled: false,
  braveApiKey: '',
  browserEnabled: false,
  ttsEnabled: false,
  elevenlabsApiKey: '',
  canvasEnabled: false,
  cronEnabled: false,
  memoryEnabled: false,
}

export default function NewAgentWizard({ open, onClose }: NewAgentWizardProps) {
  const [step, setStep] = useState<Step>(1)
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('ANTHROPIC')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [channels, setChannels] = useState<any[]>([])
  const [skills, setSkills] = useState({ ...defaultSkills })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  // Reset state and pre-fill provider/model each time wizard opens
  useEffect(() => {
    if (!open) return
    setStep(1)
    setName('')
    setChannels([])
    setSkills({ ...defaultSkills })
    setError('')
    setCreating(false)

    fetch('/api/instance/config')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.config) {
          setProvider(data.config.provider || 'ANTHROPIC')
          setApiKey(data.config.apiKey || '')   // masked like "sk-a...1234"
          setModel(data.config.model || '')
        }
      })
      .catch(() => {})
  }, [open])

  function canNext(): boolean {
    if (step === 1) return name.trim().length > 0
    if (step === 2) return provider.length > 0 && apiKey.length > 0
    return true
  }

  function next() {
    if (!canNext()) return
    setStep(s => (Math.min(5, s + 1) as Step))
  }

  function back() {
    setStep(s => (Math.max(1, s - 1) as Step))
  }

  function handleProviderChange(updates: any) {
    // Clear apiKey when provider changes so user must enter a key for the new provider
    if (updates.provider !== undefined && updates.provider !== provider) {
      setProvider(updates.provider)
      setApiKey('')
    } else if (updates.apiKey !== undefined) {
      setApiKey(updates.apiKey)
    }
    if (updates.model !== undefined) setModel(updates.model)
  }

  async function deploy() {
    if (creating) return
    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/instance/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'My Agent',
          provider,
          apiKey,
          model,
          channels,
          ...skills,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Deployment failed')
        return
      }
      onClose()
      window.location.href = '/dashboard/settings'
    } catch (e: any) {
      setError(e.message || 'Deployment failed')
    } finally {
      setCreating(false)
    }
  }

  function renderStep() {
    switch (step) {
      case 1:
        return (
          <div className="space-y-4">
            <p className="text-zinc-400 text-sm">Give your new agent a name. You can change it later in settings.</p>
            <div className="space-y-2">
              <Label htmlFor="wizard-agent-name" className="text-zinc-300">Agent Name</Label>
              <Input
                id="wizard-agent-name"
                placeholder="e.g. Support Bot, Sales Bot"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && canNext() && next()}
                className="bg-zinc-800 border-zinc-600 text-white placeholder:text-zinc-500"
                autoFocus
              />
            </div>
          </div>
        )

      case 2:
        return (
          <div className="overflow-y-auto max-h-[50vh] pr-1">
            <p className="text-zinc-400 text-sm mb-4">
              Configure the AI provider. Pre-filled from your existing agent — update if needed.
              Changing the provider clears the API key.
            </p>
            <ProviderConfig
              config={{ provider, apiKey, model }}
              onChange={handleProviderChange}
            />
          </div>
        )

      case 3:
        return (
          <div className="overflow-y-auto max-h-[50vh] pr-1">
            <ChannelSelector channels={channels} onChange={setChannels} />
          </div>
        )

      case 4:
        return (
          <div className="overflow-y-auto max-h-[50vh] pr-1">
            <SkillsConfig
              config={skills}
              onChange={updates => setSkills(s => ({ ...s, ...updates }))}
            />
          </div>
        )

      case 5: {
        const enabledSkills = Object.entries(skills)
          .filter(([k, v]) => k.endsWith('Enabled') && v)
          .map(([k]) => k.replace('Enabled', ''))
        return (
          <div className="space-y-4">
            <p className="text-zinc-400 text-sm">Review your configuration and deploy your new agent.</p>
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-400">Name</span>
                <span className="text-white font-medium">{name || 'My Agent'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Provider</span>
                <span className="text-white font-medium">{provider}</span>
              </div>
              {model && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">Model</span>
                  <span className="text-white font-medium">{model}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-zinc-400">Channels</span>
                <span className="text-white font-medium">
                  {channels.length > 0
                    ? channels.map(c => c.type).join(', ')
                    : 'None (configure after deploy)'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Skills</span>
                <span className="text-white font-medium">
                  {enabledSkills.length > 0 ? enabledSkills.join(', ') : 'None'}
                </span>
              </div>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>
        )
      }
    }
  }

  if (!mounted || !open) return null

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 999999 }}
      className="flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-2xl rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-red-400" />
            <h2 className="text-white font-semibold text-lg">New Agent</h2>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 px-6 py-3 border-b border-zinc-800 overflow-x-auto">
          {STEP_LABELS.map((label, i) => {
            const n = (i + 1) as Step
            const isActive = step === n
            const isDone = step > n
            return (
              <div key={label} className="flex items-center gap-1 flex-shrink-0">
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-red-600 text-white'
                    : isDone
                      ? 'bg-zinc-700 text-green-400'
                      : 'bg-zinc-800 text-zinc-500'
                }`}>
                  {isDone
                    ? <Check className="w-3 h-3" />
                    : <span>{n}</span>
                  }
                  <span>{label}</span>
                </div>
                {i < STEP_LABELS.length - 1 && (
                  <ChevronRight className="w-3 h-3 text-zinc-600 flex-shrink-0" />
                )}
              </div>
            )
          })}
        </div>

        {/* Step content */}
        <div className="px-6 py-5 flex-1 min-h-[180px]">
          {renderStep()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-700">
          <Button
            variant="outline"
            onClick={step === 1 ? onClose : back}
            className="border-zinc-600 text-zinc-300 hover:bg-zinc-800"
          >
            {step === 1
              ? 'Cancel'
              : <><ChevronLeft className="w-4 h-4 mr-1" />Back</>
            }
          </Button>

          <div className="flex gap-2">
            {(step === 3 || step === 4) && (
              <Button
                variant="outline"
                onClick={next}
                className="border-zinc-600 text-zinc-400 hover:bg-zinc-800"
              >
                Skip
              </Button>
            )}
            {step < 5 && (
              <Button
                onClick={next}
                disabled={!canNext()}
                className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
              >
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
            {step === 5 && (
              <Button
                onClick={deploy}
                disabled={creating}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {creating
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Deploying...</>
                  : 'Deploy Agent'
                }
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
