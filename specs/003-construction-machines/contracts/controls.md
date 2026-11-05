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
| move | WASD / arrows | left joystick | left stick | W/S drive, A/D turn | W/S throttle, A/D steer (turns on the spot when slow or stopped) | A/D swing the arm, W/S move the hook out/in | — |
| action | E / left click | ACTION button | X | Scoop / Dump | Load / Unload | Grab / Release (the hook lowers and rises by itself) | Mix |
| jump | Space | JUMP button (label "Exit") | A | get out | get out | get out | get out |
| toss | Q | TOSS button (label "Camera") | B | follow ↔ driver camera | follow ↔ driver camera | hook camera ↔ cab camera | mixer view ↔ free camera |

**Labels**:
- The action button label always names the next machine action: "Scoop", "Dump", "Load 4 bricks",
  "Unload", "Grab", "Release", "Mix (3 bags)".
- When nothing is possible, the label is greyed with a reason ("Move closer to the pit", "Hook is
  empty").

**Control hint**: the first time a player enters each machine kind on a device, a hint card shows
for 6 s, or until the first input. The "?" menu item shows it again. This is stored in the profile
as `seenMachineHints: MachineKind[]`.

**Control bar** (added 2026-11-05): the whole time a player is in a machine, a one-line key summary
sits at the bottom of the screen (keyboard keys or gamepad buttons, following the last used device;
hidden on touch, whose buttons already carry labels), e.g. crane: "WASD swing · hook out/in · E grab /
release · Q camera · Space get out".

## Cameras

- **Excavator and forklift**: the follow camera targets the machine, at 1.4× the normal distance.
  Toss switches to a close **driver camera** (just behind and above the seat, looking ahead) and back.
- **Crane**: starts in the **hook camera**: high above and behind the hook (at a fixed height, about
  75° down, following the jib direction), so the hook, its piece and the slots below are in view and
  it never sits next to the cab. Toss switches to the **cab camera** and back.
- **Mixer**: a fixed side view of the hopper and the chute; toss switches to the free follow camera.
- Every enter resets to the machine's first camera.

## Cues (crew members only)

- The needed machine glows with a bouncing arrow until someone gets in (FR-022a).
- While the hook carries a piece within 1.5 m of a matching empty slot, that slot's ring lights up
  (FR-027a).
