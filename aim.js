// Aim trainer: a first-person arena where the targets are cartoon beavers,
// modelled out of primitives rather than loaded as art, and the player holds an
// alien plasma rifle rendered as a proper first-person viewmodel. Thirty
// seconds, one high score, kept in this browser. three.js does the drawing; the
// pointer lock, the spawning and the scoring are all here.
import * as THREE from './vendor/three/three.module.min.js';

const ROUND_MS = 30000;
const TARGET_COUNT = 5;
const STORAGE_KEY = 'aim.best';

// The arena is a box the player stands in the middle of. Targets spawn on a
// shell in front of them, never behind, so a round is never spent spinning.
const ROOM = { w: 38, h: 16, d: 38 };
const SPAWN = { minR: 10, maxR: 15, yMin: -2.4, yMax: 3.6, arc: Math.PI * 0.62 };

// A beaver is not a disc, so the surface a shot is scored against is a sphere
// this big around the middle of one. It matches the halo ring drawn behind the
// beaver, and it keeps the difficulty exactly where the old photo disc had it.
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

// One unit sphere and one unit box, scaled per part. Every beaver shares them,
// so five beavers cost five draw calls per part rather than five geometries.
const UNIT_BALL = new THREE.SphereGeometry(1, 20, 14);
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

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

function makeTarget() {
    const target = new THREE.Group();

    // A ring the size of the collider: it tells the player where the scored
    // edge is, and it gives the beaver something to read against in a dark room.
    const halo = new THREE.Mesh(HALO_GEOMETRY, HALO_MATERIAL);
    halo.position.z = -0.5;
    target.add(halo);

    target.add(makeBeaver());
    target.add(new THREE.Mesh(COLLIDER_GEOMETRY, COLLIDER_MATERIAL));

    placeTarget(target);
    return target;
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

// A beaver respawns the instant it is shot, so the confirmation has to be left
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

/* ---------- the rifle ---------- */

// The viewmodel is its own scene drawn over the arena with the depth buffer
// cleared between the two passes. That is the standard first-person trick: the
// gun can sit centimetres from the lens without clipping through a wall, and it
// keeps its own lighting so the metal does not go flat when the player turns.
let viewScene, viewCamera, gun, muzzle, flash, flashLight, bolt, boltPivot;
let boltStart = 0;
let flashStart = 0;
let inspectStart = 0;
let kick = 0;
let kickVel = 0;
const sway = { x: 0, y: 0 };
const lookDelta = { x: 0, y: 0 };
const glowParts = [];

// The rifle is modelled at roughly a metre long and then held at a fraction of
// that, which is the usual viewmodel trick: the parts stay easy to place in
// round numbers and one scale sets how much of the screen the gun eats.
const GUN_SCALE = 0.38;

// Where the rifle rests, and where it is held when the player inspects it.
const HOME = { pos: [0.3, -0.26, -0.72], rot: [0.05, 0.14, 0.05] };
const INSPECT = { pos: [0.06, -0.16, -0.58], rot: [0.2, -1.0, -0.34] };

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

function buildViewmodel() {
    viewScene = new THREE.Scene();
    viewCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 40);

    viewScene.add(new THREE.AmbientLight(INK, 1.2));
    const key = new THREE.DirectionalLight(INK, 2.2);
    key.position.set(-0.6, 1, 0.4);
    viewScene.add(key);
    const fill = new THREE.DirectionalLight(0xa67d43, 1.1);
    fill.position.set(1, -0.4, 0.6);
    viewScene.add(fill);

    gun = buildGun();
    gun.visible = false;
    viewScene.add(gun);

    // The bolt lives in the scene rather than on the gun: once it is away it
    // flies straight while the rifle is still recoiling.
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

// An alien plasma rifle: a slim hex receiver, a caged muzzle with three prongs
// closing around a floating core, an energy cell slung underneath and a pair of
// swept blades at the back. All primitives, all in the page palette. The player
// sees it from behind and slightly above, so the detail sits on the top and the
// rear where it will actually be looked at.
function buildGun() {
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

    // The muzzle is a marker, not a mesh: the flash hangs off it and the bolt
    // starts from wherever it has ended up after the recoil.
    muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, -1.3);
    g.add(muzzle);

    flash = new THREE.Group();
    flash.visible = false;
    const puff = new THREE.Sprite(new THREE.SpriteMaterial({
        map: GLOW,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    puff.scale.setScalar(0.5);
    flash.add(puff);
    const spark = new THREE.Mesh(UNIT_BALL, new THREE.MeshBasicMaterial({
        color: 0xfff3da,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    spark.scale.setScalar(0.07);
    flash.add(spark);
    flash.userData.puff = puff;
    flash.userData.spark = spark;
    muzzle.add(flash);

    flashLight = new THREE.PointLight(AMBER, 0, 3);
    flashLight.position.set(0, 0, -0.2);
    muzzle.add(flashLight);

    g.position.set(HOME.pos[0], HOME.pos[1], HOME.pos[2]);
    g.rotation.set(HOME.rot[0], HOME.rot[1], HOME.rot[2]);
    g.scale.setScalar(GUN_SCALE);
    return g;
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
    gun.position.set(
        lerp(HOME.pos[0], INSPECT.pos[0], pose) - sway.x * 0.8 + Math.sin(now / 1400) * 0.004 * breathe,
        lerp(HOME.pos[1], INSPECT.pos[1], pose) - sway.y * 0.5 + Math.sin(now / 900) * 0.005 * breathe + kick * 0.022,
        lerp(HOME.pos[2], INSPECT.pos[2], pose) + kick * 0.1
    );
    gun.rotation.set(
        lerp(HOME.rot[0], INSPECT.rot[0], pose) - kick * 0.26 + sway.y * 0.9,
        lerp(HOME.rot[1], INSPECT.rot[1], pose) + sway.x * 1.1 + spin,
        lerp(HOME.rot[2], INSPECT.rot[2], pose) + kick * 0.06 + roll
    );

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
            flash.userData.puff.scale.setScalar(0.4 + t * 0.55);
            flash.userData.puff.material.opacity = fade;
            flash.userData.spark.scale.setScalar(0.085 * fade);
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

// Called on every shot, hit or miss: the rifle does not know whether it landed.
function fireGun(ndc) {
    if (!gun.visible) return;
    setAimPoint(ndc);
    kickVel += 7.4;
    flashStart = performance.now();
    // A sprite is always square to the camera, so a fresh spin on the texture
    // is the only thing keeping two shots from flashing identically.
    flash.userData.puff.material.rotation = Math.random() * Math.PI * 2;

    gun.updateMatrixWorld();
    muzzle.getWorldPosition(muzzleWorld);
    boltPivot.position.copy(muzzleWorld);
    boltPivot.lookAt(AIM_POINT);
    boltPivot.visible = true;
    bolt.position.z = 0.3;
    bolt.material.opacity = 1;
    boltStart = flashStart;

    // A shot cuts an inspect short by jumping it to the part where the rifle
    // comes back down, rather than snapping.
    if (inspectStart) inspectStart = Math.min(inspectStart, performance.now() - INSPECT_MS * 0.86);
}

function showGun(visible) {
    if (!gun) return;
    gun.visible = visible;
    if (visible) return;
    kick = 0;
    kickVel = 0;
    inspectStart = 0;
    flashStart = 0;
    boltStart = 0;
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
        // of the arena no matter how close a beaver has spawned.
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
    shots++;
    fireGun(ndc);

    raycaster.setFromCamera(ndc || CENTRE, camera);
    const hit = raycaster.intersectObjects(targetGroup.children, true)[0];

    if (hit) {
        let target = hit.object;
        while (target.parent && target.parent !== targetGroup) target = target.parent;
        hits++;
        hitPoint.copy(target.position);
        spawnBurst(hitPoint);
        placeTarget(target);
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
    if (document.pointerLockElement) document.exitPointerLock();
    elTitle.textContent = 'paused';
    elStatLabel.textContent = 'hits so far';
    elStatValue.textContent = String(hits);
    elStatNote.textContent = `${(remainingMs / 1000).toFixed(1)}s left · best ${best}`;
    elStart.textContent = 'resume';
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

/* ---------- wiring ---------- */

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

    fire();
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
    setNote('pointer lock was refused, so aim by clicking the beavers directly');
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

buildScene();
buildViewmodel();
applyLook();
resize();
window.addEventListener('resize', resize);
requestAnimationFrame(loop);

elStart.disabled = false;
elStart.textContent = 'start';
elStatValue.textContent = String(best);
elStatNote.textContent = best ? `30 seconds · best ${best}` : '30 seconds · no runs yet';
if (touchOnly) {
    elHint.textContent = 'tap the beavers · tap the rifle to inspect it';
}
