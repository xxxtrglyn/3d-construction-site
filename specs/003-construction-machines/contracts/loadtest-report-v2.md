# Contract: Load-test report additions (version 2)

This contract extends [002 loadtest-report.schema.json](../../002-multiplayer-core/contracts/loadtest-report.schema.json).
The report's `version` becomes `2`. All 002 fields stay.

```jsonc
{
  "version": 2,
  "bots": {
    "behaviors": {
      // 002 keys ... plus:
      "machineEnter": 0, "scoop": 0, "dump": 0, "mix": 0, "bagIn": 0, "pour": 0,
      "craneGrab": 0, "craneRelease": 0, "palletLoad": 0, "palletUnload": 0,
      "outsiderEnterTry": 0            // deliberate permission probes (must all be refused)
    }
  },
  "machines": {
    "groundworkDone": 0,               // buildings that finished Groundwork during the run
    "craneSnaps": 0,                   // high + hand slots filled via crane
    "forkliftSnaps": 0,
    "maxMachinesMoving": 0,            // max machines with a non-idle phase or moving in one tick
    "machineBytesPerClientPerS": { "avg": 0, "p95": 0 }
  },
  "consistency": {
    // 002 counters ... plus (all must be 0):
    "machineOutsiderOps": 0,
    "highFilledByHand": 0,
    "workerMovedByMachine": 0,
    "heldPiecesLost": 0
  }
}
```

**Pass rule**: every 002 budget holds, every consistency counter is 0, and in a full run (≥ 300 s)
`groundworkDone ≥ 4`, `craneSnaps ≥ 8` and `palletUnload ≥ 10`. Those last three show that the
machines were really exercised.
