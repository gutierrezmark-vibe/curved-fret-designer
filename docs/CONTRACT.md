# Geometry contract

The whole app depends on one pure ES module, `src/geometry.js`, which has no DOM and no three.js. The **math agent** owns it. The **UI agent** only consumes it. Shapes below are fixed. Adding fields is fine, but renaming or removing one needs coordination through the lead.

## Conventions

- **All geometry is in millimetres.** Inches are display only (`params.units`).
- **String index `i = 0` is the treble (highest-pitched) string**, so `i = N-1` is the bass, the same as "String 1" in Understand_Math.rtf.
- **Board plane is x/y.** `x = 0` is the board centreline and **+x points toward the bass side**. `y = 0` is the perpendicular line (the point at fraction `perpRatio` along every string), and **+y points toward the bridge**, so the nut sits at negative y.
- `scale` is the true length of a string measured **along the string** from the nut point to the bridge point, not its y-span.
- Every polyline is an array of `{x, y}`.

## API

```js
import { DEFAULTS, computeDesign, scaleLengths, defaultGauges,
         encodeParams, decodeParams } from './geometry.js';

scaleLengths(params)    // -> number[] mm, length = numStrings, index 0 = treble
computeDesign(params)   // -> Design (below); merges params over DEFAULTS
defaultGauges(n)        // -> number[] inches, index 0 = treble
encodeParams(params)    // -> URL-hash string, encoding only values that differ from DEFAULTS
decodeParams(hash)      // -> params
```

### Params

| key | type | meaning |
|---|---|---|
| `units` | `'in' \| 'mm'` | display units only |
| `numStrings` | int ≥ 1 | **no maximum** |
| `numFrets` | int | default 24 |
| `mode` | `'single' \| 'fan' \| 'exponential' \| 'divergent' \| 'convergent' \| 's-curve' \| 'custom'` | how scale lengths are generated |
| `trebleScale`, `bassScale` | mm | target end scales (single uses `trebleScale`) |
| `scalar`, `growth` | number | `L[n] = L[n-1] ± scalar·growth^(n-1)` (mm) |
| `direction` | `'toBass' \| 'toTreble'` | which end is the anchor in `exponential` mode |
| `fitToEnds` | bool | solve `scalar` so the series hits `bassScale` exactly |
| `pivot` | number (string index, may be fractional, e.g. 3.5) | where the divergent, convergent or S-curve halves meet |
| `trebleHalf`, `bassHalf` | `{scalar, growth}` | independent halves for convergent and S-curve |
| `customScales` | number[] mm | used when `mode === 'custom'` |
| `perpRatio` | 0..1 | 0 = perpendicular nut, 1 = perpendicular bridge, 0.5 = perpendicular octave |
| `nutSpacing`, `bridgeSpacing` | mm | centre-to-centre spacing between adjacent strings. Widths are derived from these, so any string count fits. |
| `edgeMargin` | mm | outer string to board edge (nut and bridge) |
| `boardExtension` | mm | how far the board continues past the last fret |
| `gauges` | number[] inches | optional, otherwise `defaultGauges(numStrings)` |

`nutWidth = (N-1)·nutSpacing + 2·edgeMargin`. Bridge width works the same way.

### Design (return value)

```js
{
  params,                       // the fully merged params
  strings: [{ i, scale, gauge, wound, nut:{x,y}, bridge:{x,y} }],
  frets: [{
    n,                          // 1..numFrets (fret 0 is the nut, below)
    crossings: [{x,y}],         // one per string, exactly on the string
    curve: [{x,y}],             // dense smooth polyline, board edge to board edge
    sagitta,                    // mm, max deviation of the curve from its chord
    minRadius,                  // mm, tightest bend radius (fret-wire bending)
    inflections                 // count of curvature sign changes (S-curve > 0)
  }],
  nut:    { crossings, curve },   // fret 0
  bridge: { crossings, curve },   // saddle points
  boardEnd: { curve },            // board end past the last fret
  outline: [{x,y}],               // closed board outline polygon
  widths: { nut, bridge },        // mm
  metrics: { maxSagitta, minRadius, scaleRange:[min,max] },
  warnings: [{ level:'info'|'warn'|'error', message }]
}
```

Fret positions use 12-TET: on each string, fret `n` sits at fraction `1 - 2^(-n/12)` from the nut toward the bridge.
