# Commission Payroll Plan

Status: Implemented (2026-08-26) — see CLAUDE.md Decision Log for the final
implementation summary. Open items before this is fully production-verified:
launch/click-test the new UI, and confirm the PCB/recurring-base/pay-period
assumptions below with the client's accountant if not already done.

## 1. Client Requirement

Some employees are paid from commission and follow a different payroll schedule
from employees who use attendance-based payroll.

Example:

```text
Trip total:                 RM12,690
Commission rate:            20%
Commission earnings:       RM2,538
Basic salary:               RM0
Gross pay:                  RM2,538
EPF/SOCSO/EIS base:         RM1,700
Pay date:                   1st of the month
```

The RM1,700 is **not** basic salary and must not be added to the RM2,538 gross
pay. It is the contribution base used for EPF, SOCSO, and EIS calculations.

The employee must not be included in the normal attendance payroll run paid on
the 26th.

## 2. Current Problem

The current payroll calculation assumes:

```text
salary structure + commission = gross pay
```

The current payroll run also gathers all active employees with an applicable
salary structure. It has no payroll group or pay schedule filter. Therefore a
commission-only employee can be included in the attendance payroll run by
mistake.

The current commission calculation also adds commission to the statutory wage
estimate and uses gross pay as the statutory calculation base. That does not
support the client's commission-only arrangement.

## 3. Target Payroll Model

### 3.1 Employee payroll configuration

Add explicit payroll configuration:

```text
Payroll type:
- Attendance salary
- Commission only

Pay schedule:
- 26th
- 1st
```

The client employee should be configured as:

```text
Payroll type:       Commission only
Pay schedule:       1st
Attendance needed:  No
```

The configuration should be stored in the database and enforced by the payroll
service. It must not be only a renderer-side filter.

### 3.2 Separate gross pay and statutory base

The calculation engine must keep these values separate:

```text
gross_pay:          RM2,538
statutory_base:     RM1,700
commission:         RM2,538
```

The calculation should behave as follows:

```text
EPF   = calculated from RM1,700
SOCSO = rate bracket looked up using RM1,700
EIS   = rate bracket looked up using RM1,700
Net   = RM2,538 minus employee deductions
```

The RM1,700 must never be added to gross pay.

PCB treatment is intentionally separate from EPF/SOCSO/EIS and must be
confirmed with the client's accountant before implementation. The system must
not silently assume that PCB follows the same base.

## 4. Payroll Runs and Pay Dates

The application must support more than one payroll run for the same payroll
month when the runs have different payroll groups.

Example for August:

```text
August 2026 - Attendance - Pay 26th
August 2026 - Commission - Pay 1st
```

The attendance run includes only attendance-based employees. The commission run
includes only commission-only employees.

The payroll run should contain at least:

```text
period year/month
payroll group
pay date
status
```

The current uniqueness rule of one run per `(year, month)` must be changed to
allow one run per payroll group, for example `(year, month, payroll_group)`.

The exact period convention must be confirmed. The expected client flow is that
a payment on 1 September uses the commission for the August payroll period.

## 5. HR Workflow

1. Configure the employee as `Commission only` with pay schedule `1st`.
2. Create the normal `Attendance - Pay 26th` payroll run.
3. Process attendance and calculate the 26th run. The commission-only employee
   must not appear in this run.
4. Create the `Commission - Pay 1st` payroll run for the relevant period.
5. Enter the commission earnings. For the example, enter RM2,538.
6. Enter or select the statutory contribution base. For the example, enter
   RM1,700.
7. Calculate the run.
8. Review the calculation summary:

   ```text
   Commission earnings:       RM2,538
   Gross pay:                  RM2,538
   EPF/SOCSO/EIS base:         RM1,700
   Pay date:                   1st
   ```

9. Correct commission or statutory base while the run is still a draft, then
   recalculate.
10. Finalize the run. The gross pay, statutory base, deductions, and pay date
    become historical snapshots.

## 6. Implementation Scope

### Database

- Add payroll type and pay schedule configuration.
- Add payroll group and pay date to payroll runs.
- Allow multiple runs for the same period when payroll groups differ.
- Store the statutory base used by each payroll run item.
- Preserve the selected commission treatment in the payroll snapshot.
- Use a migration; do not alter production tables manually.

### Shared Types and Validation

- Add types for payroll type, payroll group, and pay schedule.
- Add Zod validation for payroll run creation and commission input.
- Require statutory base to be non-negative when supplied.
- Keep public API contracts synchronized between IPC, preload, and renderer.

### Payroll Services

- Filter employees by payroll group in the service layer.
- Add commission-only calculation where commission is the gross earning.
- Pass `grossPay` and `statutoryBase` as separate calculation inputs.
- Use `statutoryBase` for EPF/SOCSO/EIS rate lookup and calculation.
- Keep commission and statutory base in finalized payroll snapshots.
- Prevent a finalized run from changing its commission or statutory base.

### Renderer

- Add payroll group and pay date fields to payroll run creation.
- Add a clear commission-only employee configuration screen or fields.
- Update Commission Panel with commission amount and statutory base.
- Show gross pay and statutory base as separate columns in the review table.
- Show the selected pay date and payroll group in the run header.
- Update payslip PDF and Excel export with the statutory base where appropriate.

## 7. Compatibility Rules

Existing attendance-based employees must continue working without manual
reconfiguration.

Existing commission entries should retain their current behavior until the new
treatment is explicitly selected or migrated. A safe default for existing
non-client commission arrangements is to include commission in the statutory
base, subject to payroll/accounting approval.

Commission-only employees must not be implemented by setting a fake RM1,700
salary structure. That would incorrectly produce a gross pay of RM4,238.

## 8. Tests Required

At minimum, add tests covering:

- RM12,690 × 20% produces RM2,538 commission.
- Commission-only gross pay is RM2,538, not RM4,238.
- Statutory base is RM1,700.
- EPF uses RM1,700 rather than RM2,538.
- SOCSO and EIS brackets use RM1,700.
- Commission-only employee is excluded from the 26th attendance run.
- Commission-only employee is included in the 1st commission run.
- Two payroll runs can exist for the same month with different groups.
- Recalculation while draft remains correct and idempotent.
- Finalized payroll preserves the original gross pay and statutory base.
- Existing attendance payroll behavior remains unchanged.

## 9. Decisions Required Before Coding

- Confirm whether payment on the 1st uses the previous month's commission
  period.
- Confirm whether RM1,700 is entered every month or stored as a recurring
  statutory-base value for the employee.
- Confirm whether PCB includes the commission or uses a separate base.
- Confirm the official EPF/SOCSO/EIS treatment with the client's accountant.
- Confirm whether supervisors may submit commission data or HR remains the
  only person allowed to enter it.
