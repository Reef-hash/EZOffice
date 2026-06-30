-- Migration 0005: Add per-employee PCB profile to salary_structures.
-- Previously, payrollRun.ts hardcoded 'single'/0-children for every employee,
-- causing incorrect PCB deduction for married employees and those with children.
-- These columns live on salary_structures (effective-dated) so that a life event
-- (marriage, new child) is captured alongside the next salary review.
--
-- Default values preserve backward compatibility: existing rows become 'single'/0.

ALTER TABLE salary_structures
ADD COLUMN pcb_category TEXT NOT NULL DEFAULT 'single'
  CHECK(pcb_category IN ('single', 'married_no_spouse_income', 'married_with_spouse_income'));

ALTER TABLE salary_structures
ADD COLUMN pcb_children_count INTEGER NOT NULL DEFAULT 0
  CHECK(pcb_children_count >= 0);
