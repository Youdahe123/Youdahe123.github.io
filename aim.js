// Aim trainer: a first-person arena where the targets are cartoon animals (or a
// plain bullseye), modelled out of primitives rather than loaded as art, and the
// player picks a gun from a small loadout rendered as a proper first-person
// viewmodel. Thirty seconds, one high score, kept in this browser. three.js
// does the drawing; the pointer lock, the spawning and the scoring are all here.
import * as THREE from './vendor/three/three.module.min.js';

const ROUND_MS = 30000;
const TARGET_COUNT = 5;
const STORAGE_KEY = 'aim.best';
const NAME_KEY = 'aim.name';
const GUN_KEY = 'aim.gun';
const TARGET_KEY = 'aim.target';

// The arena is a box the player stands in the middle of. Targets spawn on a
// shell in front of them, never behind, so a round is never spent spinning.
const ROOM = { w: 38, h: 16, d: 38 };
const SPAWN = { minR: 10, maxR: 15, yMin: -2.4, yMax: 3.6, arc: Math.PI * 0.62 };

// A target is not a disc, so the surface a shot is scored against is a sphere
// this big around the middle of one. It matches the halo ring drawn behind it,
// and every model is built to fill it, so the pick is cosmetic and the
// difficulty stays the same whichever one is up.
const HIT_RADIUS = 0.95;

const LOOK_SPEED = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.12;

// The page has one ink palette, so the beavers and the rifle stay inside it:
// cream, amber and the browns in between.
const INK = 0xf0e9dd;
const AMBER = 0xd9a24e;

const INSPECT_MS = 2500;

const stage = document.getElementById('aimStage');
const canvas = document.getElementById('aimCanvas');
const panel = document.getElementById('aimPanel');
const hud = document.getElementById('aimHud');
const crosshair = document.getElementById('aimCrosshair');
const elTime = document.getElementById('aimTime');
const elScore = document.getElementById('aimScore');
const elAcc = document.getElementById('aimAcc');
const elTitle = document.querySelector('.aim-title');
const elStatLabel = document.getElementById('aimStatLabel');
const elStatValue = document.getElementById('aimStatValue');
const elStatNote = document.getElementById('aimStatNote');
const elStart = document.getElementById('aimStart');
const elReset = document.getElementById('aimReset');
const elHint = document.getElementById('aimHint');
const elNote = document.getElementById('aimNote');
const elSaveOpen = document.getElementById('aimSaveOpen');
const elSave = document.getElementById('aimSave');
const elName = document.getElementById('aimName');
const elSaveBtn = document.getElementById('aimSaveBtn');
const elSaveMsg = document.getElementById('aimSaveMsg');
const elBoard = document.getElementById('aimBoard');
const elBoardEmpty = document.getElementById('aimBoardEmpty');
const elGuns = document.getElementById('aimGuns');
const elTargets = document.getElementById('aimTargets');

// Touch devices have no pointer to lock, so they aim by tapping the target
// directly and the copy changes to match.
const touchOnly = window.matchMedia('(hover: none), (pointer: coarse)').matches;

let renderer, scene, camera, targetGroup;
let yaw = 0;
let pitch = 0;
let running = false;
let fallbackAim = false;
let remainingMs = 0;
let endsAt = 0;
let hits = 0;
let shots = 0;
let best = 0;
// The last finished round, which is what the save form submits. Cleared once it
// is on the board so the same run cannot be saved twice.
let lastRun = null;

try {
    best = Number(localStorage.getItem(STORAGE_KEY)) || 0;
} catch {
    best = 0;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOut = (t) => {
    const x = clamp(t, 0, 1);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/* ---------- shared bits ---------- */

// A soft round glow, drawn once and reused by the muzzle flash and the hit
// bursts. Cheaper than shipping an image and it keeps the page asset-free.
function glowTexture() {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255, 252, 244, 1)');
    g.addColorStop(0.3, 'rgba(240, 200, 130, 0.6)');
    g.addColorStop(1, 'rgba(230, 170, 90, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

const GLOW = glowTexture();

// One unit sphere and one unit box, scaled per part. Every target shares them,
// so five targets cost five draw calls per part rather than five geometries.
const UNIT_BALL = new THREE.SphereGeometry(1, 20, 14);
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
// Apex along +Y, so a beak turned by a quarter about X points at the camera.
const UNIT_CONE = new THREE.ConeGeometry(1, 1, 12);
const UNIT_DISC = new THREE.CylinderGeometry(1, 1, 0.04, 40);

/* ---------- scene ---------- */

function buildScene() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // The viewmodel is a second pass over the top of the arena, so the clearing
    // is done by hand in render().
    renderer.autoClear = false;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x121312);
    scene.fog = new THREE.Fog(0x121312, 18, 46);

    camera = new THREE.PerspectiveCamera(68, 1, 0.1, 120);
    camera.position.set(0, 0, 0);

    // Flat, low light: the room should read as a dark space with edges, not a
    // lit set. The targets carry all the contrast.
    scene.add(new THREE.AmbientLight(0xf0e9dd, 1.35));
    const key = new THREE.DirectionalLight(0xf0e9dd, 1.1);
    key.position.set(4, 8, 6);
    scene.add(key);
    const rim = new THREE.PointLight(0xf0e9dd, 10, 34);
    rim.position.set(0, -3, -8);
    scene.add(rim);

    buildRoom();

    targetGroup = new THREE.Group();
    scene.add(targetGroup);
    for (let i = 0; i < TARGET_COUNT; i++) targetGroup.add(makeTarget());

    buildBursts();
}

function buildRoom() {
    // Wireframe box plus a floor grid: enough geometry to see yourself turning
    // without anything to look at that is not a target.
    const box = new THREE.BoxGeometry(ROOM.w, ROOM.h, ROOM.d);
    const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(box),
        new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.18 })
    );
    scene.add(edges);

    const shell = new THREE.Mesh(
        box,
        new THREE.MeshBasicMaterial({ color: 0x191a19, side: THREE.BackSide })
    );
    scene.add(shell);

    const grid = new THREE.GridHelper(ROOM.w, 38, 0xa67d43, INK);
    grid.position.y = -ROOM.h / 2 + 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.12;
    scene.add(grid);
}

/* ---------- the beaver ---------- */

// Toon shading rather than a photo: two flat tones per surface, which is what
// makes a pile of spheres read as a cartoon instead of a diagram.
const FUR = {
    coat: new THREE.MeshToonMaterial({ color: 0x9a6b3f }),
    dark: new THREE.MeshToonMaterial({ color: 0x6b4526 }),
    light: new THREE.MeshToonMaterial({ color: 0xc9a173 }),
    nose: new THREE.MeshToonMaterial({ color: 0x33291f }),
    // Eyes and teeth stay the same brightness wherever the beaver is standing,
    // so they read at fifteen metres. Those are the features you aim at.
    white: new THREE.MeshBasicMaterial({ color: 0xf7f2e7 }),
    pupil: new THREE.MeshBasicMaterial({ color: 0x1b1a18 }),
};

const HALO_GEOMETRY = new THREE.RingGeometry(HIT_RADIUS, HIT_RADIUS + 0.08, 48);
const HALO_MATERIAL = new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.3 });
const COLLIDER_GEOMETRY = new THREE.SphereGeometry(HIT_RADIUS, 12, 10);
// An invisible material is still raycast against, which is exactly what a
// collider wants: scored on, never drawn.
const COLLIDER_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });

// Every part is the shared unit sphere or box, scaled and placed. The beaver
// faces +Z because that is the axis Object3D.lookAt points at the camera.
function part(geometry, material, scale, position) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.position.set(position[0], position[1], position[2]);
    return mesh;
}

function makeBeaver() {
    const beaver = new THREE.Group();

    // Tail first so the body sits over it. Angled out to the side rather than
    // straight back, or a beaver that always turns to face you would never show
    // the one feature that makes it a beaver.
    const tail = part(UNIT_BALL, FUR.dark, [0.3, 0.44, 0.06], [0.44, -0.58, -0.1]);
    tail.rotation.set(-0.35, 0, -0.62);
    beaver.add(tail);

    beaver.add(part(UNIT_BALL, FUR.coat, [0.62, 0.58, 0.5], [0, -0.22, 0]));
    beaver.add(part(UNIT_BALL, FUR.light, [0.34, 0.3, 0.18], [0, -0.26, 0.38]));
    beaver.add(part(UNIT_BALL, FUR.coat, [0.44, 0.42, 0.4], [0, 0.36, 0.05]));

    for (const side of [-1, 1]) {
        beaver.add(part(UNIT_BALL, FUR.dark, [0.13, 0.13, 0.06], [side * 0.33, 0.66, 0]));
        beaver.add(part(UNIT_BALL, FUR.coat, [0.14, 0.16, 0.12], [side * 0.5, -0.26, 0.16]));
        beaver.add(part(UNIT_BALL, FUR.dark, [0.17, 0.1, 0.2], [side * 0.26, -0.72, 0.22]));
        beaver.add(part(UNIT_BALL, FUR.white, [0.085, 0.085, 0.085], [side * 0.17, 0.46, 0.3]));
        beaver.add(part(UNIT_BALL, FUR.pupil, [0.05, 0.05, 0.05], [side * 0.185, 0.46, 0.37]));
        beaver.add(part(UNIT_BOX, FUR.white, [0.085, 0.16, 0.05], [side * 0.052, 0.12, 0.46]));
    }

    beaver.add(part(UNIT_BALL, FUR.light, [0.26, 0.2, 0.2], [0, 0.26, 0.32]));
    beaver.add(part(UNIT_BALL, FUR.nose, [0.075, 0.06, 0.06], [0, 0.33, 0.5]));

    return beaver;
}

/* ---------- the rest of the lineup ---------- */

const toon = (color) => new THREE.MeshToonMaterial({ color });
const FEATHER = { white: toon(0xf1ece2), red: toon(0xc2412f), orange: toon(0xe39a3b) };
const FROG = { skin: toon(0x6f9a45), dark: toon(0x4c7030), belly: toon(0xc9d38e) };
const PENGUIN = { coat: toon(0x3a3f47), belly: toon(0xf1ece2) };
const RINGS = { red: toon(0xb8432f), cream: toon(0xf0e9dd) };

function beak(material, scale, position) {
    const mesh = part(UNIT_CONE, material, scale, position);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
}

// The one every csgo player has shot at least once on the way to a site.
function makeChicken() {
    const chicken = new THREE.Group();

    for (const [x, tilt] of [[-0.12, 0.3], [0, 0], [0.12, -0.3]]) {
        const feather = part(UNIT_BALL, FEATHER.white, [0.1, 0.28, 0.06], [x, -0.02, -0.42]);
        feather.rotation.set(-0.6, 0, tilt);
        chicken.add(feather);
    }

    chicken.add(part(UNIT_BALL, FEATHER.white, [0.5, 0.46, 0.56], [0, -0.28, 0]));
    chicken.add(part(UNIT_BALL, FEATHER.white, [0.27, 0.3, 0.27], [0, 0.3, 0.2]));

    for (const side of [-1, 1]) {
        chicken.add(part(UNIT_BALL, FEATHER.white, [0.1, 0.28, 0.38], [side * 0.47, -0.24, -0.02]));
        chicken.add(part(UNIT_BALL, FUR.white, [0.07, 0.07, 0.07], [side * 0.14, 0.36, 0.4]));
        chicken.add(part(UNIT_BALL, FUR.pupil, [0.04, 0.04, 0.04], [side * 0.15, 0.36, 0.46]));
        chicken.add(part(UNIT_BOX, FEATHER.orange, [0.04, 0.24, 0.04], [side * 0.16, -0.8, 0.02]));
        chicken.add(part(UNIT_BOX, FEATHER.orange, [0.1, 0.03, 0.16], [side * 0.16, -0.92, 0.08]));
    }

    for (const i of [-1, 0, 1]) {
        chicken.add(part(UNIT_BALL, FEATHER.red, [0.07, 0.1, 0.07], [0, 0.6 + (i === 0 ? 0.03 : 0), 0.2 + i * 0.08]));
    }
    chicken.add(beak(FEATHER.orange, [0.07, 0.16, 0.07], [0, 0.28, 0.5]));
    chicken.add(part(UNIT_BALL, FEATHER.red, [0.05, 0.09, 0.05], [0, 0.15, 0.44]));

    return chicken;
}

function makeFrog() {
    const frog = new THREE.Group();

    frog.add(part(UNIT_BALL, FROG.skin, [0.62, 0.44, 0.5], [0, -0.3, 0]));
    frog.add(part(UNIT_BALL, FROG.belly, [0.42, 0.3, 0.2], [0, -0.36, 0.36]));
    frog.add(part(UNIT_BALL, FROG.skin, [0.5, 0.32, 0.42], [0, 0.12, 0.14]));

    for (const side of [-1, 1]) {
        frog.add(part(UNIT_BALL, FROG.skin, [0.17, 0.17, 0.17], [side * 0.26, 0.4, 0.18]));
        frog.add(part(UNIT_BALL, FUR.white, [0.12, 0.12, 0.12], [side * 0.26, 0.44, 0.28]));
        frog.add(part(UNIT_BALL, FUR.pupil, [0.07, 0.05, 0.05], [side * 0.27, 0.44, 0.39]));
        frog.add(part(UNIT_BALL, FROG.dark, [0.2, 0.14, 0.34], [side * 0.5, -0.58, 0.06]));
        frog.add(part(UNIT_BALL, FROG.dark, [0.12, 0.06, 0.16], [side * 0.26, -0.72, 0.36]));
    }

    frog.add(part(UNIT_BOX, FUR.nose, [0.36, 0.02, 0.02], [0, 0.02, 0.5]));
    return frog;
}

function makePenguin() {
    const penguin = new THREE.Group();

    penguin.add(part(UNIT_BALL, PENGUIN.coat, [0.52, 0.8, 0.46], [0, -0.1, 0]));
    penguin.add(part(UNIT_BALL, PENGUIN.belly, [0.3, 0.5, 0.14], [0, -0.22, 0.36]));
    penguin.add(part(UNIT_BALL, PENGUIN.belly, [0.2, 0.14, 0.1], [0, 0.4, 0.38]));

    for (const side of [-1, 1]) {
        penguin.add(part(UNIT_BALL, FUR.white, [0.07, 0.07, 0.07], [side * 0.12, 0.44, 0.42]));
        penguin.add(part(UNIT_BALL, FUR.pupil, [0.04, 0.04, 0.04], [side * 0.125, 0.44, 0.48]));
        const flipper = part(UNIT_BALL, PENGUIN.coat, [0.1, 0.42, 0.18], [side * 0.52, -0.12, 0]);
        flipper.rotation.z = side * 0.25;
        penguin.add(flipper);
        penguin.add(part(UNIT_BALL, FEATHER.orange, [0.14, 0.05, 0.2], [side * 0.16, -0.9, 0.16]));
    }

    penguin.add(beak(FEATHER.orange, [0.07, 0.16, 0.06], [0, 0.34, 0.5]));
    return penguin;
}

// The classic: rings stacked face-on, each a hair in front of the last.
function makeBullseye() {
    const board = new THREE.Group();
    [0.92, 0.74, 0.56, 0.38, 0.2, 0.08].forEach((radius, i) => {
        const ring = new THREE.Mesh(UNIT_DISC, i % 2 ? RINGS.red : RINGS.cream);
        ring.scale.set(radius, 1, radius);
        ring.rotation.x = Math.PI / 2;
        ring.position.z = i * 0.012;
        board.add(ring);
    });
    return board;
}

const TARGETS = [
    { id: 'beaver', label: 'beaver', build: makeBeaver },
    { id: 'chicken', label: 'chicken', build: makeChicken },
    { id: 'frog', label: 'frog', build: makeFrog },
    { id: 'penguin', label: 'penguin', build: makePenguin },
    { id: 'bullseye', label: 'bullseye', build: makeBullseye },
];

let targetKind = TARGETS[0];

function makeTarget() {
    const target = new THREE.Group();

    // A ring the size of the collider: it tells the player where the scored
    // edge is, and it gives the target something to read against in a dark room.
    const halo = new THREE.Mesh(HALO_GEOMETRY, HALO_MATERIAL);
    halo.position.z = -0.5;
    target.add(halo);

    target.userData.model = targetKind.build();
    target.add(target.userData.model);
    target.add(new THREE.Mesh(COLLIDER_GEOMETRY, COLLIDER_MATERIAL));

    placeTarget(target);
    return target;
}

// Swaps the model inside each target in place. The halo, the collider and where
// each one is standing all stay put, so a switch mid-menu is seamless.
function selectTarget(id) {
    targetKind = TARGETS.find((t) => t.id === id) || TARGETS[0];
    if (!targetGroup) return;
    for (const target of targetGroup.children) {
        target.remove(target.userData.model);
        target.userData.model = targetKind.build();
        target.add(target.userData.model);
    }
}

// Somewhere on a shell in front of the player, and not on top of a target that
// is already there.
function placeTarget(target) {
    for (let attempt = 0; attempt < 24; attempt++) {
        const angle = (Math.random() - 0.5) * SPAWN.arc;
        const radius = SPAWN.minR + Math.random() * (SPAWN.maxR - SPAWN.minR);
        const pos = new THREE.Vector3(
            Math.sin(angle) * radius,
            SPAWN.yMin + Math.random() * (SPAWN.yMax - SPAWN.yMin),
            -Math.cos(angle) * radius
        );

        const clash = targetGroup && targetGroup.children.some(
            (other) => other !== target && other.visible && other.position.distanceTo(pos) < 4.2
        );
        if (clash) continue;

        target.position.copy(pos);
        target.visible = true;
        target.userData.bornAt = performance.now();
        target.userData.phase = Math.random() * Math.PI * 2;
        target.userData.baseY = pos.y;
        target.scale.setScalar(0.001); // pops in, see updateTargets
        return;
    }
    target.visible = true;
}

function updateTargets(now) {
    for (const target of targetGroup.children) {
        if (!target.visible) continue;

        // Grow in over 140ms so a respawn is visible rather than instant.
        const age = now - (target.userData.bornAt || now);
        const grow = Math.min(1, age / 140);
        target.scale.setScalar(0.25 + 0.75 * easeOut(grow));

        // A slow bob keeps the arena from feeling like a still image.
        target.position.y = target.userData.baseY + Math.sin(now / 900 + target.userData.phase) * 0.22;
        target.lookAt(camera.position);
    }
}

/* ---------- hit bursts ---------- */

// A target respawns the instant it is shot, so the confirmation has to be left
// behind at the old spot: a ring that expands and fades where it was standing.
const BURST_COUNT = 8;
const bursts = [];

function buildBursts() {
    const ringGeometry = new THREE.RingGeometry(0.46, 0.6, 32);
    for (let i = 0; i < BURST_COUNT; i++) {
        const group = new THREE.Group();
        group.visible = false;

        const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({
            color: INK,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        }));
        group.add(ring);

        const puff = new THREE.Sprite(new THREE.SpriteMaterial({
            map: GLOW,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        }));
        group.add(puff);

        scene.add(group);
        bursts.push({ group, ring, puff, start: 0 });
    }
}

function spawnBurst(position) {
    // Oldest slot wins, so a fast streak of hits never runs out of bursts.
    let slot = bursts.find((b) => !b.start);
    if (!slot) slot = bursts.reduce((a, b) => (a.start < b.start ? a : b));
    slot.group.position.copy(position);
    slot.start = performance.now();
    slot.group.visible = true;
}

function updateBursts(now) {
    for (const burst of bursts) {
        if (!burst.start) continue;
        const t = (now - burst.start) / 280;
        if (t >= 1) {
            burst.start = 0;
            burst.group.visible = false;
            continue;
        }
        const grow = easeOut(t);
        burst.group.lookAt(camera.position);
        burst.ring.scale.setScalar(0.6 + grow * 2.2);
        burst.ring.material.opacity = 0.9 * (1 - t);
        burst.puff.scale.setScalar(1.6 * (1 - grow * 0.4));
        burst.puff.material.opacity = 0.8 * Math.pow(1 - t, 2);
    }
}

/* ---------- the guns ---------- */

// The viewmodel is its own scene drawn over the arena with the depth buffer
// cleared between the two passes. That is the standard first-person trick: the
// gun can sit centimetres from the lens without clipping through a wall, and it
// keeps its own lighting so the metal does not go flat when the player turns.
// Every gun in the loadout is built once up front; picking one just swaps which
// is visible and which muzzle the flash and the tracer come out of.
let viewScene, viewCamera, gun, muzzle, flash, flashLight, bolt, boltPivot;
const guns = {};
let boltStart = 0;
let flashStart = 0;
let inspectStart = 0;
let kick = 0;
let kickVel = 0;
const sway = { x: 0, y: 0 };
const lookDelta = { x: 0, y: 0 };
const glowParts = [];

// Firing state: when the last round left, how many have gone in a row (which is
// what spread grows with), and whether the button is down for automatic fire.
let lastShotAt = -Infinity;
let streak = 0;
let triggerHeld = false;

// Between rounds the gun is shown off in the middle of the menu instead of
// held. It floats in the gap between the panel and the board.
let showcase = false;
let showcaseX = 0.06;
let viewAmbient, showcaseLight, showcaseGlow;

// The middle of the gap between the panel and the board, in screen units, read
// off the layout so the gun stays centred in it at any window size.
function measureShowcase() {
    const left = document.querySelector('.aim-panel').getBoundingClientRect().right;
    const right = document.querySelector('.aim-side').getBoundingClientRect().left;
    const box = stage.getBoundingClientRect();
    showcaseX = (((left + right) / 2 - box.left) / box.width) * 2 - 1;
}

// The guns are modelled at roughly a metre and held at a fraction of that, the
// usual viewmodel trick: parts stay easy to place in round numbers and one
// scale sets how much of the screen each gun eats. Rifles sit out at the hip,
// handguns closer in and nearer the middle.
const RIFLE_HOLD = {
    home: { pos: [0.3, -0.26, -0.72], rot: [0.05, 0.14, 0.05] },
    inspect: { pos: [0.06, -0.16, -0.58], rot: [0.2, -1.0, -0.34] },
};
const PISTOL_HOLD = {
    home: { pos: [0.22, -0.2, -0.58], rot: [0.04, 0.1, 0.03] },
    inspect: { pos: [0.04, -0.12, -0.5], rot: [0.2, -1.0, -0.34] },
};

function metal(color, roughness, metalness) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function energy(color, intensity) {
    return new THREE.MeshStandardMaterial({
        color: 0x1a1208,
        emissive: color,
        emissiveIntensity: intensity,
        roughness: 0.4,
        metalness: 0.1,
    });
}

// Shared finishes for the real-world guns. Metalness stays moderate because
// there is no environment map to reflect, and fully metallic parts go black.
const GUNMETAL = metal(0x565a5e, 0.4, 0.55);
const POLYMER = metal(0x34363a, 0.62, 0.2);
const STEEL = metal(0xa29f96, 0.32, 0.65);
const CHROME = metal(0xd2cfc6, 0.24, 0.7);
const WOOD = metal(0x6e4424, 0.62, 0.05);

function box(g, material, scale, position, rotation) {
    const mesh = new THREE.Mesh(UNIT_BOX, material);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.position.set(position[0], position[1], position[2]);
    if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    g.add(mesh);
    return mesh;
}

// A cylinder laid along the barrel axis.
function tube(g, material, radius, length, position, segments = 14) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments), material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(position[0], position[1], position[2]);
    g.add(mesh);
    return mesh;
}

// The muzzle is a marker, not a mesh: the flash hangs off it and the tracer
// starts from wherever it has ended up after the recoil.
function attachMuzzle(g, position, color) {
    const point = new THREE.Object3D();
    point.position.set(position[0], position[1], position[2]);
    g.add(point);

    const burst = new THREE.Group();
    burst.visible = false;
    const puff = new THREE.Sprite(new THREE.SpriteMaterial({
        map: GLOW,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    puff.scale.setScalar(0.5);
    burst.add(puff);
    const spark = new THREE.Mesh(UNIT_BALL, new THREE.MeshBasicMaterial({
        color: 0xfff3da,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    spark.scale.setScalar(0.07);
    burst.add(spark);
    burst.userData.puff = puff;
    burst.userData.spark = spark;
    point.add(burst);

    const light = new THREE.PointLight(color, 0, 3);
    light.position.set(0, 0, -0.2);
    point.add(light);

    g.userData.muzzle = point;
    g.userData.flash = burst;
    g.userData.flashLight = light;
}

// An alien plasma rifle: a slim hex receiver, a caged muzzle with three prongs
// closing around a floating core, an energy cell slung underneath and a pair of
// swept blades at the back. All primitives, all in the page palette. The player
// sees it from behind and slightly above, so the detail sits on the top and the
// rear where it will actually be looked at.
function buildPlasma() {
    const shell = metal(0x26282a, 0.42, 0.72);
    const plate = metal(0x8f8a7e, 0.48, 0.45);
    const dark = metal(0x141514, 0.6, 0.5);
    const core = energy(AMBER, 2.1);
    const vein = energy(0xffd79a, 1.7);
    glowParts.push(core, vein);

    const g = new THREE.Group();

    // Receiver: a hexagonal prism laid along the barrel axis.
    const receiver = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.8, 6), shell);
    receiver.rotation.x = Math.PI / 2;
    receiver.position.z = -0.05;
    g.add(receiver);

    // A raised spine with a lit seam running down it.
    const spine = new THREE.Mesh(UNIT_BOX, dark);
    spine.scale.set(0.07, 0.075, 0.52);
    spine.position.set(0, 0.1, -0.12);
    g.add(spine);

    const seam = new THREE.Mesh(UNIT_BOX, vein);
    seam.scale.set(0.026, 0.012, 0.42);
    seam.position.set(0, 0.142, -0.12);
    g.add(seam);

    // Inset side panels, each with one thin lit slot. Narrow on purpose: a
    // broad pale panel here reads as a crate rather than a receiver.
    for (const side of [-1, 1]) {
        const panel = new THREE.Mesh(UNIT_BOX, plate);
        panel.scale.set(0.02, 0.075, 0.44);
        panel.position.set(side * 0.092, -0.008, -0.08);
        g.add(panel);

        const slot = new THREE.Mesh(UNIT_BOX, core);
        slot.scale.set(0.009, 0.024, 0.3);
        slot.position.set(side * 0.104, -0.008, -0.08);
        g.add(slot);
    }

    // Notch sight on the spine.
    const sight = new THREE.Mesh(UNIT_BOX, plate);
    sight.scale.set(0.046, 0.055, 0.03);
    sight.position.set(0, 0.165, -0.38);
    g.add(sight);

    const bead = new THREE.Mesh(UNIT_BALL, core);
    bead.scale.setScalar(0.013);
    bead.position.set(0, 0.198, -0.38);
    g.add(bead);

    // Barrel, tapering forward, with three glowing bands.
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.058, 0.66, 14), shell);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.76;
    g.add(barrel);

    const bandGeometry = new THREE.TorusGeometry(0.052, 0.011, 8, 20);
    for (const z of [-0.56, -0.75, -0.94]) {
        const band = new THREE.Mesh(bandGeometry, core);
        band.rotation.x = Math.PI / 2;
        band.position.z = z;
        g.add(band);
    }

    // The cage: three prongs closing in on the core it holds. This is the part
    // the eye lands on, so it gets the length and the lit tips.
    const prongGeometry = new THREE.ConeGeometry(0.026, 0.36, 8);
    const tipGeometry = new THREE.SphereGeometry(0.017, 10, 8);
    for (let i = 0; i < 3; i++) {
        const arm = new THREE.Group();
        arm.rotation.z = (i / 3) * Math.PI * 2 + Math.PI / 6;

        const prong = new THREE.Mesh(prongGeometry, shell);
        prong.rotation.x = -Math.PI / 2 - 0.12; // points forward, leaning inward
        prong.position.set(0, 0.098, -1.2);
        arm.add(prong);

        const tip = new THREE.Mesh(tipGeometry, vein);
        tip.position.set(0, 0.076, -1.37);
        arm.add(tip);

        g.add(arm);
    }

    const heart = new THREE.Mesh(UNIT_BALL, core);
    heart.scale.setScalar(0.06);
    heart.position.z = -1.18;
    g.add(heart);

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.014, 8, 24), vein);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = -1.18;
    g.add(collar);

    // Energy cell slung under the receiver, lit along its middle.
    const cell = new THREE.Mesh(UNIT_BOX, dark);
    cell.scale.set(0.09, 0.17, 0.24);
    cell.position.set(0, -0.14, -0.26);
    g.add(cell);

    const charge = new THREE.Mesh(UNIT_BOX, core);
    charge.scale.set(0.1, 0.095, 0.17);
    charge.position.set(0, -0.14, -0.26);
    g.add(charge);

    // Grip, guard and trigger.
    const grip = new THREE.Mesh(UNIT_BOX, dark);
    grip.scale.set(0.085, 0.3, 0.13);
    grip.position.set(0, -0.26, 0.16);
    grip.rotation.x = 0.3;
    g.add(grip);

    const band = new THREE.Mesh(UNIT_BOX, plate);
    band.scale.set(0.092, 0.03, 0.138);
    band.position.set(0, -0.19, 0.14);
    band.rotation.x = 0.3;
    g.add(band);

    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.013, 8, 16, Math.PI * 1.15), shell);
    guard.rotation.set(0, Math.PI / 2, -0.4);
    guard.position.set(0, -0.1, 0.06);
    g.add(guard);

    const trigger = new THREE.Mesh(UNIT_BOX, plate);
    trigger.scale.set(0.018, 0.065, 0.02);
    trigger.position.set(0, -0.11, 0.07);
    g.add(trigger);

    // Two fins splayed off the back of the receiver, each with a lit edge. They
    // are what stops the silhouette reading as a rifle from Earth, so they have
    // to grow out of the body: an arc floating alongside it read as a hook.
    for (const side of [-1, 1]) {
        const fin = new THREE.Group();
        fin.position.set(side * 0.055, 0.06, 0.24);
        fin.rotation.set(-0.22, 0, side * 0.55);

        const web = new THREE.Mesh(UNIT_BOX, plate);
        web.scale.set(0.016, 0.16, 0.3);
        web.position.set(0, 0.07, 0);
        fin.add(web);

        const edge = new THREE.Mesh(UNIT_BOX, core);
        edge.scale.set(0.02, 0.014, 0.22);
        edge.position.set(0, 0.148, 0);
        fin.add(edge);

        g.add(fin);
    }

    // Stock with a lit heel, so there is something to look at when the rifle
    // turns its back on the player during an inspect.
    const stock = new THREE.Mesh(UNIT_BOX, shell);
    stock.scale.set(0.1, 0.19, 0.22);
    stock.position.set(0, -0.02, 0.43);
    g.add(stock);

    const heel = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.011, 8, 18), vein);
    heel.rotation.x = Math.PI / 2;
    heel.position.set(0, -0.02, 0.54);
    g.add(heel);

    attachMuzzle(g, [0, 0, -1.3], AMBER);
    return g;
}

// An M4-pattern carbine: flat-top upper with a full-length rail, a handguard,
// a front sight post, a slightly curved magazine and a collapsible stock.
function buildRifle() {
    const g = new THREE.Group();

    box(g, GUNMETAL, [0.1, 0.11, 0.6], [0, 0.03, -0.08]);
    box(g, GUNMETAL, [0.095, 0.09, 0.34], [0, -0.07, -0.02]);
    box(g, POLYMER, [0.004, 0.04, 0.12], [0.052, 0.03, -0.04]);
    box(g, GUNMETAL, [0.14, 0.02, 0.04], [0, 0.08, 0.2]);

    box(g, POLYMER, [0.12, 0.12, 0.52], [0, 0.03, -0.64]);
    for (const side of [-1, 1]) box(g, GUNMETAL, [0.012, 0.03, 0.48], [side * 0.066, 0.03, -0.64]);

    box(g, GUNMETAL, [0.06, 0.025, 1.08], [0, 0.1, -0.36]);
    for (let i = 0; i < 12; i++) box(g, POLYMER, [0.064, 0.012, 0.03], [0, 0.118, 0.12 - i * 0.085]);
    box(g, GUNMETAL, [0.05, 0.06, 0.06], [0, 0.14, 0.14]);
    box(g, GUNMETAL, [0.03, 0.14, 0.04], [0, 0.1, -0.94]);

    tube(g, GUNMETAL, 0.022, 0.34, [0, 0.03, -1.06]);
    tube(g, POLYMER, 0.032, 0.1, [0, 0.03, -1.26]);

    box(g, POLYMER, [0.075, 0.2, 0.13], [0, -0.2, -0.14], [-0.1, 0, 0]);
    box(g, POLYMER, [0.075, 0.16, 0.13], [0, -0.36, -0.2], [-0.32, 0, 0]);

    box(g, POLYMER, [0.08, 0.26, 0.12], [0, -0.22, 0.17], [0.32, 0, 0]);
    box(g, GUNMETAL, [0.02, 0.012, 0.16], [0, -0.14, 0.06]);
    box(g, STEEL, [0.016, 0.06, 0.02], [0, -0.1, 0.07]);

    tube(g, GUNMETAL, 0.035, 0.3, [0, 0, 0.36]);
    box(g, POLYMER, [0.08, 0.16, 0.28], [0, -0.03, 0.58]);
    box(g, POLYMER, [0.085, 0.2, 0.03], [0, -0.04, 0.72]);

    attachMuzzle(g, [0, 0.03, -1.32], 0xffc36b);
    return g;
}

// A striker-fired polymer pistol: a boxy slide with rear serrations over a
// short frame, three-dot sights and a steep grip.
function buildPistol() {
    const g = new THREE.Group();

    box(g, GUNMETAL, [0.075, 0.085, 0.46], [0, 0.05, -0.2]);
    for (let i = 0; i < 5; i++) box(g, POLYMER, [0.078, 0.06, 0.008], [0, 0.05, -i * 0.02]);
    box(g, POLYMER, [0.07, 0.05, 0.4], [0, -0.02, -0.2]);
    tube(g, POLYMER, 0.014, 0.01, [0, 0.05, -0.432]);

    box(g, STEEL, [0.012, 0.018, 0.018], [0, 0.1, -0.4]);
    box(g, STEEL, [0.05, 0.02, 0.02], [0, 0.1, 0]);

    box(g, POLYMER, [0.07, 0.26, 0.13], [0, -0.17, 0.03], [0.28, 0, 0]);
    box(g, POLYMER, [0.02, 0.012, 0.12], [0, -0.1, -0.12]);
    box(g, POLYMER, [0.02, 0.06, 0.012], [0, -0.07, -0.18]);
    box(g, STEEL, [0.014, 0.045, 0.016], [0, -0.06, -0.1]);

    attachMuzzle(g, [0, 0.05, -0.46], 0xffc36b);
    return g;
}

// The Desert Eagle: all chrome, a long slide under the heavy triangular barrel
// with its grooved top, and an exposed hammer. Big on purpose.
function buildDeagle() {
    const g = new THREE.Group();

    box(g, CHROME, [0.095, 0.1, 0.56], [0, 0.06, -0.24]);
    for (let i = 0; i < 6; i++) box(g, STEEL, [0.098, 0.07, 0.008], [0, 0.06, -0.01 - i * 0.018]);
    box(g, CHROME, [0.07, 0.05, 0.46], [0, 0.13, -0.3]);
    box(g, POLYMER, [0.02, 0.006, 0.44], [0, 0.158, -0.3]);
    box(g, STEEL, [0.09, 0.06, 0.46], [0, -0.02, -0.24]);
    tube(g, POLYMER, 0.02, 0.01, [0, 0.1, -0.53]);

    box(g, STEEL, [0.014, 0.022, 0.02], [0, 0.17, -0.5]);
    box(g, STEEL, [0.05, 0.024, 0.02], [0, 0.17, -0.08]);
    box(g, STEEL, [0.03, 0.05, 0.03], [0, 0.11, 0.06], [-0.4, 0, 0]);

    box(g, POLYMER, [0.085, 0.3, 0.14], [0, -0.2, 0.04], [0.22, 0, 0]);
    box(g, STEEL, [0.02, 0.012, 0.14], [0, -0.1, -0.14]);
    box(g, STEEL, [0.02, 0.07, 0.012], [0, -0.07, -0.21]);
    box(g, STEEL, [0.014, 0.05, 0.016], [0, -0.06, -0.11]);

    attachMuzzle(g, [0, 0.1, -0.54], 0xffb456);
    return g;
}

// A six-shot revolver: a long barrel over a full underlug, a cylinder that
// turns a chamber per shot, a spur hammer and a wooden grip.
function buildRevolver() {
    const g = new THREE.Group();

    box(g, STEEL, [0.07, 0.14, 0.22], [0, 0.02, -0.02]);
    box(g, STEEL, [0.06, 0.03, 0.24], [0, 0.12, -0.02]);

    const drum = new THREE.Group();
    drum.position.set(0, 0.03, -0.02);
    tube(drum, GUNMETAL, 0.09, 0.16, [0, 0, 0], 18);
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        tube(drum, POLYMER, 0.018, 0.006, [Math.cos(a) * 0.055, Math.sin(a) * 0.055, -0.082], 10);
    }
    g.add(drum);
    g.userData.drum = drum;
    g.userData.drumAngle = 0;

    tube(g, STEEL, 0.03, 0.56, [0, 0.085, -0.4]);
    box(g, STEEL, [0.045, 0.05, 0.5], [0, 0.04, -0.42]);
    box(g, STEEL, [0.012, 0.04, 0.05], [0, 0.13, -0.64]);
    box(g, STEEL, [0.025, 0.07, 0.04], [0, 0.12, 0.12], [-0.5, 0, 0]);

    box(g, WOOD, [0.075, 0.28, 0.14], [0, -0.16, 0.14], [0.35, 0, 0]);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.011, 8, 16, Math.PI * 1.15), STEEL);
    guard.rotation.set(0, Math.PI / 2, -0.4);
    guard.position.set(0, -0.08, 0.04);
    g.add(guard);
    box(g, STEEL, [0.014, 0.05, 0.016], [0, -0.08, 0.05]);

    attachMuzzle(g, [0, 0.085, -0.7], 0xffc36b);
    return g;
}

// How each gun handles. Cooldown is the fastest it will fire again, spread is
// how far consecutive shots wander from the crosshair (in screen units), punch
// is how far each shot kicks the view up. The scoring surface is the same for
// all of them: the gun changes the rhythm, not the target.
const WEAPONS = [
    { id: 'plasma', label: 'plasma rifle', build: buildPlasma, scale: 0.38, ...RIFLE_HOLD, showcase: 1.9,
        cooldown: 120, auto: false, kick: 7.4, punch: 0, spread: null, flash: 1, tracer: 0xffe9bd, tracerWidth: 1 },
    { id: 'ar', label: 'ar', build: buildRifle, scale: 0.36, ...RIFLE_HOLD, showcase: 2.05,
        cooldown: 95, auto: true, kick: 3.2, punch: 0.0045, spread: { step: 0.005, max: 0.045 }, flash: 0.9, tracer: 0xffd88a, tracerWidth: 0.45 },
    { id: 'pistol', label: 'pistol', build: buildPistol, scale: 0.42, ...PISTOL_HOLD, showcase: 0.95,
        cooldown: 110, auto: false, kick: 4.6, punch: 0.006, spread: { step: 0.006, max: 0.03 }, flash: 0.75, tracer: 0xffd88a, tracerWidth: 0.4 },
    { id: 'deagle', label: 'deagle', build: buildDeagle, scale: 0.42, ...PISTOL_HOLD, showcase: 1.12,
        cooldown: 380, auto: false, kick: 11, punch: 0.02, spread: { step: 0.03, max: 0.06 }, flash: 1.5, tracer: 0xffd08a, tracerWidth: 0.6 },
    { id: 'revolver', label: 'revolver', build: buildRevolver, scale: 0.42, ...PISTOL_HOLD, showcase: 1.25,
        cooldown: 480, auto: false, kick: 9.5, punch: 0.016, spread: null, flash: 1.3, tracer: 0xffd08a, tracerWidth: 0.55 },
];

let weapon = WEAPONS[0];

function buildViewmodel() {
    viewScene = new THREE.Scene();
    viewCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 40);

    viewAmbient = new THREE.AmbientLight(INK, 1.2);
    viewScene.add(viewAmbient);

    // The menu preview gets its own light and a soft glow behind it, so a dark
    // gun still reads against a dark room. Both are off during a round.
    showcaseLight = new THREE.PointLight(INK, 0, 6);
    viewScene.add(showcaseLight);
    showcaseGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: GLOW,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    showcaseGlow.visible = false;
    viewScene.add(showcaseGlow);
    const key = new THREE.DirectionalLight(INK, 2.2);
    key.position.set(-0.6, 1, 0.4);
    viewScene.add(key);
    const fill = new THREE.DirectionalLight(0xa67d43, 1.1);
    fill.position.set(1, -0.4, 0.6);
    viewScene.add(fill);

    for (const entry of WEAPONS) {
        const g = entry.build();
        g.scale.setScalar(entry.scale);
        g.visible = false;
        guns[entry.id] = g;
        viewScene.add(g);
    }

    // The tracer lives in the scene rather than on the gun: once it is away it
    // flies straight while the gun is still recoiling.
    boltPivot = new THREE.Group();
    boltPivot.visible = false;
    bolt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.024, 0.012, 0.6, 8),
        new THREE.MeshBasicMaterial({
            color: 0xffe9bd,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        })
    );
    bolt.rotation.x = Math.PI / 2; // length along the pivot's +Z, which lookAt aims
    boltPivot.add(bolt);
    viewScene.add(boltPivot);
}

function selectWeapon(id) {
    const shown = !!(gun && gun.visible);
    const floating = showcase;
    if (gun) gun.visible = false;

    weapon = WEAPONS.find((w) => w.id === id) || WEAPONS[0];
    gun = guns[weapon.id];
    ({ muzzle, flash, flashLight } = gun.userData);
    bolt.material.color.set(weapon.tracer);
    bolt.scale.set(weapon.tracerWidth, 1, weapon.tracerWidth);

    // Start from rest, so a swap never inherits the last gun's recoil.
    showGun(false);
    gun.position.set(...weapon.home.pos);
    gun.rotation.set(...weapon.home.rot);
    gun.visible = shown;
    showcase = floating;
    applyShowcaseLights();
    streak = 0;
    lastShotAt = -Infinity;
}

// Recoil, sway, the pulsing core and the inspect animation, all folded into the
// rifle's transform once per frame.
const AIM_POINT = new THREE.Vector3(0, 0, -14);
const muzzleWorld = new THREE.Vector3();

// Where on the screen the shot went, in the viewmodel camera's own space, so
// the tracer converges on the click rather than always on the middle.
function setAimPoint(ndc) {
    const depth = 14;
    const half = Math.tan((viewCamera.fov * Math.PI) / 360) * depth;
    AIM_POINT.set((ndc ? ndc.x : 0) * half * viewCamera.aspect, (ndc ? ndc.y : 0) * half, -depth);
}

function updateGun(now, dt) {
    if (!gun.visible) return;

    // A damped spring rather than a linear decay: the rifle snaps back and
    // overshoots slightly, which is what makes a shot feel like it landed.
    kickVel += (-220 * kick - 22 * kickVel) * dt;
    kick += kickVel * dt;

    // Weapon lag. The look delta is consumed each frame, so a still mouse pulls
    // the rifle back to where it rests.
    const swayX = clamp(lookDelta.x * 0.0011, -0.07, 0.07);
    const swayY = clamp(lookDelta.y * 0.0011, -0.07, 0.07);
    lookDelta.x = 0;
    lookDelta.y = 0;
    const follow = Math.min(1, dt * 9);
    sway.x += (swayX - sway.x) * follow;
    sway.y += (swayY - sway.y) * follow;

    // Inspect: the rifle comes up to the middle of the screen, turns all the
    // way round so the far side and the muzzle cage are both visible, and drops
    // back to the hip. A full turn ends where it started, so the spin needs no
    // unwinding when the pose blend runs out.
    let pose = 0;
    let spin = 0;
    let roll = 0;
    if (inspectStart) {
        const t = (now - inspectStart) / INSPECT_MS;
        if (t >= 1) {
            inspectStart = 0;
        } else {
            pose = easeInOut(t / 0.18) * easeInOut((1 - t) / 0.18);
            spin = easeInOut((t - 0.12) / 0.7) * Math.PI * 2;
            roll = Math.sin(Math.PI * clamp((t - 0.1) / 0.8, 0, 1)) * 0.45;
        }
    }

    const breathe = running ? 1 : 0.4;
    if (showcase) {
        // On the menu the picked gun floats in the gap between the panel and
        // the board: a slow loop round a small circle, turning as it goes so
        // every side of it gets shown.
        const t = now / 1000;
        const d = weapon.showcase;
        const half = Math.tan((viewCamera.fov * Math.PI) / 360) * d;
        const cx = showcaseX * half * viewCamera.aspect;
        gun.position.set(cx + Math.cos(t * 0.9) * d * 0.08, Math.sin(t * 0.9) * d * 0.06, -d);
        gun.rotation.set(0.14 + Math.sin(t * 0.9) * 0.1, t * 0.7, Math.cos(t * 0.9) * 0.12);
        showcaseLight.position.set(cx - d * 0.3, d * 0.45, -d * 0.4);
        showcaseGlow.position.set(cx, 0, -d - 0.4);
        showcaseGlow.scale.setScalar(d * 1.1);
    } else {
        gun.position.set(
            lerp(weapon.home.pos[0], weapon.inspect.pos[0], pose) - sway.x * 0.8 + Math.sin(now / 1400) * 0.004 * breathe,
            lerp(weapon.home.pos[1], weapon.inspect.pos[1], pose) - sway.y * 0.5 + Math.sin(now / 900) * 0.005 * breathe + kick * 0.022,
            lerp(weapon.home.pos[2], weapon.inspect.pos[2], pose) + kick * 0.1
        );
        gun.rotation.set(
            lerp(weapon.home.rot[0], weapon.inspect.rot[0], pose) - kick * 0.26 + sway.y * 0.9,
            lerp(weapon.home.rot[1], weapon.inspect.rot[1], pose) + sway.x * 1.1 + spin,
            lerp(weapon.home.rot[2], weapon.inspect.rot[2], pose) + kick * 0.06 + roll
        );
    }

    // The revolver's cylinder turns one chamber per shot, quickly but not
    // instantly, so the turn reads.
    const drum = gun.userData.drum;
    if (drum) drum.rotation.z += (gun.userData.drumAngle - drum.rotation.z) * Math.min(1, dt * 18);

    // The core breathes when idle and goes bright for the length of a shot.
    const heat = flashStart ? Math.max(0, 1 - (now - flashStart) / 260) : 0;
    const pulse = 1.5 + Math.sin(now / 420) * 0.35 + heat * 2.6;
    for (const material of glowParts) material.emissiveIntensity = pulse;

    // Muzzle flash: a single frame would be missed at 120Hz, so it lives for
    // about a tenth of a second and shrinks as it goes.
    if (flashStart) {
        const t = (now - flashStart) / 110;
        if (t >= 1) {
            flashStart = 0;
            flash.visible = false;
            flashLight.intensity = 0;
        } else {
            flash.visible = true;
            const fade = 1 - t;
            flash.userData.puff.scale.setScalar((0.4 + t * 0.55) * weapon.flash);
            flash.userData.puff.material.opacity = fade;
            flash.userData.spark.scale.setScalar(0.085 * fade * weapon.flash);
            flash.userData.spark.material.opacity = fade;
            flashLight.intensity = 9 * fade;
        }
    }

    // The bolt leaves the muzzle and heads for the middle of the screen, which
    // is where the crosshair and the shot both went.
    if (boltStart) {
        const t = (now - boltStart) / 150;
        if (t >= 1) {
            boltStart = 0;
            boltPivot.visible = false;
        } else {
            bolt.position.z = 0.3 + t * 9;
            bolt.material.opacity = 1 - t * t;
        }
    }
}

// Called on every shot, hit or miss: the gun does not know whether it landed.
function fireGun(ndc) {
    if (!gun.visible) return;
    setAimPoint(ndc);
    kickVel += weapon.kick;
    flashStart = performance.now();
    // A sprite is always square to the camera, so a fresh spin on the texture
    // is the only thing keeping two shots from flashing identically.
    flash.userData.puff.material.rotation = Math.random() * Math.PI * 2;
    if (gun.userData.drum) gun.userData.drumAngle += Math.PI / 3;

    gun.updateMatrixWorld();
    muzzle.getWorldPosition(muzzleWorld);
    boltPivot.position.copy(muzzleWorld);
    boltPivot.lookAt(AIM_POINT);
    boltPivot.visible = true;
    bolt.position.z = 0.3;
    bolt.material.opacity = 1;
    boltStart = flashStart;

    // A shot cuts an inspect short by jumping it to the part where the gun
    // comes back down, rather than snapping.
    if (inspectStart) inspectStart = Math.min(inspectStart, performance.now() - INSPECT_MS * 0.86);
}

// The menu preview. Only on a wide screen: when the menu stacks into one
// column there is no gap to float in, and the gun would sit under the text.
function setShowcase(on) {
    showcase = on && window.innerWidth > 900;
    if (showcase) measureShowcase();
    if (gun) gun.visible = showcase;
    applyShowcaseLights();
}

function applyShowcaseLights() {
    if (!viewAmbient) return;
    viewAmbient.intensity = showcase ? 2.4 : 1.2;
    showcaseLight.intensity = showcase ? 9 : 0;
    showcaseGlow.visible = showcase;
}

function showGun(visible) {
    if (!gun) return;
    showcase = false;
    applyShowcaseLights();
    gun.visible = visible;
    if (visible) return;
    kick = 0;
    kickVel = 0;
    inspectStart = 0;
    flashStart = 0;
    boltStart = 0;
    triggerHeld = false;
    flash.visible = false;
    flashLight.intensity = 0;
    boltPivot.visible = false;
}

/* ---------- drawing ---------- */

function resize() {
    if (!renderer) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    viewCamera.aspect = w / h;
    viewCamera.updateProjectionMatrix();
    render();
}

function render() {
    if (!renderer) return;
    renderer.clear();
    renderer.render(scene, camera);
    if (gun && gun.visible) {
        // Fresh depth for the viewmodel pass, so the rifle is always in front
        // of the arena no matter how close a target has spawned.
        renderer.clearDepth();
        renderer.render(viewScene, viewCamera);
    }
}

/* ---------- aiming ---------- */

function applyLook() {
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
}

function onMouseMove(event) {
    if (!running) return;
    yaw -= event.movementX * LOOK_SPEED;
    pitch -= event.movementY * LOOK_SPEED;
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
    applyLook();
    lookDelta.x += event.movementX;
    lookDelta.y += event.movementY;
}

const raycaster = new THREE.Raycaster();
const CENTRE = new THREE.Vector2(0, 0);
const hitPoint = new THREE.Vector3();

// The rifle lives in its own scene, so a tap on it is a separate cast against
// the viewmodel camera. It is how inspect is reachable on a phone, where there
// is no F key to press.
function tappedGun(ndc) {
    if (!gun || !gun.visible) return false;
    // The renderer is what normally refreshes these matrices. Without this the
    // cast runs against whatever the last frame left behind, and on the very
    // first one that is the identity, which parks the whole rifle on top of the
    // camera and swallows every tap on the arena.
    gun.updateWorldMatrix(true, true);
    raycaster.setFromCamera(ndc, viewCamera);
    return raycaster.intersectObject(gun, true).length > 0;
}

// A shot from the middle of the screen, which is where the crosshair is.
function fire(ndc) {
    if (!running) return;
    const now = performance.now();
    if (now - lastShotAt < weapon.cooldown) return;

    // Shots fired close together wander further from where the player aimed,
    // which is what keeps holding down the AR from being free hits.
    streak = now - lastShotAt < weapon.cooldown * 2.5 ? streak + 1 : 0;
    lastShotAt = now;
    shots++;

    let aim = ndc || CENTRE;
    if (weapon.spread && streak) {
        const r = Math.min(weapon.spread.max, streak * weapon.spread.step) * Math.sqrt(Math.random());
        const a = Math.random() * Math.PI * 2;
        aim = new THREE.Vector2(aim.x + (Math.cos(a) * r) / camera.aspect, aim.y + Math.sin(a) * r);
    }
    fireGun(aim);

    raycaster.setFromCamera(aim, camera);
    const hit = raycaster.intersectObjects(targetGroup.children, true)[0];

    if (hit) {
        let target = hit.object;
        while (target.parent && target.parent !== targetGroup) target = target.parent;
        hits++;
        hitPoint.copy(target.position);
        spawnBurst(hitPoint);
        placeTarget(target);
    }

    // Recoil climbs the view, so a second shot has to pull back down onto the
    // target. Only with the pointer locked: on a phone the view does not move.
    if (weapon.punch && document.pointerLockElement) {
        pitch = Math.min(PITCH_LIMIT, pitch + weapon.punch);
        yaw += (Math.random() - 0.5) * weapon.punch * 0.6;
        applyLook();
    }

    updateHud();
}

/* ---------- round ---------- */

function startRound() {
    hits = 0;
    shots = 0;
    remainingMs = 0;
    yaw = 0;
    pitch = 0;
    applyLook();
    targetGroup.children.forEach(placeTarget);

    running = true;
    fallbackAim = false;
    endsAt = performance.now() + ROUND_MS;
    stage.classList.add('is-running');
    panel.hidden = true;
    hideSave();
    lastRun = null;
    hud.hidden = false;
    hud.setAttribute('aria-hidden', 'false');
    crosshair.hidden = false;
    showGun(true);
    setNote('');
    updateHud();

    if (!touchOnly) lockPointer();
}

function lockPointer() {
    const request = canvas.requestPointerLock({ unadjustedMovement: true });
    // Chrome returns a promise for the options form; older engines return
    // undefined and report failure through pointerlockerror instead.
    if (request && typeof request.catch === 'function') {
        request.catch(() => canvas.requestPointerLock());
    }
}

function endRound() {
    running = false;
    remainingMs = 0;
    stage.classList.remove('is-running');
    hud.hidden = true;
    hud.setAttribute('aria-hidden', 'true');
    crosshair.hidden = true;
    panel.hidden = false;
    showGun(false);
    setShowcase(true);
    if (document.pointerLockElement) document.exitPointerLock();

    const beaten = hits > best;
    if (beaten) {
        best = hits;
        try {
            localStorage.setItem(STORAGE_KEY, String(best));
        } catch {
            // Private mode: the score stands for this session only.
        }
    }

    elTitle.textContent = beaten ? 'new best' : 'time';
    elStatLabel.textContent = beaten ? 'high score' : 'this run';
    elStatValue.textContent = beaten ? String(best) : String(hits);
    elStatNote.textContent = `${accuracy()}% accuracy · ${shots} ${shots === 1 ? 'shot' : 'shots'} · best ${best}`;
    elStart.textContent = 'go again';
    setNote('');

    lastRun = hits > 0 ? { score: hits, shots, gun: weapon.id } : null;
    lockPicks(false);
    elSaveOpen.hidden = !lastRun || !boardOnline;
}

function accuracy() {
    return shots ? Math.round((hits / shots) * 100) : 100;
}

function updateHud() {
    elScore.textContent = String(hits);
    elAcc.textContent = `${accuracy()}%`;
}

// One loop for the whole page, running whether or not a round is on: the
// targets need to bob and face the camera on the menu too, and a target that
// only grew in during a round was invisible before the first start.
let lastFrame = 0;

function loop(now) {
    // Clamped so a tab that was in the background does not resolve the recoil
    // spring in one enormous step.
    const dt = lastFrame ? Math.min(0.033, (now - lastFrame) / 1000) : 0.016;
    lastFrame = now;

    updateTargets(now);
    updateBursts(now);
    updateGun(now, dt);

    if (running && triggerHeld && weapon.auto) fire();

    if (running) {
        const left = Math.max(0, endsAt - now);
        elTime.textContent = (left / 1000).toFixed(1);
        if (left <= 0) endRound();
    }

    render();
    requestAnimationFrame(loop);
}

function pause(message) {
    if (!running) return;
    running = false;
    // Hold the clock where it stopped. The deadline is wall-clock, so without
    // this a player who tabs away comes back to a round that already expired.
    remainingMs = Math.max(0, endsAt - performance.now());
    stage.classList.remove('is-running', 'is-locked');
    hud.hidden = true;
    crosshair.hidden = true;
    panel.hidden = false;
    showGun(false);
    setShowcase(true);
    if (document.pointerLockElement) document.exitPointerLock();
    elTitle.textContent = 'paused';
    elStatLabel.textContent = 'hits so far';
    elStatValue.textContent = String(hits);
    elStatNote.textContent = `${(remainingMs / 1000).toFixed(1)}s left · best ${best}`;
    elStart.textContent = 'resume';
    hideSave();
    lockPicks(true);
    setNote(message || '');
}

function resume() {
    if (remainingMs <= 0) {
        startRound();
        return;
    }
    running = true;
    fallbackAim = false;
    endsAt = performance.now() + remainingMs;
    remainingMs = 0;
    stage.classList.add('is-running');
    panel.hidden = true;
    hud.hidden = false;
    hud.setAttribute('aria-hidden', 'false');
    crosshair.hidden = touchOnly;
    showGun(true);
    setNote('');
    if (!touchOnly) lockPointer();
}

function setNote(text) {
    elNote.textContent = text;
    elNote.hidden = !text;
}

/* ---------- loadout ---------- */

function remember(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // the pick lasts for this visit only
    }
}

function recall(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

// One row of radio-style chips. Arrow keys are not wired: there are five
// options and a tab stop each is fine.
function buildChips(container, options, selected, onPick) {
    container.replaceChildren();
    for (const option of options) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'aim-chip';
        chip.setAttribute('role', 'radio');
        chip.setAttribute('aria-checked', String(option.id === selected));
        chip.textContent = option.label;
        chip.addEventListener('click', () => {
            for (const other of container.children) other.setAttribute('aria-checked', String(other === chip));
            onPick(option.id);
        });
        container.append(chip);
    }
}

// Mid-round the loadout is locked, so a paused run cannot swap guns halfway.
function lockPicks(locked) {
    for (const chip of [...elGuns.children, ...elTargets.children]) chip.disabled = locked;
}

function updateHint() {
    if (touchOnly) {
        elHint.textContent = `tap the ${targetKind.id === 'bullseye' ? 'targets' : `${targetKind.label}s`} · tap the gun to inspect it`;
    } else {
        elHint.textContent = `${weapon.auto ? 'hold to spray' : 'click to fire'} · move to aim · f to inspect · esc to pause`;
    }
}

/* ---------- leaderboard ---------- */

// The board lives behind the Worker. On a static host there is no /api, so the
// first failed read marks it offline and the save button never shows.
let boardOnline = false;

function renderBoard(scores, mine) {
    elBoard.replaceChildren();
    scores.forEach((entry, i) => {
        const row = document.createElement('li');
        row.className = 'aim-board-row';
        if (entry.id === mine) row.classList.add('is-mine');

        const place = document.createElement('span');
        place.className = 'aim-board-place';
        place.textContent = String(i + 1);

        const name = document.createElement('span');
        name.className = 'aim-board-name';
        name.textContent = entry.name;
        const gunName = WEAPONS.find((w) => w.id === entry.gun);
        if (gunName) {
            const tag = document.createElement('small');
            tag.textContent = ` ${gunName.label}`;
            name.append(tag);
        }

        const score = document.createElement('span');
        score.className = 'aim-board-score';
        score.textContent = String(entry.score);

        const acc = document.createElement('span');
        acc.className = 'aim-board-acc';
        acc.textContent = `${entry.accuracy}%`;

        row.append(place, name, score, acc);
        elBoard.append(row);
    });
    elBoardEmpty.hidden = scores.length > 0;
    elBoardEmpty.textContent = 'no scores yet. be the first.';
}

async function loadBoard() {
    try {
        const res = await fetch('/api/aim', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const { scores } = await res.json();
        boardOnline = true;
        renderBoard(Array.isArray(scores) ? scores : [], null);
    } catch {
        boardOnline = false;
        elBoard.replaceChildren();
        elBoardEmpty.hidden = false;
        elBoardEmpty.textContent = 'the leaderboard is offline right now.';
    }
}

function hideSave() {
    elSaveOpen.hidden = true;
    elSave.hidden = true;
    elSaveMsg.textContent = '';
}

function openSave() {
    if (!lastRun) return;
    elSaveOpen.hidden = true;
    elSave.hidden = false;
    elSaveMsg.textContent = `${lastRun.score} ${lastRun.score === 1 ? 'hit' : 'hits'}, ${Math.round((lastRun.score / lastRun.shots) * 100)}% accuracy`;
    try {
        elName.value = localStorage.getItem(NAME_KEY) || '';
    } catch {
        // no remembered name
    }
    elName.focus();
}

async function saveScore(event) {
    event.preventDefault();
    const name = elName.value.trim();
    if (!lastRun || !name) return;

    elSaveBtn.disabled = true;
    elSaveMsg.textContent = 'saving…';
    try {
        const res = await fetch('/api/aim', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, score: lastRun.score, shots: lastRun.shots, gun: lastRun.gun }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'could not save');

        try {
            localStorage.setItem(NAME_KEY, name);
        } catch {
            // the name just will not be prefilled next time
        }
        lastRun = null;
        renderBoard(data.scores || [], data.id);
        elSave.hidden = true;
        setNote(data.place ? `saved. you are #${data.place} on the board.` : 'saved, but not quite top 50 yet.');
    } catch (error) {
        elSaveMsg.textContent = error.message || 'could not save, try again';
    } finally {
        elSaveBtn.disabled = false;
    }
}

/* ---------- wiring ---------- */

elSaveOpen.addEventListener('click', openSave);
elSave.addEventListener('submit', saveScore);

// One button: it starts a fresh round, or picks up a paused one.
elStart.addEventListener('click', () => {
    if (remainingMs > 0) resume();
    else startRound();
});

elReset.addEventListener('click', () => {
    best = 0;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // nothing to clear
    }
    elStatValue.textContent = '0';
    elStatNote.textContent = '30 seconds · no runs yet';
});

// Firing: a pointer-locked click shoots down the crosshair, a tap on a phone
// shoots wherever the finger landed.
canvas.addEventListener('pointerdown', (event) => {
    if (!running) return;

    if (touchOnly || !document.pointerLockElement) {
        const box = canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((event.clientX - box.left) / box.width) * 2 - 1,
            -((event.clientY - box.top) / box.height) * 2 + 1
        );
        if (tappedGun(ndc)) {
            if (!inspectStart) inspectStart = performance.now();
            return;
        }
        fire(ndc);
        return;
    }

    triggerHeld = true;
    fire();
});

document.addEventListener('pointerup', () => {
    triggerHeld = false;
});

document.addEventListener('mousemove', onMouseMove);

document.addEventListener('pointerlockchange', () => {
    const locked = !!document.pointerLockElement;
    stage.classList.toggle('is-locked', locked);
    // Esc releases the lock, which is the pause gesture the hint describes.
    if (running && !locked && !touchOnly && !fallbackAim) pause('');
});

// Some browsers and embedded views refuse pointer lock outright. The round is
// still perfectly playable by clicking the targets where they are, so it keeps
// going in that mode rather than dying on the spot.
document.addEventListener('pointerlockerror', () => {
    if (!running) return;
    fallbackAim = true;
    stage.classList.remove('is-locked');
    crosshair.hidden = true;
    setNote('pointer lock was refused, so aim by clicking the targets directly');
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && running) {
        pause('');
        return;
    }
    // Inspect, on the key every shooter puts it on. It does not stop the clock
    // and it does not stop a shot, so showing off costs you the seconds.
    if ((event.key === 'f' || event.key === 'F') && running && !inspectStart && !event.repeat) {
        inspectStart = performance.now();
    }
});

// Switching tabs stops requestAnimationFrame, so a round left in the
// background would come back already over. Pause it instead.
document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) pause('');
});

/* ---------- boot ---------- */

selectTarget(recall(TARGET_KEY));
buildScene();
buildViewmodel();
selectWeapon(recall(GUN_KEY));
setShowcase(true);
buildChips(elGuns, WEAPONS, weapon.id, (id) => {
    selectWeapon(id);
    remember(GUN_KEY, id);
    updateHint();
});
buildChips(elTargets, TARGETS, targetKind.id, (id) => {
    selectTarget(id);
    remember(TARGET_KEY, id);
    updateHint();
});
applyLook();
resize();
window.addEventListener('resize', () => {
    resize();
    if (!panel.hidden) setShowcase(true);
});
requestAnimationFrame(loop);

elStart.disabled = false;
elStart.textContent = 'start';
elStatValue.textContent = String(best);
elStatNote.textContent = best ? `30 seconds · best ${best}` : '30 seconds · no runs yet';
loadBoard();
updateHint();
