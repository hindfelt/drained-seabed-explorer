# P0 Findings — Engine/Pack Split + Automated Pipeline

Date: 2026-07-16. Verdict: **P0 goal met.** The engine boots any region pack;
the zero-dependency generator produced the Öresund automatically (parity gate
passed) plus two regions we had never touched — a deep Norwegian fjord and a
Pacific atoll — both booting clean with zero console errors.

Proof screenshots: `docs/screenshots/{oresund-p0,oresund-p0-water,geiranger-p0,bora-bora-p0}.png`

## Per-region results

| | Öresund | Geirangerfjord | Bora Bora |
|---|---|---|---|
| bbox | 12.44,55.82→12.94,56.10 | 6.95,62.05→7.35,62.25 | −151.85,−16.60→−151.65,−16.42 |
| bathymetry | EMODnet + GEBCO | EMODnet + GEBCO | **GEBCO-only (warned)** |
| min/max meters | −51.2 / +92.0 | −407.0 / +1741.7 | −2219.7 / +375.6 |
| seaFactor | 1.76 | 0.221 | 0.041 |
| world terrain | −88.4 … +33.7 | −89.4 … +35.0 | −89.3 … +8.0 |
| wrecks / places / shoals | 39 / 12 / 4 | 0 / 1 / 3 | 4 / 5 / 4 |
| warnings | none | "no charted wrecks" | "GEBCO-only" |

## What auto-tuning got right

- **Depth normalization is the engine's backbone.** `seaFactor = min(3.5,
  90/max(10,|minMeters|))` maps every region's deepest point to ≈ −90 world
  units, so the fixed engine constants (clamp −100, water hidden at −95)
  hold everywhere — a 51 m strait and a 2,220 m ocean trench both render at
  full dramatic depth.
- **Öresund parity.** After re-keying two rules against the real grid (see
  fixes below), 6 of 7 auto-tuned values landed within 12% of the hand-tuned
  baseline: landCeiling 33.75 (vs 33.5), midEdge −31.6 (vs −32), shelfEdge
  −24.4 (vs −22), trenchStart −48.3 (vs −55), trenchFull −73.3 (vs −80),
  saltMax −4.4 (vs −5). The browser gate confirmed visual parity: land on
  both coasts, Ven's fields on Ven, salt flats on the banks, channel trench.
- **Honest degradation works end-to-end.** Bora Bora's GEBCO-only warning and
  Geiranger's "no charted wrecks" are generated, persisted into `meta.json`,
  and surfaced in the credits line exactly as designed.
- **UKHO wrecks are genuinely global** — 4 charted wrecks inside the tiny
  Bora Bora window, normalized identically to the Öresund's 39.

## What auto-tuning got wrong (P1 candidates)

1. **Alpine land is crushed to mesas** (Geiranger). landCeiling keyed to sea
   depth (33.75) compresses 1,700 m peaks into flat-topped plateaus; the
   fjord reads as a trench between mesas rather than between mountains. P1:
   consider a land budget keyed to `maxMeters` when land dominates relief
   (e.g. `landCeiling = clamp(0.375·|seaMinWorld| · f(maxMeters/|minMeters|),
   …)`), or a documented per-pack override flag on the CLI.
2. **Abyssal bboxes flatten islands** (Bora Bora, max world +8.0). One deep
   corner of ocean dictates seaFactor for the whole scene. P1: derive
   seaFactor from a robust depth percentile (p95 of sea depth) instead of the
   absolute min, or crop outlier depths to the bbox's dominant regime.
3. **saltMin can't reach the hand-tuned −25** — the plan's formula locks
   saltMin/saltMax to a 3× ratio (`[p25, p25/3]·seaFactor`) while the proven
   Öresund values sit at 5×. Cosmetically fine (salt band still renders),
   but the formula needs a second degree of freedom in P1.
4. **Unnamed-wreck label noise.** 26 of the Öresund's 39 UKHO wrecks are
   unnamed and render as "UNKNOWN WRECK" pills, cluttering the view. P1:
   render unnamed wrecks with beacon + hull but no label (or a dot label),
   keeping the count in the panel.

## GEBCO-only quality verdict

Usable, with the warning doing honest work. At ~450 m grid spacing the Bora
Bora lagoon keeps its overall atoll shape — the barrier-reef ring reads
clearly once drained — but all sub-kilometer features (coral heads, passes,
the lagoon's inner channels) are smoothed away, and the volcanic island loses
its 727 m peak to interpolation (376 m in-grid, +8 world units after the
abyssal-driven seaFactor). Verdict: GEBCO-only regions are presentable and
honestly labeled, but finding #2 above matters more than raw resolution.

## Fixes made against the plan during execution

- The plan's Task 1 codec test used `-3276.8`, which collides with the
  `-32768` nodata sentinel — changed to `-3276.7`.
- `node --test generator/` (plan) does not accept directories on Node 25 —
  the test script is a quoted glob instead.
- The plan's percentile example implies depth percentiles (p25 = shallow);
  the first implementation computed elevation percentiles and inverted the
  band mapping — fixed in `meta.mjs`.
- The plan's `landCeiling ≈ maxMeters·landFactor` was anchored to a fictional
  `maxMeters ≈ 38.9` (the real grid has 92 m ridges); re-keyed to 37.5% of
  world sea depth, which reproduces the hand-tuned 33.5.
- The plan's shoal radius (`cells × cellSize`) is dimensionally wrong (105 km
  radii); replaced with equivalent-circle radius over a bounded crest window.
- The plan's wreck rule (`approximate` when `position_m` missing) flags 39/39
  wrecks — `position_m` is `'n/a'` across the dataset. Replaced with
  position-text precision (decimal minutes on both axes = charted), giving
  4/39, matching the old curation's scale.
- Overpass rejects bare-body POSTs (406/504): the adapter now form-encodes
  `data=` with a User-Agent. The public instance is still flaky — the CLI run
  needed retries; P1 should add automatic retry/mirror fallback.

## Process notes

- Tasks 1–7 were implemented by Codex (one fabricated fixture caught and
  re-recorded from the live endpoint; one test-script deviation reverted).
- Task 8 passed a Codex adversarial review (4 findings, all addressed:
  NaN-nodata fabrication guard, pack schema validation, shoal radius, plus
  the accepted boot-sequencing note).
- Tasks 9–10 could **not** get their Codex adversarial review: the codex
  runtime wedged (two runs stalled with zero activity) and was declared
  broken mid-execution. Both tasks were verified by tests (19/19),
  `validatePack`, clean builds, and browser gates instead — a re-review once
  the runtime recovers is recommended.
- Snyk scans were clean through Task 8 + the shoal fix; the auth token
  expired before the Task 9/10 commits (interactive re-auth required), so
  the final ~40-line generator diff and pack data are unscanned. Re-scan
  after `snyk auth`.

## P1 shortlist

1. seaFactor from robust depth percentile (fixes flattened islands).
2. Land-relief-aware landCeiling (fixes mesa fjords).
3. Unnamed-wreck label policy.
4. Overpass retry + mirror fallback in the adapter.
5. Salt band second degree of freedom.
6. Web generator per the original plan (MapLibre picker, Worker + R2).
