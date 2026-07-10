// ActivateLicensePage — one-time EZOffice license activation (docs/LICENSE_INTEGRATION_AUDIT.md).
// Shown before the existing Phase A admin login/signup screen when this
// machine has never been activated, or its cached decision has gone stale
// past the offline grace window. Requires internet for this one screen only —
// every subsequent launch works fully offline within the grace window.

import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { useIpcMutation } from '@/shared/hooks/useIpcQuery'

interface ActivateLicensePageProps {
  onActivated: () => void
  /** Shown when re-activation was triggered by an expired grace window, not first launch. */
  reasonMessage?: string | null
}

type Step = 'email' | 'code'

export function ActivateLicensePage({ onActivated, reasonMessage }: ActivateLicensePageProps) {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const sendOtpMutation = useIpcMutation<{ sent: boolean }, { email: string }>(
    (data) => window.api.license.sendOtp(data),
    [],
  )

  const verifyOtpMutation = useIpcMutation<
    { success: boolean; decision: string; clientAction: string; message?: string },
    { email: string; token: string }
  >(
    (data) => window.api.license.verifyOtp(data),
    [],
  )

  const handleSendCode = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    try {
      await sendOtpMutation.mutateAsync({ email })
      setInfo(`A 6-digit code was sent to ${email}. Enter it below.`)
      setStep('code')
    } catch (err) {
      setError(String(err))
    }
  }

  const handleVerify = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    try {
      const result = await verifyOtpMutation.mutateAsync({ email, token: code })
      if (result.success) {
        onActivated()
        return
      }
      setError(result.message ?? `Activation was denied (${result.clientAction}). Contact support if this is unexpected.`)
    } catch (err) {
      setError(String(err))
    }
  }

  const isLoading = step === 'email' ? sendOtpMutation.isPending : verifyOtpMutation.isPending

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-surface p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-neutral-900">EZOffice</h1>
          <p className="mt-2 text-sm text-neutral-600">Activate this installation</p>
        </div>

        {reasonMessage && (
          <div className="mb-4 rounded-sm bg-warning-50 p-3 text-sm text-warning-700">
            {reasonMessage}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-sm bg-error-50 p-3 text-sm text-error-700">
            {error}
          </div>
        )}

        {info && !error && (
          <div className="mb-4 rounded-sm bg-success-50 p-3 text-sm text-success-700">
            {info}
          </div>
        )}

        {step === 'email' ? (
          <form onSubmit={handleSendCode} className="space-y-4">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setEmail(e.target.value)
                setError(null)
              }}
              placeholder="the email used to purchase EZOffice"
              disabled={isLoading}
              required
            />
            <Button type="submit" variant="primary" disabled={isLoading} isLoading={isLoading} className="w-full">
              Send Activation Code
            </Button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <Input
              label="Activation Code"
              type="text"
              value={code}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setCode(e.target.value)
                setError(null)
              }}
              placeholder="6-digit code from your email"
              disabled={isLoading}
              required
            />
            <Button type="submit" variant="primary" disabled={isLoading} isLoading={isLoading} className="w-full">
              Activate
            </Button>
            <button
              type="button"
              onClick={() => { setStep('email'); setCode(''); setError(null); setInfo(null) }}
              className="w-full text-center text-xs text-neutral-500 hover:text-neutral-700"
            >
              Use a different email
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-neutral-500">
          You only need to do this once per installation — EZOffice works fully
          offline afterward.
        </p>
      </div>
    </div>
  )
}
