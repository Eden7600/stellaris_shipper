# Shipwright: Stellaris fleet & design planner

Client-side Astro + React app that recommends ship designs and a fleet layout for Stellaris 4.5,
based on your researched tech, command limit, naval capacity and the enemy's fleet.

## Setup

```sh
npm install
npm run extract -- "D:/SteamLibrary/steamapps/common/Stellaris"   # reads game files -> src/data/game.json + public/icons
npm run dev
```

Re-run `extract` after a game patch. It parses the game's script files (`common/component_templates`,
`section_templates`, `ship_sizes`, `technology`, `scripted_variables`, `scripted_triggers`), the weapon
stat CSV, English localisation, and converts the DDS icons to PNG (no dependencies).

- `npm test`: parser and planner invariants
- `npm run smoke [preset]`: prints designs and the fleet for early/mid/late tech

## Deploy to Cloudflare Workers

The site is fully static and deploys as an assets-only Worker (`wrangler.jsonc`, no server code). The generated
`src/data/game.json` and `public/icons/` are committed, so the Cloudflare build doesn't need a Stellaris install.

- `npm run deploy`: builds and runs `wrangler deploy`. The first run asks you to log in to Cloudflare and creates
  the `stellaris-shipper` Worker.
- `npm run preview:worker`: builds and serves it locally with `wrangler dev`, exactly as Cloudflare would.
- **Workers Builds (Git integration):** Workers & Pages → Create → Workers → import this repo.
  Set the build command to `npm run build` and the deploy command to `npx wrangler deploy`. Node comes from
  `.nvmrc`.

`public/_headers` caches the hashed bundles forever and the icons for a week. A deployed site is public, and the
icons and data are Paradox assets, so consider access controls (e.g. Cloudflare Access) if that matters.

## How the planner works (`src/lib/planner.js`)

- Damage/day per weapon vs. the enemy: period = (cooldown + average windup) / 10 days (matches the wiki's
  weapon tables), hit chance (accuracy vs. evasion and tracking, evasion capped by `SHIP_MAX_EVASION`),
  shield/armor/hull multipliers and penetration, and `size_damage_factor` (damage × (1 + k × target naval size)).
- Ships fight at their computer's `preferred_attack_range` from `common/ship_behaviors` (min/median/max of
  weapon ranges). Guns shorter than that fire less often.
- Surplus reactor power grants the `ship_excess_power` static modifier (evasion, speed, damage).
- Enemy PD losses scale with missile durability (health + armor, evasion) from the weapon CSV.
- The in-game designer role is derived from the combat computer's `ai_tags` and the hull's roles.

## Build plan and economy

- **Strategy:** *Expand* fills free naval capacity (total − used) and keeps your existing ships. *Replace*
  plans the whole navy from scratch.
- **Costs and upkeep:** build costs cover every resource (alloys plus strategic resources) from component and
  section `resources`. Monthly upkeep comes from hull + sections + components. It is shown three ways:
  - *Docked:* ship upkeep cut by the docking buildings you tick (`ship_orbit_upkeep_mult`, e.g. Crew Quarters
    −25%), and logistics (trade) × `LOGISTIC_FLEET_UPKEEP_DOCKED_MULT` (0).
  - *In friendly space:* logistics × 0.5.
  - *Deployed:* everything is paid in full.

  Optional limits can be set for docked and deployed upkeep separately.
- **Minimum fleets:** the navy is split into at least this many balanced fleets (e.g. one per front), even if
  they then sit below the command limit.
- **Picking ships:** greedy by value per unit of the scarcest constraint (naval capacity, per-resource build
  budget, per-resource upkeep budget). Ships are then split into balanced fleets under the command limit,
  with at most one titan per fleet.
- **Research advice:** each available tech that unlocks a part, section or hull is scored by re-planning the
  navy with it added, keeping the enemy fixed. The top 3 per research area are highlighted.

## Threat model (`src/lib/enemy.js`)

You pick a weighted mix of threats. "General purpose" blends AI empires with Fallen Empires and the crises.
- **AI empires:** built from the AI's own fleet rules at your tech level. Hull mix comes from the
  `ai_ship_data` base fractions, tech taper and fleet-doctrine composition factors, plus the
  weapon-preference boost. Weapons come from the doctrine's AI ship roles and the weapon preference.
  Defenses come from the defense-preference armor/shield ratios applied to the best utility parts you
  could fit. Options left on "Any" use the odds the AI personalities roll.
- **Prethoryn, Extradimensional Invaders, Contingency, Fallen Empires, Marauders:** their actual
  `global_ship_designs` (hull HP, armor, shields, evasion, size, weapons, PD). Stations are skipped.
- Effective HP vs. the enemy weapon mix (armor, shields, hardening, evasion, PD/flak interception).
- For each hull × combat computer, every section combination is filled slot by slot to maximise
  DPS × EHP within reactor power.
- Fleet: Lanchester square law. Maximise Σ√(DPS×EHP) within command limit and naval capacity, with at
  most one titan and about 25% support hull.

Not modelled yet: bioships, repeatable techs, auras, cloaking, starbases, leader/doctrine modifiers.
Game data and icons are © Paradox Interactive. Don't host the extracted `public/icons` publicly without
considering that.
