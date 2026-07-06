// SettingsPage — company profile configuration (Phase D1).
// Admins configure company name, SST, BRN, and bank account here.
// Used by payslips, invoices, and exports.

import { useState, useEffect } from 'react'
import { useIpcQuery } from '@/shared/hooks/useIpcQuery'
import { Input } from '@/shared/components/Input'
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

  const handleChange = (field: keyof UpdateCompanySettingsInput, value: string) => {
    setFormData((prev: UpdateCompanySettingsInput) => ({
      ...prev,
      [field]: value.trim() || undefined,
    }))
  }

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file size (max 2MB for logo)
    if (file.size > 2 * 1024 * 1024) {
      addToast('Logo must be smaller than 2MB', 'error')
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      const base64 = event.target?.result as string
      setFormData((prev) => ({
        ...prev,
        logo_base64: base64,
      }))
      setLogoPreview(base64)
      addToast('Logo uploaded', 'success')
    }
    reader.readAsDataURL(file)
  }

  async function handleSave() {
    try {
      setIsSaving(true)
      await window.api.settings.updateCompany(formData)
      addToast('Company settings saved', 'success')
    } catch (err) {
      addToast(`Failed to save settings: ${String(err)}`, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-neutral-500">Loading settings...</p>
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
              <div>
                <label className="block text-xs text-neutral-600 mb-2">Upload Logo (PNG or JPG, max 2MB)</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={handleLogoUpload}
                  className="block w-full text-sm text-neutral-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-md file:border-0
                    file:text-xs file:font-semibold
                    file:bg-primary-50 file:text-primary-700
                    hover:file:bg-primary-100"
                />
              </div>
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
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Company Name</label>
                <Input
                  type="text"
                  value={formData.company_name ?? ''}
                  onChange={(e) => handleChange('company_name', e.target.value)}
                  placeholder="e.g., PT Maju Jaya Sdn Bhd"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">Email</label>
                  <Input
                    type="email"
                    value={formData.email ?? ''}
                    onChange={(e) => handleChange('email', e.target.value)}
                    placeholder="e.g., info@company.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">Phone</label>
                  <Input
                    type="tel"
                    value={formData.phone ?? ''}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    placeholder="e.g., +60 3 1234 5678"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Address</label>
                <textarea
                  value={formData.address ?? ''}
                  onChange={(e) => handleChange('address', e.target.value)}
                  placeholder="Company address for invoices..."
                  rows={3}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Tax & Banking */}
          <div>
            <h3 className="text-sm font-medium text-neutral-900 mb-4">Tax & Banking</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">SST Number</label>
                  <Input
                    type="text"
                    value={formData.sst_number ?? ''}
                    onChange={(e) => handleChange('sst_number', e.target.value)}
                    placeholder="e.g., 001234567890"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">BRN Number</label>
                  <Input
                    type="text"
                    value={formData.brn_number ?? ''}
                    onChange={(e) => handleChange('brn_number', e.target.value)}
                    placeholder="e.g., 000123456789"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Bank Account Name</label>
                <Input
                  type="text"
                  value={formData.bank_account_name ?? ''}
                  onChange={(e) => handleChange('bank_account_name', e.target.value)}
                  placeholder="e.g., PT Maju Jaya Sdn Bhd"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Bank Account Number</label>
                <Input
                  type="text"
                  value={formData.bank_account_number ?? ''}
                  onChange={(e) => handleChange('bank_account_number', e.target.value)}
                  placeholder="e.g., 0123456789"
                />
              </div>
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
