// SettingsPage — company profile configuration (Phase D1).
// Admins configure company name, SST, BRN, and bank account here.
// Used by payslips, invoices, and exports.

import { useState, useEffect } from 'react'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { Input, FileInput, Field } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Card } from '@/shared/components/Card'
import { useToast } from '@/shared/components/Toast'
import type { CompanySettings } from '@/shared/types/entities'
import type { UpdateCompanySettingsInput } from '@/shared/types/inputs'

export function SettingsPage() {
  const { addToast } = useToast()
  const [formData, setFormData] = useState<UpdateCompanySettingsInput>({})
  const [isSaving, setIsSaving] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  // Fetch current settings
  const { data: settings, isLoading } = useIpcQuery<CompanySettings>(
    ['settings', 'company'],
    () => window.api.settings.getCompany(),
  )

  const updateMutation = useIpcMutation<CompanySettings, UpdateCompanySettingsInput>(
    (data) => window.api.settings.updateCompany(data),
    [['settings', 'company']],
    { onSuccessMessage: 'Company settings saved' },
  )

  // Populate form when settings load
  useEffect(() => {
    if (settings) {
      setFormData({
        company_name: settings.company_name ?? '',
        sst_number: settings.sst_number ?? '',
        brn_number: settings.brn_number ?? '',
        bank_account_name: settings.bank_account_name ?? '',
        bank_account_number: settings.bank_account_number ?? '',
        email: settings.email ?? '',
        phone: settings.phone ?? '',
        address: settings.address ?? '',
        logo_base64: settings.logo_base64 ?? '',
      })
      if (settings.logo_base64) {
        setLogoPreview(settings.logo_base64)
      }
    }
  }, [settings])

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 2MB validation
    if (file.size > 2 * 1024 * 1024) {
      addToast('Logo must be smaller than 2MB', 'error')
      return
    }

    const reader = new FileReader()
    reader.onloadend = () => {
      const base64String = reader.result as string
      setFormData((prev) => ({ ...prev, logo_base64: base64String }))
      setLogoPreview(base64String)
      addToast('Logo uploaded', 'success')
    }
    reader.readAsDataURL(file)
  }

  const handleChange = (field: keyof UpdateCompanySettingsInput, value: string) => {
    setFormData((prev: UpdateCompanySettingsInput) => ({
      ...prev,
      [field]: value,
    }))
  }

  async function handleSave() {
    // Client-side quick email validation if entered
    if (formData.email && formData.email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(formData.email.trim())) {
        addToast('Failed to save: Invalid email address format', 'error')
        return
      }
    }

    setIsSaving(true)
    try {
      const trimmedData: UpdateCompanySettingsInput = {}
      for (const [key, val] of Object.entries(formData)) {
        if (typeof val === 'string') {
          trimmedData[key as keyof UpdateCompanySettingsInput] = key === 'logo_base64' ? val : val.trim()
        } else {
          trimmedData[key as keyof UpdateCompanySettingsInput] = val
        }
      }
      await updateMutation.mutateAsync(trimmedData)
    } catch (err) {
      const errMsg = String(err)
      if (errMsg.includes('[')) {
        try {
          const jsonStart = errMsg.indexOf('[')
          const jsonStr = errMsg.substring(jsonStart)
          const issues = JSON.parse(jsonStr)
          if (Array.isArray(issues) && issues.length > 0) {
            const formatted = issues.map((i: any) => i.message || i.code).join(', ')
            addToast(`Failed to save settings: ${formatted}`, 'error')
            return
          }
        } catch {
          // Fall back to general toast
        }
      }
      addToast(`Failed to save settings: ${errMsg}`, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6 p-6 max-w-2xl">
        <div className="h-8 w-48 bg-neutral-200 animate-pulse rounded-sm" />
        <Card>
          <div className="space-y-4">
            <div className="h-10 bg-neutral-200 animate-pulse rounded-md" />
            <div className="h-10 bg-neutral-200 animate-pulse rounded-md" />
            <div className="h-10 bg-neutral-200 animate-pulse rounded-md" />
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Company Settings</h1>
        <p className="text-sm text-neutral-600 mt-1">Configure company information for payslips and invoices</p>
      </div>

      <Card>
        <div className="space-y-6">
          {/* Logo Section */}
          <div className="border-b pb-6">
            <label className="block text-sm font-medium text-neutral-700 mb-3">Company Logo</label>
            <div className="grid grid-cols-2 gap-6">
              <FileInput
                label="Upload Logo (PNG or JPG, max 2MB)"
                accept="image/png,image/jpeg"
                onChange={handleLogoUpload}
              />
              {logoPreview && (
                <div className="flex items-center justify-center">
                  <img src={logoPreview} alt="Company Logo" className="max-h-24 max-w-24 object-contain" />
                </div>
              )}
            </div>
          </div>

          {/* Company Info */}
          <div>
            <h3 className="text-sm font-medium text-neutral-900 mb-4">Company Information</h3>
            <div className="space-y-4">
              <Input
                label="Company Name"
                type="text"
                value={formData.company_name ?? ''}
                onChange={(e) => handleChange('company_name', e.target.value)}
                placeholder="e.g., PT Maju Jaya Sdn Bhd"
              />

              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Email"
                  type="email"
                  value={formData.email ?? ''}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="e.g., info@company.com"
                />
                <Input
                  label="Phone"
                  type="tel"
                  value={formData.phone ?? ''}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  placeholder="e.g., +60 3 1234 5678"
                />
              </div>

              <Field id="company-address" label="Address">
                <textarea
                  id="company-address"
                  value={formData.address ?? ''}
                  onChange={(e) => handleChange('address', e.target.value)}
                  placeholder="Company address for invoices..."
                  rows={3}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-surface text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-primary-600 focus:ring-primary-600/40 transition-colors"
                />
              </Field>
            </div>
          </div>

          {/* Tax & Banking */}
          <div>
            <h3 className="text-sm font-medium text-neutral-900 mb-4">Tax & Banking</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="SST Number"
                  type="text"
                  value={formData.sst_number ?? ''}
                  onChange={(e) => handleChange('sst_number', e.target.value)}
                  placeholder="e.g., 001234567890"
                />

                <Input
                  label="BRN Number"
                  type="text"
                  value={formData.brn_number ?? ''}
                  onChange={(e) => handleChange('brn_number', e.target.value)}
                  placeholder="e.g., 000123456789"
                />
              </div>

              <Input
                label="Bank Account Name"
                type="text"
                value={formData.bank_account_name ?? ''}
                onChange={(e) => handleChange('bank_account_name', e.target.value)}
                placeholder="e.g., PT Maju Jaya Sdn Bhd"
              />

              <Input
                label="Bank Account Number"
                type="text"
                value={formData.bank_account_number ?? ''}
                onChange={(e) => handleChange('bank_account_number', e.target.value)}
                placeholder="e.g., 0123456789"
              />
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t">
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="bg-blue-50 border-blue-200">
        <p className="text-sm text-blue-900">
          💡 <strong>Tip:</strong> These settings are used on payslips, invoices, and exported files. Update them whenever your company information changes.
        </p>
      </Card>
    </div>
  )
}
