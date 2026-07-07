// LoginPage — admin login screen (shown before app shell).
// On first launch: signup form. On subsequent launches: login form.

import { useState, useEffect } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { useIpcMutation } from '@/shared/hooks/useIpcQuery'

interface LoginPageProps {
  onLoginSuccess: (adminId: number) => void
  isFirstLaunch: boolean
}

export function LoginPage({ onLoginSuccess, isFirstLaunch }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [showPassword, setShowPassword] = useState(false)

  const loginMutation = useIpcMutation<{ success: boolean; adminId?: number }, { username: string; password: string }>(
    ({ username: u, password: p }) => window.api.admin.login(u, p),
    [],
  )

  const signupMutation = useIpcMutation<
    { success: boolean; admin?: { id: number; username: string } },
    { username: string; password: string }
  >(
    ({ username: u, password: p }) => window.api.admin.init(u, p),
    [],
  )

  const validatePasswordMutation = useIpcMutation<
    { valid: boolean; errors: string[] },
    string
  >(
    (pwd) => window.api.admin.validatePassword(pwd),
    [],
  )

  // Validate password in real-time on signup screen
  useEffect(() => {
    if (isFirstLaunch && password) {
      validatePasswordMutation.mutateAsync(password).then((result) => {
        setPasswordErrors(result.errors)
      }).catch(() => {
        setPasswordErrors(['Failed to validate password'])
      })
    }
  }, [password, isFirstLaunch, validatePasswordMutation])

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    try {
      const result = await loginMutation.mutateAsync({ username, password })
      if (result.success && result.adminId) {
        onLoginSuccess(result.adminId)
      }
    } catch (err) {
      setError(String(err))
    }
  }

  const handleSignup = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (passwordErrors.length > 0) {
      setError('Please fix password requirements before signing up')
      return
    }

    try {
      const result = await signupMutation.mutateAsync({ username, password })
      if (result.success && result.admin?.id) {
        onLoginSuccess(result.admin.id)
      }
    } catch (err) {
      setError(String(err))
    }
  }

  const isLoading = isFirstLaunch ? signupMutation.isPending : loginMutation.isPending

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-surface p-8 shadow-sm">
        {/* Logo / Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-neutral-900">EZOffice</h1>
          <p className="mt-2 text-sm text-neutral-600">
            {isFirstLaunch ? 'Create Admin Account' : 'Admin Login'}
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 rounded-sm bg-error-50 p-3 text-sm text-error-700">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={isFirstLaunch ? handleSignup : handleLogin} className="space-y-4">
          {/* Username */}
          <div>
            <Input
              label="Username"
              type="text"
              value={username}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setUsername(e.target.value)
                setError(null)
              }}
              placeholder="Enter username"
              disabled={isLoading}
              required
            />
          </div>

          {/* Password */}
          <div>
            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setPassword(e.target.value)
                setError(null)
              }}
              placeholder="Enter password"
              disabled={isLoading}
              required
            />
          </div>

          {/* Password Strength (Signup only) */}
          {isFirstLaunch && password && (
            <div className={`rounded-sm p-3 text-sm ${passwordErrors.length === 0 ? 'bg-success-50 text-success-700' : 'bg-warning-50 text-warning-700'}`}>
              {passwordErrors.length === 0 ? (
                <p>✓ Password is strong</p>
              ) : (
                <ul className="list-inside list-disc space-y-1">
                  {passwordErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Confirm Password (Signup only) */}
          {isFirstLaunch && (
            <div>
              <Input
                label="Confirm Password"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setConfirmPassword(e.target.value)
                  setError(null)
                }}
                placeholder="Confirm password"
                disabled={isLoading}
                required
              />
            </div>
          )}

          {/* Show Password Toggle */}
          <label className="flex items-center gap-2 text-sm text-neutral-600">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-300"
            />
            Show password
          </label>

          {/* Submit Button */}
          <Button
            type="submit"
            variant="primary"
            disabled={isLoading}
            isLoading={isLoading}
            className="w-full"
          >
            {isFirstLaunch ? 'Create Account' : 'Login'}
          </Button>
        </form>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-neutral-500">
          {isFirstLaunch
            ? 'This is the first admin account for your installation'
            : 'Enter your admin credentials to access EZOffice'}
        </p>
      </div>
    </div>
  )
}
