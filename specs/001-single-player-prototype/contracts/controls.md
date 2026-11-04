# Contract: Player Controls

All devices map onto one set of actions (`packages/client/src/input/actions.ts`). Gameplay code
reads only these actions, never raw device events.

| Action | Meaning | Keyboard / mouse | Touch | Gamepad |
|---|---|---|---|---|
| `move` (vec2) | Walk direction relative to the camera | WASD / arrow keys | Left-half dynamic joystick | Left stick |
| `run` (bool) | Run speed | Shift (hold) | Joystick pushed > 85 % | Left stick > 85 % or LB |
| `look` (vec2) | Orbit the camera | Mouse drag with right button, or pointer-lock move | Drag on right half | Right stick |
| `jump` | Jump | Space | [JUMP] button | A / Cross |
| `action` | Pick up nearest piece, or drop the held one | E or left click | [GRAB/DROP] button (label changes) | X / Square |
| `toss` | Throw the held piece forward | Q, or hold `action` ≥ 0.35 s and release | [TOSS] button (visible only while holding) | B / Circle |
| `respawn` | Back to spawn | R (hold 0.5 s) or menu | Menu → "Back to spawn" | Select / View |
| `menu` | Settings: mute, shuffle name, back to spawn, build again | Esc | ☰ button | Start / Menu |

## Rules

- On-screen buttons appear only after the first `touchstart`, and hide again after 10 s of
  keyboard/mouse use.
- The action button targets the nearest piece within 1.2 m in front of the worker (a 120° cone); the
  target piece gets a white rim highlight.
- No action is required for snapping: carrying a matching piece into the build zone and dropping or
  tossing it there triggers the snap.
- Movement speeds: walk 3.2 m/s, run 5.5 m/s, jump apex height 1.1 m. Carrying a beam or the bell
  slows the worker by 15 %.
