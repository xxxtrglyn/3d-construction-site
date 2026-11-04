# Contract: Machine Controls

This contract extends the [001](../../001-single-player-prototype/contracts/controls.md) and
[002](../../002-multiplayer-core/contracts/controls.md) controls. Gameplay stays "move + action +
toss (+ jump)" (Principle V). In a machine the same four inputs are re-mapped, and no new buttons are
added.

## Entering

The context-sensitive `action` gets a new priority, inserted before the 002 item 5 ("pick up"):

- **Near one of your plot's machines** (within 1.5 m of its cab, hands empty, seat free): **"Get
  in"**.
- If you are not crew, the prompt reads "Crew only" (greyed), and pressing it shows that hint.
- If someone is driving, the prompt reads "Someone is driving".

## While operating

| Input | Keyboard / mouse | Touch | Gamepad | Excavator | Forklift | Crane | Mixer |
|---|---|---|---|---|---|---|---|
| move | WASD / arrows | left joystick | left stick | W/S drive, A/D turn | W/S throttle, A/D steer | A/D swing the arm, W/S move the hook out/in | — |
| action | E / left click | ACTION button | X | Scoop / Dump | Load / Unload | Grab / Release (the hook lowers and rises by itself) | Mix |
| jump | Space | JUMP button (label "Exit") | A | get out | get out | get out | get out |
| toss | Q | TOSS button (label "Camera", crane only) | B | — | — | hook camera ↔ cab camera | — |

**Labels**:
- The action button label always names the next machine action: "Scoop", "Dump", "Load 4 bricks",
  "Unload", "Grab", "Release", "Mix (3 bags)".
- When nothing is possible, the label is greyed with a reason ("Move closer to the pit", "Hook is
  empty").

**Control hint**: the first time a player enters each machine kind on a device, a hint card shows
for 6 s, or until the first input. The "?" menu item shows it again. This is stored in the profile
as `seenMachineHints: MachineKind[]`.

## Cameras

- **Excavator and forklift**: the follow camera targets the machine, at 1.4× the normal distance.
- **Crane**: starts in the **hook camera** (raised, behind the hook, following the jib direction).
  Toss switches to the **cab camera** and back. Every enter resets it to the hook camera.
- **Mixer**: a fixed camera framing the hopper and the chute.

## Cues (crew members only)

- The needed machine glows with a bouncing arrow until someone gets in (FR-022a).
- While the hook carries a piece within 1.5 m of a matching empty slot, that slot's ring lights up
  (FR-027a).
