// render/contact.js — soft contact shadow on an invisible floor.
// The instrument is rendered from below into a small depth-darkness target
// (closer to the floor = darker), blurred twice, and laid on a transparent
// plane. It is only re-rendered when the geometry moves (rebuilds, tweens,
// the intro), so it costs nothing while the camera orbits.
import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

export function createContactShadow(renderer, { size = 512, height = 48, darkness = 1.25, opacity = 0.92, blur = 2.6 } = {}) {
  const group = new THREE.Group();
  const rt = new THREE.WebGLRenderTarget(size, size); rt.texture.generateMipmaps = false;
  const rtBlur = new THREE.WebGLRenderTarget(size, size); rtBlur.texture.generateMipmaps = false;
  let geo = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: rt.texture, transparent: true, opacity, depthWrite: false, color: 0x000000 });
  // Texture alpha carries the shadow; colour stays black.
  mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', 'diffuseColor.a *= texture2D( map, vMapUv ).a;'); };
  const plane = new THREE.Mesh(geo, mat);
  plane.scale.y = -1; plane.renderOrder = -1; plane.castShadow = false; plane.receiveShadow = false;
  group.add(plane);
  const blurPlane = new THREE.Mesh(geo); blurPlane.visible = false; group.add(blurPlane);
  const cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, height);
  cam.rotation.x = Math.PI / 2; group.add(cam);

  const depthMat = new THREE.MeshDepthMaterial();
  depthMat.userData.darkness = { value: darkness };
  depthMat.onBeforeCompile = sh => {
    sh.uniforms.darkness = depthMat.userData.darkness;
    sh.fragmentShader = 'uniform float darkness;\n' + sh.fragmentShader.replace(
      'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
      'gl_FragColor = vec4( vec3( 0.0 ), pow( 1.0 - fragCoordZ, 1.6 ) * darkness );');
  };
  depthMat.depthTest = false; depthMat.depthWrite = false;
  const hMat = new THREE.ShaderMaterial(HorizontalBlurShader); hMat.depthTest = false;
  const vMat = new THREE.ShaderMaterial(VerticalBlurShader); vMat.depthTest = false;

  let w = 1, d = 1;
  function blurPass(amount) {
    blurPlane.visible = true;
    blurPlane.material = hMat; hMat.uniforms.tDiffuse.value = rt.texture; hMat.uniforms.h.value = amount / 256;
    renderer.setRenderTarget(rtBlur); renderer.render(blurPlane, cam);
    blurPlane.material = vMat; vMat.uniforms.tDiffuse.value = rtBlur.texture; vMat.uniforms.v.value = amount / 256 * (w / d);
    renderer.setRenderTarget(rt); renderer.render(blurPlane, cam);
    blurPlane.visible = false;
  }
  return {
    group, plane,
    // Footprint in world units (x, z extents) and the floor height.
    setFootprint(cx, cz, width, depth, floorY) {
      w = width; d = depth;
      group.position.set(cx, floorY, cz);
      const g = new THREE.PlaneGeometry(width, depth).rotateX(Math.PI / 2);
      plane.geometry = g; blurPlane.geometry = g; geo.dispose(); geo = g;
      Object.assign(cam, { left: -width / 2, right: width / 2, top: depth / 2, bottom: -depth / 2 });
      cam.updateProjectionMatrix();
    },
    render(scene, hide = []) {
      const bg = scene.background, vis = hide.map(o => o.visible), pv = plane.visible;
      scene.background = null; hide.forEach(o => { o.visible = false; }); plane.visible = false;
      const clearAlpha = renderer.getClearAlpha(), clearColor = renderer.getClearColor(new THREE.Color());
      const shadowAuto = renderer.shadowMap.autoUpdate, shadowNeeds = renderer.shadowMap.needsUpdate;
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
      renderer.setClearColor(0x000000, 0);
      scene.overrideMaterial = depthMat;
      renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam);
      scene.overrideMaterial = null;
      blurPass(blur);
      blurPass(blur * 0.45);
      renderer.setRenderTarget(null);
      renderer.setClearColor(clearColor, clearAlpha);
      renderer.shadowMap.autoUpdate = shadowAuto; renderer.shadowMap.needsUpdate = shadowNeeds;
      scene.background = bg; hide.forEach((o, i) => { o.visible = vis[i]; }); plane.visible = pv;
    },
    dispose() { rt.dispose(); rtBlur.dispose(); geo.dispose(); mat.dispose(); depthMat.dispose(); hMat.dispose(); vMat.dispose(); },
  };
}
