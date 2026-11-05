# Phase Validation Gate: Mixed-Material Stages (004)

Checklist from [quickstart.md](./quickstart.md) → "Phase validation gate". Results are filled in by
the implementation.

- [x] Before starting implementation: 003 gate open items accepted, or the risk accepted by the owner
      (constitution workflow)
  - **2026-11-05: risk accepted by the owner.** Implementation of 004 proceeds while these items stay
    open: from 003, the `render.machines` budget approval and phone fps, the owner review of the
    machine and plot renders, and the 003 playtest; from 002, its owner/device/playtest items. They
    are re-checked at the 004 gate.
- [ ] `pnpm verify` green, including WebKit e2e and the quick load test
- [ ] Load test: `stalledTowers == 0`, towers per shift ≥ 003 baseline, per-client bandwidth and tick
      within budget (SC-005, SC-006)
- [ ] No piece silently consumed in e2e and load tests (SC-007)
- [ ] Owner approves the stage renders with second-material details (FR-024)
- [ ] Solo tower time with machines ≤ 110 % of the 003 time (SC-004)
- [ ] Playtest (5 people): ≥ 4 read their plot's needs within 5 s (SC-001); < 10 % refused deliveries
      after stage 2 (SC-002); 4-person crew: ≥ 3 of 6 stages with parallel work on different
      materials (SC-003)
