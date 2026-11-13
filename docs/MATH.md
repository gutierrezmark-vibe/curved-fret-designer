# The math behind Curved Fret Designer

This is written for a luthier, not a mathematician. Every number here comes from `src/geometry.js` and can be checked with `node --test tests/`.

## 1. The one idea: every string has its own scale

A normal fan (multiscale) board gives each string its own scale length, but the lengths go up in equal steps from treble to bass, so the frets are straight lines. If the steps are **not** equal, the frets have to bend to stay at the right place on every string. Curved frets aren't decoration. They're what you get when the scale lengths don't step evenly.

So the whole design is just a list of scale lengths, one per string. Everything else (nut, frets, bridge, board outline) follows from that list plus the string spacing.

## 2. Mark's formula

From *Understand_Math* and the spreadsheet:

```
L[n] = L[n-1] ± scalar · growth^(n-1)
```

All values are in millimetres. Each string is the previous one plus a **step**. The first step is `scalar` mm, and every step after it is `growth` times the one before.

| growth | what the steps do | what the frets do |
|---|---|---|
| 1 | all equal | straight fan |
| above 1 (1.1, 1.3...) | get bigger toward the bass ("accelerating", Mark's *Fast*) | bow strongly near the bass |
| below 1 (0.9, 0.935...) | get smaller toward the bass ("decelerating", Mark's *Slow*) | bow strongly near the treble |

The further growth is from 1, the more the frets bend. Mark's notes call anything above 1.3 "too severe" for practical use, so the app warns outside 0.8–1.3.

**Indexing convention.** In the app, `scalar` is the **first step** (string 1 to string 2), which matches the spreadsheet (`=B3+($E$3*$F$3^(A3-1))` with `A3 = 1`). The RTF's first worked example raises growth to the *current* string number instead, which makes the first step `scalar × growth`. The two are the same curve with a different scalar: Mark's "2 × 1.45^(n-1)" is the app's **scalar 2.9, growth 1.45**.

**Continuous strings.** The series can be written in closed form: the sum of the first d steps is `scalar · (growth^d − 1)/(growth − 1)`, or `scalar · d` when growth = 1. That formula also works for fractional d, which is how the app handles a pivot at "string 4.5" and draws smooth curves between strings (section 6).

## 3. The modes

String 1 (index 0) is always the treble. `fitToEnds` (on by default) solves the scalar(s) so the treble and bass strings land exactly on `trebleScale` and `bassScale`, which lets you say "25.5 to 30, this shape".

| mode | params that matter | what it is |
|---|---|---|
| `single` | trebleScale | One scale, straight frets. |
| `fan` | trebleScale, bassScale | Equal steps, straight fanned frets. |
| `exponential` | scalar, growth, direction, fitToEnds | One series. `toBass` starts at the treble and adds steps; `toTreble` starts at the bass and subtracts them. With fitToEnds, `scalar = (bass − treble) / (1 + g + … + g^(N−2))`. |
| `divergent` (D-scale) | scalar, growth, pivot, fitToEnds | One series that grows **outward from the pivot** in both directions: subtract toward the treble, add toward the bass. For even counts, use a half pivot (3.5 on an 8-string), which is Mark's "hypothetical .5 string". fitToEnds solves the scalar and the pivot string's scale together. |
| `convergent` (C-scale) | trebleHalf, bassHalf, pivot, fitToEnds | Two series, one climbing **from the treble string** and one descending **from the bass string**, meeting at the pivot. Strings at or below the pivot use the treble series (Mark's "cherry pick"). fitToEnds scales both scalars by the same factor so the halves meet exactly. Without it, they can miss each other (the app reports the gap). |
| `s-curve` | trebleHalf, bassHalf, pivot, fitToEnds | Two series growing **outward from the pivot**, each with its own scalar and growth. With fitToEnds, both scalars are solved so the ends are exact **and the two halves leave the pivot at the same slope**. That guarantees a smooth inflection with no kink, exactly at the pivot. |
| `custom` | customScales | Any list. Missing entries continue the last step. |

`design.profile.solved` reports the scalars actually used after fitting, so the UI can display them.

### Convergent vs divergent vs S: the same family

Reading a geometric series backwards gives another geometric series, with growth flipped to 1/growth. So a C-scale with growth 1.32 from the ends has the same shape as an outward (D/S) series with growth 1/1.32 ≈ 0.758 from the middle. The fits for board B below show this: convergent g = 1.32 and s-curve g ≈ 0.76 both reproduce it. The modes differ in which end you anchor and which numbers you type. The S-curve mode exists because it is the easiest one to dial in: set the two end scales, put the pivot where you want the inflection, and set one growth per half.

## 4. Mark's three FretFind2D boards, reverse-fitted

`fitScales(scalesMm)` fits every mode by least squares (growths searched numerically, the rest solved exactly) and picks the simplest one within 0.3 mm. All three boards came out of Mark's spreadsheet formula. The small residuals are from typing the FretFind values to 2–3 decimals; for example, board A's 25.77" is the formula's 25.7797" truncated.

| board | best fit | scalar | growth | anchor / pivot | max error |
|---|---|---|---|---|---|
| **A** (8-str, 25.5"–28.665") | exponential toward bass | 2.895 mm (exact formula: **2.9**) | **1.4507** (1.45) | treble 647.65 mm | 0.19 mm |
| **B** (9-str, 25.5"–29.99") | convergent, equal halves | 8.95 mm (exact: **9**) | **1.3237** (1.32) | pivot **string 5** (index 4) | 0.11 mm |
| **C** (8-str, 25.5"–28.688") | exponential toward bass | 14.002 mm (exact: **14.025** = 15 × 0.935) | **0.9358** (0.935) | treble 647.68 mm | 0.16 mm |

Other fits worth knowing:

* **B** also fits as a divergent D-scale (pivot 4, growth 0.758 = 1/1.32, max error 0.18 mm) and as an S-curve (pivot 4, outward growths 0.757/0.760, 0.07 mm). It is not an exponential: the best single series misses by 5.2 mm. B is an S-curve, which is why its frets visibly inflect at string 5.
* With Mark's exact formula (9 mm, 1.32 from 647.7 and from 762), the two halves miss each other by 0.22 mm at string 5. He took string 5 from the treble side. Preset `mark-b` turns on fitToEnds (meeting exactly, bass = 30.000"), which changes no string by more than 0.25 mm. Preset `mark-b-built` holds his exact FretFind numbers.
* A at growth 1.45 is above Mark's own 1.3 comfort limit, so the app shows an info note.

Presets `mark-a`, `mark-b`, `mark-c` reproduce all three boards from the formula to within 0.26 mm (0.01"). The tests check this.

## 5. Why the frets curve, and the perpendicular flip

Put the board's y-axis along the neck, with y = 0 on the **perpendicular line** (the point at `perpRatio` along every string). For a string of length L, the point at fraction t from the nut (fret n sits at t = 1 − 2^(−n/12)) is at

```
y  ≈  (t − perpRatio) · L(string)
```

(exactly `(t − perpRatio) · dy`, where dy is the string's length projected on the neck axis. It differs from L by well under a millimetre for any fan.)

So **every fret is the same L-profile, scaled by its own factor** `k = 1 − perpRatio − 2^(−n/12)`. With perpRatio = 0.5:

| line | factor k | meaning |
|---|---|---|
| nut | −0.500 | full curve, one way |
| fret 1 | −0.444 | almost as curved as the nut |
| fret 5 | −0.249 | half as curved |
| **fret 12** | **0** | **dead straight** (it *is* the perpendicular line) |
| fret 24 | +0.250 | half as curved, **the other way** |
| bridge saddles | +0.500 | mirror image of the nut |

The perpendicular fret is the pivot of a seesaw. Every fret on the nut side bends one way, every fret on the bridge side bends the opposite way, and the amount grows with distance from the perpendicular fret in *scale fraction* (not in millimetres). In the UI this is worth showing as an animation that sweeps perpRatio and watches the straight fret travel along the neck. Moving perpRatio to 0 makes the nut straight, and every fret then bends the same way, more and more toward the bridge.

The *direction* of the bow along a fret comes from how the scale steps change from string to string. That's the **second difference** of the list, `L[i−1] − 2·L[i] + L[i+1]`, which is positive where steps are growing and negative where they are shrinking. It is reported as `design.profile.secondDiff`. Equal steps (a fan) have second difference 0, which means straight frets.

## 6. How the curves are drawn (exactly through every crossing)

The app treats string number as a continuous slider s (0 = treble, N−1 = bass). For any s in between it builds a **virtual string**:

* nut x and bridge x are linear in s (the string spacing is even),
* the length L(s) comes from the analytic series where one exists, otherwise from a smooth cubic spline through the real lengths (not-a-knot, so the curvature isn't forced to zero at the outer strings),
* fret n on that virtual string is the point at fraction 1 − 2^(−n/12), exactly as on a real string.

Sliding s from one side to the other traces each fret. The curve passes **exactly** through every real crossing, because at integer s the virtual string *is* the real string. The nut (fret 0), the bridge saddle line (t = 1) and the board end (last fret + `boardExtension`, measured along each string) are built the same way.

**Board edges.** Each edge is a straight line from the nut, `edgeMargin` outside the outer string, to the bridge line, `edgeMargin` outside it. That puts the edge at virtual string −edgeMargin/nutSpacing at the nut and −edgeMargin/bridgeSpacing at the bridge. Each fret curve simply carries on past the outer string until it meets that edge, so frets reach the edges smoothly instead of as straight stubs.

With 1 or 2 strings there is nothing to bend, so the frets are straight lines.

### What each fret reports

* `sagitta`: the largest gap between the fret and a straight line from edge to edge (mm). This is the "how bent does it look" number.
* `signedSagitta`: the same gap, positive when it bows toward the bridge.
* `bows`: the sagitta of each piece between inflections. An S has two.
* `minRadius`: the tightest bend radius along the fret (mm), from the true curvature. This is the "can I bend wire to this" number.
* `inflections`, `inflectionPoints`: where the curvature changes sign. An S-curve fret has one, at the pivot.

`metrics` collects the worst values: `maxSagitta`, `minRadius`, `nutSagitta`, `inflectingFrets`, `perpFret` (the fractional fret on the perpendicular line), `minFretSpacing`.

## 7. S-curves, defined rigorously

A fret has an S (an inflection) where the scale-length profile L(s) changes from **concave** (steps shrinking) to **convex** (steps growing), or the reverse. In the S-curve mode, with pivot p:

```
for s < p:  L(s) = Lp − a · S(p − s, gT)       treble half
for s ≥ p:  L(s) = Lp + b · S(s − p, gB)       bass half
where S(d, g) = (g^d − 1)/(g − 1)
```

* The bass half is convex when gB > 1 and concave when gB < 1.
* The treble half is the mirror image: concave when gT > 1, convex when gT < 1.
* **So there is an S exactly when both growths sit on the same side of 1.** If one is above and one below, both halves bend the same way and you get a plain C-shaped curve. The app tells you so.
* fitToEnds solves a and b from two conditions: the ends are exact, and `a·ln(gT)/(gT−1) = b·ln(gB)/(gB−1)`, so the slope matches at the pivot. The curvature changes sign right at s = p, so the inflection lands on the pivot. The tests check that every non-perpendicular fret of every S preset inflects within 0.15 of a string of the pivot. The only shift comes from the tiny fan correction in dy.
* Both growths below 1 (both halves slowing down away from the middle) gives the shape of Mark's C-scale and his photographed 9-string: steep in the middle of the board, flattening toward both edges. Both above 1 gives the opposite S.

Convergent (C-scale) also has an S whenever both halves have growth on the same side of 1. It only joins smoothly when the halves are symmetric or fitted. Otherwise the app falls back to a spline through the string lengths so the fret never gets a corner.

## 8. String count: does a 6-string show the curve?

Same "musical" settings for every count: treble 25.5", nut spacing 7.3 mm, bridge spacing 9.5 mm, perpendicular at the 12th fret (perpRatio 0.5), 24 frets, fitToEnds. Numbers are the fret **sagitta in mm** (fret 12 is straight because it is the perpendicular fret).

| setting | strings | fret 1 | fret 5 | fret 12 | fret 24 | tightest radius |
|---|---|---|---|---|---|---|
| exponential, g 1.30, +3" | 6 | 5.1 | 3.5 | 0 | 3.5 | 74 mm |
| | 7 | 6.3 | 4.1 | 0 | 4.1 | 74 |
| | 8 | 7.5 | 4.7 | 0 | 4.7 | 74 |
| | 9 | 8.6 | 5.3 | 0 | 5.3 | 74 |
| | 12 | 11.6 | 6.9 | 0 | 6.8 | 74 |
| exponential, g 1.15, +3" | 6 | 2.8 | 1.9 | 0 | 1.9 | 139 |
| | 8 | 4.1 | 2.6 | 0 | 2.6 | 138 |
| | 12 | 6.5 | 3.9 | 0 | 3.8 | 138 |
| exponential, g 0.90, +3" | 6 | 2.1 | 1.4 | 0 | 1.4 | 182 |
| | 8 | 3.1 | 2.0 | 0 | 2.0 | 182 |
| | 12 | 5.1 | 3.0 | 0 | 3.0 | 182 |
| S-curve, g 0.80 per half, +3" | 6 | 1.1 | 0.7 | 0 | 0.7 | 86 |
| | 7 | 1.4 | 0.9 | 0 | 0.9 | 86 |
| | 8 | 1.6 | 1.0 | 0 | 1.0 | 86 |
| | 9 | 1.9 | 1.1 | 0 | 1.1 | 86 |
| | 12 | 2.6 | 1.5 | 0 | 1.5 | 86 |
| C-scale g 1.32 (Mark's B shape), +4.5" | 6 | 1.6 | 1.2 | 0 | 1.2 | 71 |
| | 8 | 2.6 | 1.8 | 0 | 1.8 | 69 |
| | 9 | 3.0 | 2.0 | 0 | 2.0 | 69 |
| | 12 | 4.4 | 2.7 | 0 | 2.7 | 69 |

With the perpendicular at the nut instead (perpRatio 0), fret 12 bends too: for example, 5.6 mm on the 6-string g 1.30 board and 9.5 mm on the 9-string.

What this says:

1. **Bend radius doesn't depend on string count.** It is set by growth and the scale range per string. Growth 1.3 bends to about 75 mm no matter how many strings, and Mark's built 9-string bends to about 70–75 mm, so that is known to be buildable. The app shows info below 100 mm, a warning below 50 mm and an error below 25 mm.
2. **How visible the curve is grows with string count**, roughly with the square of the board width, because the same curvature runs over a wider board.
3. **A one-way curve is clearly visible on a 6-string.** 2–5 mm of bow at fret 1 for growth 0.9–1.3 is easy to see (fret crowns are about 2.5 mm wide). Allow it.
4. **An S on 6 strings is marginal.** Each half has only 3 strings, and each half bows about 1 mm. You'd see it up close, but it reads as "slightly wobbly" rather than as an S. From 8 strings each half bows 1.6 mm or more, and Mark's 9-string reaches 3 mm.

**Recommendation.**

* Allow any string count, with no maximum. 1 and 2 strings give straight frets, and 12, 18, 24 and more all work.
* Warn (info) when the largest bow is under 1 mm: "frets will look nearly straight".
* For S-curves (and C/D scales), recommend **7 or more strings** (at least 3 on each side of the pivot), and ideally **8+**. Below 7 the app shows an info note.
* Keep growth inside 0.8–1.3 for normal work. 1.3–1.45 gets an info note and beyond that a warning.

## 9. Warnings the app raises

| level | when |
|---|---|
| error | a scale length is invalid; a string is shorter than its sideways offset; a fret radius is under 25 mm |
| warn | scales not monotonic (frets zig-zag); growth beyond 0.7–1.45; frets closer than 6 mm on the shortest string; radius under 50 mm; scale range over 7" |
| info | growth outside 0.8–1.3; radius under 100 mm (pre-bend on a jig); range over 5"; largest bow under 1 mm; an S with growths on opposite sides of 1 (no S); S/C/D designs under 7 strings; C-scale halves missing each other by more than 0.5 mm; with an explicit tuning, string tension outside 10–32 lb |

## 10. Strings, tension, import and sharing

* `defaultGauges(n)`: .009 .011 .016 .024w .032w .042w .054w .068w .080w .090w then .100w for every further string. Gauges of .020 and above are marked `wound`.
* Each string also gets a `note` (standard tuning, extended down in fourths: B1, F#1, C#1...) and `tensionLb`/`tensionN`, from `T = UW·(2·L·f)²/386.4` with plain steel UW ≈ 0.2227·d² and nickel-wound UW ≈ 0.185·d² lb/in. Pass `tuning: ['E4','B3',...]` for real numbers. For example, a .009 E4 at 25.5" comes out at 13.1 lb.
* `importFretFind(url)` reads a FretFind2D share link: `sl` (single/multiple/individual), `len`, `lenF`, `lenL`, `pDist`, `il[]`, `ipDist`, `nutWidth`/`bridgeWidth` (outer-string centre to centre, as in FretFind2D), the overhang keys (`oE` etc.), `numStrings`, `numFrets` and `u` (in/cm/mm). Individual scales come in as `custom`. Run `fitScales(p.customScales)` to recover a formula.
* `encodeParams`/`decodeParams` write a short versioned hash, e.g. `v=2&n=8&m=s-curve&lb=723.9&pv=3.5&th=10,0.8&bh=10,0.8`. Only values that differ from the defaults are written. Unknown or broken values are ignored, and old JSON links still open.

## 11. Exports (`src/exports.js`)

All exports are pure functions of a Design and return `{ data, mime, extension }`:

* `exportSVG(design)`: a 1:1 SVG in mm (nut left, treble top), with layers for centreline, strings, outline, nut, frets, bridge and labels.
* `exportDXF(design)`: R12 ASCII DXF in mm, with layers OUTLINE, NUT, FRETS, STRINGS, CENTRE, BRIDGE and TEXT. Frets are dense polylines that pass through every crossing.
* `exportPDF(design)`: a cover page plus the fret-position table (distance from the nut along each string, in the design's units), then the 1:1 template tiled across Letter-landscape pages (in both directions if the board is wide). Tiles overlap by 15 mm and have dashed cut lines and ⊕ registration marks. Every tile carries a 100 mm and a 4 in check ruler.
* `exportCSV(design)`: one row per string per fret (nut, frets, bridge) with distance from the nut along the string and x/y of the crossing, in mm and inches.
