// render/post.js — the photographic post chain.
//   MSAA HDR render -> GTAO contact shading -> restrained bloom (only true
//   specular hot spots) -> optional macro depth of field -> finish: ACES tone
//   map, cool-graphite grade, optical vignette centred on the free viewport,
//   and a 1-LSB dither so the dark backdrop gradients never band.
// Quality ladder (drop order): GTAO -> bloom -> DPR -> composer.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';

// Hide helper meshes (overlays, the contact-shadow floor) and the backdrop
// from the extra G-buffer/depth renders: they must not occlude or cost a quad.
function withScene(scene, hide, fn) {
  const bg = scene.background, vis = [];
  scene.background = null;
  for (const o of hide) { vis.push(o.visible); o.visible = false; }
  try { fn(); } finally {
    scene.background = bg;
    hide.forEach((o, i) => { o.visible = vis[i]; });
  }
}
class AOPass extends GTAOPass {
  constructor(scene, camera, w, h, hide) { super(scene, camera, w, h); this.hide = hide; }
  // AO is low-frequency and denoised: compute it at half resolution.
  setSize(w, h) { super.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1)); }
  render(renderer, writeBuffer, readBuffer, dt, mask) {
    withScene(this.scene, this.hide, () => super.render(renderer, writeBuffer, readBuffer, dt, mask));
  }
}
class DoFPass extends BokehPass {
  constructor(scene, camera, params, hide) { super(scene, camera, params); this.hide = hide; }
  render(renderer, writeBuffer, readBuffer, dt, mask) {
    withScene(this.scene, this.hide, () => super.render(renderer, writeBuffer, readBuffer, dt, mask));
  }
}

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.3 },
    uGrade: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uExposure, uVignette, uGrade;
    uniform vec2 uCenter, uAspect;
    varying vec2 vUv;
    // Khronos PBR Neutral: near-linear through the mids (albedo reads true, as
    // in product photography), soft highlight shoulder, minimal shadow toe.
    vec3 cfdNeutral(vec3 color) {
      const float startC = 0.8 - 0.04, desat = 0.15;
      color *= uExposure;
      float x = min(color.r, min(color.g, color.b));
      float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
      color -= off;
      float peak = max(color.r, max(color.g, color.b));
      if (peak < startC) return color;
      float dd = 1.0 - startC;
      float newPeak = 1.0 - dd * dd / (peak + dd - startC);
      color *= newPeak / peak;
      float gg = 1.0 - 1.0 / (desat * (peak - startC) + 1.0);
      return mix(color, vec3(newPeak), gg);
    }
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // optical vignette (natural cos^4-like fall-off), centred on the free viewport
      vec2 d = (vUv - uCenter) * uAspect;
      c *= 1.0 - uVignette * smoothstep(0.2, 1.05, length(d));
      c = clamp(cfdNeutral(c), 0.0, 1.0);
      // grade: cool graphite shadows, neutral highlights, a touch less saturation
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 g = mix(vec3(l), c, 0.88);
      g *= mix(vec3(0.975, 0.995, 1.03), vec3(1.0, 0.997, 0.99), smoothstep(0.0, 0.25, l));
      c = toSRGB(clamp(mix(c, g, uGrade), 0.0, 1.0));
      // gentle photographic S in display space (pivot at mid-grey)
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.18 * uGrade);
      c += (hash(gl_FragCoord.xy) + hash(gl_FragCoord.yx + 17.0) - 1.0) / 255.0;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export function createPost(renderer, scene, camera, { hide = [] } = {}) {
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const ao = new AOPass(scene, camera, 4, 4, hide);
  // Scene units are millimetres: a 5 mm radius gives contact darkening where
  // fret wire meets wood, under saddles and along the board/body joint,
  // without greying the open board.
  ao.updateGtaoMaterial({ radius: 5.5, distanceExponent: 1.4, thickness: 2.5, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: 8 });
  ao.blendIntensity = 0.85;
  composer.addPass(ao);

  // Bloom only for true specular hot spots (direct-light glints on metal),
  // at half resolution: it is a blur, and full-res mips cost more than the scene.
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.1, 0.2, 6.0);
  // Clamp what feeds the bloom so a single direct-light glint cannot flood a
  // halo across the frame; the tone mapper handles the core itself.
  bloom.materialHighPassFilter.fragmentShader = bloom.materialHighPassFilter.fragmentShader
    .replace('gl_FragColor = mix( outputColor, texel, alpha );', 'gl_FragColor = mix( outputColor, min( texel, vec4( 9.0 ) ), alpha );');
  bloom.materialHighPassFilter.needsUpdate = true;
  const bloomSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => bloomSetSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
  composer.addPass(bloom);

  const dof = new DoFPass(scene, camera, { focus: 300, aperture: 0.000012, maxblur: 0.0035 }, hide);
  dof.enabled = false;
  composer.addPass(dof);

  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);

  let W = 4, H = 4;
  return {
    composer, ao, bloom, dof, finish,
    setSize(w, h, dpr) {
      W = w; H = h;
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
      finish.uniforms.uAspect.value.set(w / Math.max(w, h) * 1.25, h / Math.max(w, h) * 1.25);
    },
    // Centre of the free viewport (between the panels) in UV space.
    setCenter(cx, cy) { finish.uniforms.uCenter.value.set(cx / W, 1 - cy / H); },
    setExposure(e) { finish.uniforms.uExposure.value = e; },
    setQuality(q) { ao.enabled = q >= 3; bloom.enabled = q >= 2; },
    render() { composer.render(); },
    dispose() { ao.dispose(); dof.renderTargetDepth?.dispose(); composer.dispose?.(); rt.dispose(); },
  };
}
