// EmployeeImportDialog — CSV file picker → preview/validate → transactional import.

import { useState, useRef } from 'react'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import { Table } from '@/shared/components/Table'
import type { Column } from '@/shared/components/Table'
import type { CsvEmployeeRow, CsvImportResult } from '@/shared/types/inputs'

interface ParsedRow {
  employee_code: string
  name: string
  ic_number: string
  phone: string
  email: string
  department_name: string
  position: string
  date_joined: string
}

const previewColumns: Column<ParsedRow>[] = [
  { key: 'employee_code', header: 'Code', accessor: (r) => r.employee_code, sortable: true, sortValue: (r) => r.employee_code, width: '80px' },
  { key: 'name', header: 'Name', accessor: (r) => r.name, sortable: true, sortValue: (r) => r.name },
  { key: 'ic_number', header: 'IC', accessor: (r) => r.ic_number, sortable: true, sortValue: (r) => r.ic_number, width: '120px' },
  { key: 'department_name', header: 'Dept', accessor: (r) => r.department_name || '—', sortable: true, sortValue: (r) => r.department_name || '' },
  { key: 'date_joined', header: 'Joined', accessor: (r) => r.date_joined, sortable: true, sortValue: (r) => r.date_joined, width: '100px' },
]

interface EmployeeImportDialogProps {
  isOpen: boolean
  onClose: () => void
  onImport: (rows: CsvEmployeeRow[]) => Promise<CsvImportResult>
}

export function EmployeeImportDialog({ isOpen, onClose, onImport }: EmployeeImportDialogProps) {
  const [previewRows, setPreviewRows] = useState<ParsedRow[]>([])
  const [csvRows, setCsvRows] = useState<CsvEmployeeRow[]>([])
  const [result, setResult] = useState<CsvImportResult | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setParseError(null)
    setResult(null)

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
        if (lines.length < 2) {
          setParseError('CSV file must have a header row and at least one data row')
          return
        }

        // Parse header
        const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/ /g, '_'))

        const requiredHeaders = ['employee_code', 'name', 'ic_number', 'date_joined']
        const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h))
        if (missingHeaders.length > 0) {
          setParseError(`Missing required columns: ${missingHeaders.join(', ')}. Expected: ${requiredHeaders.join(', ')}`)
          return
        }

        // Parse data rows
        const parsed: ParsedRow[] = []
        const raw: CsvEmployeeRow[] = []

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''))
          const row: Record<string, string> = {}
          headers.forEach((h, idx) => {
            row[h] = values[idx] ?? ''
          })

          parsed.push({
            employee_code: row['employee_code'] || '',
            name: row['name'] || '',
            ic_number: row['ic_number'] || '',
            phone: row['phone'] || '',
            email: row['email'] || '',
            department_name: row['department_name'] || '',
            position: row['position'] || '',
            date_joined: row['date_joined'] || '',
          })

          raw.push({
            employee_code: row['employee_code'] || '',
            name: row['name'] || '',
            ic_number: row['ic_number'] || '',
            phone: row['phone'] || '',
            email: row['email'] || '',
            department_name: row['department_name'] || '',
            position: row['position'] || '',
            date_joined: row['date_joined'] || '',
          })
        }

        setPreviewRows(parsed)
        setCsvRows(raw)
      } catch {
        setParseError('Failed to parse CSV file. Ensure it is a valid comma-separated file.')
      }
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    if (csvRows.length === 0) return
    setIsImporting(true)
    try {
      const res = await onImport(csvRows)
      setResult(res)
    } finally {
      setIsImporting(false)
    }
  }

  function handleReset() {
    setPreviewRows([])
    setCsvRows([])
    setResult(null)
    setParseError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleClose() {
    handleReset()
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Import Employees from CSV"
      size="lg"
      footer={
        <div className="flex w-full justify-between">
          <div>
            {result && (
              <p className="text-sm text-neutral-600">
                Imported <span className="font-semibold text-success-700">{result.imported}</span> employees
                {result.errors.length > 0 && (
                  <span className="text-error-700"> ({result.errors.length} errors)</span>
                )}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleClose}>
              {result ? 'Done' : 'Cancel'}
            </Button>
            {previewRows.length > 0 && !result && (
              <>
                <Button variant="secondary" onClick={handleReset}>
                  Reset
                </Button>
                <Button isLoading={isImporting} onClick={handleImport}>
                  Import {previewRows.length} Rows
                </Button>
              </>
            )}
          </div>
        </div>
      }
    >
      {!previewRows.length && !parseError && (
        <div className="flex flex-col items-center gap-4 py-8">
          <p className="text-sm text-neutral-600">
            Select a CSV file with columns: <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">employee_code, name, ic_number, date_joined</code>
          </p>
          <p className="text-xs text-neutral-500">
            Optional columns: phone, email, department_name, position
          </p>
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
            Choose CSV File
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      )}

      {parseError && (
        <div className="flex flex-col gap-4 py-4">
          <p className="rounded-sm bg-error-50 px-3 py-2 text-sm text-error-700">{parseError}</p>
          <Button variant="secondary" onClick={handleReset}>
            Try Another File
          </Button>
        </div>
      )}

      {previewRows.length > 0 && !result && (
        <div>
          <p className="mb-3 text-sm text-neutral-600">
            Preview: {previewRows.length} rows ready to import
          </p>
          <Table
            columns={previewColumns}
            data={previewRows}
            rowKey={(r) => r.employee_code}
          />
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-4">
          <div className="rounded-sm bg-success-50 px-4 py-3">
            <p className="text-sm font-medium text-success-700">
              Successfully imported {result.imported} employees
            </p>
          </div>
          {result.errors.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-error-700">Import Errors:</p>
              <div className="max-h-48 overflow-y-auto rounded-sm border border-error-200 bg-error-50">
                {result.errors.map((err, idx) => (
                  <p key={idx} className="border-b border-error-100 px-3 py-1.5 text-xs text-error-700 last:border-b-0">
                    Row {err.row}: {err.message}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
