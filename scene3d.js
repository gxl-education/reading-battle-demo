// ============================================================
// 3D 对战场景（升级版）
// ------------------------------------------------------------
// 新增：
//   - 飘落的花瓣 / 光点 大气层
//   - 攻击：蓄力光圈 + 拖尾 + 剑光弧线 + 撞击爆炸 + 镜头震动
//   - 怪兽受击：闪白 + 伤害数字飘出 + 碎裂粒子
//   - 怪兽攻击：变红蓄力 + 暗影波 + 镜头震
//   - 怪兽倒下：旋转 + 散开向上飘
//   - 玩家庆祝：跳跃 + 头顶星星 + 转圈
//   - 能量满：金色光环
//   - 读对：⭐ 从天上掉
// ============================================================

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

let scene, camera, renderer, clock;
let player, monster, ground;
let ambientParticles = []; // 飘落的花瓣 / 光点
let fxParticles = [];      // 临时特效粒子
let floatTexts = [];       // 飘字（伤害数字 / +1 之类）
let trail = [];            // 玩家攻击拖尾
let animations = [];
let rafId = null;
let canvasEl = null;
let resizeObs = null;
let monsterTheme = { primary: '#7ed957', accent: '#ffe66d', eye: '#2d4a1f' };
let cameraShake = { strength: 0, decay: 0 };
let energyAura = null; // 满能量光环

// ----------------- 工具 -----------------
function tween(obj, prop, from, to, duration, easing = (t) => t) {
  const start = performance.now();
  return new Promise((resolve) => {
    animations.push({
      tick() {
        const t = Math.min(1, (performance.now() - start) / (duration * 1000));
        obj[prop] = from + (to - from) * easing(t);
        if (t >= 1) { resolve(); return false; }
        return true;
      }
    });
  });
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeInBack = (t) => { const c1 = 1.70158; const c3 = c1 + 1; return c3 * t * t * t - c1 * t * t; };

function shake(strength = 0.15, durationS = 0.4) {
  cameraShake.strength = strength;
  cameraShake.decay = strength / durationS;
}

// ----------------- 飘字（伤害数字之类） -----------------
function makeTextSprite(text, color = '#ff4d6d', size = 96) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${size}px "ZCOOL KuaiLe", "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#fff';
  ctx.strokeText(text, 128, 64);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.2, 0.6, 1);
  return sprite;
}

function spawnFloatText(text, position, color = '#ff4d6d') {
  const s = makeTextSprite(text, color);
  s.position.copy(position);
  s.userData = { life: 0, maxLife: 1.0, vy: 1.5 };
  scene.add(s);
  floatTexts.push(s);
}

// ----------------- 粒子工厂 -----------------
function spawnBurst(position, color, count = 24, opts = {}) {
  const {
    spread = 2,
    upwardBias = 0.5,
    gravity = 6,
    size = 0.1,
    life = 0.7
  } = opts;
  const geo = new THREE.SphereGeometry(size, 8, 8);
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: typeof color === 'function' ? color() : color,
      transparent: true, opacity: 1
    });
    const p = new THREE.Mesh(geo, mat);
    p.position.copy(position);
    p.position.x += (Math.random() - 0.5) * 0.3;
    p.position.y += (Math.random() - 0.5) * 0.3;
    p.position.z += (Math.random() - 0.5) * 0.3;
    p.userData = {
      vx: (Math.random() - 0.5) * spread,
      vy: Math.random() * spread + upwardBias,
      vz: (Math.random() - 0.5) * spread,
      gravity,
      life: 0,
      maxLife: life * (0.7 + Math.random() * 0.6),
      spin: (Math.random() - 0.5) * 6,
      sizeScale: 0.7 + Math.random() * 0.6
    };
    p.scale.setScalar(p.userData.sizeScale);
    scene.add(p);
    fxParticles.push(p);
  }
}

// 星形粒子（庆祝用）
function makeStarSprite(color = '#ffd166') {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.translate(32, 32);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    const x = Math.cos(a) * 26;
    const y = Math.sin(a) * 26;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    const a2 = a + Math.PI / 5;
    ctx.lineTo(Math.cos(a2) * 11, Math.sin(a2) * 11);
  }
  ctx.closePath();
  ctx.shadowColor = color; ctx.shadowBlur = 12;
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  return new THREE.Sprite(mat);
}

function spawnStarRain(centerPos, count = 8) {
  for (let i = 0; i < count; i++) {
    const s = makeStarSprite('#ffd166');
    s.position.set(
      centerPos.x + (Math.random() - 0.5) * 1.5,
      centerPos.y + 3 + Math.random() * 1,
      centerPos.z + (Math.random() - 0.5) * 0.5
    );
    const targetY = centerPos.y;
    const fallTime = 0.7 + Math.random() * 0.4;
    s.scale.setScalar(0.5);
    scene.add(s);
    floatTexts.push({
      // 复用 floatTexts 的更新逻辑
      isSprite: true,
      sprite: s,
      userData: { life: 0, maxLife: fallTime, vy: -(s.position.y - targetY) / fallTime },
      get position() { return s.position; },
      get material() { return s.material; }
    });
    // 实际加入 floatTexts 处理
  }
}

// 简化：用 fxParticles 系统跑星星雨更稳
function dropStar(targetPos) {
  const star = makeStarSprite('#ffd166');
  star.position.set(
    targetPos.x + (Math.random() - 0.5) * 2,
    targetPos.y + 3.5,
    targetPos.z + (Math.random() - 0.5) * 0.5
  );
  star.scale.setScalar(0.4);
  star.userData = {
    isStar: true,
    targetY: targetPos.y,
    startY: star.position.y,
    life: 0,
    maxLife: 0.8,
    rotation: 0
  };
  scene.add(star);
  fxParticles.push(star);
}

// ----------------- 环境粒子（飘花瓣 + 光点） -----------------
function spawnAmbient() {
  // 花瓣
  for (let i = 0; i < 18; i++) {
    const colors = ['#ffb3d1', '#ffd6e0', '#fff0a8', '#c8f0c8'];
    const geo = new THREE.PlaneGeometry(0.15, 0.1);
    const mat = new THREE.MeshBasicMaterial({
      color: colors[i % colors.length],
      transparent: true, opacity: 0.85,
      side: THREE.DoubleSide
    });
    const p = new THREE.Mesh(geo, mat);
    p.position.set(
      (Math.random() - 0.5) * 12,
      Math.random() * 6 + 2,
      (Math.random() - 0.5) * 4 - 1
    );
    p.userData = {
      type: 'petal',
      vy: -0.3 - Math.random() * 0.3,
      vx: (Math.random() - 0.5) * 0.2,
      spinX: (Math.random() - 0.5) * 2,
      spinZ: (Math.random() - 0.5) * 2
    };
    scene.add(p);
    ambientParticles.push(p);
  }
  // 光点
  for (let i = 0; i < 12; i++) {
    const geo = new THREE.SphereGeometry(0.06, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfff2c8,
      transparent: true, opacity: 0.7
    });
    const p = new THREE.Mesh(geo, mat);
    p.position.set(
      (Math.random() - 0.5) * 10,
      Math.random() * 5 + 1,
      (Math.random() - 0.5) * 3
    );
    p.userData = {
      type: 'spark',
      phase: Math.random() * Math.PI * 2,
      basePos: p.position.clone()
    };
    scene.add(p);
    ambientParticles.push(p);
  }
}

// ----------------- 拖尾 -----------------
function spawnTrailNode(position, color = 0x4a90e2) {
  const geo = new THREE.SphereGeometry(0.18, 10, 10);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(position);
  m.userData = { life: 0, maxLife: 0.35 };
  scene.add(m);
  trail.push(m);
}

// ----------------- 角色构造（与原版相同基础上加了几处） -----------------
function buildPlayer() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a90e2, roughness: 0.55 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 24), bodyMat);
  body.position.y = 0.55; body.scale.y = 1.1;
  group.add(body);

  // 披风
  const capeMat = new THREE.MeshStandardMaterial({ color: 0xe94f64, roughness: 0.7, side: THREE.DoubleSide });
  const cape = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.9, 16, 1, true), capeMat);
  cape.position.set(0, 0.6, -0.25);
  cape.rotation.x = 0.15;
  group.add(cape);
  group.userData.cape = cape;

  const headMat = new THREE.MeshStandardMaterial({ color: 0xfde7c8, roughness: 0.5 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 24), headMat);
  head.position.y = 1.35; group.add(head);

  // 帽子
  const hatMat = new THREE.MeshStandardMaterial({ color: 0xe94f64, roughness: 0.55 });
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.55, 24), hatMat);
  hat.position.y = 1.85; group.add(hat);
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
  pom.position.y = 2.15; group.add(pom);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), eyeMat);
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.13, 1.4, 0.38); eyeR.position.set(0.13, 1.4, 0.38);
  group.add(eyeL, eyeR);

  const cheekMat = new THREE.MeshStandardMaterial({ color: 0xff9ec7, transparent: true, opacity: 0.6 });
  const cheekL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), cheekMat);
  const cheekR = cheekL.clone();
  cheekL.position.set(-0.22, 1.28, 0.34); cheekR.position.set(0.22, 1.28, 0.34);
  group.add(cheekL, cheekR);

  const armMat = bodyMat.clone();
  const armL = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), armMat);
  const armR = armL.clone();
  armL.position.set(-0.5, 0.75, 0.1); armR.position.set(0.5, 0.75, 0.1);
  group.add(armL, armR);

  // 剑
  const sword = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xe8eef7, metalness: 0.7, roughness: 0.25, emissive: 0x4a90e2, emissiveIntensity: 0.2 }));
  blade.position.y = 0.35;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xc9a227 }));
  sword.add(blade, guard);
  sword.position.set(0.55, 0.85, 0.25);
  sword.rotation.z = -0.3;
  group.add(sword);
  group.userData.sword = sword;
  group.userData.blade = blade;

  group.position.set(-2.2, 0, 0);
  group.userData.basePos = group.position.clone();
  return group;
}

function buildMonster(theme) {
  const group = new THREE.Group();
  const primary = new THREE.Color(theme.primary);
  const accent = new THREE.Color(theme.accent);

  const bodyMat = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.85, 28, 28), bodyMat);
  body.position.y = 0.85; body.scale.set(1.2, 1.05, 1.2);
  group.add(body);

  for (let i = 0; i < 3; i++) {
    const angle = (i - 1) * 0.5;
    const horn = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.35, 12),
      new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4 })
    );
    horn.position.set(Math.sin(angle) * 0.45, 1.65, Math.cos(angle) * 0.45 - 0.1);
    horn.rotation.z = angle * 0.6;
    group.add(horn);
  }

  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.eye) });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 18), whiteMat);
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.28, 1.15, 0.65); eyeR.position.set(0.28, 1.15, 0.65);
  const pupL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), pupilMat);
  const pupR = pupL.clone();
  pupL.position.set(-0.28, 1.15, 0.82); pupR.position.set(0.28, 1.15, 0.82);
  group.add(eyeL, eyeR, pupL, pupR);
  group.userData.pupils = [pupL, pupR];

  const mouth = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0x3a1f1f })
  );
  mouth.position.set(0, 0.78, 0.78); mouth.scale.set(1.4, 0.6, 0.6);
  group.add(mouth);

  const legMat = new THREE.MeshStandardMaterial({ color: primary.clone().multiplyScalar(0.7) });
  const legL = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), legMat);
  const legR = legL.clone();
  legL.position.set(-0.42, 0.2, 0.15); legR.position.set(0.42, 0.2, 0.15);
  group.add(legL, legR);

  group.position.set(2.2, 0, 0);
  group.userData.basePos = group.position.clone();
  group.userData.bodyMat = bodyMat;
  return group;
}

function buildGround() {
  const geo = new THREE.CircleGeometry(7, 48);
  const mat = new THREE.MeshStandardMaterial({ color: 0xeaf7e6, roughness: 0.95 });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2; m.position.y = 0;

  // 小草丛
  const grass = new THREE.Group();
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 4;
    const blade = new THREE.Mesh(
      new THREE.ConeGeometry(0.04, 0.25 + Math.random() * 0.15, 5),
      new THREE.MeshStandardMaterial({ color: 0x6fb35e + Math.random() * 0x101010 })
    );
    blade.position.set(Math.cos(a) * r, 0.12, Math.sin(a) * r);
    blade.rotation.z = (Math.random() - 0.5) * 0.3;
    grass.add(blade);
  }
  const ground = new THREE.Group();
  ground.add(m);
  ground.add(grass);
  return ground;
}

function buildEnergyAura() {
  // 玩家脚下的光环（满能量时显示）
  const geo = new THREE.RingGeometry(0.7, 0.95, 32);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffd166, transparent: true, opacity: 0, side: THREE.DoubleSide
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  return ring;
}

// ----------------- 主循环 -----------------
function loop() {
  rafId = requestAnimationFrame(loop);
  const dt = clock.getDelta();
  const t = clock.elapsedTime;

  if (player) {
    player.position.y = Math.sin(t * 2) * 0.05;
    player.rotation.y = Math.sin(t * 0.7) * 0.1;
    // 披风轻摆
    if (player.userData.cape) {
      player.userData.cape.rotation.z = Math.sin(t * 1.8) * 0.08;
    }
    // 能量光环跟随
    if (energyAura) {
      energyAura.position.x = player.position.x;
      energyAura.position.z = player.position.z;
      energyAura.rotation.z += dt * 1.2;
      energyAura.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
    }
  }
  if (monster) {
    monster.position.y = Math.sin(t * 1.5 + 1) * 0.08;
    monster.rotation.y = Math.sin(t * 0.5) * 0.08;
    const pupils = monster.userData.pupils;
    if (pupils && player) {
      const dir = player.position.clone().sub(monster.position).normalize();
      pupils.forEach((p, idx) => {
        p.position.x = (idx === 0 ? -0.28 : 0.28) + dir.x * 0.04;
        p.position.y = 1.15 + dir.y * 0.04;
      });
    }
  }

  // 环境粒子
  ambientParticles.forEach((p) => {
    if (p.userData.type === 'petal') {
      p.position.y += p.userData.vy * dt;
      p.position.x += p.userData.vx * dt;
      p.rotation.x += p.userData.spinX * dt;
      p.rotation.z += p.userData.spinZ * dt;
      if (p.position.y < -0.5) {
        p.position.y = 6 + Math.random() * 2;
        p.position.x = (Math.random() - 0.5) * 12;
      }
    } else if (p.userData.type === 'spark') {
      p.position.y = p.userData.basePos.y + Math.sin(t * 1.5 + p.userData.phase) * 0.4;
      p.position.x = p.userData.basePos.x + Math.cos(t * 0.8 + p.userData.phase) * 0.3;
      p.material.opacity = 0.4 + Math.sin(t * 3 + p.userData.phase) * 0.3;
    }
  });

  // FX 粒子
  fxParticles = fxParticles.filter((p) => {
    p.userData.life += dt;
    const lifeT = p.userData.life / p.userData.maxLife;
    if (p.userData.isStar) {
      // 星星下落
      const u = easeOut(lifeT);
      p.position.y = p.userData.startY + (p.userData.targetY - p.userData.startY) * u;
      p.material.rotation = (p.material.rotation || 0) + dt * 4;
      p.material.opacity = lifeT < 0.7 ? 1 : 1 - (lifeT - 0.7) / 0.3;
      p.scale.setScalar(0.4 + lifeT * 0.4);
    } else {
      p.position.x += p.userData.vx * dt;
      p.position.y += p.userData.vy * dt;
      p.position.z += p.userData.vz * dt;
      p.userData.vy -= (p.userData.gravity || 6) * dt;
      p.rotation.x += (p.userData.spin || 0) * dt;
      p.material.opacity = 1 - lifeT;
      p.scale.setScalar(p.userData.sizeScale * (1 - lifeT * 0.4));
    }
    if (lifeT >= 1) {
      scene.remove(p);
      p.geometry && p.geometry.dispose();
      p.material && p.material.dispose();
      return false;
    }
    return true;
  });

  // 拖尾衰减
  trail = trail.filter((m) => {
    m.userData.life += dt;
    const u = m.userData.life / m.userData.maxLife;
    m.material.opacity = 0.7 * (1 - u);
    m.scale.setScalar(1 - u * 0.5);
    if (u >= 1) {
      scene.remove(m);
      m.geometry.dispose(); m.material.dispose();
      return false;
    }
    return true;
  });

  // 飘字
  floatTexts = floatTexts.filter((s) => {
    s.userData.life += dt;
    const u = s.userData.life / s.userData.maxLife;
    s.position.y += s.userData.vy * dt;
    s.material.opacity = 1 - u;
    s.scale.setScalar(1.2 * (1 - u * 0.3));
    if (u >= 1) {
      scene.remove(s);
      s.material.map && s.material.map.dispose();
      s.material.dispose();
      return false;
    }
    return true;
  });

  // 补间
  animations = animations.filter((a) => a.tick(dt));

  // 镜头震动
  if (cameraShake.strength > 0.001) {
    camera.position.x += (Math.random() - 0.5) * cameraShake.strength;
    camera.position.y += (Math.random() - 0.5) * cameraShake.strength;
    cameraShake.strength = Math.max(0, cameraShake.strength - cameraShake.decay * dt);
  }
  // 镜头基础位置稳定
  camera.lookAt(0, 1, 0);

  renderer.render(scene, camera);
}

// ----------------- 公共 API -----------------
export function init(canvas, opts = {}) {
  canvasEl = canvas;
  monsterTheme = opts.monsterTheme || monsterTheme;

  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 320;

  scene = new THREE.Scene();
  // 天空渐变背景（双色 sphere）
  const skyGeo = new THREE.SphereGeometry(50, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0xa8d8ff) },
      bottomColor: { value: new THREE.Color(0xfff0d6) }
    },
    vertexShader: `varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vPos; uniform vec3 topColor; uniform vec3 bottomColor;
      void main() {
        float h = normalize(vPos).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, smoothstep(-0.1, 0.8, h)), 1.0);
      }`
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(0xcbe6ff, 10, 22);

  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
  camera.position.set(0, 2.4, 6.5);
  camera.lookAt(0, 1, 0);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const dir = new THREE.DirectionalLight(0xfff2d6, 1.0);
  dir.position.set(3, 6, 4); scene.add(dir);
  const rim = new THREE.DirectionalLight(0xa8c4ff, 0.5);
  rim.position.set(-3, 2, -3); scene.add(rim);

  // 远景小山
  for (let i = 0; i < 5; i++) {
    const hill = new THREE.Mesh(
      new THREE.SphereGeometry(1.5 + Math.random() * 0.8, 12, 12),
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.3 + Math.random() * 0.1, 0.5, 0.65) })
    );
    hill.position.set((i - 2) * 2.2, -0.5, -4 - Math.random() * 2);
    hill.scale.y = 0.4;
    scene.add(hill);
  }
  // 远处云朵
  for (let i = 0; i < 4; i++) {
    const cloud = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.5 + Math.random() * 0.3, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 })
      );
      puff.position.set(j * 0.55, Math.random() * 0.2, 0);
      cloud.add(puff);
    }
    cloud.position.set(-5 + i * 3 + Math.random(), 4 + Math.random(), -6);
    scene.add(cloud);
  }

  ground = buildGround();
  scene.add(ground);

  player = buildPlayer();
  scene.add(player);

  monster = buildMonster(monsterTheme);
  scene.add(monster);

  energyAura = buildEnergyAura();
  scene.add(energyAura);

  spawnAmbient();

  clock = new THREE.Clock();
  loop();

  const onResize = () => {
    if (!canvasEl) return;
    const ww = canvasEl.clientWidth;
    const hh = canvasEl.clientHeight;
    if (ww === 0 || hh === 0) return;
    camera.aspect = ww / hh; camera.updateProjectionMatrix();
    renderer.setSize(ww, hh, false);
  };
  resizeObs = new ResizeObserver(onResize);
  resizeObs.observe(canvas);
  window.addEventListener('resize', onResize);
}

export function setMonsterTheme(theme) {
  if (!monster) return;
  monsterTheme = theme;
  monster.userData.bodyMat.color = new THREE.Color(theme.primary);
}

// 玩家攻击：超绚烂版
export async function playerAttack() {
  if (!player || !monster) return;
  const base = player.userData.basePos;

  // 1. 蓄力：脚下扩散光圈
  for (let i = 0; i < 2; i++) {
    spawnBurst(
      new THREE.Vector3(base.x, 0.1, 0),
      0xfff2c8,
      14,
      { spread: 1.5, upwardBias: 0.2, gravity: -3, size: 0.08, life: 0.4 }
    );
    await new Promise((r) => setTimeout(r, 80));
  }

  // 2. 蹲一下
  await tween(player.position, 'x', base.x, base.x - 0.4, 0.18, easeOut);

  // 3. 冲过去 + 拖尾
  const dashStart = performance.now();
  const dashDuration = 0.28;
  const targetX = monster.position.x - 1.0;
  await new Promise((resolve) => {
    animations.push({
      tick() {
        const t = Math.min(1, (performance.now() - dashStart) / (dashDuration * 1000));
        player.position.x = base.x - 0.4 + (targetX - (base.x - 0.4)) * easeOut(t);
        // 撒拖尾
        if (Math.random() < 0.7) {
          spawnTrailNode(
            new THREE.Vector3(player.position.x, 0.6 + Math.random() * 0.5, 0),
            0x4a90e2
          );
        }
        if (t >= 1) { resolve(); return false; }
        return true;
      }
    });
  });

  // 4. 挥剑 + 剑光
  const sword = player.userData.sword;
  const blade = player.userData.blade;
  if (sword && blade) {
    // 剑发光增强
    const origIntensity = blade.material.emissiveIntensity;
    blade.material.emissiveIntensity = 1.5;
    tween(sword.rotation, 'z', -0.3, -1.8, 0.15, easeOut)
      .then(() => {
        tween(sword.rotation, 'z', -1.8, -0.3, 0.2, easeOut);
        blade.material.emissiveIntensity = origIntensity;
      });
  }

  // 5. 撞击爆炸（多层）
  const hitPos = monster.position.clone().add(new THREE.Vector3(0, 0.8, 0));
  spawnBurst(hitPos, new THREE.Color(monsterTheme.accent), 28, { spread: 3, upwardBias: 0.8, size: 0.12, life: 0.7 });
  spawnBurst(hitPos, 0xffffff, 16, { spread: 4, upwardBias: 0.3, size: 0.08, life: 0.4 });
  spawnBurst(hitPos, 0xffd166, 12, { spread: 2.5, upwardBias: 1.2, size: 0.1, life: 0.9 });

  // 6. 镜头震
  shake(0.2, 0.3);

  // 等一下让爆炸看到
  await new Promise((r) => setTimeout(r, 100));

  // 7. 退回
  await tween(player.position, 'x', targetX, base.x, 0.32, easeOut);
}

export async function monsterHurt(hpRatio, damage = 1) {
  if (!monster) return;
  const mat = monster.userData.bodyMat;
  const orig = mat.color.clone();

  // 闪白
  mat.color.set(0xffffff);
  setTimeout(() => mat.color.copy(orig), 140);

  // 伤害数字
  spawnFloatText(
    `-${damage}`,
    monster.position.clone().add(new THREE.Vector3(0.3, 1.8, 0)),
    '#ff3355'
  );

  // 晃动
  const baseX = monster.userData.basePos.x;
  await tween(monster.position, 'x', baseX, baseX + 0.3, 0.08);
  await tween(monster.position, 'x', baseX + 0.3, baseX - 0.2, 0.08);
  await tween(monster.position, 'x', baseX - 0.2, baseX, 0.08);

  // 按剩余血缩小
  const targetScale = 0.55 + 0.45 * Math.max(0, hpRatio);
  await tween(monster.scale, 'x', monster.scale.x, targetScale, 0.3, easeOut);
  monster.scale.y = monster.scale.z = targetScale;
}

export async function monsterAttack() {
  if (!monster || !player) return;
  const base = monster.userData.basePos;
  const mat = monster.userData.bodyMat;
  const orig = mat.color.clone();

  // 蓄力：变红 + 抖动
  mat.color.set(0xff4455);
  for (let i = 0; i < 3; i++) {
    monster.position.x = base.x + (Math.random() - 0.5) * 0.1;
    await new Promise((r) => setTimeout(r, 80));
  }

  // 暗影波（黑紫色粒子向玩家方向喷射）
  for (let i = 0; i < 12; i++) {
    spawnBurst(
      monster.position.clone().add(new THREE.Vector3(-0.5, 1, 0)),
      new THREE.Color(0x6a3a8a),
      4,
      { spread: 1, upwardBias: 0.3, gravity: 0, size: 0.14, life: 0.5 }
    );
    await new Promise((r) => setTimeout(r, 30));
  }

  // 冲过来
  const target = player.position.x + 1.2;
  await tween(monster.position, 'x', base.x, target, 0.22, easeOut);
  mat.color.copy(orig);

  // 玩家受击
  shake(0.25, 0.4);
  spawnBurst(
    player.position.clone().add(new THREE.Vector3(0, 1, 0)),
    new THREE.Color(0xff4d4d),
    20,
    { spread: 2.5, upwardBias: 1, size: 0.12, life: 0.6 }
  );
  spawnFloatText('-1 ❤', player.position.clone().add(new THREE.Vector3(0, 2, 0)), '#ff3355');

  // 玩家被推开
  const pb = player.userData.basePos;
  tween(player.position, 'x', pb.x, pb.x - 0.5, 0.1, easeOut)
    .then(() => tween(player.position, 'x', pb.x - 0.5, pb.x, 0.3, easeOut));

  // 怪兽退回
  await tween(monster.position, 'x', target, base.x, 0.32, easeOut);
}

export async function monsterDefeat() {
  if (!monster) return;
  // 大量粒子向上飘
  for (let i = 0; i < 3; i++) {
    spawnBurst(
      monster.position.clone().add(new THREE.Vector3(0, 1, 0)),
      new THREE.Color(monsterTheme.accent),
      20,
      { spread: 2, upwardBias: 2, gravity: 2, size: 0.15, life: 1.2 }
    );
    await new Promise((r) => setTimeout(r, 100));
  }
  // 旋转 + 缩小
  const start = performance.now();
  await new Promise((resolve) => {
    animations.push({
      tick() {
        const t = Math.min(1, (performance.now() - start) / 800);
        monster.rotation.y += 0.3;
        const s = (1 - t) * monster.scale.x;
        monster.scale.set(s, s, s);
        if (t >= 1) {
          monster.visible = false;
          resolve();
          return false;
        }
        return true;
      }
    });
  });
}

export async function playerCelebrate() {
  if (!player) return;
  const base = player.userData.basePos;
  // 头顶星星
  for (let i = 0; i < 6; i++) {
    dropStar(new THREE.Vector3(player.position.x, 2, 0));
    await new Promise((r) => setTimeout(r, 90));
  }
  // 跳跃 + 转圈
  for (let i = 0; i < 3; i++) {
    await tween(player.position, 'y', 0, 0.6, 0.18, easeOut);
    await tween(player.position, 'y', 0.6, 0, 0.18, easeOut);
  }
  await tween(player.rotation, 'y', 0, Math.PI * 2, 0.6, easeInOut);
  player.rotation.y = 0;
}

// 读对一句：从天上掉一颗星星
export function onCorrect() {
  if (!player) return;
  dropStar(player.position.clone());
  // 玩家小弹跳
  tween(player.position, 'y', 0, 0.25, 0.1, easeOut)
    .then(() => tween(player.position, 'y', 0.25, 0, 0.15, easeOut));
}

// 能量满：脚下光环显示
export function setEnergyFull(full) {
  if (!energyAura) return;
  const targetOpacity = full ? 0.6 : 0;
  tween(energyAura.material, 'opacity', energyAura.material.opacity, targetOpacity, 0.4, easeOut);
}

export function dispose() {
  if (rafId) cancelAnimationFrame(rafId);
  if (resizeObs) resizeObs.disconnect();
  if (renderer) {
    renderer.dispose();
    renderer.forceContextLoss && renderer.forceContextLoss();
  }
  scene = camera = renderer = player = monster = ground = energyAura = null;
  ambientParticles = []; fxParticles = []; floatTexts = []; trail = []; animations = [];
  rafId = null;
}
