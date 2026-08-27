// Shared test fixture for EmployeeMonthlySummary.
//
// The summary shape grows as payroll learns about new kinds of hours (rest-day and
// public-holiday premium hours were added 2026-08-27). Building it through this helper
// keeps every test focused on the fields it actually exercises, instead of each one
// repeating a full literal that has to be edited whenever a field is added.
//
// Not a *.test.ts file, so vitest's `electron/**/*.test.ts` include never collects it.

import type { EmployeeMonthlySummary } from '../../../../src/shared/types/entities'

export function makeSummary(
  overrides: Partial<EmployeeMonthlySummary> = {},
): EmployeeMonthlySummary {
  return {
    employee_id: 1,
    total_regular_hours: 0,
    total_ot_hours: 0,
    days_worked: 0,
    total_rest_day_hours: 0,
    total_rest_day_ot_hours: 0,
    total_holiday_hours: 0,
    total_holiday_ot_hours: 0,
    total_required_hours: 0,
    total_shortfall_hours: 0,
    ...overrides,
  }
}
