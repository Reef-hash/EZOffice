// RateTablesPage — admin view/edit for EPF/SOCSO/EIS/PCB statutory rate tables.
// Per CLAUDE.md §7 (2026-06-26): seeded with placeholder rows only — the project owner must
// enter authoritative figures from the official KWSP/PERKESO/LHDN publications here before
// running real payroll.

import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { RateBracketSection } from './RateBracketSection'
import type { RateBracketDraft } from './RateBracketSection'
import { PcbBracketSection } from './PcbBracketSection'
import type { EpfRate, SocsoRate, EisRate, PcbBracket } from '@/shared/types/entities'
import type { CreateEpfRateInput, CreateSocsoRateInput, CreateEisRateInput, CreatePcbBracketInput } from '@/shared/types/inputs'

export function RateTablesPage() {
  // ── EPF ──
  const { data: epfRates = [], isLoading: epfLoading } = useIpcQuery<EpfRate[]>(
    ['payroll', 'epfRates'],
    () => window.api.payroll.epfRates.list(),
  )
  const createEpf = useIpcMutation<EpfRate, CreateEpfRateInput>(
    (data) => window.api.payroll.epfRates.create(data),
    [['payroll', 'epfRates']],
    { onSuccessMessage: 'EPF rate created successfully' },
  )
  const deleteEpf = useIpcMutation<void, number>(
    (id) => window.api.payroll.epfRates.delete(id),
    [['payroll', 'epfRates']],
    { onSuccessMessage: 'EPF rate deleted successfully' },
  )

  // ── SOCSO ──
  const { data: socsoRates = [], isLoading: socsoLoading } = useIpcQuery<SocsoRate[]>(
    ['payroll', 'socsoRates'],
    () => window.api.payroll.socsoRates.list(),
  )
  const createSocso = useIpcMutation<SocsoRate, CreateSocsoRateInput>(
    (data) => window.api.payroll.socsoRates.create(data),
    [['payroll', 'socsoRates']],
    { onSuccessMessage: 'SOCSO rate created successfully' },
  )
  const deleteSocso = useIpcMutation<void, number>(
    (id) => window.api.payroll.socsoRates.delete(id),
    [['payroll', 'socsoRates']],
    { onSuccessMessage: 'SOCSO rate deleted successfully' },
  )

  // ── EIS ──
  const { data: eisRates = [], isLoading: eisLoading } = useIpcQuery<EisRate[]>(
    ['payroll', 'eisRates'],
    () => window.api.payroll.eisRates.list(),
  )
  const createEis = useIpcMutation<EisRate, CreateEisRateInput>(
    (data) => window.api.payroll.eisRates.create(data),
    [['payroll', 'eisRates']],
    { onSuccessMessage: 'EIS rate created successfully' },
  )
  const deleteEis = useIpcMutation<void, number>(
    (id) => window.api.payroll.eisRates.delete(id),
    [['payroll', 'eisRates']],
    { onSuccessMessage: 'EIS rate deleted successfully' },
  )

  // ── PCB ──
  const { data: pcbBrackets = [], isLoading: pcbLoading } = useIpcQuery<PcbBracket[]>(
    ['payroll', 'pcbBrackets'],
    () => window.api.payroll.pcbBrackets.list(),
  )
  const createPcb = useIpcMutation<PcbBracket, CreatePcbBracketInput>(
    (data) => window.api.payroll.pcbBrackets.create(data),
    [['payroll', 'pcbBrackets']],
    { onSuccessMessage: 'PCB bracket created successfully' },
  )
  const deletePcb = useIpcMutation<void, number>(
    (id) => window.api.payroll.pcbBrackets.delete(id),
    [['payroll', 'pcbBrackets']],
    { onSuccessMessage: 'PCB bracket deleted successfully' },
  )

  async function handleCreateEpf(draft: RateBracketDraft) {
    await createEpf.mutateAsync({
      effective_from: draft.effective_from,
      employee_category: draft.employee_category,
      wage_from: draft.wage_from,
      wage_to: draft.wage_to,
      employee_contribution_pct: draft.contribution_employee,
      employer_contribution_pct: draft.contribution_employer,
    })
  }

  async function handleCreateSocso(draft: RateBracketDraft) {
    await createSocso.mutateAsync({
      effective_from: draft.effective_from,
      employee_category: draft.employee_category,
      wage_from: draft.wage_from,
      wage_to: draft.wage_to,
      employee_contribution: draft.contribution_employee,
      employer_contribution: draft.contribution_employer,
    })
  }

  async function handleCreateEis(draft: RateBracketDraft) {
    await createEis.mutateAsync({
      effective_from: draft.effective_from,
      employee_category: draft.employee_category,
      wage_from: draft.wage_from,
      wage_to: draft.wage_to,
      employee_contribution: draft.contribution_employee,
      employer_contribution: draft.contribution_employer,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3 rounded-xl bg-warning-50 p-4 text-sm">
        <span className="text-base">⚠️</span>
        <p className="text-warning-700">
          These tables ship with placeholder data only. Enter the authoritative figures from the
          official KWSP (EPF Third Schedule), PERKESO (SOCSO/EIS Contribution Table), and LHDN
          (PCB Schedule) publications before running real payroll.
        </p>
      </div>

      <RateBracketSection
        title="EPF (Employees Provident Fund)"
        description="Bracket by monthly wage — contribution as a percentage of wage."
        rows={epfRates.map((r) => ({
          id: r.id,
          effective_from: r.effective_from,
          employee_category: r.employee_category,
          wage_from: r.wage_from,
          wage_to: r.wage_to,
          contribution_employee: r.employee_contribution_pct,
          contribution_employer: r.employer_contribution_pct,
        }))}
        isLoading={epfLoading}
        employeeFieldLabel="Employee %"
        employerFieldLabel="Employer %"
        onCreate={handleCreateEpf}
        onDelete={(id) => deleteEpf.mutateAsync(id)}
        isCreating={createEpf.isPending}
      />

      <RateBracketSection
        title="SOCSO"
        description="Bracket by monthly wage — fixed contribution amounts."
        rows={socsoRates.map((r) => ({
          id: r.id,
          effective_from: r.effective_from,
          employee_category: r.employee_category,
          wage_from: r.wage_from,
          wage_to: r.wage_to,
          contribution_employee: r.employee_contribution,
          contribution_employer: r.employer_contribution,
        }))}
        isLoading={socsoLoading}
        employeeFieldLabel="Employee (RM)"
        employerFieldLabel="Employer (RM)"
        onCreate={handleCreateSocso}
        onDelete={(id) => deleteSocso.mutateAsync(id)}
        isCreating={createSocso.isPending}
      />

      <RateBracketSection
        title="EIS (Employment Insurance Scheme)"
        description="Bracket by monthly wage — fixed contribution amounts."
        rows={eisRates.map((r) => ({
          id: r.id,
          effective_from: r.effective_from,
          employee_category: r.employee_category,
          wage_from: r.wage_from,
          wage_to: r.wage_to,
          contribution_employee: r.employee_contribution,
          contribution_employer: r.employer_contribution,
        }))}
        isLoading={eisLoading}
        employeeFieldLabel="Employee (RM)"
        employerFieldLabel="Employer (RM)"
        onCreate={handleCreateEis}
        onDelete={(id) => deleteEis.mutateAsync(id)}
        isCreating={createEis.isPending}
      />

      <PcbBracketSection
        rows={pcbBrackets}
        isLoading={pcbLoading}
        onCreate={async (draft) => { await createPcb.mutateAsync(draft) }}
        onDelete={(id) => deletePcb.mutateAsync(id)}
        isCreating={createPcb.isPending}
      />
    </div>
  )
}
