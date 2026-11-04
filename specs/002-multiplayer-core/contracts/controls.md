# Contract: Player Controls (multiplayer additions)

This contract extends `specs/001-single-player-prototype/contracts/controls.md`. All 001 actions
keep working unchanged. Gameplay stays "move + action + toss (+ jump)". The new `talk` action and
the panels below are menu-style UI, not gameplay buttons, and there is no free-text input anywhere.

## New actions

| Action | Meaning | Keyboard / mouse | Touch | Gamepad |
|---|---|---|---|---|
| `talk` | Open or close the talk wheel (5 emotes + 6 quick messages) | T, or the 💬 button | 💬 button | Y / Triangle |
| `wheelPick` | Choose a wheel item | Number keys 1–9/0, or click | Tap | Right stick to point + A |
| `answerYes` / `answerNo` | Approve or deny the top join-request card (Host only) | Y / N, or click | Tap ✔ / ✖ | RB / LB while a card is shown |
| `chat` | Open the chat box (typed, ≤ 80 chars) | Enter (Esc closes, Tab switches Nearby/Crew, Enter sends) | "Aa" button | — (reading chat and the talk wheel only; typing not required) |
| `people` | Open the "People here" list (mute, hide; Host: remove, make Host) | P, or menu | Menu → People here | View (hold) |

## Context-sensitive `action` (one button, as in 001)

The action button does one thing, chosen in this priority order:

1. **Holding a piece**: drop it, or toss it with a hold-release, as in 001. Inside your crew's build
   zone, the drop snaps the piece.
2. **Near the Foreman** (within 2.0 m, not holding): open the Foreman dialogue.
3. **Near a plot sign** (within 1.5 m, not in that crew): ask to join. In Open mode this joins
   immediately. A crew member who presses action at the sign opens the crew panel instead (members,
   join mode for the Host, leave).
4. **Near your crew's supply bin, with pieces in it**: take one.
5. **Otherwise**: pick up the nearest piece or rack item, as in 001.

The prompt next to the button always names what will happen ("Talk", "Ask to join", "Take brick",
"Grab", "Drop").

## Dialogs and panels

All are DOM, use the toon UI style, and work with mouse, touch, keyboard and gamepad focus.

- **Foreman dialogue**: buttons "Start a building" → blueprint card (Clock Tower) → "Let's build!";
  "Who's hiring?" (list with stage, crew size and mode; picking one shows a guide arrow);
  "Unfinished buildings" (shown only when any exist); "Bye". Esc or walking away closes it.
- **Request card** (Host): stacked at the top of the screen. It shows the requester's name and hat
  color, a 30 s countdown ring, ✔ and ✖. If several are pending, the newest is on top and the rest
  are queued.
- **Player card**: opens when you tap or click a worker, or pick someone from People here. It offers
  Mute, Hide, **Report chat** and, for the Host only when the player is in your crew, "Remove from
  crew" and "Make Host".
- **Chat box and log**: the log sits bottom-left with Nearby and Crew tabs, 50 lines, and fades when
  idle. The box shows the channel, an 80-character counter and refusal hints ("Links and contact
  info aren't allowed", "Slow down", "Chat unlocks in 0:42", "Chat paused for this shift"). Nearby
  messages also appear as speech bubbles, at most 12 at a time, nearest first. Menu → "Hide all
  chat" is remembered on the device.
- **Shift banner**: a 5-minute warning toast, then a 30 s countdown chip, then a summary card after
  the reset.
- **Connection chip**: "Connection is shaky" when the round trip is above 400 ms or no snapshot has
  arrived for more than 500 ms. "Playing solo" plus "Join others" appear in fallback.
- **Invite**: Menu → "Invite friends" copies `https://<host>/?w=<worldId>` and shows "Link copied!".

## Rules

- Mute and hide choices last until the player leaves the world, and are kept only on the device;
  they also hide that player's chat.
- While the chat box is open, every gameplay action is ignored (keys go to the text box), and the
  worker stops.
- When the Host role changes to you, a toast says "You're the Host now!". The request cards and
  Host buttons then appear.
- "Build again" is not shown in multiplayer.
- Speed and jump values are the same as 001. They now come from shared kinematics (see
  `data-model.md`, WorkerState and MoveInput).
