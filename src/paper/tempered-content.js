// tempered-content.js: the text of the second white paper, on the Tempered
// fret mode (a recreation of True-Temperament-style fretting).
// Same conventions as content.js: $…$ inline math, $$…$$ display math,
// {{key}} live values from tempered-figures.js facts(), <figure data-fig>
// filled by paper.js, <table data-live> filled by tempered-figures.js.

export const META = {
  kicker: 'Technical paper · Curved Fret Designer · Tempered frets',
  title: 'Tempered Frets: Recreating True-Temperament Fretting from First Principles',
  dek: 'True Temperament moves every fret separately under every string, for two reasons: to tune the notes to a better temperament, and to cancel the sharpness that fretting adds to a real string. This paper rebuilds both layers in the open, from the published Thidell Formula 1 offsets and from string physics, and states plainly where the recreation differs from the original.',
};

export const SECTIONS = [
{ id: 'abstract', title: 'Abstract', html: String.raw`
<div class="abstract">
<p>On an ordinary guitar every fret is one straight bar, so every string is forced to the same equal-tempered division. True Temperament, the system developed by Anders Thidell, replaces each fret with a shaped one whose contact point is set separately under every string. The company publishes the temperament it now uses, <em>Thidell Formula 1</em>, as cents offsets from equal temperament. It does not publish fret coordinates: those come from a measurement process it calls Dynamic Intonation.</p>
<p>This paper recreates the system in two layers. The <b>temperament layer</b> turns the published offsets into a target pitch for every string and fret, and the target pitch into an exact position along the string. The <b>compensation layer</b> models why a fretted string plays sharp (stretching from the finger and fret, and bending stiffness) and solves for the fret position that cancels it. The per-string points are then joined into one continuous, buildable fret with a bounded bend radius.</p>
<p>On a 25.5″ six-string the temperament alone moves frets by up to {{maxShiftT}} mm, and the two layers together by up to {{maxShift}} mm. Every figure is computed live by the designer's engine. A dedicated section lists each point where this recreation departs from Thidell's.</p>
</div>
<p class="keywords"><span>Keywords</span> True Temperament · Thidell Formula 1 · well temperament · intonation · fret compensation · string stiffness · curved frets · CNC</p>
`},

{ id: 'two-problems', title: 'Two problems, one fret', html: String.raw`
<p>A fret has one job: when the string is pressed behind it, the note must sound at the right pitch. "Right" hides two separate questions.</p>
<h3>Which pitch? The temperament problem</h3>
<p>Western harmony is built on simple frequency ratios: the octave 2/1, the fifth 3/2, the major third 5/4. These cannot all be pure at once on a 12-note keyboard. Twelve pure fifths overshoot seven octaves by the Pythagorean comma, about 23.5 cents, and four pure fifths overshoot a pure major third by the syntonic comma, about 21.5 cents. A <em>temperament</em> decides where those errors go. Twelve-tone equal temperament (12-TET) spreads them evenly: every fifth is {{etP5}} cents narrow, which is nearly pure, but every major third is {{etM3}} cents wide, which most ears can hear in a sustained chord.</p>
<h3>Does the string obey? The intonation problem</h3>
<p>Even with a perfect target, a real fretted string does not play the pitch that the ideal formula predicts. Pressing it down stretches it, which raises its tension. Its stiffness makes it act shorter than it is. The usual fix is the saddle setback, which corrects one fret per string (normally the 12th) and leaves residual errors everywhere else. They are largest at the first frets, where a plain fret plays {{err1lo}} to {{err1hi}} cents sharp on the designer's default six-string.</p>
<blockquote class="pull"><p>A straight fret makes every string share one compromise. A tempered fret lets every string have its own.</p></blockquote>
<p>True Temperament tackles both problems with the same tool. Because each fret can sit at a different place under every string, it can aim each note at a better-tuned target <em>and</em> cancel each string's own fretting error. The rest of this paper derives both, then the fret that joins them.</p>
`},

{ id: 'temperament', title: 'The temperament layer', html: String.raw`
<h3>Cents</h3>
<p>Pitch differences are measured in cents, 1200 to the octave:</p>
$$c(f_1, f_2) = 1200 \log_2 \frac{f_2}{f_1} . \tag{1}$$
<p>A 12-TET semitone is exactly 100 cents, so a temperament can be written as twelve small offsets $o(p)$, one per pitch class $p$, added to the equal-tempered pitches. Pure intervals in cents are $1200\log_2(5/4) \approx 386.31$ for the major third, $1200\log_2(3/2) \approx 701.96$ for the fifth and $1200\log_2(6/5) \approx 315.64$ for the minor third.</p>
<h3>Thidell Formula 1</h3>
<p>True Temperament publishes Formula 1 as offsets for the twelve notes and separate offsets for the open strings. The open strings are mostly the offsets of their own notes, with one exception: the high E is tuned to −1 rather than the chromatic −2. These numbers are the only data this tool takes from True Temperament.</p>
<div class="ptable-wrap"><table class="ptable live" data-live="tt-offsets"></table></div>
<h3>What it does to the intervals</h3>
<p>Under a temperament with offsets $o$, the interval of $k$ semitones from root $r$ is $100k + o(r+k) - o(r)$ cents. Applying that to every key shows what Formula 1 is for. In the common guitar keys (C, D, E, G, A and B) the major thirds come out {{guitarM3lo}} to {{guitarM3hi}} cents wide, against 13.7 in 12-TET. The cost is paid in the remote keys (C♯, E♭, G♯, B♭), whose thirds widen to {{remoteM3lo}}–{{remoteM3hi}} cents, while every fifth stays within {{p5worst}} cents of pure. Formula 1 is a <em>well temperament</em> in the historical sense: every key is usable, but the keys a guitarist plays most sound sweetest.</p>
<figure class="fig" data-fig="tt-intervals">
  <div class="fig-head"><span class="fig-no">Figure 1</span><span class="fig-title">Formula 1, key by key</span></div>
  <div class="fig-body"></div>
  <figcaption>Error from pure of each key's major third (left bar) and fifth (right bar) under Formula 1. The dashed line is the 12-TET major third, 13.7 cents wide in every key. Bars below it are better than equal temperament. Computed from the published offsets with equation (1).</figcaption>
</figure>
<div class="ptable-wrap"><table class="ptable live" data-live="tt-ivtable"></table></div>
<p class="aside-note">Minor thirds tell a more mixed story. Formula 1 narrows several of them (in C, F and G) beyond 12-TET's 15.6 cents, because widening a key's fifth-and-third pattern to sweeten the major third pulls the minor third the other way. This is the familiar trade-off of every well temperament, and it is part of why the published offsets favour the major-key shapes of open-position guitar.</p>
`},

{ id: 'targets', title: 'From cents to millimetres', html: String.raw`
<h3>The target for every string and fret</h3>
<p>String $i$ has open MIDI note $m_i$ and is itself tuned to its open-string offset $o_{\text{open}}(m_i)$. Fret $n$ on that string plays note $m_i + n$, which the temperament wants at offset $o(m_i + n)$. Since a tuner hears the fretted note relative to the open string, the target in cents above the open string is</p>
$$C_{i,n} = 100\,n + o(m_i + n) - o_{\text{open}}(m_i) . \tag{2}$$
<p>In 12-TET both offsets are zero and $C_{i,n} = 100n$.</p>
<h3>Ideal string</h3>
<p>For an ideal flexible string the frequency is inversely proportional to the vibrating length. To sound $C$ cents above the open string of scale $L$, the fret must leave a length of $L\,2^{-C/1200}$, so its distance from the nut is</p>
$$x_{i,n} = L\left(1 - 2^{-C_{i,n}/1200}\right) . \tag{3}$$
<p>With $C = 100n$ this is the usual 12-TET rule $L(1 - 2^{-n/12})$. Differentiating (3) gives the sensitivity: one cent moves the fret by</p>
$$\frac{\partial x}{\partial C} = \frac{\ln 2}{1200}\,L\,2^{-C/1200} = \frac{\ln 2}{1200}\,\ell_n , \tag{4}$$
<p>where $\ell_n$ is the vibrating length left at fret $n$. On a 25.5″ scale that is {{centMm1}} mm per cent at the first fret and {{centMm12}} mm at the twelfth. This explains why tempered frets wiggle most near the nut: the same cents cost twice the distance there.</p>
<h3>A worked example</h3>
<p>Take the G string (open G3, offset +4) at fret 1, which plays G♯ (offset −4). Equation (2) gives $C = 100 - 4 - 4 = 92$ cents. Equation (3) puts the fret {{gShiftT}} mm from the plain 12-TET position, toward the nut. That 8-cent drop is the largest the temperament asks for on a standard six-string, and it is the step a True Temperament neck is best known for, at the G string near the nut.</p>
<figure class="fig" data-fig="tt-map" data-open="tt6">
  <div class="fig-head"><span class="fig-no">Figure 2</span><span class="fig-title">The two layers, separately and together</span></div>
  <div class="fig-body"></div>
  <figcaption>Top view of the 25.5″ six-string preset, nut on the left, treble string at the top. <b>Temperament only</b> is equation (3). <b>Compensation only</b> keeps 12-TET targets and cancels fretting sharpness (Sections 5 and 6). <b>Both</b> is the designer's default. At true scale the moves are a few millimetres, so a ×5 view exaggerates each fret's departure from straight.</figcaption>
</figure>
`},

{ id: 'physics', title: 'Why a fretted string plays sharp', html: String.raw`
<p>Equation (3) assumes the string is ideal and that pressing it changes nothing but its length. Neither is true. The designer models three effects. All lengths are in millimetres along the string, with the fret-top plane at height zero.</p>
<h3>Geometry of a fretted string</h3>
<p>At rest the string runs from the nut, a clearance $b$ above the fret plane, to the saddle at distance $S$ and height $s_0$. The action at the 12th fret, $a_{12}$, fixes the slope, so $s_0 = b + (a_{12} - b)\,S/(L/2)$. When the player frets at $x_n$, the finger pushes the string down to a depth $d$ below the crown, halfway between frets $n-1$ and $n$ at $x_f = (x_{n-1} + x_n)/2$. The string now follows three straight pieces, from the nut to the finger, over the crown and on to the saddle:</p>
$$P = \sqrt{x_f^2 + (b+d)^2} + \sqrt{(x_n - x_f)^2 + d^2} + \sqrt{(S - x_n)^2 + s_0^2} , \qquad R = \sqrt{S^2 + (s_0 - b)^2} . \tag{5}$$
<h3>Stretch and tension</h3>
<p>The extra length $P - R$ strains the whole tensioned string. That includes the length past the nut and saddle, $L_d$ (about 160 mm to the tuner post and the anchor), which shares the stretch. With $E$ the Young's modulus and $A$ the cross-section of the load-bearing core,</p>
$$T = T_0 + E A\,\frac{P - R}{R + L_d} . \tag{6}$$
<p>$T_0$ is the open-string tension from the designer's string table, $T_0 = \mu(2Lf_0)^2$. On wound strings only the core carries the load. The model takes a core 0.42 times the outer diameter, typical of hex-core guitar strings.</p>
<h3>Stiffness</h3>
<p>A stiff string resists bending at its ends, which makes it act slightly shorter. For a string clamped at both ends the classic result (Fletcher and Rossing) multiplies the ideal frequency by $1 + 2\varepsilon + 4\varepsilon^2$ with $\varepsilon = \sqrt{EI/T}/\ell$, where $I = \pi d_c^4/64$ is the core's second moment of area and $\ell$ the vibrating length. A fret crown and a saddle are not perfect clamps, so the designer scales the term by a calibration factor $\kappa$:</p>
$$\beta = \kappa\,\frac{\sqrt{EI/T}}{\ell}, \qquad \kappa = 0.5 . \tag{7}$$
<p>The value 0.5 was chosen so that the model's saddle setbacks on the designer's default 9–42 set, {{setMin}} to {{setMax}} mm, match what luthiers set on real electric guitars. With the textbook $\kappa = 1$ the plain G and the low E would need about 6 and 7.5 mm, which real instruments do not show.</p>
<h3>The pitch of a fretted note</h3>
<p>Putting it together, the vibrating length is $\ell = \sqrt{(S - x_n)^2 + s_0^2}$, and the pitch in cents above the open string is</p>
$$c(x_n) = 1200 \log_2\!\left[\frac{\sqrt{T}\,(1 + 2\beta + 4\beta^2)\,/\,\ell}{\sqrt{T_0}\,(1 + 2\beta_0 + 4\beta_0^2)\,/\,R}\right] . \tag{8}$$
<p>The density $\mu$ cancels. The ratio compares the fretted note with the open string under the same model, because the player tunes the open string by ear or with a tuner.</p>
<figure class="fig" data-fig="tt-error">
  <div class="fig-head"><span class="fig-no">Figure 3</span><span class="fig-title">How far a plain fret misses</span></div>
  <div class="fig-body"></div>
  <figcaption>Pitch error of plain 12-TET frets, per string, after a normal setup with each saddle set so the 12th fret plays a true octave. The first frets play {{err1lo}} to {{err1hi}} cents sharp and the highest fret {{err22lo}} to {{err22hi}} cents. A saddle can only zero one fret per string. The rest is what compensation removes.</figcaption>
</figure>
`},

{ id: 'compensation', title: 'Solving for the fret', html: String.raw`
<h3>Step 1: the saddle</h3>
<p>The model first does what a technician does: it moves the saddle until a plain 12th fret plays exactly 1200 cents. Because a longer string flattens the note at a rate given by (4), the fixed-point update</p>
$$S_{k+1} = S_k + S_k\,\frac{\ln 2}{1200}\,\bigl(c_{12}(S_k) - 1200\bigr) \tag{9}$$
<p>converges in a few iterations. The setback $S - L$ is reported for every string: {{setbacks}} mm on the default six-string. Set the saddles to these values, since the frets are solved for this saddle position.</p>
<h3>Step 2: every fret on every string</h3>
<p>With the saddle fixed, fret $n$ on string $i$ is the root of</p>
$$c(x_{i,n}) - C_{i,n} = 0 , \tag{10}$$
<p>which the designer solves with the secant method, starting from the 12-TET position. Equation (8) is smooth and monotonic in $x$ over a fret's range, so the solve converges to a tenth of a micron in a handful of steps. The finger position depends on the previous fret, so frets are solved in order from the nut.</p>
<h3>The two layers on one string</h3>
<p>Separating the result shows what each layer contributes. On the G string the temperament moves fret 1 by {{gShiftT}} mm and the compensation roughly doubles that to {{gShift}} mm. Further up the neck the compensation shrinks quickly. Near the nut the finger pushes the string down over a short run from the nut, a steep angle that stretches it most. Higher up, the same depth is spread over a much longer run.</p>
<div class="ptable-wrap"><table class="ptable live" data-live="tt-split"></table></div>
<h3>Sensitivity</h3>
<p>Equation (6) depends on how hard the player presses ($d$) and on the action ($a_{12}$). Both are inputs in the designer. The table shows why True Temperament measures rather than calculates: halving or doubling finger pressure changes the low-E correction at fret 1 by about a factor of two. The temperament layer, in contrast, is exact.</p>
<div class="ptable-wrap"><table class="ptable live" data-live="tt-sens"></table></div>
<div class="callout"><b>Rule of thumb:</b> trust the temperament layer exactly. Treat the compensation layer as a well-founded estimate for the stated action, gauge and touch, and if you build a neck, check it with a strobe tuner before committing to a production run.</div>
`},

{ id: 'fret-shape', title: 'From points to a fret', html: String.raw`
<p>The solve gives one point per string per fret. A fret is a single piece of metal, so the points must be joined into a continuous curve that is flat where the string touches it and turns gently between strings.</p>
<h3>Segments (the default)</h3>
<p>Thidell's patent describes a fret made of straight segments under each string, joined by curved transitions, so that a string pushed sideways during a bend stays on a flat part and does not change pitch. The designer builds this across the continuous string index $s$. Between strings $i$ and $i+1$, with shifts $h_i$ and $h_{i+1}$ and local coordinate $u = s - i$, the fret is flat for a fraction $\alpha$ at each end and blends in between with the C2 "smootherstep"</p>
$$\sigma(v) = 6v^5 - 15v^4 + 10v^3, \qquad \Delta(s) = h_i + (h_{i+1} - h_i)\,\sigma\!\left(\frac{u - \alpha}{1 - 2\alpha}\right) . \tag{11}$$
<p>$\sigma$ has zero first and second derivatives at both ends, so the flat parts meet the blend without a kink or a jump in curvature. That suits a CNC cutter and a fret crown.</p>
<h3>Bounding the bend</h3>
<p>The steepest curvature of the blend is $\max|\sigma''| = 10/\sqrt{3}$ over unit width. A step of height $h$ blended over a width $w$ therefore has a minimum radius of about $w^2\sqrt{3}/(10h)$. To keep it above $R_{\min}$ (2.5 mm by default, more than the fret crown's half-width), the blend needs</p>
$$w \ge \sqrt{\tfrac{10}{\sqrt{3}}\,h\,R_{\min}}, \qquad \alpha = \min\!\left(0.3,\ \frac{g - w}{2g}\right) , \tag{12}$$
<p>where $g$ is the string spacing at that fret. Small steps keep long flats, up to 30&nbsp;% of the gap at each side, and the large G-string step uses more of the gap. On the default preset the tightest radius is {{minR}} mm.</p>
<h3>Smooth (the alternative)</h3>
<p>The second style passes a natural cubic spline through the per-string points. It has no flats, so a sideways bend changes pitch slightly, but it bends more gently ({{minRs}} mm here). It is the construction used by Chavarria and Schettler for their optimised curved-fret guitar.</p>
<figure class="fig" data-fig="tt-shape" data-open="tt6">
  <div class="fig-head"><span class="fig-no">Figure 4</span><span class="fig-title">Segments versus smooth</span></div>
  <div class="fig-body"></div>
  <figcaption>Frets 1 to 7 of the default preset in both styles, from the same per-string points. Both pass exactly through every string's solved position. They differ only between strings.</figcaption>
</figure>
<h3>Into the engine</h3>
<p>For the rest of the designer a tempered fret is just another curve of the family described in the first paper. The engine traces $t(s) = t_n + \Delta(s)/L$ along each virtual string, so the board edges, the 3D model, the blueprint and the exports all work unchanged. The DXF still writes each fret as one degree-3 spline within 0.001 mm of the exact shape.</p>
`},

{ id: 'deviations', title: 'Where this differs from Thidell', html: String.raw`
<p>This is a recreation, not a copy. True Temperament publishes its temperament and describes its method, but not its fret coordinates. Every point below is a place where our formula could differ from a real Thidell Formula 1 neck.</p>
<div class="ptable-wrap"><table class="ptable">
<thead><tr><th>Aspect</th><th>True Temperament</th><th>This designer</th><th>Effect</th></tr></thead>
<tbody>
<tr><th scope="row">Temperament</th><td>Thidell Formula 1, published cents offsets</td><td>The same offsets, used exactly</td><td>None. The pitch targets match.</td></tr>
<tr><th scope="row">Target per note</th><td>Not published as a formula</td><td>Equation (2): note offset minus open-string offset</td><td>The natural reading of the published tuning instructions. Not confirmed by TT.</td></tr>
<tr><th scope="row">Compensation</th><td>Dynamic Intonation: each note measured on real instruments and strings</td><td>Physics model, equations (5)–(8), with a calibrated stiffness factor κ = 0.5</td><td>The largest difference. The compensation part of each fret is an estimate, sensitive to touch and action (see the sensitivity table in Section 6).</td></tr>
<tr><th scope="row">Fret coordinates</th><td>Proprietary, measured per neck model</td><td>Computed for any scale, gauge, action and tuning</td><td>Ours cannot be checked against TT's numbers, but adapts to designs TT does not make.</td></tr>
<tr><th scope="row">Things measurement captures</th><td>Neck relief, crown shape, fretboard radius, string make, playing amplitude</td><td>Not modelled. Flat board, sharp crown, steel strings, small amplitude.</td><td>Second-order effects, usually under a cent, that a measured neck includes and ours ignores.</td></tr>
<tr><th scope="row">Open strings beyond the table</th><td>Offsets published for standard tuning plus low B and F♯</td><td>Other tunings fall back to the note's chromatic offset</td><td>Drop and open tunings follow Formula 1's logic, but are not TT-endorsed values.</td></tr>
<tr><th scope="row">Fret shape</th><td>Flat segments under strings, curved transitions; exact profile unpublished</td><td>Flat segments with C2 smootherstep blends, bend radius ≥ 2.5 mm (or a smooth spline)</td><td>Same principle and the same contact points. The transitions may look different.</td></tr>
<tr><th scope="row">Manufacture</th><td>Slots CNC-milled, frets cast (silicon bronze in the patent), replaceable</td><td>Exports slot geometry (DXF, SVG, PDF). Making the frets is left to the builder.</td><td>Standard fret wire cannot be bent to these steps. Plan for cast, milled or 3D-printed-and-cast frets.</td></tr>
<tr><th scope="row">Saddle</th><td>Normal adjustable bridge, set by the tech</td><td>Setback solved per string (equation 9) and reported</td><td>Equivalent in practice. Ours gives a starting point to set.</td></tr>
<tr><th scope="row">Multiscale</th><td>Fanned TT necks exist</td><td>Tempered mode is single-scale by design, kept separate from the curved-fret modes</td><td>No fanned tempered boards in this version.</td></tr>
<tr><th scope="row">Notes per octave</th><td>The patent also covers 19- and 31-tone boards</td><td>12 notes only</td><td>Microtonal tempered boards are out of scope.</td></tr>
</tbody></table></div>
<p>Two checks keep the recreation honest. With equal temperament and compensation off, the tempered mode reproduces a plain single-scale board to within $10^{-9}$ mm. And with compensation off, every fret lands exactly where equation (3) puts the Formula 1 target. Both are in the designer's automated tests.</p>
`},

{ id: 'building', title: 'Building it', html: String.raw`
<h3>Slots</h3>
<p>Export the <b>DXF</b>. Each fret is one smooth spline through every string's solved position, ready for a CAM "trace" or "engrave" operation with a slotting cutter of the tang's width. The <b>CSV</b> and the <b>PDF</b> table give each fret's distance from the nut <em>on each string separately</em>, which is the number to check with calipers or a probe after cutting.</p>
<h3>Frets</h3>
<p>Ordinary fret wire bends sideways only to large radii, and these frets step by millimetres between strings, so it will not follow them. The practical options are: cast frets, as True Temperament does, from a master made by pressing soft metal into a cut slot (the method in Thidell's patent); frets milled from bar stock; or cut wire segments under each string with the transitions filed in. The designer's warnings report the tightest radius on the board.</p>
<h3>Saddles and tuning</h3>
<p>Set each saddle back from the scale line by the reported setback and tune the open strings to their offsets (for Formula 1: E −1, B −1, G +4, D +2, A 0, E −2 cents) with a tuner that can read fractions of a cent. Then check a few fretted notes against their targets. On the G string at fret 1 the tuner should read G♯ at −4 cents.</p>
<div class="callout"><b>Before cutting:</b> enter your real action and gauges, decide on the finger depth that matches your touch, and prototype on scrap. The temperament is exact. The compensation is only as good as those inputs.</div>
`},

{ id: 'use-cases', title: 'Use-case scenarios', html: String.raw`
<dl class="cases">
<dt>Open-position players and singer-songwriters</dt>
<dd>Open chords in E, A, D, G and C are where 12-TET thirds sound roughest, and where Formula 1's thirds are closest to pure (Figure 1). A tempered neck makes those chord shapes noticeably calmer, especially on sustained and distorted chords, where beating is most audible.</dd>
<dt>Recording and studio work</dt>
<dd>Stacked guitar parts reveal intonation error. The <b>Equal (compensated)</b> option keeps strict 12-TET targets but removes fretting sharpness, so guitars stay in tune with pianos and synths while chords up the neck stop drifting sharp near the nut.</dd>
<dt>Scale lengths and string counts TT does not offer</dt>
<dd>True Temperament makes necks for a set range of scales and string counts. The recreation works for any scale, any gauge set and any number of strings, for example a 26.5″ seven-string, a short-scale travel guitar or a bass. It gives a builder a starting design where no off-the-shelf neck exists.</dd>
<dt>Retrofitting an existing instrument</dt>
<dd>A new fingerboard with tempered slots can go on an existing neck. Export the DXF at the guitar's real scale and nut width, slot it, and fit cast or milled frets. The saddle setbacks tell you whether the existing bridge has enough travel.</dd>
<dt>Evaluating before buying</dt>
<dd>A guitarist curious about True Temperament can see the fret map for their own scale and strings, hear the difference in the interval table, and read the tuning offsets before committing to a commercial neck.</dd>
<dt>Teaching temperament and intonation</dt>
<dd>The two layers make abstract ideas visible. Switch Figure 2 between "temperament only" and "compensation only" and watch which frets move and why. The interval table makes the trade-offs of a well temperament concrete.</dd>
<dt>When not to use it</dt>
<dd>Heavy string-benders lean on the frets' flat segments, so prefer the Segments style and keep the action modest. Players who change tunings often should know that the offsets are tied to the tuning. A retuned string no longer sits on its designed targets, and the designer must be re-run for the new tuning. And because standard fret wire cannot follow these shapes, a builder without a way to cast or mill frets should not cut the slots.</dd>
</dl>
`},

{ id: 'glossary', title: 'Glossary and references', html: String.raw`
<h3>Glossary</h3>
<dl class="glossary">
<dt>Cent</dt><dd>1/1200 of an octave, 1/100 of a 12-TET semitone. Equation (1).</dd>
<dt>Temperament</dt><dd>A choice of the twelve pitches that spreads the unavoidable errors of pure intervals in a chosen way.</dd>
<dt>Well temperament</dt><dd>A temperament in which every key is usable but keys differ in colour, with the common keys purest.</dd>
<dt>Thidell Formula 1</dt><dd>True Temperament's current temperament, published as cents offsets from 12-TET for each note and open string.</dd>
<dt>Target, $C_{i,n}$</dt><dd>The cents above the open string that fret $n$ on string $i$ should sound. Equation (2).</dd>
<dt>Dynamic Intonation</dt><dd>True Temperament's name for measuring each note's correct position on a real instrument.</dd>
<dt>Compensation</dt><dd>Moving a fret or saddle from its ideal position so a real string plays the intended pitch.</dd>
<dt>Setback</dt><dd>How far a saddle sits behind the nominal scale line.</dd>
<dt>Finger depth, $d$</dt><dd>How far the fretting finger pushes the string below the fret crown.</dd>
<dt>Stiffness factor, $\beta$</dt><dd>The bending-stiffness correction in equation (7), scaled by the calibration $\kappa$.</dd>
<dt>Smootherstep</dt><dd>The quintic blend $6v^5 - 15v^4 + 10v^3$, flat to second order at both ends.</dd>
</dl>
<h3>References</h3>
<ol class="refs">
<li><b>True Temperament, FAQ and How to tune.</b> truetemperament.com. Source of the Thidell Formula 1 note and open-string offsets used here.</li>
<li><b>A. Thidell, US Patent 7,728,210 B2, "Device for string instruments".</b> Fret segments under each string, curved transitions, measurement-based slot coordinates and cast frets.</li>
<li><b>A. Thidell, Thidell Formula 1 technical details.</b> guyguitars.com/truetemperament. Open-string and chromatic offsets.</li>
<li><b>G. U. Varieschi and C. M. Gower, "Intonation and Compensation of Fretted String Instruments"</b> (2009), arXiv:0906.0127. Fretted-string stretching and compensation models.</li>
<li><b>M. Chavarria and J. Schettler, "The Secret behind the Squiggles: Guitars with Optimally Curved Frets"</b>, Bridges 2019, pp. 279–286. A mathematical framework for temperaments and a spline-fret design that resembles Formula 1.</li>
<li><b>"Design of a fretboard using the stiff string equation"</b> (2021), arXiv:2106.13030. Stiff-string effects on fret placement.</li>
<li><b>N. H. Fletcher and T. D. Rossing, <i>The Physics of Musical Instruments</i></b> (Springer). Stiff-string frequency with clamped ends.</li>
<li><b>This designer's engine</b> (<code>src/tempered.js</code>). Every number and figure in this paper is computed by it, and its tests check equations (2), (3) and the 12-TET limit.</li>
</ol>
<p class="colophon">True Temperament, Thidell Formula 1 and Dynamic Intonation are names of True Temperament AB. This independent recreation is not affiliated with or endorsed by True Temperament.</p>
`},
];
