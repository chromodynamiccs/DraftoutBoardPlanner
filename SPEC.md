# Draftout 3-Player Draft Tool — Spec

## What this is

A local web app that lets **three people draft a 6x6 Lockout board** by taking
turns picking between two randomly offered goals, then exports the finished
board as a file the Draftout mod can load directly.

The Draftout mod has a built-in draft phase, but it's hardcoded to exactly 2
players and doesn't accept custom boards. This tool replaces that draft phase
for a 3-player group.

## Background you need (already verified — don't re-research)

These facts were confirmed by decompiling `draftout-1_15_1.jar`. Trust them.

- **Game mode is LOCKOUT, not DRAFTOUT.** The mode enum has hard limits:
  `DRAFTOUT(min 2, max 2, supportsCustomBoard=false)`,
  `LOCKOUT(min 2, max 4, supportsCustomBoard=true)`,
  `BLACKOUT(min 1, max 4, supportsCustomBoard=true)`.
  Draftout mode cannot be used for this. Lockout can.
- **Board sizes are 3 to 7, square only.** 6x6 is valid.
- **There is no difficulty data anywhere in the client.** The `Goal` class is
  just `id`, `data`, and completion state. Goal pairing must be pure random.
  Do not invent difficulty tiers or try to balance pairs.
- **Boards cannot contain duplicate goals.** The mod rejects them on load.

## The export format (the important part)

The mod reads custom boards from `.minecraft/lockout-boards/<name>.json`:

```json
{
  "size": 6,
  "goals": [
    { "id": "MINE_DIAMOND_ORE", "data": "null" },
    { "id": "KILL_COLORED_SHEEP", "data": "light_blue" }
  ]
}
```

- `size` is an int, 3–7
- `goals` is a flat array of exactly `size * size` entries, read in row-major order
- `data` is the string `"null"` when the goal takes no parameter
- Validation on load: `size` in range, `size * size === goals.length`, no null ids

The whole point of the export is that nobody types 36 goals into the mod's
board builder by hand. User downloads the JSON, drops it in the folder, clicks
Load then Apply Board.

## Goal data

`draftout-goals.json` (provided alongside this spec) contains 289 base goals:

```json
{ "id": "MINE_DIAMOND_ORE", "name": "Mine Diamond Ore", "needsData": false }
```

Five goals have `needsData: true` — their display name still contains a `%1$s`
placeholder and they require a color in the `data` field:

- `WEAR_COLORED_LEATHER_ARMOR_PIECE` (takes color + armor piece)
- `KILL_COLORED_SHEEP`
- `OBTAIN_COLORED_GLAZED_TERRACOTTA`
- `OBTAIN_64_COLORED_WOOL`
- `OBTAIN_64_COLORED_CONCRETE`

The 16 Minecraft dye colors: white, orange, magenta, light_blue, yellow, lime,
pink, gray, light_gray, cyan, purple, blue, brown, green, red, black.

When one of these five is offered, pick a random color at offer time, fill it
into the display name, and carry that color through to the export's `data`
field. Treat each color variant as a distinct goal for duplicate purposes.

## Draft rules

- 3 or 4 players, named by the user at setup (default P1/P2/P3, P4 optional)
- 6x6 board = 36 picks, split evenly (12 per player at 3, 9 per player at 4)
- **Rotating order**: A B C A B C ... (A B C D A B C D ... at 4 players)
- Each turn, offer 2 goals drawn at random from the remaining pool
- Player picks one; it's appended to the board in order
- No goal can appear twice on the board
- Draft ends when the board is full

## Phase 1 — build this first

Single shared screen, "hot seat" style. One person has the app open and clicks;
the group is on a call or looking at the same screen. No sync, no backend.

Requirements:

- Setup screen: player names, board size (default 6, allow 3–7)
- Draft screen: whose turn it is, the 2 offered goals as large tap targets,
  and a running view of the board filling up
- Colour-code each filled tile by which player picked it
- **Undo** — misclicks will happen, this is not optional
- End screen: the 6x6 grid, plus a "Download board JSON" button producing the
  exact format above, plus a plain-text list as fallback
- Keep all draft logic as pure functions over a single state object, e.g.
  `offerGoals(state) -> [goalA, goalB]` and `pickGoal(state, choice) -> newState`.
  Phase 2 depends on this.

Stop after Phase 1 and let the user try it before continuing.

## Phase 2 — only after Phase 1 works

Live sync so all three players draft from their own phones. Because turns are
strictly sequential, there are never concurrent writes to reconcile — this is
much simpler than general multiplayer state.

- Room code to join
- Only the active player's buttons are live; others see a waiting state
- Everyone sees the board fill in real time
- Because the logic is already pure functions, this should be swapping where
  the state object lives, not a rewrite

## Out of scope

- Difficulty tiers or balanced pairing (data doesn't exist — see above)
- Anything that reads a live Draftout board during a match (against the rules)
- A Minecraft mod (the launcher blocks unapproved mods)
- Goal icons in v1. The mod's jar has ~190 custom PNGs at
  `assets/draftout/textures/goal/`, but most goals render as plain vanilla item
  textures that are NOT in the mod jar. Text labels are fine for v1.

## Open decisions — ask the user before building

1. **The rejected goal**: does the option you didn't pick get discarded, or
   return to the pool where the next player might be offered it? The second is
   more interesting strategically. Default to discard if unanswered.
2. **Pick timer**: real Draftout gives 10 seconds before auto-picking at
   random. Include it, or let picks be untimed?

## Tech

Plain HTML/CSS/JS in one file is enough for Phase 1, or React if Phase 2 is
coming soon. No build step needed for Phase 1. localStorage is fine and useful
for resuming an interrupted draft.
