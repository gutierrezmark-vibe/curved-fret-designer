// content.js — the text of the white paper.
// $…$ is inline math and $$…$$ display math (typeset with KaTeX).
// {{key}} is replaced with a live value computed by the geometry engine.
// <figure data-fig="…"> elements are filled in by paper.js.

export const META = {
  kicker: 'Technical paper · Curved Fret Designer',
  title: 'Curved Frets: The Geometry of Exponential-Scale Fretboards',
  dek: 'When every string has its own scale length and those lengths do not step evenly, straight fanned frets have to become curves. This paper derives that geometry from a single recurrence, maps the family of shapes it produces and sets out what it takes to build one.',
};

export const SECTIONS = [
{ id: 'abstract', title: 'Abstract', html: String.raw`
<div class="abstract">
<p>Multiscale, or fanned-fret, instruments give each string its own scale length. When the lengths rise in equal steps from treble to bass, every fret is a straight line. This paper looks at what happens when the steps are not equal: each fret has to curve so that it stays at the correct position on every string.</p>
<p>We describe a compact recurrence for generating such scale sets, $L_n = L_{n-1} \pm s\,g^{\,n-1}$, and give its closed form and the solution that fits it to chosen end scales. We then derive the fret geometry from a continuous string index and show that every fret is one shared profile scaled by $k_n = 1 - p - 2^{-n/12}$. That one factor explains why the curvature reverses across the perpendicular fret.</p>
<p>We map the family of shapes the recurrence produces (accelerating and decelerating exponential, divergent, convergent and S-curve) and measure how visible each one is as the string count changes. We close with practical guidance on slotting, bending fret wire, bridges and intonation. Every figure is computed live by the same geometry engine that drives the designer.</p>
</div>
<p class="keywords"><span>Keywords</span> multiscale · fanned frets · curved frets · scale length · geometric series · 12-TET · fret-wire bending · CNC</p>
`},

{ id: 'background', title: 'Background', html: String.raw`
<p>The <em>scale length</em> of a string is its vibrating length, from the nut to the saddle. On a conventional guitar every string shares one scale, so the frets are parallel. A <em>multiscale</em> instrument gives each string its own scale, usually longer toward the bass. With the strings fanned between a narrower nut and a wider bridge, the frets end up slanted rather than square to the neck.</p>
<p>The idea is not new. Some Renaissance plucked instruments, the orpharion among them, already used a slanted nut, bridge and frets. In recent decades fanned frets have become a common option from independent luthiers and production makers alike, especially on extended-range guitars and basses. There are three reasons to want one.</p>

<h3>Tension</h3>
<p>For a flexible string of linear density $\mu$ tuned to frequency $f$ over a scale $L$, the tension is</p>
$$T = \mu\,(2Lf)^2 . \tag{1}$$
<p>At a fixed pitch and gauge, tension grows with the square of the scale length. A longer scale on the low strings therefore lets a builder either keep familiar gauges and gain tension where the strings would otherwise feel floppy, or keep a target tension with a lighter string. Per-string scales make it possible to set the feel of each string on purpose instead of accepting whatever one shared scale gives.</p>

<h3>Inharmonicity</h3>
<p>Real strings are stiff, so their overtones run slightly sharp of whole-number multiples of the fundamental. For a plain string of diameter $d$ and Young's modulus $E$, the standard stiff-string result is</p>
$$f_k \approx k\,f_1\sqrt{1 + B\,k^2}, \qquad B = \frac{\pi^3 E\, d^4}{64\, T\, L^2} . \tag{2}$$
<p>Substituting (1) at a fixed pitch and gauge gives $B \propto L^{-4}$. Lengthening a string by 10&nbsp;% cuts $B$ by about a third ($1/1.1^4 \approx 0.68$) and raises tension by 21&nbsp;% ($1.1^2$). The effect matters most on short, thick, low-tension strings, which is exactly where a guitar's lowest strings sit. Wound strings behave in a similar way, with the core doing most of the stiffening.</p>

<h3>Ergonomics</h3>
<p>Fanned frets slant, and the slant is set by two choices: how much the scale changes across the neck, and where the one square fret, the <em>perpendicular</em>, sits. Putting the perpendicular near the middle of the neck splits the slant between the nut and the highest frets, so neither end is extreme. As we will see, uneven steps add a third choice: <em>which strings</em> the change in scale is spent on.</p>
`},

{ id: 'fan-to-curve', title: 'From fan to curve', html: String.raw`
<p>Fret $n$ sits on each string at the fraction $t_n = 1 - 2^{-n/12}$ of that string's scale, measured from the nut. That is the 12-tone equal-tempered rule, and it holds string by string whatever the other strings are doing.</p>
<p>In a linear fan the scale lengths rise by a constant step, so with the strings evenly spaced the nut points lie on a straight line and so do the bridge points. Fret $n$ crosses each string at the same fraction of the way from one line to the other. Every crossing is then a linear function of the string number, so the crossings line up on a straight fret.</p>
<p>Break the equal steps and the argument fails. The crossings still sit at the correct fraction on every string, but they no longer lie on a line. The amount by which the steps change is measured by the second difference</p>
$$\Delta^2 L_i = L_{i+1} - 2L_i + L_{i-1} , \tag{3}$$
<p>which is zero for every string of a straight fan. Where it is positive the steps are growing and the frets bow one way. Where it is negative they bow the other way.</p>
<blockquote class="pull"><p>Curved frets are not an ornament. They are what straight frets turn into when the scale lengths stop stepping evenly.</p></blockquote>
<figure class="fig" data-fig="fan" data-open="acc8">
  <div class="fig-head"><span class="fig-no">Figure 1</span><span class="fig-title">Same ends, different steps</span></div>
  <div class="fig-body"></div>
  <figcaption>Two 8-string boards with identical treble and bass scales (25.5″ and 28.5″), drawn to the same scale with the nut on the left and the treble string at the top. <b>Top:</b> equal steps, a linear fan with straight frets. <b>Bottom:</b> steps that grow by 1.3× per string, so the first fret bows by {{acc8sag1}} mm. The perpendicular fret (the octave) is straight in both.</figcaption>
</figure>
`},

{ id: 'formula', title: 'The formula', html: String.raw`
<p>The scale sets in this paper come from a compact recurrence, a formula shared in the luthier community:</p>
$$L_n = L_{n-1} \pm s\,g^{\,n-1}, \qquad n = 1, \dots, N-1 . \tag{4}$$
<p>All lengths are in millimetres. $L_0$ is the anchor string, $s$ (the <em>scalar</em>) is the first step and $g$ (the <em>growth</em>) is the ratio between consecutive steps. With the plus sign the series starts at the treble and adds toward the bass. With the minus sign it starts at the bass and subtracts toward the treble. The steps are $s,\ sg,\ sg^2,\ \dots$, a geometric sequence, so each step is $g$ times the one before.</p>
<p class="aside-note">Some write the exponent as $n$ instead of $n-1$. That makes the first step $s\,g$ and describes the same curve with a different scalar.</p>

<h3>Closed form</h3>
<p>Summing the steps gives the scale of string $n$ directly:</p>
$$L_n = L_0 + s\sum_{k=0}^{n-1} g^{\,k} = L_0 + s\,\frac{g^{\,n}-1}{g-1}, \qquad g \neq 1 . \tag{5}$$

<h3>Fitting the ends</h3>
<p>A designer usually starts from the two outer scales ("25.5″ to 28.5″") and a shape. Setting $n = N-1$ in (5) and solving for the scalar fits the series exactly to both ends:</p>
$$s = \frac{(L_{N-1} - L_0)\,(g-1)}{g^{\,N-1} - 1} . \tag{6}$$
<p>With the ends fixed, $g$ alone decides the shape. Figure 2 holds both ends of an 8-string board fixed and changes only the growth.</p>

<h3>Why $g = 1$ is a linear fan</h3>
<p>As $g \to 1$ the geometric sum tends to the number of terms,</p>
$$\lim_{g \to 1}\frac{g^{\,n}-1}{g-1} = n \quad\Longrightarrow\quad L_n = L_0 + s\,n , \tag{7}$$
<p>so every step is the same and the board is a straight fan. The second difference makes the point exactly:</p>
$$\Delta^2 L_n = s\,g^{\,n-1}(g - 1) , \tag{8}$$
<p>which is zero for every string only when $g = 1$. For any other growth it has the sign of $s(g-1)$ on every string, so the frets bow one way across the whole board and bend more and more toward the end where the steps are largest.</p>
<div class="ptable-wrap"><table class="ptable">
<thead><tr><th>growth $g$</th><th>the steps</th><th>the frets</th></tr></thead>
<tbody>
<tr><th scope="row">$g = 1$</th><td>all equal</td><td>straight fan</td></tr>
<tr><th scope="row">$g &gt; 1$</th><td>grow toward the bass (accelerating)</td><td>bow, most strongly near the bass</td></tr>
<tr><th scope="row">$g &lt; 1$</th><td>shrink toward the bass (decelerating)</td><td>bow the other way, most strongly near the treble</td></tr>
</tbody></table></div>
<figure class="fig" data-fig="growth" data-open="acc8">
  <div class="fig-head"><span class="fig-no">Figure 2</span><span class="fig-title">One pair of ends, five growths</span></div>
  <div class="fig-body"></div>
  <figcaption>Departure of each string's scale from a straight fan, for an 8-string board fitted to 25.5″–28.5″ with equation (6). At $g = 1$ the departure is zero everywhere. With $g = 1.3$ the first step is {{g13first}} mm and the last is {{g13last}} mm. With $g = 0.8$ the first is {{g08first}} mm and the last {{g08last}} mm. The total change is the same in every case. Only where it is spent differs.</figcaption>
</figure>
`},

{ id: 'geometry', title: 'The geometry', html: String.raw`
<p>From here on we call the scalar $a$ and keep $s$ for a <em>continuous string index</em>: $s = 0$ is the treble string, $s = N-1$ is the bass, and fractional values lie between strings. Equation (5) already makes sense for fractional $s$,</p>
$$L(s) = L_0 + a\,\frac{g^{\,s}-1}{g-1}, \qquad 0 \le s \le N-1 , \tag{9}$$
<p>so we can describe a <em>virtual string</em> at any $s$. Put the board's $x$-axis across the neck, with $x = 0$ on the centreline and $+x$ toward the bass, and the $y$-axis along the neck. With string spacings $\delta_{\mathrm{nut}}$ and $\delta_{\mathrm{br}}$ and $c = (N-1)/2$, the virtual string runs from $x_{\mathrm{nut}}(s) = (s-c)\,\delta_{\mathrm{nut}}$ to $x_{\mathrm{br}}(s) = (s-c)\,\delta_{\mathrm{br}}$.</p>
<p>Measure $y$ from the <em>perpendicular line</em>, the point at fraction $p$ along every string, where $p = 0$ puts it at the nut, $p = 1$ at the bridge and $p = \tfrac12$ at the octave. Fret $n$ on the virtual string, with $t_n = 1 - 2^{-n/12}$, is then at</p>
$$\begin{aligned} x_n(s) &= x_{\mathrm{nut}}(s) + t_n\,\big[x_{\mathrm{br}}(s) - x_{\mathrm{nut}}(s)\big] \\ y_n(s) &= (t_n - p)\,h(s) \end{aligned} \tag{10}$$
<p>where $h(s) = \sqrt{L(s)^2 - (x_{\mathrm{br}} - x_{\mathrm{nut}})^2}$ is the string's length projected on the neck axis. On any real board $h$ differs from $L$ by well under a millimetre, so</p>
$$y_n(s) \approx k_n\,L(s), \quad k_n = 1 - p - 2^{-n/12} . \tag{11}$$
<p>This is the central result. <strong>Every fret is the same profile $L(s)$, scaled by its own factor $k_n$.</strong> The nut is the case $n = 0$ ($k = -p$) and the bridge is $t = 1$ ($k = 1 - p$). Sliding $s$ from one board edge to the other traces each fret. At integer $s$ the virtual string is a real string, so the curve passes exactly through every real crossing.</p>

<h3>The perpendicular fret and the flip</h3>
<p>Along a fret, $x$ is linear in $s$ with slope $\delta_n = \delta_{\mathrm{nut}} + t_n(\delta_{\mathrm{br}} - \delta_{\mathrm{nut}})$, the string spacing at that fret. Differentiating (11) twice gives the fret's curvature:</p>
$$\frac{d^2 y_n}{dx^2} \approx \frac{k_n\,L''(s)}{\delta_n^{\,2}} . \tag{12}$$
<p>The shape across the board comes from $L''$, the same for every fret, and the sign and size come from $k_n$. The factor is zero, and the fret dead straight, at</p>
$$n_\perp = -12\,\log_2(1 - p) , \tag{13}$$
<p>which is the 12th fret for $p = \tfrac12$. Every fret on the nut side has $k_n &lt; 0$ and bends one way. Every fret on the bridge side has $k_n &gt; 0$ and bends the other way.</p>
<div class="ptable-wrap"><table class="ptable" data-live="ktable"></table></div>
<p>So the bow of a fret is proportional to how far it sits from the perpendicular line, as a fraction of the scale. With $p = \tfrac12$, fret 24 has $k = +0.25$ and fret 5 has $k \approx -0.25$: both are about a quarter of the scale from the octave, on opposite sides, so they bow by almost exactly the same amount in opposite directions. Moving the perpendicular to the nut ($p = 0$) makes the nut straight, and then every fret bends the same way, more and more toward the bridge.</p>
<blockquote class="pull"><p>The perpendicular fret is the fulcrum of a seesaw. Everything on the nut side bends one way. Everything on the bridge side bends the other.</p></blockquote>
<figure class="fig" data-fig="seesaw" data-open="acc8">
  <div class="fig-head"><span class="fig-no">Figure 3</span><span class="fig-title">The seesaw: scale factor $k_n$ and the frets it shapes</span></div>
  <div class="fig-body"></div>
  <figcaption>Drag the slider to move the perpendicular. <b>Top:</b> $k_n$ for the nut, frets 1–24 and the bridge. <b>Bottom:</b> the 8-string $g = 1.3$ board from Figure 1, recomputed live, with nut-side frets in ice blue and bridge-side frets in grey. The straight fret travels with $p$, and the curvature changes sign across it.</figcaption>
</figure>
<p>Between strings, $L(s)$ comes from the closed form wherever one exists. For a list of measured or hand-typed scales the designer uses a smooth cubic spline through the real lengths, with not-a-knot ends so the curvature isn't forced to zero at the outer strings. Each board edge is a straight line from the nut to the bridge, a fixed margin outside the outer string, and each fret simply continues past the outer string until it meets the edge.</p>
`},

{ id: 'family', title: 'The family of shapes', html: String.raw`
<p>Equation (12) says the shape of every fret is the shape of $L''(s)$. The recurrence can be anchored in several ways, and each gives a recognisable family. Figure 4 shows a member of each, drawn from the engine.</p>
<p>For the pivot modes we write $s_*$ for the pivot, the string index (possibly fractional, such as 3.5) where two halves meet, and use the step-sum</p>
$$S(d, g) = \frac{g^{\,d} - 1}{g - 1}, \qquad S(d, 1) = d . \tag{14}$$

<h3>Exponential: accelerating and decelerating</h3>
<p>A single series from one end: $L(s) = L_0 + a\,S(s, g)$. Its second derivative,</p>
$$L''(s) = a\,\frac{(\ln g)^2}{g-1}\,g^{\,s} , \tag{15}$$
<p>never changes sign, so every fret is a one-way bow. For $g &gt; 1$ (accelerating) the curvature grows toward the bass and the low strings get most of the extra length. For $g &lt; 1$ (decelerating) the profile is concave, the curvature is strongest on the treble side, and the big steps come first.</p>

<h3>Divergent (D-scale)</h3>
<p>One series grows <em>outward from the pivot</em> in both directions:</p>
$$L(s) = \begin{cases} L_* - a\,S(s_* - s,\ g), & s &lt; s_* \\ L_* + a\,S(s - s_*,\ g), & s \ge s_* \end{cases} \tag{16}$$
<p>With $g &gt; 1$ the steps are smallest at the pivot and grow toward both outer strings. The profile is concave on the treble side and convex on the bass side, so $L''$ changes sign at $s_*$ and every fret except the perpendicular has a single inflection there. Fitting the ends solves $a$ and the pivot string's scale $L_*$ together.</p>

<h3>Convergent (C-scale)</h3>
<p>Two series, one climbing from the treble string and one descending from the bass string, meet at the pivot:</p>
$$L(s) = \begin{cases} L_0 + a_T\,S(s,\ g_T), & s \le s_* \\ L_{N-1} - a_B\,S(N-1-s,\ g_B), & s &gt; s_* \end{cases} \tag{17}$$
<p>With growths above 1 the steps grow <em>toward</em> the pivot, so the board is steep in the middle and flattens toward both edges. That is the mirror image of the D-scale, and again each fret inflects once, at the pivot. Fitting the ends scales both scalars by the same factor so the halves meet. They join without a kink only when their slopes also match at the pivot, which happens automatically for a symmetric design.</p>

<h3>S-curve</h3>
<p>The general form: two series grow outward from the pivot, each with its own scalar and growth.</p>
$$L(s) = \begin{cases} L_* - a\,S(s_* - s,\ g_T), & s &lt; s_* \\ L_* + b\,S(s - s_*,\ g_B), & s \ge s_* \end{cases} \tag{18}$$
<p>When fitting the ends, the designer solves $a$ and $b$ from two conditions: the end scales are exact, and the slopes match at the pivot,</p>
$$a\,\frac{\ln g_T}{g_T - 1} = b\,\frac{\ln g_B}{g_B - 1} , \tag{19}$$
<p>so the inflection is smooth and lands exactly on $s_*$. The bass half is convex when $g_B &gt; 1$. The treble half is its mirror image and is concave when $g_T &gt; 1$. So</p>
$$\text{an S exists} \iff (g_T - 1)(g_B - 1) &gt; 0 , \tag{20}$$
<p>that is, when both growths sit on the same side of 1. Both above 1 gives the D-type S, flat in the middle and steep outside. Both below 1 gives the C-type S, steep in the middle. If one growth is above 1 and the other below, both halves bend the same way and the result is a single one-way bow with no inflection.</p>
<figure class="fig fig-wide" data-fig="profiles">
  <div class="fig-head"><span class="fig-no">Figure 4</span><span class="fig-title">Scale profiles of the five shapes</span></div>
  <div class="fig-body"></div>
  <figcaption>Scale length against string number (1 = treble), computed from each design's profile samples. The dashed line is the straight fan between the same ends, and the dashed vertical marks the pivot. Each panel opens in the designer.</figcaption>
</figure>

<h3>A C-scale with $g$ is an outward series with $1/g$</h3>
<p>Reading a geometric series backwards gives another geometric series. The steps $a, ag, \dots, ag^{m-1}$, read from the far end, are $ag^{m-1}$ times $1, g^{-1}, g^{-2}, \dots$. In terms of (14),</p>
$$a\,S(m, g) - a\,S(m-d, g) = a\,g^{\,m-1}\,S\!\left(d,\ \tfrac{1}{g}\right) , \tag{21}$$
<p>so the treble half of a C-scale climbing toward the pivot with growth $g$ is exactly an outward half with growth $1/g$ and scalar $ag^{m-1}$. C, D and S are one family. They differ only in which end you anchor and which numbers you type. As a live check, the 9-string C-scale with $g = 1.32$ and an S-curve with $g = 1/1.32 \approx 0.758$ per half, both fitted to the same ends and pivot, differ by at most <b class="live-num">{{cvs}} mm</b> on any string.</p>
<figure class="fig" data-fig="scurve" data-open="s12">
  <div class="fig-head"><span class="fig-no">Figure 5</span><span class="fig-title">Where the S turns: a 12-string S-curve</span></div>
  <div class="fig-body"></div>
  <figcaption>Fret map of a 12-string S-curve (25.5″–30″, pivot between strings 6 and 7, growth 0.88 per half). White dots mark every inflection point found by the engine, and the dashed line is the virtual string at the pivot. {{s12count}} of {{s12total}} frets inflect, all within {{s12off}} of a string of the pivot. The one that doesn't is the perpendicular fret, which is straight. Bows are exaggerated by default, so switch to true scale to see the board as built.</figcaption>
</figure>
`},

{ id: 'limits', title: 'Practical limits', html: String.raw`
<h3>String count</h3>
<p>Curvature needs room to show. The table below fixes the musical settings and changes only the number of strings. It reports the bow, or <em>sagitta</em>, of the first fret: the largest gap between the fret and a straight line from edge to edge. A medium fret crown is about 2.5&nbsp;mm wide, so a bow under 1&nbsp;mm reads as "nearly straight".</p>
<div class="ptable-wrap" data-live="sagtable"></div>
<p>Three things stand out. First, <strong>the tightest bend radius does not depend on string count</strong>. It is set by the growth and by the scale range per string. Second, the bow grows steadily as strings are added, roughly in proportion for these settings and a little faster for the C and S shapes, because the same curvature runs over a wider board. Third, the pivot shapes split the board in two. On six strings each half has only three strings and bows about a millimetre, which reads as a slight wobble rather than an S.</p>
<figure class="fig" data-fig="sagitta" data-open="s8">
  <div class="fig-head"><span class="fig-no">Figure 6</span><span class="fig-title">Bow of the first fret against string count</span></div>
  <div class="fig-body"></div>
  <figcaption>The same five settings from 3 to 14 strings, all computed now. The shaded band is under 1 mm. One-way exponential curves are clearly visible on six strings. The C and S shapes need about seven strings, and look their best from eight.</figcaption>
</figure>
<div class="callout"><b>Recommendation.</b> Any string count works, and one and two strings simply give straight frets. A one-way exponential curve is clearly visible on a 6-string. For S-curves, C-scales and D-scales, plan on <b>7 or more strings</b> (at least three on each side of the pivot), and ideally 8 or more.</div>

<h3>Growth</h3>
<p>Steps compound. On an 8-string board the last step is $g^6$ times the first: {{g13pow}}× at $g = 1.3$, but {{g145pow}}× at $g = 1.45$. Growth between 0.8 and 1.3 covers most practical work. From about 1.3 the curvature concentrates hard on the last few strings and gets severe, so the designer adds a note between 1.3 and 1.45 and a warning beyond that, and the same on the low side below 0.8 and 0.7.</p>

<h3>Fret-wire bend radius</h3>
<p>Sagitta says how curved a fret <em>looks</em>. Radius says whether you can <em>bend wire</em> to it. The designer reports the tightest radius along every fret from the true curvature. It flags radii under 100&nbsp;mm (pre-bend the wire on a jig), warns under 50&nbsp;mm and treats anything under 25&nbsp;mm as impractical. For the accelerating 8-string board of Figure 1 the tightest radius is {{acc8r}} mm, at fret {{acc8rf}}. With the perpendicular at the octave, the first fret is always the tightest because it has the largest $|k_n|$ (the nut is tighter still). Move the perpendicular to the nut and the tightest bend moves to the last fret.</p>

<h3>Cramped high frets</h3>
<p>Because adjacent frets are both copies of the same profile, their gap at any string is proportional to that string's scale. Frets never cross, and the tightest spacing is always on the shortest string. On a 25.5″ string frets 23 and 24 are {{sp2324}} mm apart. The designer warns when the last two frets come closer than 6&nbsp;mm, where slotting, levelling and playing all get difficult. In the upper register the frets also bow the opposite way to those near the nut. That matters when you plan the neck joint and any cutaway.</p>
`},

{ id: 'building', title: 'Building it', html: String.raw`
<h3>From file to slots</h3>
<p>Curved slots are a job for a CNC router. A straight fret saw in a mitre box cannot follow them. Export the design as <b>DXF</b> (R2000, millimetres, with OUTLINE, NUT, FRETS, STRINGS, CENTRE, BRIDGE and TEXT layers) for CAM. Every fret, the nut, the bridge line and the board end is a <i>single</i> smooth cubic spline that passes through every string crossing and stays within 0.001&nbsp;mm of the exact curve, so a trace or 2D-contour operation can follow each slot as one entity with a small end mill or slitting cutter sized to your fret tang. The board outline is a closed chain of four entities: nut curve, two straight edges and board-end curve. The 1:1 <b>SVG</b> carries the same curves as B&eacute;zier paths for laser templates and printing, but CAD programs split a path into one piece per B&eacute;zier segment, so use the DXF for toolpaths. Cut a test slot in scrap and check the fit before committing the board. On a radiused board, either project the toolpath onto the radius so the slot depth stays constant, or slot the blank flat before radiusing and allow for the depth you will remove.</p>

<h3>Bending the wire</h3>
<p>A curved fret needs two bends: the usual one that matches the fingerboard radius, and a sideways bend in the plane of the board that follows the slot. Pre-bend the sideways curve on a jig. A simple form can be cut from the same DXF as the board, slightly tighter than the slot to allow for spring-back. S-frets need two opposite bends, so mark the inflection point (the designer shows it) and work each half from there. Seat the wire and check that it sits fully home along its length. Gluing helps hold a fret that wants to spring back. Level and crown as usual.</p>

<h3>Nut, bridge and hardware</h3>
<p>The nut and the saddle line belong to the same family as the frets: the nut has $k = -p$ and the saddle line has $k = 1 - p$. Unless the perpendicular is at the nut, the nut is curved as strongly as the first frets. It can be cut to the curve on the CNC, or replaced by a curved zero fret followed by a string guide. On the bridge side, single-string bridges or individual saddles let every string sit on its own point of the saddle curve. Headless hardware with independent string units is a natural fit, because each unit can be placed and intonated on its own.</p>

<h3>Intonation</h3>
<p>The designer places the theoretical, uncompensated 12-TET positions: frets at $t_n$ and saddles at $t = 1$. Real strings need compensation. In general each saddle ends up slightly behind its theoretical point, by more on heavier strings. Set it with a tuner at the 12th fret, as on any guitar. Individual saddles make that per-string adjustment straightforward on a curved saddle line.</p>

<h3>The 1:1 template</h3>
<p>The <b>PDF</b> export starts with a cover page and a fret-position table, then tiles the board at 1:1 across Letter-landscape pages, in both directions if the board is wide. Tiles overlap by 15&nbsp;mm and carry dashed cut lines, registration marks, and a 100&nbsp;mm and a 4&nbsp;in check ruler. Print at 100&nbsp;% (actual size) and measure the rulers before you trust the print. Use the template to check CNC output, to mark out a hand-built board, or to make the fret-bending forms. The <b>CSV</b> export lists the distance from the nut along each string for every fret, in millimetres and inches.</p>
<div class="callout"><b>Before cutting:</b> read the designer's warnings panel. It checks scales, growth, bend radius, fret spacing and string count against the limits in Section 7.</div>
`},

{ id: 'use-cases', title: 'Use-case scenarios', html: String.raw`
<dl class="cases">
<dt>Extended-range guitars, 7 to 12 strings and beyond</dt>
<dd>The more strings, the wider the range of pitches sharing one neck, and the more a single scale has to compromise. Curved frets let the scale follow the strings: near-guitar scales on the treble side and substantially longer ones for the lowest strings. Since the curvature grows with string count, these are also the boards where the shapes read most clearly.</dd>
<dt>Balancing tension across a wide range</dt>
<dd>Equation (1) turns a target tension per string into a target scale per string. Those targets rarely step evenly, so a fan is only an approximation. Pick the shape whose profile best follows the targets, or type the scales into the Custom mode and let the designer find the closest formula.</dd>
<dt>Baritone and bass-VI hybrids</dt>
<dd>Instruments that span guitar and bass territory need a large total change in scale. An accelerating series spends most of that change on the lowest strings and keeps the upper strings close to a familiar baritone feel, rather than spreading it evenly across the neck.</dd>
<dt>Ergonomics: a comfortable fan at both ends</dt>
<dd>With the perpendicular placed mid-neck, the slant is shared between the nut and the high frets. Uneven steps add a choice of <em>where across the neck</em> the slant goes. With $g &gt; 1$ the treble strings, where most lead playing happens, stay nearly parallel and the fan is concentrated in the bass. With $g &lt; 1$ the reverse is true.</dd>
<dt>Aesthetics and signature instruments</dt>
<dd>A curved fret line is unmistakable. Because the shape comes from the scale profile and not from styling, it is a visual signature with a functional reason behind it, and the family of shapes leaves room for a builder to make one their own.</dd>
<dt>Experimental tunings</dt>
<dd>Unusual open tunings and wide intervals change which strings need more or less tension. Per-string scales let you set each one. A tuning tool such as Scala is useful for working out the pitches. Note that the designer places 12-TET frets, so microtonal fretting would change $t_n$, not the scale set.</dd>
<dt>Harp-guitar-like designs</dt>
<dd>Traditional harp guitars add unfretted sub-bass strings. A curved-fret board offers a different route to a very wide <em>fretted</em> range, with long scales on the lowest strings from an accelerating series and no limit on string count in the designer. Reach across the neck, not geometry, becomes the limit.</dd>
</dl>
`},

{ id: 'glossary', title: 'Glossary and references', html: String.raw`
<h3>Glossary</h3>
<dl class="glossary">
<dt>Scale length</dt><dd>Vibrating length of a string, nut to saddle, measured along the string.</dd>
<dt>Multiscale, fanned frets</dt><dd>A board where strings have different scale lengths, so the frets slant.</dd>
<dt>Perpendicular, $p$</dt><dd>The fraction along every string where the fret line is square to the neck. 0 is the nut, 1 is the bridge and ½ is the octave.</dd>
<dt>Scalar, $s$ or $a$</dt><dd>The first step of the recurrence, in millimetres.</dd>
<dt>Growth, $g$</dt><dd>The ratio between consecutive steps. 1 is a linear fan.</dd>
<dt>Fit to ends</dt><dd>Solving the scalar(s) so the outer strings land exactly on chosen scales.</dd>
<dt>Pivot, $s_*$</dt><dd>The string index, possibly fractional, where the two halves of a D, C or S design meet.</dd>
<dt>Virtual string</dt><dd>A string at a fractional index $s$, used to trace each fret smoothly between real strings.</dd>
<dt>Scale factor, $k_n$</dt><dd>$1 - p - 2^{-n/12}$. Every fret is the scale profile multiplied by this.</dd>
<dt>Second difference</dt><dd>$L_{i+1} - 2L_i + L_{i-1}$. Zero means straight frets, and its sign gives the direction of the bow.</dd>
<dt>Sagitta (bow)</dt><dd>The largest gap between a fret and its edge-to-edge chord.</dd>
<dt>Bend radius</dt><dd>The tightest radius of curvature along a fret, which decides whether wire can be bent to it.</dd>
<dt>Inflection</dt><dd>A point where a fret's curvature changes sign. An S-fret has one.</dd>
<dt>12-TET</dt><dd>Twelve-tone equal temperament. Fret $n$ is at $1 - 2^{-n/12}$ of the scale from the nut.</dd>
<dt>Compensation</dt><dd>Moving saddles (sometimes the nut) from their theoretical positions so real strings play in tune.</dd>
<dt>Inharmonicity</dt><dd>Overtones running sharp of whole-number multiples because of string stiffness.</dd>
</dl>
<h3>References</h3>
<ol class="refs">
<li><b>Twelve-tone equal temperament.</b> Fret $n$ divides the scale at $1 - 2^{-n/12}$ from the nut. Equivalently, each fret takes $1/17.817$ of the remaining length (the "rule of 18" is a rounded form of this constant, $1/(1 - 2^{-1/12}) \approx 17.817$).</li>
<li><b>Stiff-string inharmonicity.</b> Equation (2) is the standard result for a stiff string, as treated in N.&nbsp;H.&nbsp;Fletcher and T.&nbsp;D.&nbsp;Rossing, <i>The Physics of Musical Instruments</i> (Springer).</li>
<li><b>FretFind2D.</b> A web tool for designing fretboards, including multiscale and individually specified scales. The designer can import its share links and fit the imported scales to the formulas in this paper.</li>
<li><b>Scala.</b> Software for creating, analysing and archiving musical tunings and scales.</li>
<li><b>This designer's geometry engine.</b> Every figure and live number in this paper is computed by it, and its test suite checks the closed forms, the fits and the inflection placement described here.</li>
</ol>
<p class="colophon">Set in Newsreader and Inter Tight, with equations typeset by KaTeX. Figures are inline SVG computed in your browser.</p>
`},
];
