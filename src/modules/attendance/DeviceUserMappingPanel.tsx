// DeviceUserMappingPanel — H4 UI for docs/DEVICE_SYNC_AUDIT.md.
// Lists users enrolled on the ZKTeco device (fetched live) and lets the admin
// pick which EZOffice employee each one maps to, via the existing
// employees.update(device_user_id) path — same field EmployeeForm's manual
// number input already writes to, just with a friendlier picker here since
// the device's own user IDs are otherwise invisible to the admin.

import { useMemo, useState } from 'react'
import { Table } from '@/shared/components/Table'
import { Button } from '@/shared/components/Button'
import { Select } from '@/shared/components/Input'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { useToast } from '@/shared/components/Toast'
import type { Column } from '@/shared/components/Table'
import type { DeviceUser, Employee } from '@/shared/types/entities'

interface MappingRow extends DeviceUser {
  mappedEmployeeId: number | null
}

export function DeviceUserMappingPanel() {
  const { addToast } = useToast()
  const [pendingSaveId, setPendingSaveId] = useState<number | null>(null)

  const { data: deviceUsers = [], isLoading: isLoadingDeviceUsers, error: deviceUsersError, refetch } = useIpcQuery<DeviceUser[]>(
    ['attendance', 'deviceUsers'],
    () => window.api.attendance.getDeviceUsers(),
  )

  const { data: employees = [] } = useIpcQuery<Employee[]>(
    ['employees'],
    () => window.api.employees.list(),
  )

  // employees.update's declared type (UpdateEmployeeInput) doesn't include
  // device_user_id — the same as EmployeeForm.tsx's cast for shift_id/device_user_id,
  // since the IPC handler's Zod schema (updateEmployeeWithShiftSchema) does accept it.
  const updateEmployeeMutation = useIpcMutation<Employee, { id: number; device_user_id: number | null }>(
    ({ id, device_user_id }) => window.api.employees.update(id, { device_user_id } as never),
    [['employees']],
  )

  const employeeOptions = useMemo(
    () => [
      { value: '', label: 'Not mapped' },
      ...employees.map((e) => ({ value: String(e.id), label: `${e.name} (${e.employee_code})` })),
    ],
    [employees],
  )

  const rows: MappingRow[] = useMemo(
    () =>
      deviceUsers.map((du) => {
        const mapped = employees.find((e) => e.device_user_id === du.deviceUserId)
        return { ...du, mappedEmployeeId: mapped?.id ?? null }
      }),
    [deviceUsers, employees],
  )

  const handleMap = async (deviceUserId: number, employeeIdStr: string) => {
    const newEmployeeId = employeeIdStr ? Number(employeeIdStr) : null

    // If this device user was already mapped to a different employee, clear
    // that employee's device_user_id first — device_user_id is unique, the
    // service layer rejects assigning it to two employees at once.
    const previouslyMapped = employees.find((e) => e.device_user_id === deviceUserId)

    try {
      setPendingSaveId(deviceUserId)
      if (previouslyMapped && previouslyMapped.id !== newEmployeeId) {
        await updateEmployeeMutation.mutateAsync({ id: previouslyMapped.id, device_user_id: null })
      }
      if (newEmployeeId !== null) {
        await updateEmployeeMutation.mutateAsync({ id: newEmployeeId, device_user_id: deviceUserId })
      }
      addToast('Mapping saved', 'success')
    } catch (err) {
      addToast(`Failed to save mapping: ${String(err)}`, 'error')
    } finally {
      setPendingSaveId(null)
    }
  }

  const columns: Column<MappingRow>[] = [
    {
      key: 'deviceUserId',
      header: 'Device User ID',
      accessor: (r) => r.deviceUserId,
      width: '130px',
    },
    {
      key: 'name',
      header: 'Name on Device',
      accessor: (r) => r.name,
    },
    {
      key: 'mappedEmployeeId',
      header: 'Mapped Employee',
      width: '260px',
      accessor: (r) => (
        <Select
          value={r.mappedEmployeeId !== null ? String(r.mappedEmployeeId) : ''}
          onChange={(e) => handleMap(r.deviceUserId, e.target.value)}
          options={employeeOptions}
          disabled={pendingSaveId === r.deviceUserId}
        />
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      width: '110px',
      accessor: (r) =>
        r.mappedEmployeeId !== null ? (
          <StatusBadge tone="success">Mapped</StatusBadge>
        ) : (
          <StatusBadge tone="warning">Unmapped</StatusBadge>
        ),
    },
  ]

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-neutral-900">Device User Mapping</h3>
          <p className="mt-1 text-sm text-neutral-600">
            Match each fingerprint-enrolled device user to an EZOffice employee. Unmapped
            users' punches are skipped during sync.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => refetch()} isLoading={isLoadingDeviceUsers}>
          Refresh
        </Button>
      </div>

      {deviceUsersError && (
        <div className="rounded-sm border border-error-200 bg-error-50 p-3 text-sm text-error-700">
          Failed to load device users: {String(deviceUsersError)}
        </div>
      )}

      <Table
        columns={columns}
        data={rows}
        rowKey={(r) => String(r.deviceUserId)}
        isLoading={isLoadingDeviceUsers}
        emptyState={{
          title: 'No device users found',
          description: 'Enroll fingerprints on the device first, then click Refresh.',
        }}
      />
    </div>
  )
}
