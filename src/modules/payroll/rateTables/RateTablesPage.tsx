// RateTablesPage — admin view/edit for EPF/SOCSO/EIS/LINDUNG/PCB statutory rate tables.
// SOCSO, EIS and LINDUNG 24 Jam ship as built-in PERKESO tables (migration 0029); EPF and
// PCB still need the official KWSP/LHDN figures entered here before running real payroll.

import { useIpcQuery, useIpcMutation } from '@/shared/hooks/useIpcQuery'
import { RateBracketSection } from './RateBracketSection'
import type { RateBracketDraft } from './RateBracketSection'
import { PcbBracketSection } from './PcbBracketSection'
import type { EpfRate, SocsoRate, EisRate, LindungRate, PcbBracket } from '@/shared/types/entities'
import type {
  CreateEpfRateInput, CreateSocsoRateInput, CreateEisRateInput, CreateLindungRateInput, CreatePcbBracketInput,
} from '@/shared/types/inputs'

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

  // ── LINDUNG 24 Jam ──
  const { data: lindungRates = [], isLoading: lindungLoading } = useIpcQuery<LindungRate[]>(
    ['payroll', 'lindungRates'],
    () => window.api.payroll.lindungRates.list(),
  )
  const createLindung = useIpcMutation<LindungRate, CreateLindungRateInput>(
    (data) => window.api.payroll.lindungRates.create(data),
    [['payroll', 'lindungRates']],
    { onSuccessMessage: 'LINDUNG 24 Jam rate created successfully' },
  )
  const deleteLindung = useIpcMutation<void, number>(
    (id) => window.api.payroll.lindungRates.delete(id),
    [['payroll', 'lindungRates']],
    { onSuccessMessage: 'LINDUNG 24 Jam rate deleted successfully' },
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

  async function handleCreateLindung(draft: RateBracketDraft) {
    await createLindung.mutateAsync({
      effective_from: draft.effective_from,
      employee_category: draft.employee_category,
      wage_from: draft.wage_from,
      wage_to: draft.wage_to,
      employee_contribution: draft.contribution_employee,
      employer_contribution: 0,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3 rounded-xl bg-warning-50 p-4 text-sm">
        <span className="text-base">⚠️</span>
        <p className="text-warning-700">
          SOCSO, EIS and LINDUNG 24 Jam come built in from the PERKESO contribution tables
          (marked Built-in) — nothing to enter. EPF and PCB still need the authoritative figures
          from the official KWSP (EPF Third Schedule) and LHDN (PCB Schedule) publications before
          running real payroll. To use a different PERKESO figure, add your own row with a later
          Effective From date; it takes priority over the built-in row.
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
          source: r.source,
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
          source: r.source,
        }))}
        isLoading={eisLoading}
        employeeFieldLabel="Employee (RM)"
        employerFieldLabel="Employer (RM)"
        onCreate={handleCreateEis}
        onDelete={(id) => deleteEis.mutateAsync(id)}
        isCreating={createEis.isPending}
      />

      <RateBracketSection
        title="LINDUNG 24 Jam (Non-Employment Injury Scheme)"
        description="Employee-only contribution from 1 June 2026 (Fasa 1: 0.75%). Applied only to employees with both SOCSO and LINDUNG ticked on their salary structure."
        rows={lindungRates.map((r) => ({
          id: r.id,
          effective_from: r.effective_from,
          employee_category: r.employee_category,
          wage_from: r.wage_from,
          wage_to: r.wage_to,
          contribution_employee: r.employee_contribution,
          contribution_employer: r.employer_contribution,
          source: r.source,
        }))}
        isLoading={lindungLoading}
        employeeFieldLabel="Employee (RM)"
        onCreate={handleCreateLindung}
        onDelete={(id) => deleteLindung.mutateAsync(id)}
        isCreating={createLindung.isPending}
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
