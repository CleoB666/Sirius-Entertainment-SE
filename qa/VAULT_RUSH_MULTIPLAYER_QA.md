# Vault Rush — multiplayer QA and course handoff

## Changes

The online room leader and connected players now receive the same server-owned lobby state: roster, character choices, bot count, bot difficulty, stage, and selected room. Each player can edit only their own nickname and character; bot settings, room selection and match start remain with the room leader. Late joiners receive the current stage. The host cannot rely on a client-side-only lock: the dedicated server checks the owner slot for every privileged lobby message.

Space can be used to jump by the first local keyboard player, or by any player on their own computer in online play. The original W jump remains. Other local keyboard clusters are unchanged to avoid conflicting inputs.

The cast and tongues now move together, and tongue artwork extends from calibrated mouth points on the cast image in both Classic and Vault Rush. No separate glow indicator surrounds the tongues.

## Checks performed

- Node.js syntax checks: dedicated server, multiplayer client, both game entrypoints.
- Four simultaneous dedicated-server WebSocket connections: matching roster and selected room/stage for all four.
- Server authority: guest's attempt to change lobby stage was ignored.
- Bot count clamps to available seats as players join.

## Checks to perform before release

1. Open four separate browser sessions; join one shared code and check character choices, bot count, difficulty, room selection, briefing and start timing are consistent.
2. Test all five available thief portraits and confirm no two connected players accidentally share an unwanted selected character.
3. Test keyboard movement and Space jump for one online player, then four local players on the same keyboard.
4. Inspect both start menus at desktop, tablet and mobile widths; confirm each tongue emerges from its mouth while the cast breathes.
5. Play all rooms through to the result screen, including resource spending, indirect competition, bot fill, Draco's chase, loot regeneration and reconnection.
6. Run a fresh external playtest, documenting participants, instructions, observed problems and iterations. Do not report unperformed tests as completed.

## Course design mapping — available evidence

- Resource management: tools, energy, carried socks, banked score and relay deliveries.
- Indirect interactions: shared collectibles, contested opportunities, timed relay and vault/loot systems, Draco as shared threat.
- Multiplayer: 2–4 participants, server authority, optional bots, local keyboard controls.
- Iteration: the codebase incorporates earlier balancing and bug fixes; the specific required evidence and wording should be checked against the teacher's original assignment and actual playtest notes.

The full original course rubric was not included in the website archive. This checklist does not claim final academic approval, deployment or real-world testing.
