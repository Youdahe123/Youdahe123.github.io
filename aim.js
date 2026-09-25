// Aim trainer: a first-person arena where the targets are cartoon animals (or a
// plain bullseye), modelled out of primitives rather than loaded as art, and the
// player picks a gun from a small loadout rendered as a proper first-person
// viewmodel. Thirty seconds, one high score, kept in this browser. three.js
// does the drawing; the pointer lock, the spawning and the scoring are all here.
import * as THREE from './vendor/three/three.module.min.js';
import { createBots, collectColliders, DIFFICULTIES, BOT_COUNTS } from './bots.js';
import { mergeGeometries } from './vendor/three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from './vendor/three/addons/loaders/GLTFLoader.js';

const ROUND_MS = 30000;
const TARGET_COUNT = 5;
const STORAGE_KEY = 'aim.best';
const NAME_KEY = 'aim.name';
const GUN_KEY = 'aim.gun';
const TARGET_KEY = 'aim.target';
const MAP_KEY = 'aim.map';
const XH_KEY = 'aim.crosshair';
const XH_COLOR_KEY = 'aim.crosshairColor';
const SOUND_KEY = 'aim.sound';
const SENS_KEY = 'aim.sensitivity';
const RELOAD_KEY = 'aim.reload';
const AK_MODE_KEY = 'aim.akMode';
const EGGS_KEY = 'aim.eggs';
const MODE_KEY = 'aim.mode';
const DIFFICULTY_KEY = 'aim.difficulty';
const BOT_COUNT_KEY = 'aim.botCount';
const BOTS_BEST_KEY = 'aim.botsBest';
const BOTS_ROUND_MS = 90000;

// The arena is a box the player stands in the middle of. Targets spawn on a
// shell in front of them, never behind, so a round is never spent spinning.
const ROOM = { w: 38, h: 16, d: 38 };
const SPAWN = { minR: 10, maxR: 15, yMin: -2.4, yMax: 3.6, arc: Math.PI * 0.62 };

// A target is not a disc, so the surface a shot is scored against is a sphere
// this big around the middle of one. It matches the halo ring drawn behind it,
// and every model is built to fill it, so the pick is cosmetic and the
// difficulty stays the same whichever one is up.
const HIT_RADIUS = 0.95;

// Look speed follows csgo's formula: every unit of mouse movement turns the
// view sensitivity x 0.022 degrees, so a csgo sensitivity carries over
// roughly. Browsers report movement after the OS has had its say, so it will
// not match to the decimal.
const SENS_DEFAULT = 2.5;
const SENS_MIN = 0.2;
const SENS_MAX = 8;
let sensitivity = SENS_DEFAULT;
const lookSpeed = () => sensitivity * 0.022 * (Math.PI / 180);
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
const elMaps = document.getElementById('aimMaps');
const elScope = document.getElementById('aimScope');
const elCrosshairs = document.getElementById('aimCrosshairs');
const elXhColors = document.getElementById('aimXhColors');
const elXhPreview = document.getElementById('aimXhPreview');
const elAmmo = document.getElementById('aimAmmo');
const elAmmoGun = document.getElementById('aimAmmoGun');
const elAmmoMag = document.getElementById('aimAmmoMag');
const elAmmoFill = document.getElementById('aimAmmoFill');
const elAmmoReserve = document.getElementById('aimAmmoReserve');
const elReloads = document.getElementById('aimReloads');
const elModes = document.getElementById('aimModes');
const elBotRow = document.getElementById('aimBotRow');
const elDifficulty = document.getElementById('aimDifficulty');
const elBotCount = document.getElementById('aimBotCount');
const elTargetRow = document.getElementById('aimTargetRow');
const elScoreLabel = document.getElementById('aimScoreLabel');
const elAccLabel = document.getElementById('aimAccLabel');
const elHealth = document.getElementById('aimHealth');
const elEggs = document.getElementById('aimEggs');
const elSound = document.getElementById('aimSound');
const elFullscreen = document.getElementById('aimFullscreen');
const elSensRange = document.getElementById('aimSensRange');
const elSensValue = document.getElementById('aimSensValue');

// Touch devices have no pointer to lock, so they aim by tapping the target
// directly and the copy changes to match.
const touchOnly = window.matchMedia('(hover: none), (pointer: coarse)').matches;

let renderer, scene, camera, targetGroup;

// Two ways to play: the aim trainer's floating targets, or walking a map
// against bots that shoot back (bots.js).
const MODES = [
    { id: 'aim', label: 'aim lab' },
    { id: 'bots', label: 'bots' },
];
let mode = 'aim';
let bots = null;
let kills = 0;
let deaths = 0;
const botsMode = () => mode === 'bots';

// Movement keys, held.
const keys = { forward: false, back: false, left: false, right: false, jump: false, walk: false, crouch: false };
const KEYMAP = {
    KeyW: 'forward', ArrowUp: 'forward',
    KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    Space: 'jump',
    ShiftLeft: 'walk', ShiftRight: 'walk',
    ControlLeft: 'crouch', ControlRight: 'crouch', KeyC: 'crouch',
};
function clearKeys() {
    for (const k of Object.keys(keys)) keys[k] = false;
}
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

    camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 420);
    camera.position.set(0, 0, 0);

    // Everything that is not a target (sky, ground, props, lights) belongs to
    // the map and lives under one group, so switching maps is one swap.
    envRoot = new THREE.Group();
    scene.add(envRoot);
    selectMap(mapKind.id);

    targetGroup = new THREE.Group();
    scene.add(targetGroup);
    for (let i = 0; i < TARGET_COUNT; i++) targetGroup.add(makeTarget());

    buildBursts();
}

/* ---------- maps ---------- */

const BASE_FOV = 68;
const FLOOR_Y = -ROOM.h / 2;
let envRoot;
let envUpdate = null;
let skyMesh = null;
// Whether the map in the scene is the bots-mode build, and its walkable edges.
let builtWide = false;
let mapBounds = null;
let mapColliders = [];

// A texture painted once on a canvas. Every map surface is procedural, so the
// page ships no image assets for any of this.
function paint(size, draw, repeat = 1) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.anisotropy = 4;
    return tex;
}

// Scattered specks over a flat colour: sand, snow, concrete.
function speckle(base, specks, count, size = 256) {
    return (ctx) => {
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i < count; i++) {
            ctx.fillStyle = specks[i % specks.length];
            ctx.globalAlpha = 0.25 + Math.random() * 0.5;
            const r = 0.6 + Math.random() * 1.8;
            ctx.fillRect(Math.random() * size, Math.random() * size, r, r);
        }
        ctx.globalAlpha = 1;
    };
}

// A gradient sky on the inside of a sphere. The horizon colour matches the fog,
// so the ground fades into the sky with no visible edge.
function skyDome(root, top, horizon, bottom, exponent = 0.6) {
    const material = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
            top: { value: new THREE.Color(top) },
            horizon: { value: new THREE.Color(horizon) },
            bottom: { value: new THREE.Color(bottom) },
            exponent: { value: exponent },
        },
        vertexShader: `
            varying vec3 vDir;
            void main() {
                vDir = normalize(position);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: `
            uniform vec3 top;
            uniform vec3 horizon;
            uniform vec3 bottom;
            uniform float exponent;
            varying vec3 vDir;
            void main() {
                float h = vDir.y;
                vec3 c = h > 0.0 ? mix(horizon, top, pow(h, exponent)) : mix(horizon, bottom, pow(-h, 0.5));
                gl_FragColor = vec4(c, 1.0);
                #include <colorspace_fragment>
            }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), material);
    dome.renderOrder = -1;
    // Drawn first and never written to depth, so it sits behind everything
    // whatever its size; it follows the camera (see loop) so it never ends.
    dome.frustumCulled = false;
    root.add(dome);
    skyMesh = dome;
}

function ground(root, material, size = 900) {
    // Texture repeats were set for a 480-unit ground; keep the same tile size.
    if (material.map) material.map.repeat.multiplyScalar(size / 480);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    root.add(floor);
    return floor;
}

function light(root, type, color, intensity, position) {
    const l = type === 'dir' ? new THREE.DirectionalLight(color, intensity)
        : type === 'point' ? new THREE.PointLight(color, intensity, 40)
        : new THREE.AmbientLight(color, intensity);
    if (position) l.position.set(position[0], position[1], position[2]);
    root.add(l);
    return l;
}

// The original: a dark wireframe room. Flat, low light, so the targets carry
// all the contrast.
function buildRange(root, opts = {}) {
    light(root, 'ambient', 0xf0e9dd, 1.35);
    light(root, 'dir', 0xf0e9dd, 1.1, [4, 8, 6]);
    light(root, 'point', 0xf0e9dd, 10, [0, -3, -8]);

    // Bots mode gets a hall four times the size, full of cover blocks.
    const size = opts.wide ? 160 : ROOM.w;
    const box = new THREE.BoxGeometry(size, ROOM.h, size);
    root.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(box),
        new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.18 })
    ));
    root.add(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x191a19, side: THREE.BackSide })));

    const grid = new THREE.GridHelper(size, size, 0xa67d43, INK);
    grid.position.y = FLOOR_Y + 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.12;
    root.add(grid);

    if (!opts.wide) return undefined;
    // A bigger hall needs more light and a longer fog to see across it.
    light(root, 'ambient', 0xf0e9dd, 0.6);
    light(root, 'dir', 0xf0e9dd, 0.8, [-30, 40, -20]);
    const face = new THREE.MeshStandardMaterial({ color: 0x3d403d, roughness: 0.9 });
    const edge = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.45 });
    const cover = (x, z, w, d, h) => {
        const mesh = block(root, face, [w, h, d], [x, 0, z]);
        const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edge);
        mesh.add(lines);
    };
    outskirts(root, {
        seed: 11,
        gallery: { x: 56, z: 50, turn: -Math.PI / 2 },
        landmarks: ['court', 'stele'],
        landmarkSpots: { court: { x: -50, z: -55, turn: 0 }, stele: { x: 0, z: 70, turn: Math.PI } },
        rooms: [
            { x: -56, z: 50, turn: Math.PI / 2, kind: 'cafe' },
            { x: 56, z: -50, turn: -Math.PI / 2, kind: 'otaku' },
        ],
        life: { trees: true },
        galleryWall: () => face,
        inner: [-12, 12, -12, 12],
        outer: [-78, 78, -78, 78],
        cell: 18,
        density: 0.7,
        heights: [3, 9],
        building: (x, z, w, d, h) => cover(x, z, w * 0.7, d * 0.7, h),
        prop: (x, z, rng) => cover(x, z, 2 + rng() * 2, 2 + rng() * 2, 3),
    });
    return { bounds: [-78, 78, -78, 78], fog: [0x121312, 45, 175] };
}

// Sandstone blocks with mortar lines, for the desert walls.
function sandstone(ctx, size) {
    ctx.fillStyle = '#d2ae74';
    ctx.fillRect(0, 0, size, size);
    const rows = 8;
    const h = size / rows;
    for (let r = 0; r < rows; r++) {
        const offset = (r % 2) * (size / 8);
        for (let x = -offset; x < size; x += size / 4) {
            const shade = 190 + Math.floor(Math.random() * 30);
            ctx.fillStyle = `rgb(${shade + 20}, ${shade - 12}, ${shade - 70})`;
            ctx.fillRect(x + 2, r * h + 2, size / 4 - 4, h - 4);
        }
    }
    speckle('rgba(0,0,0,0)', ['#8e6d3e', '#f3dcae'], 1400, size)(ctx);
}

function crateTexture(ctx, size) {
    ctx.fillStyle = '#9b6b3a';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? '#8a5d31' : '#a8773f';
        ctx.fillRect(0, (i * size) / 6, size, size / 6 - 3);
    }
    ctx.strokeStyle = '#5e3d1d';
    ctx.lineWidth = size / 14;
    ctx.strokeRect(size / 28, size / 28, size - size / 14, size - size / 14);
    ctx.beginPath();
    ctx.moveTo(size / 14, size / 14);
    ctx.lineTo(size - size / 14, size - size / 14);
    ctx.stroke();
}

/* ---------- csgo-inspired maps ----------

   Each one is a loose, primitive-built nod to a real map: the landmarks and
   the palette that make it recognisable, kept out of the patch of sky the
   targets spawn in. Everything close to the player stays below the lowest a
   target can float, so nothing ever hides one. */

// A box standing on the floor: size is [width, height, depth], position is
// [x, height off the floor, z].
function block(root, material, size, position, turn = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    mesh.position.set(position[0], FLOOR_Y + position[1] + size[1] / 2, position[2]);
    mesh.rotation.y = turn;
    root.add(mesh);
    return mesh;
}

// A surface material with its texture tiled rx by ry times, so walls of
// different sizes keep the same brick or tile scale.
function surface(texture, rx = 1, ry = 1, options = {}) {
    const map = texture.clone();
    map.repeat.set(rx, ry);
    map.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map, roughness: 0.9, ...options });
}

const plain = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...options });

// A dark arched opening laid flat against a wall that faces +Z: a doorway
// or a window, with a round top.
function archway(root, material, width, height, x, base, z, turn = 0) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.PlaneGeometry(width, height - width / 2), material);
    body.position.y = (height - width / 2) / 2;
    group.add(body);
    const top = new THREE.Mesh(new THREE.CircleGeometry(width / 2, 24, 0, Math.PI), material);
    top.position.y = height - width / 2;
    group.add(top);
    group.position.set(x, FLOOR_Y + base, z);
    group.rotation.y = turn;
    root.add(group);
    return group;
}

// A pitched roof over a w by d footprint, ridge along x, sitting at height h.
function gableRoof(root, material, w, d, h, x, z, pitch = 0.5, turn = 0) {
    const group = new THREE.Group();
    const slope = d / 2 / Math.cos(pitch);
    for (const side of [-1, 1]) {
        const plane = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.3, slope + 0.4), material);
        plane.position.set(0, Math.sin(pitch) * slope / 2, side * d / 4);
        plane.rotation.x = side * pitch;
        group.add(plane);
    }
    group.position.set(x, FLOOR_Y + h, z);
    group.rotation.y = turn;
    root.add(group);
}

/* ----- bots mode: the wider maps -----

   In bots mode each map grows well past its original courtyard. The original
   stays as the centre, and the ring round it is filled with that map's own
   kind of building, laid out on a loose grid so there are streets between
   them, with a few lanes kept clear so the centre opens out onto the rest. A
   seeded random keeps the layout the same every visit. */

const WIDE_BOUNDS = [-115, 115, -130, 105];
// Where the gallery stands on most maps, door facing the middle.
const GALLERY_SPOT = { x: 62, z: 48, turn: -Math.PI / 2 };

function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const overlaps = (a, b) => a[0] < b[1] && a[1] > b[0] && a[2] < b[3] && a[3] > b[2];

function outskirts(root, cfg) {
    const rng = seeded(cfg.seed);
    const range = (lo, hi) => lo + rng() * (hi - lo);
    const outer = cfg.outer || WIDE_BOUNDS;
    const cell = cfg.cell || 22;
    const keep = [cfg.inner.map((v, i) => v + (i % 2 ? 5 : -5)), ...(cfg.keepClear || [])];
    // The gallery's plot, and the easter eggs still to hide.
    const spot = cfg.gallery;
    if (spot) keep.push([spot.x - 10, spot.x + 10, spot.z - 14, spot.z + 18]);
    // The café and the den, each on its own plot.
    const rooms = cfg.rooms ?? (spot ? ROOM_SPOTS : []);
    for (const r of rooms) keep.push([r.x - 10, r.x + 10, r.z - 14, r.z + 14]);
    const eggQueue = cfg.eggs === false ? [] : [...EGGS];
    // Open corners of street cells an egg could sit in, gathered as the grid
    // is laid out and drawn from at random afterwards, so eggs spread out.
    const eggSpots = [];
    // Landmarks claim their ground first.
    const landmarkSpots = cfg.landmarkSpots || LANDMARK_SPOTS;
    for (const name of cfg.landmarks || []) {
        const at = landmarkSpots[name];
        const [lw, ld] = LANDMARK_SIZES[name];
        keep.push([at.x - lw / 2, at.x + lw / 2, at.z - ld / 2, at.z + ld / 2]);
    }
    const blocked = (rect) => keep.some((k) => overlaps(rect, k));
    for (let cx = outer[0] + cell / 2; cx < outer[1]; cx += cell) {
        for (let cz = outer[2] + cell / 2; cz < outer[3]; cz += cell) {
            const roll = rng();
            if (roll < (cfg.density ?? 0.72)) {
                const h = range(cfg.heights?.[0] ?? 8, cfg.heights?.[1] ?? 16);
                // Judged on the building's own footprint (with room for side
                // stairs), not its whole cell, and tried a few ways, so
                // buildings pack in right up to the reserved areas.
                let placed = false;
                for (let tryNo = 0; tryNo < 4 && !placed; tryNo++) {
                    let w = range(cfg.minSize ?? 8, cell - 6);
                    let d = range(cfg.minSize ?? 8, cell - 6);
                    let bh = h;
                    // Town maps mix it up: some towers, some long blocks, the
                    // rest ordinary, so no two streets look the same.
                    if (cfg.variety) {
                        const shape = rng();
                        if (shape < 0.18) {
                            w = range(15, 19);
                            d = range(15, 19);
                            bh = range(30, 34);
                        } else if (shape < 0.42) {
                            const long = range(26, 42);
                            const short = range(15, 18);
                            [w, d] = rng() < 0.5 ? [long, short] : [short, long];
                            bh = range(12, 22);
                        }
                    }
                    const x = cx + range(-1, 1) * Math.max(0, cell - w - 6) / 2;
                    const z = cz + range(-1, 1) * Math.max(0, cell - d - 6) / 2;
                    const foot = [x - w / 2 - 3.5, x + w / 2 + 3.5, z - d / 2 - 3.5, z + d / 2 + 3.5];
                    if (blocked(foot)) continue;
                    cfg.building(x, z, w, d, bh, rng);
                    // Some flat roofs get stairs up the side, to fight from.
                    if (cfg.stairs && bh <= 12.5 && rng() < 0.35) roofStairs(root, cfg.stairs, x, z, w, d, bh);
                    // Later buildings (bigger than their cells now) keep off it.
                    keep.push(foot);
                    placed = true;
                }
                if (placed) continue;
            }
            // No building here: a prop, and a spot an egg or street life can use,
            // kept well inside the edge walls so everything can be reached.
            const px = clamp(cx + cell * 0.3, outer[0] + 5, outer[1] - 5);
            const pz = clamp(cz - cell * 0.3, outer[2] + 5, outer[3] - 5);
            if (blocked([px - 3, px + 3, pz - 3, pz + 3])) continue;
            const ox = cx + range(-5, 5);
            const oz = cz + range(-5, 5);
            if (roll < 0.93 && cfg.prop && !blocked([ox - 5, ox + 5, oz - 6, oz + 6])) cfg.prop(ox, oz, rng);
            eggSpots.push([px, pz]);
        }
    }
    // Two eggs are saved for the gallery roof; the rest go out in the streets.
    const hasCourt = (cfg.landmarks || []).includes('court');
    const onCourt = hasCourt ? eggQueue.filter((e) => e.court) : [];
    const onRoof = spot ? eggQueue.filter((e) => e.roof) : [];
    const inStreets = eggQueue.filter((e) => !onRoof.includes(e) && !onCourt.includes(e));
    eggQueue.length = 0;
    for (const egg of inStreets) {
        if (!eggSpots.length) {
            eggQueue.push(egg);
            continue;
        }
        const [ex, ez] = eggSpots.splice(Math.floor(rng() * eggSpots.length), 1)[0];
        placeEgg(root, egg, ex, ez);
    }
    eggQueue.push(...onRoof);

    // The landmarks themselves.
    for (const name of cfg.landmarks || []) {
        const at = landmarkSpots[name];
        if (name === 'tower') tower(root, at, cfg.towerStyle || { face: facadeTexture(speckle('#b9b4a8', ['#9e9990', '#cfcac0'], 1200), 'plain'), roof: plain(0x8c8478) }, rng);
        if (name === 'hangar') hangar(root, at, rng);
        if (name === 'court') {
            court(root, at);
            for (const egg of onCourt) placeEgg(root, egg, at.x + 3, at.z + 1);
        }
        if (name === 'stele') stele(root, at);
        if (name === 'lalibela') lalibela(root, at);
    }

    const roomWall = cfg.galleryWall || cfg.wall;
    for (const r of rooms) (r.kind === 'cafe' ? animeCafe : otakuDen)(root, r, roomWall, rng);
    if (cfg.life !== false) streetLife(root, eggSpots, rng, cfg.life || {});

    if (spot) {
        gallery(root, spot, cfg.galleryWall || cfg.wall);
        // Anything not hidden in the streets waits up on the gallery roof, for
        // whoever climbs the stairs.
        eggQueue.forEach((egg, i) => {
            const lx = -8 + (i % 3) * 6;
            const lz = -4 + Math.floor(i / 3) * 7;
            const c = Math.cos(spot.turn);
            const sn = Math.sin(spot.turn);
            const g = placeEgg(root, egg, spot.x + lx * c + lz * sn, spot.z - lx * sn + lz * c);
            g.position.y = 10.8;
        });
    }

    // A low wall round the edge: too high to jump, low enough to see over.
    if (cfg.wall) {
        const [x0, x1, z0, z1] = outer;
        const h = cfg.wallHeight || 7;
        const w = x1 - x0;
        const d = z1 - z0;
        block(root, cfg.wall(w, h), [w + 2, h, 2], [(x0 + x1) / 2, 0, z0 - 1]);
        block(root, cfg.wall(w, h), [w + 2, h, 2], [(x0 + x1) / 2, 0, z1 + 1]);
        block(root, cfg.wall(d, h), [2, h, d], [x0 - 1, 0, (z0 + z1) / 2]);
        block(root, cfg.wall(d, h), [2, h, d], [x1 + 1, 0, (z0 + z1) / 2]);
    }
}

/* ----- the personal touches: a gallery, stairs, and easter eggs -----

   Every bots-mode map has the same gallery somewhere in it: a room of framed
   photos from the site with little museum placards, a painted centrepiece of
   where this all started, and a wall of the places I have worked, with stairs
   up to a rooftop. Some buildings get stairs to their roofs too. And seven
   things about me are hidden round each map; shooting one finds it. */

// Photos from the site, and the placards that go under them.
const GALLERY_PHOTOS = {
    centre: { src: 'images/aim-inspo.jpg', caption: 'me and my brother · csgo · where this started' },
    back: [
        { src: 'images/web/IMG_4528.jpg', caption: 'injera' },
        { src: 'images/web/IMG_2962.jpg', caption: 'ambo' },
    ],
    left: [
        { src: 'images/web/IMG_3782.jpg', caption: 'golden gate' },
        { src: 'images/web/IMG_3040.jpg', caption: 'sf at night' },
        { src: 'images/web/IMG_4097.jpg', caption: 'presenting' },
        { src: 'images/web/IMG_4860.jpg', caption: 'afrotech' },
    ],
    right: [
        { src: 'images/web/IMG_4486.jpg', caption: 'mit' },
        { src: 'images/web/IMG_5165.jpg', caption: 'liberty mutual' },
        { src: 'images/web/IMG_4524.jpg', caption: 'the hat' },
        { src: 'images/web/IMG_4038.jpg', caption: 'the setup' },
    ],
    logos: ['logos/nmdp.png', 'logos/libertymutual.png', 'logos/medica.png', 'logos/medtronic.png', 'logos/gustavus.png'],
};

// Draws an image to fill a canvas, cropped to fit. As a painting it is laid
// down as thousands of short strokes in the photo's own colours over a soft
// underpainting, with a faint canvas weave on top.
function drawCover(ctx, img, W, H, painting) {
    const scale = Math.max(W / img.width, H / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;
    if (!painting) {
        ctx.drawImage(img, dx, dy, dw, dh);
        return;
    }
    const sw = 120;
    const sh = Math.round((120 * H) / W);
    const small = document.createElement('canvas');
    small.width = sw;
    small.height = sh;
    const sctx = small.getContext('2d');
    sctx.drawImage(img, (dx * sw) / W, (dy * sh) / H, (dw * sw) / W, (dh * sh) / H);
    const data = sctx.getImageData(0, 0, sw, sh).data;

    ctx.filter = 'blur(4px) saturate(1.3)';
    ctx.drawImage(small, 0, 0, W, H);
    ctx.filter = 'none';
    ctx.lineCap = 'round';
    // Broad strokes first, then finer ones on top, the way it would be painted.
    for (let i = 0; i < 11000; i++) {
        const fine = i > 6000;
        const x = Math.random() * W;
        const y = Math.random() * H;
        const k = (Math.floor((y * sh) / H) * sw + Math.floor((x * sw) / W)) * 4;
        const lift = fine ? 12 : 0;
        ctx.strokeStyle = `rgba(${Math.min(255, data[k] + lift)}, ${Math.min(255, data[k + 1] + lift)}, ${Math.min(255, data[k + 2] + lift)}, 0.92)`;
        ctx.lineWidth = fine ? 3 + Math.random() * 3 : 7 + Math.random() * 7;
        const a = Math.random() * Math.PI;
        const len = fine ? 8 + Math.random() * 12 : 16 + Math.random() * 22;
        ctx.beginPath();
        ctx.moveTo(x - (Math.cos(a) * len) / 2, y - (Math.sin(a) * len) / 2);
        ctx.lineTo(x + (Math.cos(a) * len) / 2, y + (Math.sin(a) * len) / 2);
        ctx.stroke();
    }
    ctx.globalAlpha = 0.06;
    for (let y = 0; y < H; y += 3) {
        ctx.fillStyle = y % 6 ? '#000' : '#fff';
        ctx.fillRect(0, y, W, 1);
    }
    ctx.globalAlpha = 1;
}

// A texture that fills in when its image arrives. Dark until then, so a slow
// connection shows empty frames rather than nothing.
function imageTexture(src, w, h, { painting = false, contain = false, background = '#2a2622' } = {}) {
    const c = document.createElement('canvas');
    const px = painting ? 1024 : 512;
    c.width = px;
    c.height = Math.round((px * h) / w);
    const ctx = c.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const img = new Image();
    img.onload = () => {
        if (contain) {
            // Logos sit inside a margin on a white card rather than filling it.
            const pad = c.width * 0.1;
            const s = Math.min((c.width - pad * 2) / img.width, (c.height - pad * 2) / img.height);
            ctx.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s);
        } else {
            drawCover(ctx, img, c.width, c.height, painting);
        }
        tex.needsUpdate = true;
    };
    img.src = src;
    return tex;
}

function labelTexture(lines, { width = 512, height = 160, bg = '#efe6d2', fg = '#2a241c', size = 44 } = {}) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => {
        ctx.font = `${i === 0 ? 600 : 400} ${i === 0 ? size : size * 0.62}px Inter, Helvetica, Arial, sans-serif`;
        ctx.fillText(line, width / 2, height / 2 + (i - (lines.length - 1) / 2) * size * 1.05, width - 20);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

const GOLD = metal(0xb8913a, 0.35, 0.7);

// A framed picture flat against a wall, facing +Z in the group it is added
// to, with a placard under it.
function framed(parent, texture, w, h, x, y, z, turn, caption, frame = GOLD) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = turn;
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 }));
    pic.position.z = 0.06;
    g.add(pic);
    const t = 0.28;
    for (const [bw, bh, bx, by] of [[w + t * 2, t, 0, h / 2 + t / 2], [w + t * 2, t, 0, -h / 2 - t / 2], [t, h, -w / 2 - t / 2, 0], [t, h, w / 2 + t / 2, 0]]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.22), frame);
        bar.position.set(bx, by, 0.08);
        g.add(bar);
    }
    if (caption) {
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w, 3.2), 0.7), new THREE.MeshBasicMaterial({ map: labelTexture([caption], { size: caption.length > 24 ? 30 : 44 }) }));
        plate.position.set(0, -h / 2 - 0.9, 0.05);
        g.add(plate);
    }
    g.traverse((o) => {
        o.userData.noCollide = true;
    });
    parent.add(g);
    return g;
}

// Solid steps up the side of something `rise` tall, climbing along -Z from
// z0, each no taller than a single step can take.
function steps(parent, material, x, z0, rise, run, width = 3) {
    const n = Math.ceil(rise / 1.0);
    const depth = run / n;
    for (let i = 0; i < n; i++) {
        const h = Math.min(rise, ((i + 1) * rise) / n);
        block(parent, material, [width, h, depth + 0.02], [x, 0, z0 - depth * (i + 0.5)]);
    }
}

function flagWalkable(mesh) {
    mesh.userData.walkable = true;
    return mesh;
}

// The gallery. Local frame: door in the front (+Z) wall, stairs up the
// outside of the +X wall to a rooftop with a parapet.
function gallery(root, { x, z, turn }, wallMaterial) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = turn;
    root.add(g);

    const W = 24;
    const D = 16;
    const H = 10;
    const T = 0.6;
    const wall = wallMaterial(W, H);
    block(g, wall, [W, H, T], [0, 0, -D / 2]);
    block(g, wall, [T, H, D], [-W / 2, 0, 0]);
    block(g, wall, [T, H, D], [W / 2, 0, 0]);
    const side = W / 2 - 2.5;
    block(g, wall, [side, H, T], [-(2.5 + side / 2), 0, D / 2]);
    block(g, wall, [side, H, T], [2.5 + side / 2, 0, D / 2]);
    block(g, wall, [5, H - 8, T], [0, 8, D / 2]);

    // A walkable roof with a low parapet, open where the stairs arrive.
    const roofMat = plain(0x8c8478);
    flagWalkable(block(g, roofMat, [W + 1, 0.8, D + 1], [0, H, 0]));
    const lip = plain(0x9a9184);
    block(g, lip, [W + 1, 1.4, 0.4], [0, H + 0.8, -D / 2 - 0.3]);
    block(g, lip, [W + 1, 1.4, 0.4], [0, H + 0.8, D / 2 + 0.3]);
    block(g, lip, [0.4, 1.4, D + 1], [-W / 2 - 0.3, H + 0.8, 0]);
    block(g, lip, [0.4, 1.4, D - 4], [W / 2 + 0.3, H + 0.8, 2]);
    steps(g, plain(0x7d7568), W / 2 + 1.8, D / 2 - 0.2, H + 0.8, D - 1.2);

    // Inside: a warm light, wood floor, a rug and a bench.
    const lamp = new THREE.PointLight(0xffe2b8, 60, 34);
    lamp.position.set(0, H - 2, 0);
    g.add(lamp);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, D - 1), surface(shared('floor', () => paint(128, planks('#7a5332', '#4a3220'))), 6, 4));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y + 0.03;
    g.add(floor);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), new THREE.MeshStandardMaterial({ map: shared('carpet', () => paint(128, carpet)), roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, FLOOR_Y + 0.05, 1);
    g.add(rug);
    block(g, plain(0x3b2a1c), [6, 1.2, 1.4], [0, 0, 1]);

    // The walls, hung.
    const P = GALLERY_PHOTOS;
    const inner = D / 2 - T / 2;
    framed(g, imageTexture(P.centre.src, 8, 6.2, { painting: true }), 8, 6.2, 0, FLOOR_Y + 5.4, -inner, 0, P.centre.caption);
    framed(g, imageTexture(P.back[0].src, 3, 4), 3, 4, -8.2, FLOOR_Y + 5.2, -inner, 0, P.back[0].caption);
    framed(g, imageTexture(P.back[1].src, 3, 4), 3, 4, 8.2, FLOOR_Y + 5.2, -inner, 0, P.back[1].caption);
    const wx = W / 2 - T / 2;
    P.left.forEach((p, i) => framed(g, imageTexture(p.src, 2.6, 3.4), 2.6, 3.4, -wx, FLOOR_Y + 5.2, -5.4 + i * 3.6, Math.PI / 2, p.caption));
    P.right.forEach((p, i) => framed(g, imageTexture(p.src, 2.6, 3.4), 2.6, 3.4, wx, FLOOR_Y + 5.2, 5.4 - i * 3.6, -Math.PI / 2, p.caption));

    // Where I have worked, on the inside of the front wall.
    const dark = metal(0x2a2622, 0.6, 0.2);
    const logoAt = [[-9, 5.5], [-5.6, 5.5], [5.6, 5.5], [9, 5.5], [0, 9]];
    P.logos.forEach((src, i) => {
        const [lx, ly] = logoAt[i];
        framed(g, imageTexture(src, 2.6, 1.3, { contain: true, background: '#ffffff' }), 2.6, 1.3, lx, FLOOR_Y + ly, inner, Math.PI, null, dark);
    });

    // The sign over the door.
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.4), new THREE.MeshBasicMaterial({ map: labelTexture(['youdahe’s gallery', 'come in'], { bg: '#1c1a17', fg: '#f0e9dd' }) }));
    sign.position.set(0, FLOOR_Y + 8.9, D / 2 + T / 2 + 0.05);
    sign.userData.noCollide = true;
    g.add(sign);
    return g;
}

// Stairs up the side of a flat-roofed building, so its roof becomes a place
// to fight from.
function roofStairs(root, material, x, z, w, d, h) {
    const g = new THREE.Group();
    g.position.set(x + w / 2 + 1.6, 0, z);
    root.add(g);
    steps(g, material, 0, d / 2, h, d);
}

/* ----- easter eggs ----- */

let eggMeshes = [];

function eggLabel(text, w, h, size = 44, bg = '#f4efe4', fg = '#b0261c') {
    return new THREE.MeshBasicMaterial({ map: labelTexture([text], { width: 256, height: Math.round((256 * h) / w), bg, fg, size }) });
}

const EGG_BUILDERS = {
    // Ambo, the Ethiopian sparkling water, in its green bottle.
    ambo() {
        const g = new THREE.Group();
        block(g, surface(shared('crate', () => paint(128, crateTexture))), [1.6, 1.6, 1.6], [0, 0, 0]);
        const glass = new THREE.MeshStandardMaterial({ color: 0x2f8f3a, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.85 });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.4, 20), glass);
        body.position.y = FLOOR_Y + 1.6 + 0.7;
        const label = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.55, 20, 1, true), eggLabel('አምቦ AMBO', 3, 1, 50));
        label.position.y = FLOOR_Y + 1.6 + 0.7;
        const shoulder = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.4, 20), glass);
        shoulder.position.y = FLOOR_Y + 1.6 + 1.6;
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.5, 12), glass);
        neck.position.y = FLOOR_Y + 1.6 + 1.95;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 12), plain(0xc0392b));
        cap.position.y = FLOOR_Y + 1.6 + 2.24;
        g.add(body, label, shoulder, neck, cap);
        return g;
    },
    // The beaver: the aim trainer's first target.
    beaver() {
        const g = new THREE.Group();
        const b = makeBeaver();
        b.scale.setScalar(1.4);
        b.position.y = FLOOR_Y + 1.25;
        g.add(b);
        return g;
    },
    // The "artificially intelligent" cap, left on a crate.
    hat() {
        const g = new THREE.Group();
        block(g, surface(shared('crate', () => paint(128, crateTexture))), [2, 2, 2], [0, 0, 0]);
        const denim = plain(0x46546a);
        const crown = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), denim);
        crown.position.y = FLOOR_Y + 2;
        const brim = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.8), denim);
        brim.position.set(0, FLOOR_Y + 2.03, 0.9);
        const words = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.3), eggLabel('artificially intelligent', 3, 1, 24, '#46546a', '#f0e9dd'));
        words.position.set(0, FLOOR_Y + 2.35, 0.62);
        words.rotation.x = -0.5;
        g.add(crown, brim, words);
        return g;
    },
    // A plate of injera with the stews on top, on a low table.
    injera() {
        const g = new THREE.Group();
        block(g, plain(0x5b3a22), [3, 1.8, 3], [0, 0, 0]);
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.25, 0.1, 32), plain(0xf2efe8));
        plate.position.y = FLOOR_Y + 1.85;
        const bread = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.06, 32),
            new THREE.MeshStandardMaterial({ map: paint(128, speckle('#c9a878', ['#a88a5e', '#dcc29a'], 1400)), roughness: 1 }));
        bread.position.y = FLOOR_Y + 1.93;
        g.add(plate, bread);
        [[0xc2521f, 0.4, 0.3], [0xd9a441, -0.4, 0.3], [0x4f7a2e, 0, -0.45], [0x6b3a1f, -0.5, -0.35], [0xb8341f, 0.5, -0.3]].forEach(([color, sx, sz]) => {
            const stew = new THREE.Mesh(UNIT_BALL, plain(color));
            stew.scale.set(0.32, 0.1, 0.32);
            stew.position.set(sx, FLOOR_Y + 2, sz);
            g.add(stew);
        });
        return g;
    },
    // youdaheDB, the database I am writing in Rust, as a little server rack.
    youdahedb() {
        const g = new THREE.Group();
        block(g, plain(0x1b1c1e, { metalness: 0.4 }), [1.8, 3.4, 1.3], [0, 0, 0]);
        for (let i = 0; i < 5; i++) {
            block(g, plain(0x2c2e31), [1.6, 0.5, 0.05], [0, 0.35 + i * 0.6, 0.66]);
            const led = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x3cff6a : 0x4fb3ff }));
            led.position.set(0.6, FLOOR_Y + 0.6 + i * 0.6, 0.7);
            g.add(led);
        }
        const tag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), eggLabel('youdaheDB', 4, 1, 60, '#1b1c1e', '#3cff6a'));
        tag.position.set(0, FLOOR_Y + 3.6, 0.2);
        g.add(tag);
        return g;
    },
    // The laptop from the photo, open on csgo.
    laptop() {
        const g = new THREE.Group();
        block(g, plain(0x6b4a2c), [3, 1.8, 2], [0, 0, 0]);
        const silver = plain(0xb9bcc1, { metalness: 0.5, roughness: 0.4 });
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 1.2), silver);
        base.position.y = FLOOR_Y + 1.84;
        const screen = new THREE.Group();
        screen.position.set(0, FLOOR_Y + 1.88, -0.6);
        screen.rotation.x = -0.25;
        const lid = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 0.06), silver);
        lid.position.y = 0.6;
        const game = paint(256, (ctx, size) => {
            const sky = ctx.createLinearGradient(0, 0, 0, size);
            sky.addColorStop(0, '#8fb3d9');
            sky.addColorStop(0.45, '#f1d9a6');
            sky.addColorStop(0.46, '#c9a46a');
            sky.addColorStop(1, '#a8834d');
            ctx.fillStyle = sky;
            ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = '#b8945c';
            ctx.fillRect(size * 0.1, size * 0.3, size * 0.35, size * 0.25);
            ctx.strokeStyle = '#3cff3c';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(size / 2 - 14, size / 2); ctx.lineTo(size / 2 - 5, size / 2);
            ctx.moveTo(size / 2 + 5, size / 2); ctx.lineTo(size / 2 + 14, size / 2);
            ctx.moveTo(size / 2, size / 2 - 14); ctx.lineTo(size / 2, size / 2 - 5);
            ctx.moveTo(size / 2, size / 2 + 5); ctx.lineTo(size / 2, size / 2 + 14);
            ctx.stroke();
            ctx.fillStyle = '#f0e9dd';
            ctx.font = 'bold 22px monospace';
            ctx.fillText('100', 12, size - 14);
            ctx.fillText('30/90', size - 80, size - 14);
        });
        const face = new THREE.Mesh(new THREE.PlaneGeometry(1.64, 1.04), new THREE.MeshBasicMaterial({ map: game }));
        face.position.set(0, 0.6, 0.04);
        screen.add(lid, face);
        g.add(base, screen);
        return g;
    },
    // The camera from AfroTech.
    camera() {
        const g = new THREE.Group();
        block(g, surface(shared('crate', () => paint(128, crateTexture))), [1.8, 1.8, 1.8], [0, 0, 0]);
        const black = plain(0x1a1a1a, { roughness: 0.6 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.5), black);
        body.position.y = FLOOR_Y + 2.2;
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.5, 20), black);
        lens.rotation.x = Math.PI / 2;
        lens.position.set(0, FLOOR_Y + 2.15, 0.45);
        const glass = new THREE.Mesh(new THREE.CircleGeometry(0.24, 20), new THREE.MeshStandardMaterial({ color: 0x1d4a6e, roughness: 0.05, metalness: 0.9 }));
        glass.position.set(0, FLOOR_Y + 2.15, 0.71);
        const tag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.3), eggLabel('AFROTECH', 4, 1, 60, '#1a1a1a', '#f0e9dd'));
        tag.position.set(0, FLOOR_Y + 2.72, 0.1);
        g.add(body, lens, glass, tag);
        return g;
    },
};

const EGGS = [
    { id: 'ambo', note: 'ambo · a taste of home' },
    { id: 'beaver', note: 'the beaver · this aim trainer’s first target' },
    { id: 'hat', note: 'artificially intelligent · the hat' },
    { id: 'injera', note: 'injera · no debate, best food' },
    { id: 'youdahedb', note: 'youdaheDB · a database, in rust, for fun' },
    { id: 'laptop', note: 'the laptop · where the csgo addiction started', roof: true },
    { id: 'camera', note: 'afrotech', roof: true },
];

function placeEgg(root, egg, x, z) {
    const g = EGG_BUILDERS[egg.id]();
    g.position.set(x, 0, z);
    g.rotation.y = Math.atan2(-x, -z);
    g.userData.egg = egg;
    g.traverse((o) => {
        o.userData.noCollide = true;
    });
    root.add(g);
    eggMeshes.push(g);
    return g;
}

/* ----- drawing the maps fast -----

   A built map is thousands of little meshes: every brick wall, stair, chair
   and poster its own draw call. After a map is built (and its collision boxes
   read off), everything that never moves is merged: meshes are grouped by
   material and by which 48-unit patch of ground they stand in, and each group
   becomes one mesh. A few hundred draw calls a frame becomes a few dozen, and
   because each merged mesh covers one patch, anything behind the camera or out
   past the fog is skipped whole. */

const CHUNK = 48;
let chunkMeshes = [];

// Textures that repeat all over a map (crates, rugs, floors, posters, house
// fronts) are painted once per map and shared, since only meshes that share a
// texture can be merged into one draw call.
const sharedTextures = new Map();
function shared(key, make) {
    if (!sharedTextures.has(key)) sharedTextures.set(key, make());
    return sharedTextures.get(key);
}

// Two materials that would draw the same get the same key, so their meshes
// can share one draw call. Texture repeats are baked into the geometry's UVs
// below, so walls cut from the same texture at different sizes still match.
function materialKey(m) {
    return [
        m.type, m.color?.getHex(), m.map?.source?.uuid, m.roughness, m.metalness,
        m.transparent, m.opacity, m.side, m.emissive?.getHex(), m.emissiveIntensity,
        m.flatShading, m.depthWrite, m.polygonOffset, m.vertexColors, m.wireframe,
    ].join('|');
}

const canonical = new Map();
function canonicalMaterial(key, m) {
    if (canonical.has(key)) return canonical.get(key);
    const c = m.clone();
    if (m.map) {
        c.map = m.map.clone();
        c.map.repeat.set(1, 1);
        c.map.offset.set(0, 0);
        c.map.needsUpdate = true;
    }
    canonical.set(key, c);
    return c;
}

// One geometry per material group, in world space, with only the attributes
// every merged mesh can share.
function worldPieces(mesh) {
    const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    source.applyMatrix4(mesh.matrixWorld);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = Array.isArray(mesh.material) && source.groups.length
        ? source.groups
        : [{ start: 0, count: source.attributes.position.count, materialIndex: 0 }];
    const pieces = [];
    for (const group of groups) {
        const m = materials[group.materialIndex];
        if (!m) continue;
        const g = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'uv']) {
            const attr = source.attributes[name];
            const size = name === 'uv' ? 2 : 3;
            const array = new Float32Array(group.count * size);
            if (attr) {
                for (let i = 0; i < group.count; i++) {
                    for (let k = 0; k < size; k++) array[i * size + k] = attr.getComponent(group.start + i, k);
                }
            }
            g.setAttribute(name, new THREE.BufferAttribute(array, size));
        }
        if (m.map) {
            const uv = g.attributes.uv;
            const { repeat, offset } = m.map;
            for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repeat.x + offset.x, uv.getY(i) * repeat.y + offset.y);
        }
        pieces.push({ g, m });
    }
    source.dispose();
    return pieces;
}

function isStatic(o) {
    for (let up = o; up; up = up.parent) {
        if (up.userData.egg || up.userData.dynamic) return false;
    }
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    return materials.every((m) => m && (m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshToonMaterial));
}

function batchStatic(root) {
    chunkMeshes = [];
    root.updateMatrixWorld(true);
    const buckets = new Map();
    const merged = [];
    const box = new THREE.Box3();
    const centre = new THREE.Vector3();
    root.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !isStatic(o)) return;
        box.setFromObject(o);
        box.getCenter(centre);
        const chunk = `${Math.floor(centre.x / CHUNK)},${Math.floor(centre.z / CHUNK)}`;
        for (const { g, m } of worldPieces(o)) {
            const key = materialKey(m);
            const bucketKey = `${key}#${chunk}`;
            if (!buckets.has(bucketKey)) buckets.set(bucketKey, { material: canonicalMaterial(key, m), list: [] });
            buckets.get(bucketKey).list.push(g);
        }
        merged.push(o);
    });
    for (const o of merged) o.parent.remove(o);
    for (const { material, list } of buckets.values()) {
        const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
        for (const piece of list) if (piece !== g) piece.dispose();
        if (!g) continue;
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, material);
        m.matrixAutoUpdate = false;
        root.add(m);
        chunkMeshes.push(m);
    }
}

// Merged patches past the fog (plus their own size) are not drawn at all.
function cullChunks() {
    const far = (scene.fog ? scene.fog.far : 260) + 20;
    for (const m of chunkMeshes) {
        const s = m.geometry.boundingSphere;
        m.visible = s.center.distanceTo(camera.position) - s.radius < far;
    }
}

/* ----- personality: real buildings, furniture, and anime -----

   The wide maps get lived in. Buildings get proper fronts (windows painted
   into the wall texture so it stays one mesh a building, plus a door, an
   awning, sometimes a poster, an air conditioner on the roof). Two buildings
   on every map can be walked into: an anime café and an otaku den, both
   furnished. The streets get café tables, benches, vending machines, cherry
   trees, lanterns and statues. The anime here is all original: posters
   painted from scratch, and four little creatures of my own in that style. */

// Things that are only there to look at: skipped by collision and bullets.
function deco(mesh) {
    mesh.traverse((o) => {
        o.userData.noCollide = true;
    });
    return mesh;
}

function mesh(parent, geometry, material, position, rotation) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(position[0], FLOOR_Y + position[1], position[2]);
    if (rotation) m.rotation.set(rotation[0], rotation[1], rotation[2]);
    parent.add(m);
    return m;
}

/* ----- furniture ----- */

const WOODS = [plain(0x6b4526), plain(0x8a5a33), plain(0x4a3020)];

// A chair facing +Z in its own group, turned to face whatever it is at.
function chair(parent, x, z, turn, material = WOODS[0], seat = null) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = turn;
    block(g, seat || material, [1.3, 0.16, 1.3], [0, 1.45, 0]);
    for (const [lx, lz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) block(g, material, [0.12, 1.45, 0.12], [lx, 0, lz]);
    block(g, material, [1.3, 1.7, 0.14], [0, 1.6, -0.6]);
    parent.add(g);
    return g;
}

function stool(parent, x, z, top = plain(0xb8341f)) {
    mesh(parent, new THREE.CylinderGeometry(0.55, 0.55, 0.2, 16), top, [x, 2.3, z]);
    mesh(parent, new THREE.CylinderGeometry(0.1, 0.14, 2.2, 8), plain(0x6f7477, { metalness: 0.5 }), [x, 1.1, z]);
}

function table(parent, x, z, r = 1.3, top = WOODS[1]) {
    mesh(parent, new THREE.CylinderGeometry(r, r, 0.14, 24), top, [x, 2.4, z]);
    mesh(parent, new THREE.CylinderGeometry(0.12, 0.3, 2.4, 10), plain(0x2f2a26), [x, 1.2, z]);
}

function bench(parent, x, z, turn) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = turn;
    const wood = WOODS[1];
    const iron = plain(0x2f3033, { metalness: 0.5 });
    block(g, wood, [5, 0.2, 1.4], [0, 1.4, 0]);
    block(g, wood, [5, 1.2, 0.18], [0, 1.9, -0.65]);
    for (const lx of [-2.2, 2.2]) block(g, iron, [0.18, 1.4, 1.3], [lx, 0, 0]);
    parent.add(g);
}

// A round table with chairs and, outside, a parasol.
function cafeSet(parent, x, z, rng, parasol = true) {
    table(parent, x, z);
    const n = rng() < 0.5 ? 2 : 4;
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng() * 0.3;
        chair(parent, x + Math.sin(a) * 2.1, z + Math.cos(a) * 2.1, a + Math.PI);
    }
    if (parasol) {
        const colors = [0xd94f3d, 0x3f6fb5, 0xe8c547, 0xf2efe6, 0x4f8a3a];
        mesh(parent, new THREE.CylinderGeometry(0.08, 0.08, 6, 8), plain(0xd8d4cc), [x, 3, z]);
        deco(mesh(parent, new THREE.ConeGeometry(3, 1.2, 8), plain(colors[Math.floor(rng() * colors.length)], { side: THREE.DoubleSide }), [x, 6.2, z]));
    }
}

/* ----- the creatures: original, chibi, big-eyed ----- */

function eyes(parent, y, z, spread, r) {
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const black = new THREE.MeshBasicMaterial({ color: 0x1b1a18 });
    const blush = new THREE.MeshBasicMaterial({ color: 0xff8fb0 });
    for (const side of [-1, 1]) {
        const e = new THREE.Mesh(UNIT_BALL, black);
        e.scale.set(r * 0.8, r, r * 0.5);
        e.position.set(side * spread, y, z);
        const shine = new THREE.Mesh(UNIT_BALL, white);
        shine.scale.setScalar(r * 0.32);
        shine.position.set(side * spread + r * 0.25, y + r * 0.35, z + r * 0.35);
        const cheek = new THREE.Mesh(UNIT_BALL, blush);
        cheek.scale.set(r * 0.7, r * 0.35, r * 0.2);
        cheek.position.set(side * spread * 1.55, y - r * 1.1, z - r * 0.15);
        parent.add(e, shine, cheek);
    }
}

const CRITTERS = {
    // A teal jelly with a leaf sprouting from the top.
    mochi() {
        const g = new THREE.Group();
        const body = new THREE.Mesh(UNIT_BALL, new THREE.MeshToonMaterial({ color: 0x5fd3c4 }));
        body.scale.set(1.1, 0.85, 1);
        body.position.y = 0.85;
        g.add(body);
        // On the surface of the jelly, which bulges out to about 0.98 here.
        eyes(g, 1.0, 0.95, 0.38, 0.17);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6), toon(0x4f8a3a));
        stem.position.y = 1.85;
        g.add(stem);
        for (const side of [-1, 1]) {
            const leaf = new THREE.Mesh(UNIT_BALL, toon(0x6fbf4a));
            leaf.scale.set(0.35, 0.08, 0.18);
            leaf.position.set(side * 0.3, 2.05, 0);
            leaf.rotation.z = side * 0.4;
            g.add(leaf);
        }
        return g;
    },
    // A white cloud fox with a big orange tail.
    cloudfox() {
        const g = new THREE.Group();
        const fur = toon(0xf7f4ee);
        const body = new THREE.Mesh(UNIT_BALL, fur);
        body.scale.set(0.75, 0.7, 0.8);
        body.position.y = 0.75;
        const head = new THREE.Mesh(UNIT_BALL, fur);
        head.scale.setScalar(0.62);
        head.position.set(0, 1.65, 0.15);
        g.add(body, head);
        eyes(g, 1.72, 0.7, 0.24, 0.12);
        for (const side of [-1, 1]) {
            const ear = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 8), fur);
            ear.position.set(side * 0.35, 2.3, 0.1);
            ear.rotation.z = -side * 0.3;
            const inner = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 8), toon(0xffb3c7));
            inner.position.set(side * 0.35, 2.28, 0.18);
            inner.rotation.z = -side * 0.3;
            g.add(ear, inner);
        }
        const tail = toon(0xf08a3c);
        [[0, 0.7, -0.7, 0.45], [0, 1.2, -1.05, 0.42], [0, 1.75, -1.1, 0.36]].forEach(([tx, ty, tz, r]) => {
            const puff = new THREE.Mesh(UNIT_BALL, tail);
            puff.scale.setScalar(r);
            puff.position.set(tx, ty, tz);
            g.add(puff);
        });
        return g;
    },
    // A little purple ghost, sticking its tongue out.
    boo() {
        const g = new THREE.Group();
        const glow = new THREE.MeshToonMaterial({ color: 0x9b7bff, emissive: 0x2a1a55 });
        const head = new THREE.Mesh(UNIT_BALL, glow);
        head.scale.set(0.9, 0.95, 0.85);
        head.position.y = 1.5;
        const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.75, 0.8, 16), glow);
        skirt.position.y = 0.85;
        g.add(head, skirt);
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const bump = new THREE.Mesh(UNIT_BALL, glow);
            bump.scale.setScalar(0.26);
            bump.position.set(Math.sin(a) * 0.6, 0.45, Math.cos(a) * 0.6);
            g.add(bump);
        }
        eyes(g, 1.6, 0.78, 0.32, 0.15);
        const tongue = new THREE.Mesh(UNIT_BALL, toon(0xff6f91));
        tongue.scale.set(0.16, 0.08, 0.14);
        tongue.position.set(0, 1.2, 0.82);
        g.add(tongue);
        g.position.y = 0.4;
        return g;
    },
    // A round red chick with a flame for a crest.
    ember() {
        const g = new THREE.Group();
        const body = new THREE.Mesh(UNIT_BALL, toon(0xe04a2f));
        body.scale.set(0.95, 0.9, 0.9);
        body.position.y = 1;
        const belly = new THREE.Mesh(UNIT_BALL, toon(0xffe0b0));
        belly.scale.set(0.6, 0.55, 0.3);
        belly.position.set(0, 0.85, 0.7);
        const beak = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 8), toon(0xf5b82e));
        beak.rotation.x = Math.PI / 2;
        beak.position.set(0, 1.15, 0.95);
        g.add(body, belly, beak);
        eyes(g, 1.35, 0.78, 0.3, 0.13);
        [[0, 2.15, 0, 0.55, 0xff9a2e], [-0.18, 2.0, -0.05, 0.4, 0xffd24a], [0.2, 1.98, 0, 0.36, 0xff6a2e]].forEach(([fx, fy, fz, hgt, color]) => {
            const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, hgt, 8), new THREE.MeshBasicMaterial({ color }));
            flame.position.set(fx, fy, fz);
            g.add(flame);
        });
        for (const side of [-1, 1]) {
            const wing = new THREE.Mesh(UNIT_BALL, toon(0xb8341f));
            wing.scale.set(0.12, 0.35, 0.3);
            wing.position.set(side * 0.9, 1.05, 0);
            wing.rotation.z = side * 0.4;
            const foot = new THREE.Mesh(UNIT_BALL, toon(0xf5b82e));
            foot.scale.set(0.18, 0.08, 0.26);
            foot.position.set(side * 0.35, 0.08, 0.2);
            g.add(wing, foot);
        }
        return g;
    },
};
const CRITTER_KINDS = Object.keys(CRITTERS);

// A critter at a given size, standing on the floor (or on something `lift` tall).
function critter(parent, kind, x, z, size = 1, turn = 0, lift = 0) {
    const g = CRITTERS[kind]();
    g.scale.setScalar(size);
    g.position.set(x, FLOOR_Y + lift + (g.position.y || 0) * size, z);
    g.rotation.y = turn;
    parent.add(deco(g));
    return g;
}

/* ----- original anime posters ----- */

const POSTER_TITLES = [
    ['星の剣', 'sword of stars'], ['夏の夜', 'summer night'], ['ドラゴン', 'dragon'], ['未来', 'the future'],
    ['サムライ', 'samurai'], ['アニメ', 'anime'], ['放課後', 'after school'], ['必殺技', 'final move'],
];
const POSTER_PALETTES = [
    ['#ff7eb3', '#7afcff', '#2b1a4a'], ['#ff9a3c', '#ffd35c', '#3a1c14'], ['#6a5cff', '#ff5c8a', '#12103a'],
    ['#3ce0a0', '#f7f06d', '#123a2e'], ['#ff5c5c', '#ffe9a8', '#2a0f18'],
];

// A poster painted on a canvas: a hero silhouette in front of a big sun with
// speed lines, or one of the creatures up close, with a title in Japanese.
function animePoster(rng) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 360;
    const ctx = c.getContext('2d');
    const [a, b, ink] = POSTER_PALETTES[Math.floor(rng() * POSTER_PALETTES.length)];
    const [title, sub] = POSTER_TITLES[Math.floor(rng() * POSTER_TITLES.length)];
    const bg = ctx.createLinearGradient(0, 0, 0, 360);
    bg.addColorStop(0, a);
    bg.addColorStop(1, b);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 360);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 40; i++) {
        const ang = rng() * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(128 + Math.cos(ang) * 60, 150 + Math.sin(ang) * 60);
        ctx.lineTo(128 + Math.cos(ang) * 260, 150 + Math.sin(ang) * 260);
        ctx.stroke();
    }

    if (rng() < 0.6) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(128, 140, 70, 0, Math.PI * 2);
        ctx.fill();
        // The hero: spiky hair, a coat, a blade across the sun.
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(128, 150, 22, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 7; i++) {
            const sx = 104 + i * 8;
            ctx.beginPath();
            ctx.moveTo(sx, 140);
            ctx.lineTo(sx + 4 + (i - 3) * 3, 110 - (i % 2) * 10);
            ctx.lineTo(sx + 8, 140);
            ctx.fill();
        }
        ctx.beginPath();
        ctx.moveTo(100, 172);
        ctx.lineTo(156, 172);
        ctx.lineTo(176, 300);
        ctx.lineTo(80, 300);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(60, 110);
        ctx.lineTo(200, 250);
        ctx.stroke();
    } else {
        // A creature's face, up close.
        ctx.fillStyle = ['#5fd3c4', '#f7f4ee', '#9b7bff', '#e04a2f'][Math.floor(rng() * 4)];
        ctx.beginPath();
        ctx.arc(128, 170, 90, 0, Math.PI * 2);
        ctx.fill();
        for (const s of [-1, 1]) {
            ctx.fillStyle = '#1b1a18';
            ctx.beginPath();
            ctx.ellipse(128 + s * 34, 160, 16, 22, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(128 + s * 34 + 6, 152, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 143, 176, 0.8)';
            ctx.beginPath();
            ctx.ellipse(128 + s * 58, 195, 14, 8, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = '#fff';
        for (let i = 0; i < 12; i++) {
            const sx = rng() * 256;
            const sy = rng() * 300;
            ctx.fillRect(sx - 1, sy - 6, 2, 12);
            ctx.fillRect(sx - 6, sy - 1, 12, 2);
        }
    }

    ctx.fillStyle = ink;
    ctx.font = '900 38px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, 128, 44);
    ctx.font = '600 16px Inter, Helvetica, Arial, sans-serif';
    ctx.fillText(sub.toUpperCase(), 128, 340);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 250, 354);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// A poster flat against a surface facing `turn`, at world x, y, z.
function poster(parent, rng, x, y, z, turn, w = 2.4) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 1.4), new THREE.MeshStandardMaterial({ map: shared(`poster${Math.floor(rng() * 8)}`, () => animePoster(rng)), roughness: 0.7 }));
    p.position.set(x, FLOOR_Y + y, z);
    p.rotation.y = turn;
    parent.add(deco(p));
    return p;
}

/* ----- street life ----- */

function vendingMachine(parent, x, z, turn, rng) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = turn;
    const colors = [0xd6362b, 0x2f6fd6, 0xf2efe6];
    block(g, plain(colors[Math.floor(rng() * colors.length)], { roughness: 0.4 }), [2.6, 5.2, 1.6], [0, 0, 0]);
    const front = shared('vending', () => paint(128, (ctx, size) => {
        ctx.fillStyle = '#e9f4ff';
        ctx.fillRect(0, 0, size, size);
        const cans = ['#e0302b', '#2f9e44', '#f2b705', '#1f5fbf', '#ff7eb3', '#8c5a2b'];
        for (let r = 0; r < 3; r++) {
            for (let i = 0; i < 6; i++) {
                ctx.fillStyle = cans[(i + r * 2) % cans.length];
                ctx.fillRect(8 + i * 20, 12 + r * 30, 12, 22);
            }
        }
        ctx.fillStyle = '#1b1a18';
        ctx.font = 'bold 18px "Hiragino Sans", sans-serif';
        ctx.fillText('ドリンク', 18, 118);
    }));
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.6), new THREE.MeshBasicMaterial({ map: front }));
    panel.position.set(0, FLOOR_Y + 3.4, 0.82);
    g.add(deco(panel));
    parent.add(g);
}

function cherryTree(parent, x, z, rng) {
    mesh(parent, new THREE.CylinderGeometry(0.35, 0.6, 7, 8), plain(0x5a3a2a), [x, 3.5, z]);
    const petals = [toon(0xffb7d5), toon(0xff9cc6), toon(0xffd1e3)];
    for (let i = 0; i < 5; i++) {
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + rng() * 1.2, 1), petals[i % 3]);
        crown.position.set(x + (rng() - 0.5) * 3.5, FLOOR_Y + 7.5 + rng() * 1.8, z + (rng() - 0.5) * 3.5);
        parent.add(deco(crown));
    }
}

function lanterns(parent, x, z, turn, span = 10) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = turn;
    const post = plain(0x3b2a1c);
    block(g, post, [0.3, 8, 0.3], [-span / 2, 0, 0]);
    block(g, post, [0.3, 8, 0.3], [span / 2, 0, 0]);
    const red = new THREE.MeshBasicMaterial({ color: 0xe0452b });
    for (let i = 1; i < 6; i++) {
        const lx = -span / 2 + (i * span) / 6;
        const l = new THREE.Mesh(UNIT_BALL, red);
        l.scale.set(0.45, 0.6, 0.45);
        l.position.set(lx, FLOOR_Y + 7.2 - Math.sin((i / 6) * Math.PI) * 0.6, 0);
        g.add(deco(l));
    }
    parent.add(g);
}

function statue(parent, x, z, rng) {
    block(parent, plain(0x9a9384), [2.6, 1.6, 2.6], [x, 0, z]);
    critter(parent, CRITTER_KINDS[Math.floor(rng() * CRITTER_KINDS.length)], x, z, 1.4, rng() * Math.PI * 2, 1.6);
}

// Whatever street spots are left over after the easter eggs get something to
// look at, up to a limit.
function streetLife(root, spots, rng, opts = {}) {
    const limit = opts.limit ?? 16;
    for (let i = 0; i < Math.min(limit, spots.length); i++) {
        const [x, z] = spots.splice(Math.floor(rng() * spots.length), 1)[0];
        const roll = rng();
        const turn = Math.floor(rng() * 4) * (Math.PI / 2);
        if (roll < 0.3) cafeSet(root, x, z, rng);
        else if (roll < 0.47) vendingMachine(root, x, z, turn, rng);
        else if (roll < 0.62) statue(root, x, z, rng);
        else if (roll < 0.74) bench(root, x, z, turn);
        else if (roll < 0.87 && opts.trees) cherryTree(root, x, z, rng);
        else if (opts.lanterns) lanterns(root, x, z, turn);
        else critter(root, CRITTER_KINDS[Math.floor(rng() * CRITTER_KINDS.length)], x, z, 1.1, rng() * Math.PI * 2);
    }
}

/* ----- real buildings ----- */

// A wall texture with a window painted into every tile, so a whole building
// front is one material. Style picks the window: shuttered, plain or high.
function facadeTexture(base, style = 'plain') {
    return paint(256, (ctx, size) => {
        base(ctx, size);
        if (style === 'none') return;
        const lit = Math.random() < 0.3;
        const wx = size * 0.3;
        const wy = style === 'high' ? size * 0.12 : size * 0.26;
        const ww = size * 0.4;
        const wh = style === 'high' ? size * 0.22 : size * 0.44;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(wx - 6, wy - 6, ww + 12, wh + 14);
        ctx.fillStyle = lit ? '#f4d99a' : '#26303a';
        ctx.fillRect(wx, wy, ww, wh);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.fillRect(wx + 4, wy + 4, ww * 0.35, wh * 0.4);
        ctx.fillStyle = '#e8e2d4';
        ctx.fillRect(wx + ww / 2 - 2, wy, 4, wh);
        ctx.fillRect(wx, wy + wh / 2 - 2, ww, 4);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(wx - 8, wy + wh + 2, ww + 16, 8);
        if (style === 'shutter' || style === 'green') {
            ctx.fillStyle = style === 'green' ? '#4f7a3a' : '#2f7f9a';
            ctx.fillRect(wx - ww * 0.42, wy, ww * 0.38, wh);
            ctx.fillRect(wx + ww * 1.04, wy, ww * 0.38, wh);
        }
    });
}

// A building box with its front on the four sides and a plain roof on top.
function facadeBox(root, texture, roof, w, h, d, x, z) {
    const side = (across) => {
        const map = texture.clone();
        map.repeat.set(Math.max(1, Math.round(across / 4)), Math.max(1, Math.round(h / 4)));
        map.needsUpdate = true;
        return new THREE.MeshStandardMaterial({ map, roughness: 0.9 });
    };
    const wFace = side(w);
    const dFace = side(d);
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [dFace, dFace, roof, roof, wFace, wFace]);
    box.position.set(x, FLOOR_Y + h / 2, z);
    root.add(box);
    return box;
}

// A door, an awning over it, sometimes a poster and something on the roof,
// on the face of the building that looks back toward the middle of the map.
function dressBuilding(root, x, z, w, d, h, rng, opts = {}) {
    const towardX = Math.abs(x) > Math.abs(z);
    const sign = towardX ? -Math.sign(x) || 1 : -Math.sign(z) || 1;
    const turn = towardX ? (sign > 0 ? Math.PI / 2 : -Math.PI / 2) : (sign > 0 ? 0 : Math.PI);
    const faceX = towardX ? x + sign * (w / 2 + 0.06) : x;
    const faceZ = towardX ? z : z + sign * (d / 2 + 0.06);
    const along = towardX ? d : w;
    const offset = (rng() - 0.5) * (along - 6);
    const ox = towardX ? 0 : offset;
    const oz = towardX ? offset : 0;

    const door = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4), new THREE.MeshStandardMaterial({ color: opts.door ?? 0x4a3020, roughness: 0.8 }));
    door.position.set(faceX + ox, FLOOR_Y + 2, faceZ + oz);
    door.rotation.y = turn;
    root.add(deco(door));
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 4.4), plain(0xd8d0c0));
    frame.position.set(faceX + ox - (towardX ? sign * 0.01 : 0), FLOOR_Y + 2.2, faceZ + oz - (towardX ? 0 : sign * 0.01));
    frame.rotation.y = turn;
    root.add(deco(frame));

    if (opts.awnings) {
        const colors = opts.awnings;
        const awning = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 1.6), plain(colors[Math.floor(rng() * colors.length)]));
        const out = 0.8;
        awning.position.set(faceX + ox + (towardX ? sign * out : 0), FLOOR_Y + 4.6, faceZ + oz + (towardX ? 0 : sign * out));
        awning.rotation.y = turn;
        awning.rotateX(0.3);
        root.add(deco(awning));
    }
    if (rng() < (opts.posters ?? 0.35)) {
        const px = towardX ? faceX + sign * 0.02 : faceX + ox + (offset > 0 ? -3.4 : 3.4);
        const pz = towardX ? faceZ + oz + (offset > 0 ? -3.4 : 3.4) : faceZ + sign * 0.02;
        poster(root, rng, px, 3.2, pz, turn, 2.2);
    }
    if (opts.roofUnits !== false && rng() < 0.5) {
        const ac = block(root, plain(0xb9bcc1, { metalness: 0.3 }), [2.2, 1.4, 1.6], [x + (rng() - 0.5) * (w - 4), h, z + (rng() - 0.5) * (d - 4)]);
        deco(ac);
    }
}

/* ----- buildings you can walk into -----

   Most street buildings on the town maps are hollow: real door openings, an
   inside that is furnished, and on the taller ones a second floor up an
   indoor staircase. A person here is 9 units tall, so the ground-floor
   ceiling sits at 10 (anything lower would be a wall to walk into), and a
   two-storey building is about 20 tall. */

const UPPER = 10;
const SLAB = 0.6;
const DOOR_W = 4.4;
const DOOR_H = 9.4;

// A wall that faces along one axis, with an optional door gap in it.
// `axis` 'x' runs along x at the given z; 'z' runs along z at the given x.
function wallRun(root, material, axis, fixed, from, to, h, door) {
    const T = 0.6;
    const piece = (a, b, base = 0, height = h) => {
        const len = b - a;
        if (len <= 0.05) return;
        const mid = (a + b) / 2;
        const m = material(len, height);
        if (axis === 'x') block(root, m, [len, height, T], [mid, base, fixed]);
        else block(root, m, [T, height, len], [fixed, base, mid]);
    };
    if (door == null) {
        piece(from, to);
        return;
    }
    piece(from, door - DOOR_W / 2);
    piece(door + DOOR_W / 2, to);
    piece(door - DOOR_W / 2, door + DOOR_W / 2, DOOR_H, h - DOOR_H);
}

// The inside, furnished as a home, a shop, or a storeroom. `g` is already
// lifted to the floor it is furnishing; x0..x1, z0..z1 is the room.
function furnish(g, kind, x0, x1, z0, z1, rng, keepOut) {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const free = (x, z, r = 2) => !keepOut || !keepOut.some(([a, b, c, d]) => x + r > a && x - r < b && z + r > c && z - r < d);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(8, x1 - x0 - 4), Math.min(5, z1 - z0 - 4)), new THREE.MeshStandardMaterial({ map: shared('carpet', () => paint(128, carpet)), roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(cx, FLOOR_Y + 0.05, cz);
    g.add(deco(rug));

    // With the open-source furniture loaded, rooms get the real thing.
    if (kenneyLoaded && furnishKenney(g, kind, x0, x1, z0, z1, rng, free)) return;

    if (kind === 'home' || kind === 'kitchen') {
        // A couch against the back wall with a TV facing it, a table with
        // chairs, a bed in a corner, a plush and a poster.
        if (free(cx, z0 + 1.6, 4)) {
            const fabric = plain([0x3a3f6b, 0x6b3a3a, 0x3a6b4f][Math.floor(rng() * 3)]);
            block(g, fabric, [6, 1.4, 2.2], [cx, 0, z0 + 1.6]);
            block(g, fabric, [6, 2.4, 0.5], [cx, 0, z0 + 0.6]);
            critter(g, CRITTER_KINDS[Math.floor(rng() * CRITTER_KINDS.length)], cx + 2, z0 + 1.7, 0.45, 0, 1.4);
        }
        if (free(cx, z1 - 1, 3)) {
            block(g, plain(0x1b1c1e), [4, 1.4, 1], [cx, 0, z1 - 1]);
            block(g, plain(0x0e0e10), [4.4, 2.6, 0.2], [cx, 1.4, z1 - 1]);
        }
        if (free(x1 - 3, cz, 3)) {
            table(g, x1 - 3.5, cz, 1.2);
            chair(g, x1 - 3.5, cz - 2, 0);
            chair(g, x1 - 3.5, cz + 2, Math.PI);
        }
        if (free(x0 + 2.4, z1 - 2.4, 3)) {
            block(g, plain(0x2b2d35), [3.6, 0.8, 4.4], [x0 + 2.4, 0, z1 - 2.8]);
            block(g, plain([0xff9cc6, 0x7afcff, 0xf2efe6][Math.floor(rng() * 3)]), [3.4, 0.3, 3.4], [x0 + 2.4, 0.8, z1 - 2.4]);
        }
        poster(g, rng, cx - 3.5, 5, z0 + 0.36, 0, 2);
    } else if (kind === 'shop') {
        // A counter, shelves of goods along the walls, and a drinks machine.
        if (free(cx, cz - 1, 4)) {
            block(g, WOODS[2], [7, 2.4, 1.4], [cx, 0, cz - 1]);
            block(g, WOODS[1], [7.3, 0.2, 1.7], [cx, 2.4, cz - 1]);
        }
        const goods = [0xd6362b, 0x2f9e44, 0xf2b705, 0x1f5fbf, 0xff7eb3];
        for (const sx of [x0 + 1, x1 - 1]) {
            if (!free(sx, cz, 2)) continue;
            for (let level = 0; level < 3; level++) {
                block(g, WOODS[2], [1.2, 0.18, z1 - z0 - 4], [sx, 1.2 + level * 1.8, cz]);
                for (let i = 0; i < 4; i++) {
                    block(g, plain(goods[(level + i) % goods.length]), [0.8, 0.9, 0.8], [sx, 1.38 + level * 1.8, z0 + 3 + i * ((z1 - z0 - 6) / 3)]);
                }
            }
        }
        if (free(x1 - 2, z0 + 1.5, 2)) vendingMachine(g, x1 - 2, z0 + 1.5, 0, rng);
        poster(g, rng, cx, 5.5, z0 + 0.36, 0, 2);
    } else {
        // Storage: crates stacked two high and a few barrels.
        const crate = surface(shared('crate', () => paint(128, crateTexture)));
        for (let i = 0; i < 5; i++) {
            const bx = x0 + 2.5 + rng() * (x1 - x0 - 5);
            const bz = z0 + 2.5 + rng() * (z1 - z0 - 5);
            if (!free(bx, bz, 2)) continue;
            block(g, crate, [3, 3, 3], [bx, 0, bz], rng() * 0.4);
            if (rng() < 0.5) block(g, crate, [3, 3, 3], [bx + 0.2, 3, bz], rng() * 0.4);
        }
        for (let i = 0; i < 3; i++) {
            const bx = x0 + 1.5 + rng() * (x1 - x0 - 3);
            const bz = z0 + 1.5;
            if (!free(bx, bz, 1.2)) continue;
            mesh(g, new THREE.CylinderGeometry(0.9, 0.9, 2.2, 14), plain(0x6f4a2a), [bx, 1.1, bz]);
        }
    }
}

// Rooms furnished from the Kenney kit. Things stand against walls, facing
// into the room, and anything that would block a doorway or stairs is skipped.
function furnishKenney(g, kind, x0, x1, z0, z1, rng, free) {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const at = (name, x, z, turn, y = 0) => (free(x, z, 2) ? kprop(g, name, x, y, z, turn) : null);
    // How tall a placed model stands, in the room's own terms (so the TV sits
    // on its cabinet on any floor). World matrices are refreshed first, since
    // nothing has been drawn yet.
    const heightOf = (obj) => {
        if (!obj) return 0;
        obj.updateWorldMatrix(true, true);
        return new THREE.Box3().setFromObject(obj).max.y - FLOOR_Y - (obj.parent?.position?.y || 0);
    };
    if (kind === 'home') {
        at('loungeSofa', cx, z0 + 2.4, 0);
        at('tableCoffee', cx, z0 + 7, 0);
        const cabinet = at('cabinetTelevision', cx, z1 - 1.6, Math.PI);
        if (cabinet) kprop(g, 'televisionModern', cx, heightOf(cabinet), z1 - 1.8, Math.PI);
        at('bedDouble', x1 - 5.5, z0 + 5.5, -Math.PI / 2);
        if (rng() < 0.6) at('bear', x1 - 5.5, z0 + 3, 0, 2.6);
        at('bookcaseOpen', x0 + 1.4, cz, Math.PI / 2);
        at('pottedPlant', x0 + 2, z0 + 2, 0);
        at('lampRoundFloor', x1 - 2, z1 - 2, 0);
        poster(g, rng, cx - 5, 5.5, z0 + 0.36, 0, 2);
        return true;
    }
    if (kind === 'kitchen') {
        for (let i = 0; i < 3; i++) at('kitchenCabinet', x0 + 3 + i * 4.6, z0 + 1.6, 0);
        const counter = at('kitchenStove', x0 + 3 + 3 * 4.6, z0 + 1.6, 0);
        at('kitchenFridgeLarge', x1 - 2.5, z0 + 2, 0);
        if (counter) kprop(g, 'kitchenCoffeeMachine', x0 + 3, heightOf(counter), z0 + 1.4, 0);
        const table = at('tableRound', cx, cz + 2, 0);
        if (table) {
            kprop(g, 'chairCushion', cx - 3, 0, cz + 2, Math.PI / 2);
            kprop(g, 'chairCushion', cx + 3, 0, cz + 2, -Math.PI / 2);
        }
        at('trashcan', x1 - 1.5, z1 - 1.5, 0);
        at('plantSmall1', cx, cz + 2, 0, 3.9);
        return true;
    }
    if (kind === 'shop') {
        for (let i = 0; i < 3; i++) at('kitchenBar', cx - 5 + i * 5, cz - 1, 0);
        for (const sx of [x0 + 1.2, x1 - 1.2]) {
            for (let i = 0; i < 2; i++) at('bookcaseOpen', sx, z0 + 4 + i * 5, sx < cx ? Math.PI / 2 : -Math.PI / 2);
        }
        at('kitchenFridgeLarge', x1 - 2.5, z0 + 1.8, 0);
        at('cardboardBoxClosed', x0 + 2.5, z1 - 2.5, rng());
        at('pottedPlant', x1 - 2, z1 - 2, 0);
        poster(g, rng, cx, 5.5, z0 + 0.36, 0, 2);
        return true;
    }
    return false;
}

// A hollow building: four walls with doors, a floor, sometimes a second
// storey reached by stairs along one wall, and a walkable roof.
function hollowBuilding(root, x, z, w, d, h, rng, style) {
    const T = 0.6;
    const x0 = x - w / 2;
    const x1 = x + w / 2;
    const z0 = z - d / 2;
    const z1 = z + d / 2;
    const face = (len, height) => {
        const map = style.face.clone();
        map.repeat.set(Math.max(1, Math.round(len / 4)), Math.max(1, Math.round(height / 4)));
        map.needsUpdate = true;
        return new THREE.MeshStandardMaterial({ map, roughness: 0.9 });
    };

    // The main door looks back toward the middle of the map; sometimes a
    // second one goes in the opposite wall, so the building is a way through.
    const towardX = Math.abs(x) > Math.abs(z);
    const main = towardX ? (x > 0 ? '-x' : '+x') : (z > 0 ? '-z' : '+z');
    const opposite = { '-x': '+x', '+x': '-x', '-z': '+z', '+z': '-z' }[main];
    const doors = { [main]: true };
    if (rng() < 0.6) doors[opposite] = true;
    const along = (lo, hi) => lo + DOOR_W / 2 + 1.5 + rng() * Math.max(0, hi - lo - DOOR_W - 3);
    const doorAt = {
        '+z': doors['+z'] ? along(x0, x1) : null,
        '-z': doors['-z'] ? along(x0, x1) : null,
        '+x': doors['+x'] ? along(z0, z1) : null,
        '-x': doors['-x'] ? along(z0, z1) : null,
    };
    wallRun(root, face, 'x', z1 - T / 2, x0, x1, h, doorAt['+z']);
    wallRun(root, face, 'x', z0 + T / 2, x0, x1, h, doorAt['-z']);
    wallRun(root, face, 'z', x1 - T / 2, z0 + T, z1 - T, h, doorAt['+x']);
    wallRun(root, face, 'z', x0 + T / 2, z0 + T, z1 - T, h, doorAt['-x']);

    // Awnings over the doors.
    for (const [side, at] of Object.entries(doorAt)) {
        if (at == null || !style.awnings) continue;
        const color = style.awnings[Math.floor(rng() * style.awnings.length)];
        const awning = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 1.2, 0.14, 1.8), plain(color));
        const out = 1;
        if (side === '+z') awning.position.set(at, FLOOR_Y + DOOR_H + 0.4, z1 + out);
        if (side === '-z') awning.position.set(at, FLOOR_Y + DOOR_H + 0.4, z0 - out);
        if (side === '+x') { awning.position.set(x1 + out, FLOOR_Y + DOOR_H + 0.4, at); awning.rotation.y = Math.PI / 2; }
        if (side === '-x') { awning.position.set(x0 - out, FLOOR_Y + DOOR_H + 0.4, at); awning.rotation.y = Math.PI / 2; }
        root.add(deco(awning));
    }

    // Floor inside.
    const floorMat = style.floor || surface(shared('floor', () => paint(128, planks('#7a5332', '#4a3220'))), w / 6, d / 6);
    const inside = new THREE.Mesh(new THREE.PlaneGeometry(w - T * 2, d - T * 2), floorMat);
    inside.rotation.x = -Math.PI / 2;
    inside.position.set(x, FLOOR_Y + 0.03, z);
    root.add(deco(inside));

    const ix0 = x0 + T;
    const ix1 = x1 - T;
    const iz0 = z0 + T;
    const iz1 = z1 - T;
    // Floors: each is 10 up from the last, so you fit under the next one.
    // Three storeys need 30 of height, two need 20.
    const roomy = w >= 14 && d >= 15;
    const floors = style.floors ?? (roomy && h >= 30 ? 3 : roomy && h >= 20 ? 2 : 1);
    const kinds = style.kinds || ['home', 'shop', 'storage', 'home', 'kitchen'];
    const pick = () => kinds[Math.floor(rng() * kinds.length)];

    // Keep the doorways and the stairs clear of furniture.
    const keepOut = [];
    for (const [side, at] of Object.entries(doorAt)) {
        if (at == null) continue;
        if (side === '+z') keepOut.push([at - 3, at + 3, iz1 - 4, iz1]);
        if (side === '-z') keepOut.push([at - 3, at + 3, iz0, iz0 + 4]);
        if (side === '+x') keepOut.push([ix1 - 4, ix1, at - 3, at + 3]);
        if (side === '-x') keepOut.push([ix0, ix0 + 4, at - 3, at + 3]);
    }

    // One flight of stairs per floor (and one more onto the roof when it can
    // be reached), switching walls each time so they stack: up the west wall
    // front to back, then the east wall back to front, and so on. Each floor
    // has a hole over the flight that comes up through it.
    const levelTop = (k) => (k === 0 ? 0 : UPPER * k + SLAB);
    const run = Math.min(iz1 - iz0 - 2, 14);
    const stairMat = style.stairs || plain(0x7d7568);
    const slabMat = plain(0x8c8478);
    const railMat = plain(0x2f3033, { metalness: 0.4 });
    const flights = floors - 1 + (style.roofAccess && !style.gable ? 1 : 0);
    for (let k = 1; k <= flights; k++) {
        const west = k % 2 === 1;
        const onRoof = k === floors;
        const base = levelTop(k - 1);
        const top = onRoof ? h : levelTop(k);
        const holeA = west ? iz1 - 0.5 - run : iz0 + 0.5;
        const holeB = west ? iz1 - 0.5 : iz0 + 0.5 + run;
        stairRun(root, stairMat, west ? ix0 + 1.6 : ix1 - 1.6, west ? iz1 - 0.5 : iz0 + 0.5, west ? -1 : 1, base, top - base, run, 3);
        if (k === 1) keepOut.push([ix0, ix0 + 3.4, holeA - 1, iz1]);

        const slab = onRoof ? (style.roof || slabMat) : slabMat;
        const y = top - SLAB;
        const mx0 = west ? ix0 + 3.2 : ix0;
        const mx1 = west ? ix1 : ix1 - 3.2;
        flagWalkable(block(root, slab, [mx1 - mx0, SLAB, iz1 - iz0], [(mx0 + mx1) / 2, y, (iz0 + iz1) / 2]));
        const sx = west ? ix0 + 1.6 : ix1 - 1.6;
        if (holeA - iz0 > 0.3) flagWalkable(block(root, slab, [3.2, SLAB, holeA - iz0], [sx, y, (iz0 + holeA) / 2]));
        if (iz1 - holeB > 0.3) flagWalkable(block(root, slab, [3.2, SLAB, iz1 - holeB], [sx, y, (holeB + iz1) / 2]));
        flagWalkable(block(root, railMat, [0.15, 1.3, run], [west ? ix0 + 3.3 : ix1 - 3.3, top, (holeA + holeB) / 2]));

        if (!onRoof) {
            const upstairs = new THREE.Group();
            upstairs.position.y = top;
            root.add(upstairs);
            furnish(upstairs, pick(), ix0 + 3.4, ix1 - 3.4, iz0, iz1, rng, []);
        }
    }
    furnish(root, pick(), ix0, ix1, iz0, iz1, rng, keepOut);

    // A roof you can get onto gets a parapet round it.
    if (flights === floors) {
        const lip = style.trim || plain(0x9a9184);
        flagWalkable(block(root, lip, [w, 1.4, 0.4], [x, h, z0 + 0.2]));
        flagWalkable(block(root, lip, [w, 1.4, 0.4], [x, h, z1 - 0.2]));
        flagWalkable(block(root, lip, [0.4, 1.4, d], [x0 + 0.2, h, z]));
        flagWalkable(block(root, lip, [0.4, 1.4, d], [x1 - 0.2, h, z]));
        return;
    }

    // The roof: walkable, with the map's trim or a tiled gable.
    if (style.gable) {
        gableRoof(root, surface(style.gable, w / 4, 2), w, d, h, x, z, 0.45, 0);
    } else {
        flagWalkable(block(root, style.roof || plain(0x8c8478), [w, 0.6, d], [x, h - 0.6, z]));
        if (style.trim) block(root, style.trim, [w + 0.8, 0.8, d + 0.8], [x, h, z]);
    }
}

/* ----- rooms you can walk into ----- */

// A plain hollow building: door in the front (+Z) wall, a flat roof. The
// gallery is built the same way; this is the shell the other rooms share.
function roomShell(root, spot, wallMaterial, { W = 24, D = 16, H = 9, sign, light = 0xffe2b8 } = {}) {
    const g = new THREE.Group();
    g.position.set(spot.x, 0, spot.z);
    g.rotation.y = spot.turn;
    root.add(g);
    const T = 0.6;
    const wall = wallMaterial(W, H);
    block(g, wall, [W, H, T], [0, 0, -D / 2]);
    block(g, wall, [T, H, D], [-W / 2, 0, 0]);
    block(g, wall, [T, H, D], [W / 2, 0, 0]);
    const side = W / 2 - 2.5;
    block(g, wall, [side, H, T], [-(2.5 + side / 2), 0, D / 2]);
    block(g, wall, [side, H, T], [2.5 + side / 2, 0, D / 2]);
    block(g, wall, [5, H - 7, T], [0, 7, D / 2]);
    flagWalkable(block(g, plain(0x7d7568), [W + 1, 0.8, D + 1], [0, H, 0]));
    const lamp = new THREE.PointLight(light, 55, 32);
    lamp.position.set(0, FLOOR_Y + H - 2, 0);
    g.add(lamp);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, D - 1), surface(shared('floor', () => paint(128, planks('#7a5332', '#4a3220'))), 6, 4));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y + 0.03;
    g.add(deco(floor));
    if (sign) {
        const board = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.4), new THREE.MeshBasicMaterial({ map: labelTexture(sign, { bg: '#1c1a17', fg: '#f0e9dd' }) }));
        board.position.set(0, FLOOR_Y + H - 1.2, D / 2 + T / 2 + 0.05);
        g.add(deco(board));
    }
    return { g, W, D, H, inner: D / 2 - T / 2, wx: W / 2 - T / 2 };
}

// A ramen café: noren over the door, a counter with stools, tables and
// chairs, red lanterns, a menu board, a lucky cat and creature plushies.
function animeCafe(root, spot, wallMaterial, rng) {
    const { g, W, D, inner, wx } = roomShell(root, spot, wallMaterial, { sign: ['anime café', 'ラーメン · 定食'], light: 0xffd2a8 });

    const cloth = new THREE.MeshStandardMaterial({
        map: labelTexture(['ラーメン'], { width: 512, height: 256, bg: '#1f2a4a', fg: '#f4efe4', size: 110 }),
        side: THREE.DoubleSide,
        roughness: 1,
    });
    const noren = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.2), cloth);
    noren.position.set(0, FLOOR_Y + 5.9, D / 2 + 0.45);
    g.add(deco(noren));

    // The counter along the back, with stools and a menu above it.
    block(g, WOODS[2], [14, 2.4, 1.6], [0, 0, -D / 2 + 2.2]);
    block(g, WOODS[1], [14.4, 0.2, 1.9], [0, 2.4, -D / 2 + 2.2]);
    for (let i = 0; i < 5; i++) stool(g, -5.6 + i * 2.8, -D / 2 + 4);
    const menu = labelTexture(['お品書き · menu', 'ramen ¥900 · gyoza ¥450 · matcha ¥300 · onigiri ¥200'], { width: 1024, height: 256, bg: '#2a1d14', fg: '#f4d99a', size: 70 });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshBasicMaterial({ map: menu }));
    board.position.set(0, FLOOR_Y + 6, -inner + 0.05);
    g.add(deco(board));

    // A lucky cat on the counter, waving.
    const cat = new THREE.Group();
    const white = toon(0xf7f4ee);
    const body = new THREE.Mesh(UNIT_BALL, white);
    body.scale.set(0.45, 0.5, 0.4);
    body.position.y = 0.5;
    const head = new THREE.Mesh(UNIT_BALL, white);
    head.scale.setScalar(0.4);
    head.position.y = 1.15;
    const paw = new THREE.Mesh(UNIT_BALL, white);
    paw.scale.set(0.13, 0.28, 0.13);
    paw.position.set(0.38, 1.3, 0.1);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 16), toon(0xd6362b));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.85;
    const bell = new THREE.Mesh(UNIT_BALL, metal(0xd9a441, 0.3, 0.8));
    bell.scale.setScalar(0.08);
    bell.position.set(0, 0.8, 0.32);
    cat.add(body, head, paw, collar, bell);
    eyes(cat, 1.2, 0.36, 0.15, 0.06);
    cat.position.set(5.5, FLOOR_Y + 2.5, -D / 2 + 2.2);
    g.add(deco(cat));

    // Tables and chairs through the middle, leaving the doorway clear.
    for (const [tx, tz] of [[-7, 0.5], [7, 0.5], [-7, 5], [7, 5]]) {
        table(g, tx, tz, 1.2);
        chair(g, tx - 2, tz, Math.PI / 2);
        chair(g, tx + 2, tz, -Math.PI / 2);
    }

    // Red lanterns over the tables.
    const red = new THREE.MeshBasicMaterial({ color: 0xe0452b });
    for (const lx of [-7, 0, 7]) {
        const l = new THREE.Mesh(UNIT_BALL, red);
        l.scale.set(0.5, 0.7, 0.5);
        l.position.set(lx, FLOOR_Y + 7, 2.5);
        g.add(deco(l));
    }

    // Plushies on a shelf, posters on the side walls.
    block(g, WOODS[1], [0.8, 0.2, 7], [-wx + 0.5, 4.2, 1]);
    CRITTER_KINDS.forEach((kind, i) => critter(g, kind, -wx + 0.6, -1.6 + i * 1.7, 0.5, Math.PI / 2, 4.3));
    poster(g, rng, -wx + 0.06, 6.8, -3, Math.PI / 2);
    poster(g, rng, wx - 0.06, 5.2, -3, -Math.PI / 2);
    poster(g, rng, wx - 0.06, 5.2, 2.5, -Math.PI / 2);
    return g;
}

// My kind of room: a couch in front of a TV with my anime night on it, bean
// bags, a desk with csgo up, a shelf of figures, a futon, posters and LEDs.
function otakuDen(root, spot, wallMaterial, rng) {
    const { g, D, inner, wx } = roomShell(root, spot, wallMaterial, { sign: ['otaku den', 'オタクの部屋'], light: 0xd7c8ff });

    // The TV on its stand, playing a photo from the site.
    block(g, plain(0x1b1c1e), [7, 1.6, 1.4], [0, 0, -inner + 0.9]);
    block(g, plain(0x0e0e10), [7.4, 4.3, 0.3], [0, 1.9, -inner + 0.5]);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.94), new THREE.MeshBasicMaterial({ map: imageTexture('images/web/IMG_3888.jpg', 7, 3.94) }));
    screen.position.set(0, FLOOR_Y + 4.05, -inner + 0.7);
    g.add(deco(screen));

    // The couch facing it, bean bags either side.
    const fabric = plain(0x3a3f6b);
    block(g, fabric, [8, 1.4, 2.4], [0, 0, 2]);
    block(g, fabric, [8, 2.6, 0.6], [0, 0, 3.2]);
    block(g, fabric, [0.6, 2, 2.4], [-4.3, 0, 2]);
    block(g, fabric, [0.6, 2, 2.4], [4.3, 0, 2]);
    for (const [bx, color] of [[-7.5, 0xff7eb3], [7.5, 0x7afcff]]) {
        const bag = new THREE.Mesh(UNIT_BALL, toon(color));
        bag.scale.set(1.3, 0.8, 1.3);
        bag.position.set(bx, FLOOR_Y + 0.8, 0.5);
        g.add(bag);
    }
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), new THREE.MeshStandardMaterial({ map: shared('carpet', () => paint(128, carpet)), roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, FLOOR_Y + 0.05, -1);
    g.add(deco(rug));

    // The desk: monitor on csgo, a gaming chair in front.
    block(g, plain(0x222325), [2.4, 2.4, 5], [-wx + 1.5, 0, 4]);
    const monitor = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8), new THREE.MeshBasicMaterial({ map: paint(256, (ctx, size) => {
        const sky = ctx.createLinearGradient(0, 0, 0, size);
        sky.addColorStop(0, '#8fb3d9');
        sky.addColorStop(0.45, '#f1d9a6');
        sky.addColorStop(0.46, '#c9a46a');
        sky.addColorStop(1, '#a8834d');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = '#3cff3c';
        ctx.lineWidth = 4;
        ctx.strokeRect(size / 2 - 3, size / 2 - 14, 6, 28);
        ctx.fillStyle = '#f0e9dd';
        ctx.font = 'bold 24px monospace';
        ctx.fillText('100', 12, size - 16);
        ctx.fillText('30/90', size - 90, size - 16);
    }) }));
    monitor.position.set(-wx + 0.4, FLOOR_Y + 3.6, 4);
    monitor.rotation.y = Math.PI / 2;
    g.add(deco(monitor));
    const gamer = chair(g, -wx + 4, 4, -Math.PI / 2, plain(0x1b1b1b), plain(0xd6362b));
    gamer.children[gamer.children.length - 1].scale.y = 1.6;

    // Figures and creatures on a shelf unit.
    const shelfWood = WOODS[2];
    for (let level = 0; level < 3; level++) block(g, shelfWood, [1.2, 0.2, 6], [wx - 0.8, 1.6 + level * 2, 3]);
    block(g, shelfWood, [1.2, 6, 0.2], [wx - 0.8, 0, 0]);
    block(g, shelfWood, [1.2, 6, 0.2], [wx - 0.8, 0, 6]);
    for (let level = 0; level < 3; level++) {
        for (let i = 0; i < 3; i++) {
            critter(g, CRITTER_KINDS[(level + i) % CRITTER_KINDS.length], wx - 0.8, 1.2 + i * 1.8, 0.42, -Math.PI / 2, 1.8 + level * 2);
        }
    }

    // A futon in the back corner.
    block(g, plain(0x2b2d35), [4.5, 0.6, 3], [wx - 3, 0, -inner + 2]);
    block(g, plain(0xff9cc6), [4.3, 0.3, 2.4], [wx - 3, 0.6, -inner + 2.2]);
    block(g, plain(0xf2efe6), [1.6, 0.4, 0.9], [wx - 3, 0.9, -inner + 0.9]);

    // Posters on every wall, and a purple LED strip round the ceiling.
    poster(g, rng, -wx + 0.06, 5.4, -3.5, Math.PI / 2);
    poster(g, rng, wx - 0.06, 6.3, -3.8, -Math.PI / 2);
    poster(g, rng, -5.5, 6, -inner + 0.06, 0);
    poster(g, rng, 5.5, 6, -inner + 0.06, 0);
    const led = new THREE.MeshBasicMaterial({ color: 0xb14dff });
    for (const [lw, ld, lx, lz] of [[23, 0.2, 0, -inner + 0.1], [0.2, 15, -wx + 0.1, 0], [0.2, 15, wx - 0.1, 0]]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(lw, 0.15, ld), led);
        strip.position.set(lx, FLOOR_Y + 8.6, lz);
        g.add(deco(strip));
    }
    return g;
}

// Where the two rooms go on a standard wide map; the gallery has its own spot.
const ROOM_SPOTS = [
    { x: -62, z: 50, turn: Math.PI / 2, kind: 'cafe' },
    { x: 62, z: -75, turn: -Math.PI / 2, kind: 'otaku' },
];

/* ----- open-source furniture -----

   Kenney's Furniture Kit (CC0, kenney.nl): real sofas, beds, kitchens and
   shelves for the insides of buildings. Loaded once at start, cloned where
   needed, and merged with everything else for drawing. Each model is scaled
   to a real size (1 m is 5 units here) along whichever side matters most. */

const KENNEY = {
    loungeSofa: ['w', 10], loungeSofaCorner: ['w', 10], loungeChair: ['h', 4.6], tableCoffee: ['w', 6],
    tableRound: ['h', 3.8], tableCross: ['h', 3.8], chairCushion: ['h', 4.6], chair: ['h', 4.6],
    bedDouble: ['d', 10], bedSingle: ['d', 10], bookcaseOpen: ['h', 9], bookcaseClosedWide: ['h', 9],
    desk: ['w', 7], chairDesk: ['h', 5.5], computerScreen: ['w', 2.6], laptop: ['w', 1.8],
    televisionModern: ['w', 6], cabinetTelevision: ['w', 7], kitchenFridgeLarge: ['h', 9.5], kitchenStove: ['h', 4.6],
    kitchenCabinet: ['h', 4.6], kitchenBar: ['h', 5.2], stoolBar: ['h', 4], pottedPlant: ['h', 5],
    plantSmall1: ['h', 2], lampRoundFloor: ['h', 8], speaker: ['h', 5], radio: ['w', 1.6],
    trashcan: ['h', 2.6], cardboardBoxClosed: ['w', 3], bear: ['h', 2.4], books: ['w', 1.5], kitchenCoffeeMachine: ['h', 1.8],
};
const kenney = {};
let kenneyLoaded = false;
const kenneyReady = (() => {
    const loader = new GLTFLoader();
    return Promise.all(Object.keys(KENNEY).map((name) => loader.loadAsync(`models/kenney/${name}.glb`)
        .then((gltf) => {
            const obj = gltf.scene;
            obj.updateMatrixWorld(true);
            kenney[name] = { obj, box: new THREE.Box3().setFromObject(obj) };
        })
        .catch(() => {})))
        .then(() => {
            kenneyLoaded = true;
        });
})();

// A furniture model standing at x, z (on something y tall), turned to face
// `turn`. Null if it did not load, so callers can fall back to boxes.
const kSize = new THREE.Vector3();
const kCentre = new THREE.Vector3();
function kprop(parent, name, x, y, z, turn = 0) {
    const k = kenney[name];
    if (!k) return null;
    const [fit, size] = KENNEY[name];
    k.box.getSize(kSize);
    k.box.getCenter(kCentre);
    const s = size / (fit === 'w' ? kSize.x : fit === 'd' ? kSize.z : kSize.y);
    const inner = k.obj.clone(true);
    inner.scale.multiplyScalar(s);
    inner.position.set(-kCentre.x * s, -k.box.min.y * s, -kCentre.z * s);
    const outer = new THREE.Group();
    outer.position.set(x, FLOOR_Y + y, z);
    outer.rotation.y = turn;
    outer.add(inner);
    parent.add(outer);
    return outer;
}

/* ----- stairs that go either way, from any height ----- */

function stairRun(parent, material, x, zStart, dir, baseY, rise, run, width = 3) {
    const n = Math.ceil(rise / 1.0);
    const depth = run / n;
    for (let i = 0; i < n; i++) {
        const h = ((i + 1) * rise) / n;
        flagWalkable(block(parent, material, [width, h, depth + 0.02], [x, baseY, zStart + dir * depth * (i + 0.5)]));
    }
}

// The same, climbing along X.
function stairRunX(parent, material, xStart, dir, z, baseY, rise, run, width = 3) {
    const n = Math.ceil(rise / 1.0);
    const depth = run / n;
    for (let i = 0; i < n; i++) {
        const h = ((i + 1) * rise) / n;
        flagWalkable(block(parent, material, [depth + 0.02, h, width], [xStart + dir * depth * (i + 0.5), baseY, z]));
    }
}

const UP_AXIS = new THREE.Vector3(0, 1, 0);

/* ----- the ethiopian flag, painted ----- */

function ethiopianFlag(ctx, size) {
    const h = size * 0.5;
    ctx.fillStyle = '#078930';
    ctx.fillRect(0, 0, size, h / 3);
    ctx.fillStyle = '#fcdd09';
    ctx.fillRect(0, h / 3, size, h / 3);
    ctx.fillStyle = '#da121a';
    ctx.fillRect(0, (2 * h) / 3, size, h / 3);
    ctx.fillStyle = '#0f47af';
    ctx.beginPath();
    ctx.arc(size / 2, h / 2, h * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fcdd09';
    ctx.lineWidth = size * 0.008;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
        const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
        const px = size / 2 + Math.cos(a) * h * 0.2;
        const py = h / 2 + Math.sin(a) * h * 0.2;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + Math.PI / 5 + (i * 2 * Math.PI) / 5;
        ctx.beginPath();
        ctx.moveTo(size / 2 + Math.cos(a) * h * 0.1, h / 2 + Math.sin(a) * h * 0.1);
        ctx.lineTo(size / 2 + Math.cos(a) * h * 0.27, h / 2 + Math.sin(a) * h * 0.27);
        ctx.stroke();
    }
}

function flagTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    ethiopianFlag(c.getContext('2d'), 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function flagpole(parent, x, z, height = 18) {
    mesh(parent, new THREE.CylinderGeometry(0.15, 0.2, height, 8), plain(0xd8d4cc, { metalness: 0.4 }), [x, height / 2, z]);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.9 }));
    flag.position.set(x + 3.1, FLOOR_Y + height - 1.8, z);
    parent.add(deco(flag));
}

function placard(parent, lines, x, y, z, turn = 0, w = 6) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.3), new THREE.MeshBasicMaterial({ map: labelTexture(lines, { bg: '#1c1a17', fg: '#f0e9dd' }) }));
    p.position.set(x, FLOOR_Y + y, z);
    p.rotation.y = turn;
    parent.add(deco(p));
}

/* ----- landmarks ----- */

// Every landmark is built in its own frame, facing +Z, then turned in steps
// of a right angle so its collision boxes stay exact.
function frame(root, spot) {
    const g = new THREE.Group();
    g.position.set(spot.x, 0, spot.z);
    g.rotation.y = spot.turn || 0;
    root.add(g);
    return g;
}

// The tower: three floors and a roof you can reach, stairs switching sides
// on every flight, a helipad and an antenna on top. Apex and COD both love
// one of these in the middle of a town.
function tower(root, spot, style, rng) {
    hollowBuilding(root, spot.x, spot.z, 30, 30, 32, rng, { ...style, floors: 3, roofAccess: true, parapet: true });
    const pad = new THREE.Mesh(new THREE.CircleGeometry(7, 40), new THREE.MeshBasicMaterial({ map: paint(256, (ctx, size) => {
        ctx.fillStyle = '#2b2d30';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = '#f2efe6';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#f2b705';
        ctx.font = 'bold 150px Inter, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('H', size / 2, size / 2 + 6);
    }) }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(spot.x + 4, FLOOR_Y + 32.05, spot.z + 4);
    root.add(deco(pad));
    mesh(root, new THREE.CylinderGeometry(0.2, 0.3, 14, 6), plain(0x9ea3a6, { metalness: 0.5 }), [spot.x - 10, 39, spot.z - 10]);
    const beacon = new THREE.Mesh(UNIT_BALL, new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    beacon.scale.setScalar(0.5);
    beacon.position.set(spot.x - 10, FLOOR_Y + 46.2, spot.z - 10);
    root.add(deco(beacon));
}

// The hangar: a huge shed, doors big enough for a plane at both ends, a
// catwalk down each long wall with stairs up, and containers to fight round.
function hangar(root, spot, rng) {
    const g = frame(root, spot);
    const W = 54;
    const D = 36;
    const H = 22;
    const T = 0.8;
    const skin = paint(128, corrugated('#8a8f93', '#5f6468'));
    const wall = (len, height) => surface(skin, len / 4, height / 8);
    // Long walls, one with a side door.
    block(g, wall(W, H), [W, H, T], [0, 0, -D / 2]);
    block(g, wall(20, H), [20, H, T], [-17, 0, D / 2]);
    block(g, wall(28, H), [28, H, T], [13, 0, D / 2]);
    block(g, wall(6, H - 9.4), [6, H - 9.4, T], [-4, 9.4, D / 2]);
    // End walls with the big doors.
    for (const side of [-1, 1]) {
        block(g, wall(11, H), [T, H, 11], [side * W / 2, 0, -D / 2 + 5.5]);
        block(g, wall(11, H), [T, H, 11], [side * W / 2, 0, D / 2 - 5.5]);
        block(g, wall(14, H - 16), [T, H - 16, 14], [side * W / 2, 16, 0]);
    }
    const stripe = surface(paint(128, hazard), 10, 1);
    block(g, stripe, [W + 0.2, 1.2, 0.2], [0, 0, -D / 2 + T / 2 + 0.2]);
    block(g, plain(0x6f7477), [W + 1, 0.8, D + 1], [0, H, 0]);
    // Roof trusses.
    const steel = plain(0x3b3f44, { metalness: 0.5 });
    for (let x = -W / 2 + 6; x < W / 2; x += 8) deco(block(g, steel, [0.4, 0.8, D], [x, H - 3, 0]));
    // Catwalks at 10 along both long walls, stairs up at the west end.
    for (const side of [-1, 1]) {
        const cz = side * (D / 2 - 2.5);
        // Stairs from the floor at the west end up to where the catwalk starts.
        stairRunX(g, steel, -W / 2 + 1.5, 1, cz, 0, 10.5, 11, 3.6);
        const from = -W / 2 + 12.5;
        const to = W / 2 - 3;
        flagWalkable(block(g, steel, [to - from, 0.5, 4], [(from + to) / 2, 10, cz]));
        flagWalkable(block(g, plain(0xf2b705), [to - from, 1.2, 0.15], [(from + to) / 2, 10.5, cz - side * 2]));
    }
    // Containers and crates on the floor.
    const boxes = [['#c8642d', '#8f3f18'], ['#3f7a4a', '#2a5332'], ['#4f86c2', '#2f5a8c'], ['#9b2f2f', '#6b1f1f']];
    const crate = surface(shared('crate', () => paint(128, crateTexture)));
    for (const [cx, cz, turn, stack] of [[-8, -6, 0, true], [10, 5, Math.PI / 2, false], [2, -9, 0, false], [16, -6, 0, true]]) {
        const c = boxes[Math.floor(rng() * boxes.length)];
        block(g, surface(paint(128, corrugated(c[0], c[1])), 4, 1), [5, 5, 12], [cx, 0, cz], turn);
        if (stack) block(g, surface(paint(128, corrugated(c[1], c[0])), 4, 1), [5, 5, 12], [cx, 5, cz], turn);
    }
    for (const [cx, cz] of [[-16, 8], [-13, 9], [22, 9], [-2, 10]]) block(g, crate, [3, 3, 3], [cx, 0, cz], rng());
    placard(g, ['hangar 7'], 0, 18, D / 2 + T / 2 + 0.05, 0, 8);
}

// A full outdoor court: painted lines, two hoops at a real ten feet, bleachers
// down one side, a fence round it, and a ball on the centre line.
function court(root, spot) {
    const g = frame(root, spot);
    const L = 34;
    const Wd = 19;
    // Painted at the court's own proportions, so the lines are not stretched.
    const courtCanvas = document.createElement('canvas');
    courtCanvas.width = 1024;
    courtCanvas.height = Math.round((1024 * Wd) / L);
    ((ctx, size) => {
        const h = size * (Wd / L);
        ctx.fillStyle = '#2f5d8c';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#c2632f';
        ctx.fillRect(0, 0, size * 0.22, h);
        ctx.fillRect(size * 0.78, 0, size * 0.22, h);
        ctx.strokeStyle = '#f2efe6';
        ctx.lineWidth = 4;
        ctx.strokeRect(4, 4, size - 8, h - 8);
        ctx.beginPath();
        ctx.moveTo(size / 2, 4);
        ctx.lineTo(size / 2, h - 4);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(size / 2, h / 2, h * 0.18, 0, Math.PI * 2);
        ctx.stroke();
        for (const end of [0, 1]) {
            const x = end ? size - 4 : 4;
            const dir = end ? -1 : 1;
            ctx.strokeRect(end ? size * 0.78 : 4, h * 0.32, size * 0.22 - 4, h * 0.36);
            ctx.beginPath();
            ctx.arc(x, h / 2, h * 0.48, -Math.PI / 2, Math.PI / 2, end === 1);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x + dir * size * 0.22, h / 2, h * 0.12, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.fillStyle = 'rgba(242, 239, 230, 0.85)';
        ctx.font = 'bold 34px Inter, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('YA', size / 2, h / 2 + 12);
    })(courtCanvas.getContext('2d'), 1024);
    const paintCourt = new THREE.CanvasTexture(courtCanvas);
    paintCourt.colorSpace = THREE.SRGBColorSpace;
    paintCourt.anisotropy = 4;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(L, Wd), new THREE.MeshStandardMaterial({ map: paintCourt, roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y + 0.04;
    g.add(deco(floor));
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(L + 10, Wd + 14), plain(0x3a3d40));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(0, FLOOR_Y + 0.02, 2);
    g.add(deco(apron));

    // The hoops: pole, arm, backboard, orange rim and a net.
    const white = plain(0xf2efe6);
    const orange = plain(0xe0662c, { metalness: 0.3 });
    const net = new THREE.MeshBasicMaterial({ color: 0xf2efe6, wireframe: true });
    for (const end of [-1, 1]) {
        const x = end * (L / 2 + 2.2);
        mesh(g, new THREE.CylinderGeometry(0.3, 0.35, 16, 10), plain(0x2f3033, { metalness: 0.5 }), [x, 8, 0]);
        block(g, plain(0x2f3033), [2.2, 0.4, 0.4], [x - end * 1.1, 15.5, 0]);
        block(g, white, [0.25, 5.4, 9], [x - end * 2.2, 13.6, 0]);
        block(g, orange, [0.28, 2.2, 3], [x - end * 2.2, 14.7, 0]);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.09, 8, 24), orange);
        rim.rotation.x = Math.PI / 2;
        rim.position.set(x - end * 3.5, FLOOR_Y + 15, 0);
        g.add(deco(rim));
        const mesh2 = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.7, 2.2, 12, 1, true), net);
        mesh2.position.set(x - end * 3.5, FLOOR_Y + 13.9, 0);
        g.add(deco(mesh2));
    }

    // Bleachers along the back: three steps of seats.
    const seat = plain(0x9ea3a6, { metalness: 0.3 });
    for (let tier = 0; tier < 3; tier++) block(g, seat, [26, 1.4 * (tier + 1), 2.4], [0, 0, -Wd / 2 - 3 - tier * 2.4]);
    // A low fence round the rest.
    const rail = plain(0x2f3033, { metalness: 0.4 });
    for (const side of [-1, 1]) block(g, rail, [0.2, 3, Wd + 10], [side * (L / 2 + 5), 0, 1]);
    block(g, rail, [L - 10, 3, 0.2], [0, 0, Wd / 2 + 6]);
    placard(g, ['the court', 'ball is life'], -L / 2 - 3, 6, Wd / 2 + 6.2, 0, 5);
    return g;
}

// The Aksum stele: a tall granite stele carved as a building of many storeys,
// false windows and beam ends, a false door at the foot, a rounded top.
function stele(root, spot) {
    const g = frame(root, spot);
    const granite = paint(256, (ctx, size) => {
        ctx.fillStyle = '#8d8a84';
        ctx.fillRect(0, 0, size, size);
        speckle('rgba(0,0,0,0)', ['#6f6c66', '#a8a49c', '#5f5c57'], 1600, size)(ctx);
        ctx.fillStyle = 'rgba(40, 38, 35, 0.55)';
        for (let floor = 0; floor < 10; floor++) {
            const y = size - (floor + 1) * (size / 10.5);
            ctx.fillRect(0, y, size, 3);
            if (floor === 0) {
                ctx.fillRect(size * 0.35, y + 6, size * 0.3, size / 10.5 - 10);
                continue;
            }
            for (let i = 0; i < 3; i++) ctx.fillRect(size * (0.18 + i * 0.25), y + 7, size * 0.13, size / 10.5 - 14);
            for (let i = 0; i < 6; i++) {
                ctx.beginPath();
                ctx.arc(size * (0.1 + i * 0.16), y + 3, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    });
    block(g, surface(paint(128, speckle('#8d8a84', ['#6f6c66', '#a8a49c'], 800)), 3, 1), [9, 1.6, 9], [0, 0, 0]);
    block(g, new THREE.MeshStandardMaterial({ map: granite, roughness: 0.95 }), [3.8, 26, 2.2], [0, 1.6, 0]);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 2.2, 20, 1, false, 0, Math.PI), plain(0x8d8a84));
    top.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    top.position.set(0, FLOOR_Y + 27.6, 0);
    g.add(top);
    placard(g, ['aksum stele', 'ethiopia · ~4th century'], 0, 2.6, 4.56, 0, 4.5);
    flagpole(g, 6, 0);
}

// Bete Giyorgis at Lalibela: a church in the shape of a cross, cut down out
// of the rock, with nested crosses on its roof. The rock walls round it stand
// in for the pit it was carved from.
function lalibela(root, spot) {
    const g = frame(root, spot);
    const rock = paint(256, speckle('#b0714a', ['#8f5a3a', '#c98a5c', '#7a4a30'], 2400));
    const stone = (len, h) => surface(rock, len / 6, h / 6);
    const H = 13;
    block(g, stone(22, H), [22, H, 8], [0, 0, 0]);
    block(g, stone(8, H), [8, H, 22], [0, 0, 0]);
    // The three nested crosses on the roof.
    const relief = plain(0x9a5f3c);
    for (let i = 0; i < 3; i++) {
        const s = 1 - i * 0.2;
        block(g, relief, [19 * s, 0.4, 2.6 * s], [0, H + i * 0.4, 0]);
        block(g, relief, [2.6 * s, 0.4, 19 * s], [0, H + i * 0.4, 0]);
    }
    // Arched windows and a door on every arm.
    const dark = new THREE.MeshBasicMaterial({ color: 0x241810 });
    for (let a = 0; a < 4; a++) {
        const turn = (a * Math.PI) / 2;
        const out = new THREE.Vector3(0, 0, 11.05).applyAxisAngle(UP_AXIS, turn);
        archway(g, dark, 3, 6, out.x, 0, out.z, turn);
        for (const side of [-1, 1]) {
            const w = new THREE.Vector3(side * 4.05, 0, 7).applyAxisAngle(UP_AXIS, turn);
            archway(g, dark, 1.4, 2.6, w.x, 8, w.z, turn + side * (Math.PI / 2));
        }
    }
    // The pit walls, with a way in.
    const pit = (len, h) => surface(rock, len / 6, h / 6);
    block(g, pit(40, 11), [40, 11, 2], [0, 0, -19]);
    block(g, pit(40, 11), [2, 11, 40], [-19, 0, 0]);
    block(g, pit(40, 11), [2, 11, 40], [19, 0, 0]);
    block(g, pit(14, 11), [14, 11, 2], [-13, 0, 19]);
    block(g, pit(14, 11), [14, 11, 2], [13, 0, 19]);
    placard(g, ['bete giyorgis', 'lalibela, ethiopia · carved from one rock'], 0, 5, 20.05, 0, 7);
}

// Where the landmarks stand on a standard wide map, in the corners and at the
// end of the long lane, clear of the gallery and the two rooms.
const LANDMARK_SPOTS = {
    tower: { x: -88, z: -102, turn: 0 },
    hangar: { x: 86, z: 86, turn: 0 },
    court: { x: -88, z: 85, turn: 0 },
    stele: { x: 0, z: 96, turn: Math.PI },
    lalibela: { x: 93, z: -108, turn: Math.PI },
};
const LANDMARK_SIZES = { tower: [32, 32], hangar: [56, 38], court: [46, 38], stele: [12, 10], lalibela: [42, 42] };

/* ----- more easter eggs: basketball, coffee, rust, school ----- */

Object.assign(EGG_BUILDERS, {
    // A basketball, left on the court.
    basketball() {
        const g = new THREE.Group();
        const ball = new THREE.Mesh(new THREE.SphereGeometry(1.2, 24, 16), new THREE.MeshStandardMaterial({
            roughness: 0.8,
            map: paint(128, (ctx, size) => {
                ctx.fillStyle = '#d9662b';
                ctx.fillRect(0, 0, size, size);
                ctx.strokeStyle = '#2a1a10';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size);
                ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(0, size / 2, size * 0.35, -Math.PI / 2, Math.PI / 2);
                ctx.arc(size, size / 2, size * 0.35, Math.PI / 2, Math.PI * 1.5);
                ctx.stroke();
            }),
        }));
        ball.position.y = FLOOR_Y + 1.2;
        g.add(ball);
        return g;
    },
    // The coffee ceremony: a jebena on a low table with little cups.
    jebena() {
        const g = new THREE.Group();
        block(g, plain(0x6b4526), [3.2, 1.4, 2.4], [0, 0, 0]);
        const grass = new THREE.Mesh(new THREE.PlaneGeometry(5, 4), plain(0x6f9a45, { side: THREE.DoubleSide }));
        grass.rotation.x = -Math.PI / 2;
        grass.position.y = FLOOR_Y + 0.05;
        g.add(grass);
        const clay = plain(0x2b2320, { roughness: 0.6 });
        const body = new THREE.Mesh(UNIT_BALL, clay);
        body.scale.set(0.7, 0.62, 0.7);
        body.position.set(-0.7, FLOOR_Y + 2.05, 0);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 1.1, 12), clay);
        neck.position.set(-0.7, FLOOR_Y + 3.05, 0);
        const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.8, 8), clay);
        spout.position.set(-0.2, FLOOR_Y + 2.3, 0);
        spout.rotation.z = -0.9;
        const handle = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.06, 6, 12, Math.PI), clay);
        handle.position.set(-1.2, FLOOR_Y + 2.6, 0);
        handle.rotation.z = Math.PI / 2;
        g.add(body, neck, spout, handle);
        const cup = plain(0xf2efe6);
        for (let i = 0; i < 6; i++) {
            const c = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.26, 10), cup);
            c.position.set(0.3 + (i % 3) * 0.42, FLOOR_Y + 1.53, -0.3 + Math.floor(i / 3) * 0.6);
            g.add(c);
        }
        return g;
    },
    // Ferris, the Rust crab (public domain), for youdaheDB.
    ferris() {
        const g = new THREE.Group();
        const shell = toon(0xf74c00);
        const body = new THREE.Mesh(UNIT_BALL, shell);
        body.scale.set(1.3, 0.55, 0.95);
        body.position.y = FLOOR_Y + 1.1;
        g.add(body);
        for (const side of [-1, 1]) {
            const claw = new THREE.Mesh(UNIT_BALL, shell);
            claw.scale.set(0.45, 0.35, 0.35);
            claw.position.set(side * 1.7, FLOOR_Y + 1.5, 0.6);
            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.8, 6), shell);
            arm.position.set(side * 1.3, FLOOR_Y + 1.3, 0.4);
            arm.rotation.z = side * 1.1;
            g.add(claw, arm);
            for (let i = 0; i < 3; i++) {
                const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6), shell);
                leg.position.set(side * 1.25, FLOOR_Y + 0.5, -0.4 + i * 0.4);
                leg.rotation.z = side * 0.7;
                g.add(leg);
            }
            const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), shell);
            stalk.position.set(side * 0.35, FLOOR_Y + 1.75, 0.5);
            g.add(stalk);
        }
        eyes(g, FLOOR_Y + 2.05, 0.6, 0.35, 0.14);
        return g;
    },
    // A graduation cap in Minnesota State Mankato's purple and gold.
    gradcap() {
        const g = new THREE.Group();
        block(g, surface(shared('crate', () => paint(128, crateTexture))), [2, 2, 2], [0, 0, 0]);
        const purple = plain(0x4b2e83);
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.55, 20), purple);
        crown.position.y = FLOOR_Y + 2.27;
        const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 1.8), purple);
        board.position.y = FLOOR_Y + 2.58;
        board.rotation.y = Math.PI / 4;
        const button = new THREE.Mesh(UNIT_BALL, plain(0xf2b705));
        button.scale.setScalar(0.1);
        button.position.y = FLOOR_Y + 2.65;
        const tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.8, 8), plain(0xf2b705));
        tassel.position.set(0.8, FLOOR_Y + 2.2, 0.1);
        g.add(crown, board, button, tassel);
        return g;
    },
});
EGGS.push(
    { id: 'basketball', note: 'ball is life · buckets', court: true },
    { id: 'jebena', note: 'buna · ethiopian coffee, three rounds' },
    { id: 'ferris', note: 'ferris · the rust crab, for youdaheDB' },
    { id: 'gradcap', note: 'cs + stats · minnesota state mankato' },
);

/* ----- textures ----- */

function pavers(base, line, cells) {
    return (ctx, size) => {
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, size, size);
        const step = size / cells;
        for (let y = 0; y < cells; y++) {
            for (let x = 0; x < cells; x++) {
                ctx.globalAlpha = 0.06 + Math.random() * 0.12;
                ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
                ctx.fillRect(x * step, y * step, step, step);
            }
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = line;
        ctx.lineWidth = 2;
        for (let i = 0; i <= cells; i++) {
            ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke();
        }
    };
}

function cobbles(ctx, size) {
    ctx.fillStyle = '#6d6154';
    ctx.fillRect(0, 0, size, size);
    const n = 10;
    const step = size / n;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const shade = 150 + Math.floor(Math.random() * 45);
            ctx.fillStyle = `rgb(${shade}, ${shade - 12}, ${shade - 30})`;
            ctx.beginPath();
            ctx.ellipse(x * step + step / 2 + (y % 2) * step / 3, y * step + step / 2, step * 0.44, step * 0.4, Math.random(), 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function terracotta(ctx, size) {
    ctx.fillStyle = '#9c4527';
    ctx.fillRect(0, 0, size, size);
    const rows = 8;
    const cols = 8;
    const h = size / rows;
    const w = size / cols;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const shade = Math.floor(Math.random() * 25);
            ctx.fillStyle = `rgb(${185 + shade}, ${88 + shade}, ${52 + shade / 2})`;
            ctx.beginPath();
            ctx.ellipse(c * w + w / 2 + (r % 2) * w / 2, r * h + h * 0.55, w * 0.46, h * 0.5, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function corrugated(light, dark) {
    return (ctx, size) => {
        const n = 16;
        for (let i = 0; i < n; i++) {
            const g = ctx.createLinearGradient(i * size / n, 0, (i + 1) * size / n, 0);
            g.addColorStop(0, dark);
            g.addColorStop(0.5, light);
            g.addColorStop(1, dark);
            ctx.fillStyle = g;
            ctx.fillRect(i * size / n, 0, size / n, size);
        }
        speckle('rgba(0,0,0,0)', ['rgba(0,0,0,0.5)', 'rgba(255,255,255,0.4)'], 500, size)(ctx);
    };
}

function hazard(ctx, size) {
    ctx.fillStyle = '#e8b923';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#1c1c1c';
    for (let i = -size; i < size * 2; i += size / 4) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + size / 8, 0);
        ctx.lineTo(i + size / 8 - size, size);
        ctx.lineTo(i - size, size);
        ctx.fill();
    }
}

function planks(base, seam) {
    return (ctx, size) => {
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, size, size);
        const n = 6;
        for (let i = 0; i < n; i++) {
            ctx.globalAlpha = 0.1 + Math.random() * 0.15;
            ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
            ctx.fillRect(i * size / n, 0, size / n, size);
            ctx.globalAlpha = 1;
            ctx.fillStyle = seam;
            ctx.fillRect(i * size / n, 0, 3, size);
        }
    };
}

function zellige(ctx, size) {
    const colors = ['#1f7a7a', '#e9e2d0', '#2d5f8f', '#1a5c5c', '#c9a452'];
    const n = 16;
    const s = size / n;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            ctx.fillStyle = colors[(x * 3 + y * 5 + ((x ^ y) & 3)) % colors.length];
            ctx.fillRect(x * s, y * s, s - 1, s - 1);
        }
    }
}

function carpet(ctx, size) {
    ctx.fillStyle = '#8e1f1f';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#d9a441';
    ctx.lineWidth = size / 24;
    ctx.strokeRect(size / 16, size / 16, size - size / 8, size - size / 8);
    ctx.fillStyle = '#1f3f6e';
    for (const [x, y] of [[0.5, 0.3], [0.5, 0.7], [0.3, 0.5], [0.7, 0.5]]) {
        ctx.beginPath();
        ctx.moveTo(x * size, y * size - size / 10);
        ctx.lineTo(x * size + size / 12, y * size);
        ctx.lineTo(x * size, y * size + size / 10);
        ctx.lineTo(x * size - size / 12, y * size);
        ctx.fill();
    }
    ctx.fillStyle = '#d9a441';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 12, 0, Math.PI * 2);
    ctx.fill();
}

// Building fronts: a grid of windows, some lit, on a concrete or glass skin.
function facade(skin, glass, lit) {
    return (ctx, size) => {
        ctx.fillStyle = skin;
        ctx.fillRect(0, 0, size, size);
        const cols = 8;
        const rows = 12;
        const w = size / cols;
        const h = size / rows;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                ctx.fillStyle = Math.random() < lit ? '#f4d99a' : glass;
                ctx.fillRect(c * w + w * 0.18, r * h + h * 0.2, w * 0.64, h * 0.6);
            }
        }
    };
}

function glyphs(ctx, size) {
    ctx.fillStyle = '#8d8f7c';
    ctx.fillRect(0, 0, size, size);
    const n = 4;
    const s = size / n;
    ctx.lineWidth = 3;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const shade = 115 + Math.floor(Math.random() * 30);
            ctx.fillStyle = `rgb(${shade}, ${shade + 4}, ${shade - 12})`;
            ctx.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
            ctx.strokeStyle = 'rgba(40, 42, 32, 0.6)';
            ctx.strokeRect(x * s + s * 0.2, y * s + s * 0.2, s * 0.6, s * 0.6);
            ctx.beginPath();
            ctx.arc(x * s + s / 2, y * s + s / 2, s * 0.14, 0, Math.PI * 1.5);
            ctx.stroke();
        }
    }
    speckle('rgba(0,0,0,0)', ['#4f6b35', '#3e5a2a', '#6f8a4a'], 700, size)(ctx);
}

function radiation(ctx, size) {
    ctx.fillStyle = '#e8b923';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#161616';
    for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.moveTo(size / 2, size / 2);
        ctx.arc(size / 2, size / 2, size * 0.42, a - 0.52, a + 0.52);
        ctx.fill();
    }
    ctx.fillStyle = '#e8b923';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#161616';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.07, 0, Math.PI * 2);
    ctx.fill();
}

// A spray-painted letter, for the site markers.
function sprayed(letter, color) {
    return (ctx, size) => {
        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = color;
        ctx.font = `900 ${size * 0.8}px Impact, Arial Black, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = color;
        ctx.shadowBlur = size / 30;
        ctx.fillText(letter, size / 2, size / 2 + size * 0.04);
    };
}

function decal(root, draw, size, x, y, z, turn = 0) {
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshStandardMaterial({ map: paint(256, draw), transparent: true, roughness: 1, depthWrite: false })
    );
    mesh.position.set(x, FLOOR_Y + y, z);
    mesh.rotation.y = turn;
    root.add(mesh);
}

function palm(root, x, z, height = 11) {
    const trunk = plain(0x8a6a44);
    for (let i = 0; i < 6; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.34 - i * 0.03, 0.4 - i * 0.03, height / 6, 8), trunk);
        seg.position.set(x + Math.sin(i * 0.4) * 0.3 * i * 0.3, FLOOR_Y + (i + 0.5) * height / 6, z);
        root.add(seg);
    }
    const frond = plain(0x3f7a2e, { side: THREE.DoubleSide });
    for (let i = 0; i < 8; i++) {
        const leaf = new THREE.Mesh(UNIT_BALL, frond);
        const a = (i / 8) * Math.PI * 2;
        leaf.scale.set(0.5, 0.12, 3);
        leaf.position.set(x + Math.cos(a) * 2.2, FLOOR_Y + height - 0.3, z + Math.sin(a) * 2.2);
        leaf.rotation.set(0, -a + Math.PI / 2, 0);
        leaf.rotateX(0.35);
        root.add(leaf);
    }
}

function tree(root, x, z, height, leaves) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, height, 8), plain(0x5a4330));
    trunk.position.set(x, FLOOR_Y + height / 2, z);
    root.add(trunk);
    for (let i = 0; i < 4; i++) {
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + (i % 2) * 1.2, 0), leaves[i % leaves.length]);
        crown.position.set(x + Math.sin(i * 2.1) * 2.2, FLOOR_Y + height + Math.cos(i * 1.7) * 1.2, z + Math.cos(i * 2.1) * 2.2);
        crown.rotation.set(i, i * 2, 0);
        root.add(crown);
    }
}

function sunAndSky(root, top, horizon, bottom, sunColor, sunPos, sky = 0xcfe3f5, groundTint = 0xb48a52) {
    skyDome(root, top, horizon, bottom, 0.55);
    root.add(new THREE.HemisphereLight(sky, groundTint, 1.4));
    light(root, 'dir', sunColor, 2.4, sunPos);
    light(root, 'ambient', 0xffffff, 0.25);
}

/* ----- dust ii ----- */

// The courtyard at the end of Long A: sandstone walls, the double doors hung
// open in the arch, the blue container, crates, and the spray-painted A.
function buildDust2(root, opts = {}) {
    sunAndSky(root, 0x4f8cc9, 0xf1d9a6, 0xd9b77e, 0xfff0d6, [-20, 30, 10]);

    ground(root, new THREE.MeshStandardMaterial({
        map: paint(256, speckle('#e0bf85', ['#b8945c', '#f5dfb5', '#a8834d'], 2600), 40),
        roughness: 1,
    }));

    const stone = paint(256, sandstone);
    // Back wall with the arch through to Long.
    block(root, surface(stone, 7, 3), [34, 16, 2], [-17, 0, -36]);
    block(root, surface(stone, 5, 3), [24, 16, 2], [22, 0, -36]);
    block(root, surface(stone, 2, 1), [10, 5, 2], [5, 11, -36]);
    const trim = plain(0xb38e57);
    block(root, trim, [70, 1, 3], [0, 16, -35]);
    if (!opts.wide) {
        block(root, surface(stone, 14, 3), [2, 16, 72], [-34, 0, -2]);
        block(root, surface(stone, 14, 3), [2, 16, 72], [34, 0, -2]);
        block(root, surface(stone, 14, 3), [70, 16, 2], [0, 0, 32]);
        block(root, trim, [3, 1, 72], [-33, 16, -2]);
        block(root, trim, [3, 1, 72], [33, 16, -2]);
    } else {
        // The same walls with gaps through them, out to the rest of the map.
        for (const [x, z, w, d] of [
            [-34, -26, 2, 24], [-34, 18, 2, 32], [34, -30, 2, 16], [34, 13, 2, 42],
            [-21.5, 32, 27, 2], [21.5, 32, 27, 2],
        ]) {
            block(root, surface(stone, Math.max(w, d) / 5, 3), [w, 16, d], [x, 0, z]);
            block(root, trim, [w + 1, 1, d + 1], [x, 16, z]);
        }
    }

    // Long doors: two heavy wooden double doors swung open in the arch.
    const door = surface(paint(128, planks('#5b3a22', '#2e1d10')), 2, 1);
    for (const side of [-1, 1]) {
        const hinge = new THREE.Group();
        hinge.position.set(5 + side * 5, FLOOR_Y, -35);
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(4.8, 10.5, 0.35), door);
        leaf.position.set(-side * 2.4, 5.25, 0);
        hinge.add(leaf);
        hinge.rotation.y = side * 1.15;
        root.add(hinge);
    }

    // "Blue": the container that sits on Long.
    const container = surface(paint(128, corrugated('#4f86c2', '#2f5a8c')), 3, 1);
    block(root, container, [4, 4.2, 9], [-25, 0, -20], 0.12);
    const crate = surface(shared('crate', () => paint(128, crateTexture)));
    for (const [x, y, z, size, turn] of [
        [-19, 0, -27, 3, -0.1], [-22, 0, -26, 3, 0.2], [-20.5, 3, -26.5, 3, 0.35],
        [24, 0, -24, 4, 0.1], [20, 0, -28, 3, -0.3], [27, 0, 4, 3, -0.2], [26, 3, 4.5, 3, 0.25],
    ]) block(root, crate, [size, size, size], [x, y, z], turn);

    decal(root, sprayed('A', '#b8321f'), 7, 22, 6.5, -34.9);
    decal(root, sprayed('←', '#1f1f1f'), 3, -14, 4, -34.9);

    if (!opts.wide) return { fog: [0xf1d9a6, 45, 140], halo: 0x3a2a18 };
    let bMarked = false;
    const dustFront = facadeTexture(sandstone, 'plain');
    outskirts(root, {
        seed: 2,
        gallery: GALLERY_SPOT,
        stairs: plain(0xc9a46a),
        inner: [-36, 36, -38, 34],
        // Long past the arch, and a lane out of every gap in the walls.
        keepClear: [[-6, 16, -115, -36], [-100, -34, -18, 6], [34, 100, -26, -4], [-12, 12, 32, 90]],
        life: { limit: 14 },
        variety: true,
        landmarks: ['tower', 'hangar', 'court', 'stele'],
        towerStyle: { face: facadeTexture(sandstone, 'plain'), roof: plain(0xc9a46a), trim: plain(0xb38e57) },
        cell: 27,
        minSize: 14,
        heights: [12, 25],
        building: (x, z, w, d, h, rng) => {
            const awnings = [0xd94f3d, 0x3f6fb5, 0xe8c547, 0x2f7f6a];
            if (w >= 14 && d >= 14 && rng() < 0.7) {
                hollowBuilding(root, x, z, w, d, h, rng, { face: dustFront, roof: plain(0xc9a46a), trim, awnings });
            } else {
                facadeBox(root, dustFront, plain(0xc9a46a), w, h, d, x, z);
                block(root, trim, [w + 0.8, 0.8, d + 0.8], [x, h, z]);
                dressBuilding(root, x, z, w, d, h, rng, { awnings });
            }
            // The B site marker goes on the first building out to the left.
            if (!bMarked && x < -40 && Math.abs(z) < 40) {
                bMarked = true;
                decal(root, sprayed('B', '#b8321f'), 6, x, h * 0.5, z + d / 2 + 0.06);
            }
        },
        prop: (x, z, rng) => {
            if (rng() < 0.3) {
                block(root, container, [4, 4.2, 9], [x, 0, z], rng() * Math.PI);
                return;
            }
            const n = 1 + Math.floor(rng() * 3);
            for (let i = 0; i < n; i++) block(root, crate, [3, 3, 3], [x + i * 3.1, 0, z + (i % 2) * 0.6], rng() * 0.4);
            if (n > 1 && rng() < 0.5) block(root, crate, [3, 3, 3], [x + 1.5, 3, z + 0.3], rng() * 0.4);
        },
        wall: (w, h) => surface(stone, w / 5, h / 5),
    });
    return { fog: [0xf1d9a6, 60, 190], halo: 0x3a2a18, bounds: WIDE_BOUNDS };
}

/* ----- mirage ----- */

// A Moroccan square: warm plaster, the palace front with its arches and blue
// shutters, a tiled dome, a market awning, carpets hung out to air, palms.
function buildMirage(root, opts = {}) {
    sunAndSky(root, 0x3e7fc4, 0xf6e3c0, 0xe0c291, 0xfff1d8, [25, 32, -5]);

    ground(root, surface(paint(256, pavers('#d7b88a', '#a88a5e', 4)), 60, 60, { roughness: 1 }));

    const plaster = paint(256, speckle('#d9b98a', ['#c19e6c', '#ecd4ab', '#b58f5f'], 2000));
    const dark = new THREE.MeshBasicMaterial({ color: 0x2a1d12 });
    const shutter = plain(0x2f7f9a);

    // Palace: a long front across the back with three arches and windows.
    block(root, surface(plaster, 6, 2), [46, 15, 6], [-4, 0, -40]);
    for (const x of [-16, -4, 8]) archway(root, dark, 5, 8, x, 0, -36.9);
    for (const x of [-20, -12, 0, 12, 18]) {
        block(root, dark, [2, 2.8, 0.2], [x, 10, -36.95]);
        block(root, shutter, [1.1, 2.8, 0.3], [x - 1.6, 10, -36.8]);
        block(root, shutter, [1.1, 2.8, 0.3], [x + 1.6, 10, -36.8]);
    }
    block(root, plain(0xc4a171), [47, 1, 7], [-4, 15, -40]);

    // A tower with a tiled dome, off to the right, and a thin minaret.
    block(root, surface(plaster, 2, 3), [12, 18, 12], [30, 0, -30]);
    const dome = new THREE.Mesh(
        new THREE.SphereGeometry(6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
        surface(paint(256, zellige), 4, 2, { roughness: 0.4, metalness: 0.1 })
    );
    dome.position.set(30, FLOOR_Y + 18, -30);
    root.add(dome);
    block(root, surface(plaster, 1, 4), [4, 28, 4], [-32, 0, -34]);
    block(root, surface(paint(128, zellige), 1, 1), [4.4, 2, 4.4], [-32, 24, -34]);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.6, 4, 4), plain(0x1f7a7a));
    cap.position.set(-32, FLOOR_Y + 30, -34);
    cap.rotation.y = Math.PI / 4;
    root.add(cap);

    // Side buildings closing in the square.
    block(root, surface(plaster, 6, 2), [8, 12, 40], [-36, 0, -8]);
    block(root, surface(plaster, 6, 2), [8, 10, 40], [36, 0, -2]);

    // Market stall with a striped awning on the left.
    const stripes = paint(128, (ctx, size) => {
        for (let i = 0; i < 8; i++) {
            ctx.fillStyle = i % 2 ? '#e8d6b3' : '#c2462c';
            ctx.fillRect((i * size) / 8, 0, size / 8, size);
        }
    });
    const awning = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), new THREE.MeshStandardMaterial({ map: stripes, side: THREE.DoubleSide, roughness: 1 }));
    awning.position.set(-29, FLOOR_Y + 6.5, -10);
    awning.rotation.set(-Math.PI / 2 + 0.5, 0, Math.PI / 2);
    root.add(awning);
    block(root, plain(0x7a5332), [4, 2.4, 9], [-29.5, 0, -10]);

    // Carpets hung over the palace ledge and the right-hand wall.
    const rug = new THREE.MeshStandardMaterial({ map: shared('carpet', () => paint(128, carpet)), side: THREE.DoubleSide, roughness: 1 });
    for (const [x, y, z, turn] of [[4, 9.5, -36.8, 0], [31.9, 5, -8, -Math.PI / 2], [31.9, 5, 2, -Math.PI / 2]]) {
        const hang = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5), rug);
        hang.position.set(x, FLOOR_Y + y, z);
        hang.rotation.y = turn;
        root.add(hang);
    }

    palm(root, -22, -30);
    palm(root, 22, -22, 12);
    palm(root, 26, 18, 10);

    if (!opts.wide) return { fog: [0xf6e3c0, 50, 150], halo: 0x3a2a18 };
    const tiles = paint(256, zellige);
    const mirageFront = facadeTexture(speckle('#d9b98a', ['#c19e6c', '#ecd4ab', '#b58f5f'], 2000), 'shutter');
    outskirts(root, {
        seed: 3,
        gallery: GALLERY_SPOT,
        life: { lanterns: true },
        variety: true,
        landmarks: ['tower', 'court', 'stele', 'lalibela'],
        stairs: plain(0xc4a171),
        inner: [-42, 42, -46, 30],
        keepClear: [[-10, 10, -115, 90], [-100, 100, -6, 10]],
        cell: 27,
        minSize: 14,
        heights: [12, 25],
        building: (x, z, w, d, h, rng) => {
            const awnings = [0xc2462c, 0xe8d6b3, 0x2f7f9a];
            if (w >= 14 && d >= 14 && rng() < 0.7) {
                hollowBuilding(root, x, z, w, d, h, rng, { face: mirageFront, roof: plain(0xc9ab7c), trim: plain(0xc4a171), awnings });
                return;
            }
            block(root, surface(plaster, w / 6, h / 6), [w, h, d], [x, 0, z]);
            block(root, plain(0xc4a171), [w + 0.8, 0.8, d + 0.8], [x, h, z]);
            // Shuttered windows on the two long faces.
            for (const side of [-1, 1]) {
                for (let i = 0; i < Math.floor(w / 6); i++) {
                    const wx = x - w / 2 + 3 + i * 6;
                    const wz = z + side * (d / 2 + 0.06);
                    block(root, dark, [1.8, 2.4, 0.1], [wx, h * 0.55, wz]);
                    block(root, shutter, [0.9, 2.4, 0.2], [wx - 1.4, h * 0.55, wz]);
                    block(root, shutter, [0.9, 2.4, 0.2], [wx + 1.4, h * 0.55, wz]);
                }
            }
            dressBuilding(root, x, z, w, d, h, rng, { awnings: [0xc2462c, 0xe8d6b3, 0x2f7f9a], door: 0x2f5f7a });
            if (rng() < 0.3) {
                const r = Math.min(w, d) * 0.35;
                const cap = new THREE.Mesh(
                    new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
                    surface(tiles, 3, 1.5, { roughness: 0.4, metalness: 0.1 })
                );
                cap.position.set(x, FLOOR_Y + h, z);
                root.add(cap);
            }
        },
        prop: (x, z, rng) => {
            if (rng() < 0.4) {
                palm(root, x, z, 9 + rng() * 4);
                return;
            }
            block(root, plain(0x7a5332), [4, 2.4, 3], [x, 0, z], rng() * Math.PI);
            const hang = new THREE.Mesh(new THREE.PlaneGeometry(3, 3.6), rug);
            hang.position.set(x, FLOOR_Y + 4.2, z + 1.6);
            root.add(hang);
        },
        wall: (w, h) => surface(plaster, w / 6, h / 6),
    });
    return { fog: [0xf6e3c0, 60, 190], halo: 0x3a2a18, bounds: WIDE_BOUNDS };
}

/* ----- inferno ----- */

// An Italian hill town: stucco houses under terracotta roofs, green shutters,
// the church's bell tower over everything, washing strung across the street,
// cobbles underfoot and cypress trees on green hills beyond.
function buildInferno(root, opts = {}) {
    sunAndSky(root, 0x6a9fd0, 0xf4dcae, 0x8fa36a, 0xffe2b0, [-30, 22, 12], 0xdbe7f2, 0x8a7a55);

    ground(root, surface(paint(256, cobbles), 50, 50, { roughness: 1 }));

    const tiles = paint(128, terracotta);
    const shutter = plain(0x4f7a3a);
    const windowDark = new THREE.MeshBasicMaterial({ color: 0x2b2118 });
    const house = (x, z, w, h, d, color, turn = 0) => {
        const wall = surface(paint(128, speckle(color, ['#b38a5a', '#f2e0c0', '#a8845a'], 900)), w / 6, h / 6);
        const body = block(root, wall, [w, h, d], [x, 0, z], turn);
        gableRoof(root, surface(tiles, w / 4, 2), w, d, h, x, z, 0.45, turn);
        // Windows with shutters on the side that faces the square.
        const face = new THREE.Vector3(0, 0, d / 2 + 0.06).applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
        for (let i = 0; i < Math.floor(w / 5); i++) {
            for (const level of [h * 0.35, h * 0.7]) {
                const along = new THREE.Vector3(-w / 2 + 2.5 + i * 5, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
                const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.2), windowDark);
                win.position.set(x + face.x + along.x, FLOOR_Y + level, z + face.z + along.z);
                win.rotation.y = turn;
                root.add(win);
                for (const side of [-1, 1]) {
                    const s = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.2, 0.15), shutter);
                    const off = new THREE.Vector3(side * 1.15, 0, 0.05).applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
                    s.position.set(win.position.x + off.x, win.position.y, win.position.z + off.z);
                    s.rotation.y = turn;
                    root.add(s);
                }
            }
        }
        return body;
    };

    house(-20, -36, 18, 12, 10, '#e2c28f');
    house(4, -40, 16, 15, 10, '#e8d3b0');
    house(24, -34, 14, 11, 10, '#d9a877');
    house(-36, -8, 30, 10, 10, '#e5c9a0', Math.PI / 2);
    house(36, -6, 26, 12, 10, '#d8b184', -Math.PI / 2);

    // The church and its bell tower, rising over the back of the square.
    const stone = surface(paint(128, speckle('#cbb28a', ['#a88f68', '#e0cda8'], 900)), 1, 4);
    block(root, stone, [7, 30, 7], [14, 0, -50]);
    const belfry = new THREE.MeshBasicMaterial({ color: 0x24190f });
    for (const [dx, dz, turn] of [[0, 3.55, 0], [-3.55, 0, -Math.PI / 2], [3.55, 0, Math.PI / 2]]) {
        archway(root, belfry, 2.4, 4.5, 14 + dx, 23, -50 + dz, turn);
    }
    const spire = new THREE.Mesh(new THREE.ConeGeometry(5.4, 6, 4), surface(tiles, 2, 2));
    spire.position.set(14, FLOOR_Y + 33, -50);
    spire.rotation.y = Math.PI / 4;
    root.add(spire);

    // Washing lines strung across the street.
    const colors = [0xd94f3d, 0xf2f0e6, 0x3f6fb5, 0xe8c547, 0x5a9a5a];
    // Strung well behind where targets float, so washing never hides one.
    for (const [x1, x2, z, y] of [[-31, -12, -30, 10], [-31, -18, -22, 9.5], [31, 14, -24, 10]]) {
        const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x1, FLOOR_Y + y, z), new THREE.Vector3(x2, FLOOR_Y + y - 0.6, z)]),
            new THREE.LineBasicMaterial({ color: 0x3a3a3a })
        );
        root.add(line);
        const count = Math.floor(Math.abs(x2 - x1) / 2.2);
        for (let i = 1; i < count; i++) {
            const t = i / count;
            const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.6), plain(colors[i % colors.length], { side: THREE.DoubleSide }));
            cloth.position.set(lerp(x1, x2, t), FLOOR_Y + y - 0.6 * t - 0.85, z);
            cloth.rotation.y = Math.sin(i) * 0.3;
            root.add(cloth);
        }
    }

    // Flower boxes on the corners, and hills with cypresses beyond the roofs.
    for (const [x, z] of [[-25, -30], [22, -28], [-30, 6], [30, 10]]) {
        block(root, plain(0x7a5332), [2.4, 0.8, 1], [x, 0, z]);
        for (let i = 0; i < 3; i++) {
            const bloom = new THREE.Mesh(UNIT_BALL, plain(i % 2 ? 0xc93a3a : 0x4f8a3a));
            bloom.scale.setScalar(0.45);
            bloom.position.set(x - 0.7 + i * 0.7, FLOOR_Y + 1.1, z);
            root.add(bloom);
        }
    }
    const hill = plain(0x7f9a55, { flatShading: true });
    for (const [x, z, r] of [[-80, -130, 55], [30, -150, 70], [120, -110, 50]]) {
        const mound = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8), hill);
        mound.scale.y = 0.35;
        mound.position.set(x, FLOOR_Y - 4, z);
        root.add(mound);
    }
    const cypress = plain(0x2f4f2a, { flatShading: true });
    for (let i = 0; i < 12; i++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(1.8, 12, 6), cypress);
        c.position.set(-90 + i * 17, FLOOR_Y + 14 + Math.sin(i) * 3, -110 - (i % 3) * 12);
        root.add(c);
    }

    if (!opts.wide) return { fog: [0xf4dcae, 55, 170], halo: 0x3a2a18 };
    const walls = ['#e2c28f', '#e8d3b0', '#d9a877', '#e5c9a0', '#d8b184', '#ead9bd'];
    outskirts(root, {
        seed: 4,
        gallery: GALLERY_SPOT,
        life: { lanterns: true, trees: true },
        variety: true,
        landmarks: ['tower', 'court', 'stele'],
        inner: [-42, 42, -56, 28],
        // A banana-style lane running out the side, and the main street.
        keepClear: [[-10, 10, -115, -56], [-100, -42, 8, 24], [42, 100, -20, -6]],
        cell: 27,
        minSize: 14,
        heights: [12, 25],
        building: (x, z, w, d, h, rng) => {
            const color = walls[Math.floor(rng() * walls.length)];
            if (w >= 14 && d >= 14 && rng() < 0.7) {
                const front = shared(`front-${color}`, () => facadeTexture(speckle(color, ['#b38a5a', '#f2e0c0', '#a8845a'], 900), 'green'));
                hollowBuilding(root, x, z, w, d, h, rng, { face: front, gable: tiles, awnings: [0x4f7a3a, 0xc2412f, 0xe8d3b0] });
                return;
            }
            const quarter = Math.floor(rng() * 4);
            house(x, z, w, h, d, walls[Math.floor(rng() * walls.length)], quarter * (Math.PI / 2));
            // A turned house swaps its width and depth on the ground.
            const [fw, fd] = quarter % 2 ? [d, w] : [w, d];
            dressBuilding(root, x, z, fw, fd, h, rng, { awnings: [0x4f7a3a, 0xc2412f, 0xe8d3b0], roofUnits: false, posters: 0.3 });
        },
        prop: (x, z, rng) => {
            if (rng() < 0.5) {
                const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.2, 14), plain(0x6f4a2a));
                barrel.position.set(x, FLOOR_Y + 1.1, z);
                root.add(barrel);
                return;
            }
            block(root, plain(0x7a5332), [2.4, 0.8, 1], [x, 0, z]);
            for (let i = 0; i < 3; i++) {
                const bloom = new THREE.Mesh(UNIT_BALL, plain(i % 2 ? 0xc93a3a : 0x4f8a3a));
                bloom.scale.setScalar(0.45);
                bloom.position.set(x - 0.7 + i * 0.7, FLOOR_Y + 1.1, z);
                root.add(bloom);
            }
        },
        wall: (w, h) => surface(paint(128, speckle('#cbb28a', ['#a88f68', '#e0cda8'], 900)), w / 6, h / 6),
    });
    return { fog: [0xf4dcae, 65, 200], halo: 0x3a2a18, bounds: WIDE_BOUNDS };
}

/* ----- nuke ----- */

// The plant: the reactor's containment dome, a blue corrugated warehouse with
// the radiation sign, hazard stripes, stacked shipping containers, pipework
// and painted yard lines, under a flat pale sky.
function buildNuke(root, opts = {}) {
    sunAndSky(root, 0x8fb0cc, 0xd8e0e6, 0xa7adb0, 0xffffff, [15, 30, 20], 0xe4ecf2, 0x8a8f94);

    ground(root, surface(paint(256, speckle('#9fa3a3', ['#868a8b', '#b5b9b9', '#7a7e7f'], 2400)), 40, 40, { roughness: 1 }));
    const paintLine = new THREE.MeshBasicMaterial({ color: 0xe0b52a });
    for (const [w, d, x, z] of [[0.5, 60, -6, -10], [0.5, 60, 6, -10], [40, 0.5, 0, -24]]) {
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paintLine);
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(x, FLOOR_Y + 0.02, z);
        root.add(stripe);
    }

    const concrete = paint(256, speckle('#c9ccce', ['#b0b4b6', '#dcdfe0'], 1500));
    // Containment: a squat cylinder with a dome, behind the yard on the left.
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 20, 48), surface(concrete, 6, 2));
    silo.position.set(-26, FLOOR_Y + 10, -62);
    root.add(silo);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(16, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), surface(concrete, 6, 2));
    dome.position.set(-26, FLOOR_Y + 20, -62);
    root.add(dome);
    for (let i = 0; i < 3; i++) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(16.05, 0.25, 6, 64), plain(0x9ea3a6));
        band.rotation.x = Math.PI / 2;
        band.position.set(-26, FLOOR_Y + 4 + i * 6, -62);
        root.add(band);
    }

    // The warehouse across the back and down the right.
    const siding = paint(128, corrugated('#4f7fae', '#2f587f'));
    block(root, surface(siding, 12, 2), [44, 14, 12], [16, 0, -40]);
    block(root, surface(siding, 12, 2), [12, 12, 40], [38, 0, -6]);
    block(root, plain(0x2f587f), [45, 1, 13], [16, 14, -40]);
    block(root, surface(paint(128, corrugated('#8a8f93', '#5f6468')), 4, 1), [12, 9, 0.3], [10, 0, -33.9]);
    decal(root, radiation, 5, 26, 9, -33.8);
    const stripes = paint(128, hazard);
    block(root, surface(stripes, 10, 1), [44.2, 1.2, 12.2], [16, 0, -40]);
    block(root, surface(stripes, 10, 1), [12.2, 1.2, 40.2], [38, 0, -6]);

    // Pipes along the warehouse front.
    for (const [y, color] of [[10, 0xc9ccce], [11.2, 0xe0b52a]]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 44, 12), plain(color, { metalness: 0.4, roughness: 0.5 }));
        pipe.rotation.z = Math.PI / 2;
        pipe.position.set(16, FLOOR_Y + y, -33.3);
        root.add(pipe);
    }

    // Shipping containers stacked on the left of the yard.
    const box = (colors) => surface(paint(128, corrugated(colors[0], colors[1])), 4, 1);
    block(root, box(['#c8642d', '#8f3f18']), [5, 5, 12], [-30, 0, -22], 0.05);
    block(root, box(['#3f7a4a', '#2a5332']), [5, 5, 12], [-30, 5, -21], -0.04);
    block(root, box(['#9b2f2f', '#6b1f1f']), [5, 5, 12], [-24, 0, -30], Math.PI / 2 + 0.1);

    // Floodlight poles.
    for (const x of [-12, 30]) {
        block(root, plain(0x6f7477, { metalness: 0.5 }), [0.5, 18, 0.5], [x, 0, -30]);
        block(root, plain(0xf2f0e6, { emissive: 0xffffff, emissiveIntensity: 0.6 }), [2.4, 1, 1], [x, 17.5, -29.6]);
    }

    if (!opts.wide) return { fog: [0xd8e0e6, 50, 170], halo: 0x2a2f33 };
    const sidings = [corrugated('#4f7fae', '#2f587f'), corrugated('#8a8f93', '#5f6468'), corrugated('#c9ccce', '#9ea3a6')];
    const boxes = [['#c8642d', '#8f3f18'], ['#3f7a4a', '#2a5332'], ['#9b2f2f', '#6b1f1f'], ['#4f86c2', '#2f5a8c']];
    outskirts(root, {
        seed: 5,
        gallery: GALLERY_SPOT,
        variety: true,
        landmarks: ['tower', 'hangar', 'court', 'stele'],
        towerStyle: { face: facadeTexture(corrugated('#8a8f93', '#5f6468'), 'high'), roof: plain(0x5f6468) },
        stairs: plain(0x6f7477, { metalness: 0.4 }),
        inner: [-44, 46, -80, 30],
        keepClear: [[-8, 8, 30, 90], [-100, -44, -12, 4], [46, 100, -30, -14]],
        cell: 27,
        minSize: 14,
        heights: [12, 25],
        building: (x, z, w, d, h, rng) => {
            const siding = Math.floor(rng() * sidings.length);
            const front = shared(`front-${siding}`, () => facadeTexture(sidings[siding], 'high'));
            if (w >= 14 && d >= 14 && rng() < 0.65) {
                hollowBuilding(root, x, z, w, d, h, rng, { face: front, roof: plain(0x5f6468), kinds: ['storage', 'storage', 'shop'], stairs: plain(0x6f7477, { metalness: 0.4 }) });
                return;
            }
            facadeBox(root, front, plain(0x5f6468), w, h, d, x, z);
            dressBuilding(root, x, z, w, d, h, rng, { door: 0x5f6468, posters: 0.3 });
            block(root, plain(0x5f6468), [w + 0.6, 0.8, d + 0.6], [x, h, z]);
            block(root, surface(stripes, w / 4, 1), [w + 0.2, 1.2, d + 0.2], [x, 0, z]);
        },
        prop: (x, z, rng) => {
            const c = boxes[Math.floor(rng() * boxes.length)];
            const turn = rng() < 0.5 ? 0 : Math.PI / 2;
            block(root, box(c), [5, 5, 12], [x, 0, z], turn);
            // A second one stacked square on top, never hanging off the edge.
            if (rng() < 0.4) {
                const c2 = boxes[Math.floor(rng() * boxes.length)];
                block(root, box(c2), [5, 5, 12], [x, 5, z], turn + (rng() - 0.5) * 0.08);
            }
        },
        wall: (w, h) => surface(concrete, w / 6, h / 6),
    });
    return { fog: [0xd8e0e6, 60, 200], halo: 0x2a2f33, bounds: WIDE_BOUNDS };
}

/* ----- vertigo ----- */

// The top of a tower under construction: a bare concrete floor with nothing
// round its edge but rails, scaffold and a crane, and the city a long way down.
function buildVertigo(root, opts = {}) {
    // Bots mode stands on a much bigger floor of the tower.
    const deck = opts.wide ? { x0: -60, x1: 60, z0: -85, z1: 40 } : { x0: -30, x1: 30, z0: -45, z1: 25 };
    const deckW = deck.x1 - deck.x0;
    const deckD = deck.z1 - deck.z0;
    const deckX = (deck.x0 + deck.x1) / 2;
    const deckZ = (deck.z0 + deck.z1) / 2;
    skyDome(root, 0x3f7fc6, 0xc9dcec, 0x9fb4c6, 0.5);
    root.add(new THREE.HemisphereLight(0xdcebf7, 0x6f7f8c, 1.5));
    light(root, 'dir', 0xfff4e0, 2.3, [-25, 30, 15]);
    light(root, 'ambient', 0xffffff, 0.25);

    // The slab, and the storey below it, in bare concrete.
    const slab = paint(256, speckle('#a9a9a4', ['#8f8f8a', '#c2c2bd', '#7c7c77'], 2400));
    block(root, surface(slab, deckW / 6, deckD / 6, { roughness: 1 }), [deckW, 1, deckD], [deckX, -1, deckZ]);
    block(root, surface(slab, deckW / 6, 2), [deckW - 2, 6, deckD - 2], [deckX, -7, deckZ]);
    const column = surface(slab, 1, 3);
    // Columns along the back, and only at the sides further forward, so the
    // middle of the view stays open.
    for (const x of [-26, -9, 9, 26]) block(root, column, [1.6, 12, 1.6], [x, 0, -42]);
    for (const x of [-26, 26]) block(root, column, [1.6, 12, 1.6], [x, 0, -20]);
    // Rebar sticking out of the column tops.
    const rebar = plain(0x7a4a2c, { metalness: 0.5 });
    for (const x of [-26, -9, 9, 26]) {
        for (let i = 0; i < 4; i++) block(root, rebar, [0.12, 2, 0.12], [x - 0.4 + (i % 2) * 0.8, 12, -42 - 0.4 + Math.floor(i / 2) * 0.8]);
    }

    // Safety rail round the edge, striped.
    const rail = surface(paint(128, hazard), 8, 1);
    for (const [w, d, x, z] of [[deckW, 0.3, deckX, deck.z0], [0.3, deckD, deck.x0, deckZ], [0.3, deckD, deck.x1, deckZ]]) {
        block(root, rail, [w, 0.4, d], [x, 3.2, z]);
        block(root, rail, [w, 0.3, d], [x, 1.6, z]);
    }
    const post = plain(0xe8b923);
    for (let x = deck.x0; x <= deck.x1; x += 6) block(root, post, [0.25, 3.6, 0.25], [x, 0, deck.z0]);

    // Scaffold tower on the right: a lattice of orange tube.
    const tubeMat = plain(0xd9731f, { metalness: 0.4, roughness: 0.6 });
    for (let level = 0; level < 5; level++) {
        for (const [x, z] of [[22, -32], [28, -32], [22, -26], [28, -26]]) block(root, tubeMat, [0.25, 4, 0.25], [x, level * 4, z]);
        for (const z of [-32, -26]) block(root, tubeMat, [6, 0.25, 0.25], [25, level * 4 + 4, z]);
        block(root, plain(0x8a6a44), [6.4, 0.3, 6.4], [25, level * 4 + 3.9, -29]);
    }

    // The tower crane, well back, over everything.
    const crane = plain(0xe8b923, { metalness: 0.3 });
    block(root, crane, [2.2, 60, 2.2], [-20, -10, -70]);
    block(root, crane, [70, 1.6, 1.6], [-5, 48, -70]);
    block(root, crane, [14, 1.6, 1.6], [-33, 48, -70]);
    block(root, plain(0x6f7477), [4, 4, 4], [-38, 44, -70]);
    block(root, plain(0x2f3a45), [3, 3, 3], [-20, 50, -70]);
    const cable = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(18, FLOOR_Y + 48, -70), new THREE.Vector3(18, FLOOR_Y + 30, -70)]),
        new THREE.LineBasicMaterial({ color: 0x333333 })
    );
    root.add(cable);
    block(root, plain(0x3b6fa8), [3, 2, 3], [18, 27.5, -70]);

    // Pallets and a tarp-covered pile on the deck.
    block(root, plain(0x2f5f9a), [5, 1.8, 4], [-20, 0, -30], 0.2);
    block(root, plain(0x8a6a44), [3, 0.5, 3], [16, 0, -12]);
    block(root, plain(0xcfc9b8), [2.6, 1.4, 2.6], [16, 0.5, -12]);

    // The city far below: towers of glass and concrete in every direction,
    // lost in the haze at the bottom.
    const skins = [
        paint(128, facade('#6f7b86', '#22303c', 0.12)),
        paint(128, facade('#9a9486', '#2d3640', 0.1)),
        paint(128, facade('#3d5870', '#182430', 0.18)),
    ];
    const cityMats = skins.map((t) => surface(t, 2, 4, { roughness: 0.6 }));
    for (let i = 0; i < 70; i++) {
        const a = (i / 70) * Math.PI * 2 + Math.sin(i) * 0.2;
        // Out past the edge of the deck, so no tower comes up through it.
        const r = (opts.wide ? 95 : 55) + ((i * 53) % 110);
        const w = 10 + (i % 4) * 4;
        const top = -30 - ((i * 31) % 70) + (i % 5 === 0 ? 62 : 0);
        const h = 140 + top;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), cityMats[i % cityMats.length]);
        mesh.position.set(Math.sin(a) * r, FLOOR_Y + top - h / 2, -Math.cos(a) * r);
        root.add(mesh);
    }

    if (!opts.wide) return { fog: [0xc9dcec, 70, 220], halo: 0x1f2a33 };
    // More of the unfinished floor: column stubs, cover walls, pallets, tarps.
    outskirts(root, {
        seed: 6,
        gallery: { x: 40, z: 12, turn: -Math.PI / 2 },
        rooms: [
            { x: -40, z: 12, turn: Math.PI / 2, kind: 'cafe' },
            { x: 40, z: -60, turn: -Math.PI / 2, kind: 'otaku' },
        ],
        life: { limit: 10 },
        galleryWall: (w, h) => surface(slab, w / 6, h / 6),
        inner: [-30, 30, -45, 25],
        outer: [deck.x0 + 2, deck.x1 - 2, deck.z0 + 2, deck.z1 - 2],
        cell: 20,
        density: 0.5,
        heights: [3, 6],
        building: (x, z, w, d, h, rng) => {
            if (rng() < 0.5) {
                block(root, column, [1.6, 12, 1.6], [x, 0, z]);
                for (let i = 0; i < 4; i++) block(root, rebar, [0.12, 2, 0.12], [x - 0.4 + (i % 2) * 0.8, 12, z - 0.4 + Math.floor(i / 2) * 0.8]);
            } else {
                block(root, surface(slab, w / 6, 1), [w * 0.8, h, 1.2], [x, 0, z], rng() < 0.5 ? 0 : Math.PI / 2);
            }
        },
        prop: (x, z, rng) => {
            block(root, plain(rng() < 0.5 ? 0x2f5f9a : 0x8a6a44), [3 + rng() * 2, 1.2 + rng() * 1.5, 3], [x, 0, z], rng());
        },
    });
    return { fog: [0xc9dcec, 80, 230], halo: 0x1f2a33, bounds: [deck.x0 + 1, deck.x1 - 1, deck.z0 + 1, deck.z1 - 1] };
}

/* ----- ancient ----- */

// A temple in the rainforest: a stepped pyramid with its stair and shrine,
// the orange of A site and the pale-blue water of B, carved pillars, and
// jungle closing in all round.
function buildAncient(root, opts = {}) {
    sunAndSky(root, 0x8fb8c9, 0xdfe6d4, 0x5d6f45, 0xfff1d0, [20, 28, 10], 0xdce8e0, 0x4f6a35);

    ground(root, new THREE.MeshStandardMaterial({
        map: paint(256, speckle('#5f7a3c', ['#4a6230', '#7a8f4a', '#6b5a3a', '#3f5428'], 3000), 40),
        roughness: 1,
    }));
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(24, 48), surface(paint(256, pavers('#9a9c88', '#6d6f5e', 4)), 8, 8));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(0, FLOOR_Y + 0.03, -12);
    root.add(plaza);

    // The pyramid: stacked tiers, a stair up the front, a shrine on top.
    const carved = paint(256, glyphs);
    for (let i = 0; i < 6; i++) {
        const w = 44 - i * 7;
        block(root, surface(carved, w / 6, 1), [w, 4, w * 0.8], [0, i * 4, -70]);
    }
    const stair = plain(0x8f917d);
    for (let i = 0; i < 24; i++) block(root, stair, [8, 1, 1.2], [0, i, -70 + 17.6 - i * 0.62]);
    block(root, surface(carved, 2, 1), [8, 6, 7], [0, 24, -70]);
    archway(root, new THREE.MeshBasicMaterial({ color: 0x1d1a14 }), 3, 4.5, 0, 24, -66.4);
    block(root, plain(0xd9731f), [9, 1, 8], [0, 30, -70]);

    // A site: orange-painted stone and banners on the left.
    const orange = plain(0xd9731f);
    block(root, surface(carved, 2, 1), [10, 3, 10], [-26, 0, -30]);
    block(root, orange, [10.2, 0.6, 10.2], [-26, 3, -30]);
    for (const x of [-30, -22]) {
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(2, 6), plain(0xd9731f, { side: THREE.DoubleSide }));
        banner.position.set(x, FLOOR_Y + 8, -24.9);
        root.add(banner);
        block(root, surface(carved, 1, 3), [2.4, 12, 2.4], [x, 0, -26]);
    }

    // B site: a shallow pool of pale-blue water edged in stone, on the right.
    block(root, surface(carved, 3, 1), [16, 1.2, 12], [26, 0, -24]);
    const water = new THREE.Mesh(
        new THREE.PlaneGeometry(14, 10),
        new THREE.MeshStandardMaterial({ color: 0x8fd3e0, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.9 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(26, FLOOR_Y + 1.25, -24);
    root.add(water);

    // Broken pillars scattered round the plaza.
    for (const [x, z, h] of [[-14, -34, 7], [14, -36, 5], [-34, -6, 9], [34, -2, 6], [-10, 14, 4]]) {
        block(root, surface(carved, 1, 2), [2.2, h, 2.2], [x, 0, z], x * 0.1);
    }

    // Jungle: trees and hanging vines all the way round, big leaves below.
    const leaves = [plain(0x2f5a24, { flatShading: true }), plain(0x3f7030, { flatShading: true }), plain(0x24461c, { flatShading: true })];
    for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        const r = 40 + (i % 4) * 9;
        const x = Math.sin(a) * r;
        const z = -Math.cos(a) * r - 10;
        // Not through the pyramid.
        if (Math.abs(x) < 26 && z < -48) continue;
        tree(root, x, z, 14 + (i % 5) * 3, leaves);
    }
    const vine = plain(0x2f5a24);
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + 0.2;
        block(root, vine, [0.15, 6 + (i % 4) * 2, 0.15], [Math.sin(a) * 38, 10, -Math.cos(a) * 38 - 10]);
    }
    const frond = plain(0x3f7a2e, { flatShading: true });
    for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        const leaf = new THREE.Mesh(UNIT_BALL, frond);
        leaf.scale.set(2.4, 0.5, 1.2);
        leaf.position.set(Math.sin(a) * 30, FLOOR_Y + 0.4, -Math.cos(a) * 30 - 10);
        leaf.rotation.y = a;
        root.add(leaf);
    }

    if (!opts.wide) return { fog: [0xdfe6d4, 40, 150], halo: 0x2a2f1c };
    // Ruins scattered through the jungle: broken walls, carved blocks, pillars,
    // and more trees between them.
    outskirts(root, {
        seed: 7,
        gallery: GALLERY_SPOT,
        life: { trees: true, lanterns: true },
        landmarks: ['court', 'stele', 'lalibela'],
        inner: [-36, 36, -90, 26],
        keepClear: [[-8, 8, 26, 90], [-100, -36, -30, -16], [36, 100, -30, -16]],
        density: 0.5,
        heights: [3, 8],
        building: (x, z, w, d, h, rng) => {
            block(root, surface(carved, w / 6, h / 4), [w, h, d * 0.4], [x, 0, z], rng() < 0.5 ? 0 : Math.PI / 2);
            block(root, surface(carved, w / 12, 1), [w * 0.45, h * 0.5, d * 0.4], [x - w * 0.2, h, z], rng() < 0.5 ? 0 : Math.PI / 2);
            if (rng() < 0.4) block(root, plain(0xd9731f), [w * 0.3, 0.4, d * 0.42], [x + w * 0.2, h, z]);
        },
        prop: (x, z, rng) => {
            if (rng() < 0.6) tree(root, x, z, 13 + rng() * 8, leaves);
            else block(root, surface(carved, 1, 2), [2.2, 3 + rng() * 5, 2.2], [x, 0, z], rng());
        },
        wall: (w, h) => surface(carved, w / 6, h / 4),
    });
    return { fog: [0xdfe6d4, 50, 180], halo: 0x2a2f1c, bounds: WIDE_BOUNDS };
}

const MAPS = [
    { id: 'training', bounds: [-18, 18, -18, 18], label: 'training', build: buildRange, defaults: { background: 0x121312, fog: [0x121312, 18, 46], halo: INK } },
    { id: 'dust2', bounds: [-32, 32, -34, 30], label: 'dust ii', build: buildDust2 },
    { id: 'mirage', bounds: [-31, 31, -36, 28], label: 'mirage', build: buildMirage },
    { id: 'inferno', bounds: [-30, 30, -30, 28], label: 'inferno', build: buildInferno },
    { id: 'nuke', bounds: [-26, 31, -33, 28], label: 'nuke', build: buildNuke },
    { id: 'vertigo', bounds: [-29, 29, -44, 24], label: 'vertigo', build: buildVertigo },
    { id: 'ancient', bounds: [-34, 34, -46, 24], label: 'ancient', build: buildAncient },
];

let mapKind = MAPS[0];

// Empties the map group, freeing what the old map made, and builds the new
// one. Fog, the halo colour round the targets and the per-frame hook all come
// from the map.
function selectMap(id) {
    mapKind = MAPS.find((m) => m.id === id) || MAPS[0];
    if (!envRoot) return;

    envRoot.traverse((node) => {
        if (node.geometry && node.geometry !== UNIT_BALL && node.geometry !== UNIT_BOX) node.geometry.dispose();
        const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
        for (const m of materials) {
            if (m.map && m.map !== GLOW) m.map.dispose();
            m.dispose();
        }
    });
    envRoot.clear();
    canonical.clear();
    sharedTextures.clear();
    skyMesh = null;
    eggMeshes = [];

    builtWide = botsMode();
    const made = mapKind.build(envRoot, { wide: builtWide }) || {};
    mapBounds = made.bounds || mapKind.bounds;
    // Collision boxes first, while every piece is still separate; then the
    // static pieces are merged for drawing.
    mapColliders = collectColliders(envRoot, FLOOR_Y);
    if (bots) bots.setColliders(mapColliders);
    batchStatic(envRoot);
    const settings = { ...(mapKind.defaults || {}), ...made };
    scene.background = settings.background !== undefined ? new THREE.Color(settings.background) : null;
    scene.fog = settings.fog ? new THREE.Fog(settings.fog[0], settings.fog[1], settings.fog[2]) : null;
    HALO_MATERIAL.color.set(settings.halo ?? INK);
    envUpdate = settings.update || null;
    // In bots mode this is the ground you walk: where the edges are.
    if (bots) bots.setBounds(mapBounds);
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
const SMG_HOLD = {
    home: { pos: [0.26, -0.23, -0.64], rot: [0.05, 0.12, 0.04] },
    inspect: { pos: [0.05, -0.14, -0.54], rot: [0.2, -1.0, -0.34] },
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
const OLIVE = metal(0x5a6b41, 0.72, 0.12);
const GLASS = metal(0x1d4a6e, 0.08, 0.9);

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
    // It is also the magazine: it drops out and a fresh one goes in on reload.
    const pack = new THREE.Group();
    const cell = new THREE.Mesh(UNIT_BOX, dark);
    cell.scale.set(0.09, 0.17, 0.24);
    cell.position.set(0, -0.14, -0.26);
    pack.add(cell);

    const charge = new THREE.Mesh(UNIT_BOX, core);
    charge.scale.set(0.1, 0.095, 0.17);
    charge.position.set(0, -0.14, -0.26);
    pack.add(charge);
    g.add(pack);
    g.userData.mag = pack;

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
    const port = new THREE.Object3D();
    port.position.set(0.055, 0.04, -0.04);
    g.add(port);
    g.userData.port = port;
    box(g, GUNMETAL, [0.14, 0.02, 0.04], [0, 0.08, 0.2]);

    box(g, POLYMER, [0.12, 0.12, 0.52], [0, 0.03, -0.64]);
    for (const side of [-1, 1]) box(g, GUNMETAL, [0.012, 0.03, 0.48], [side * 0.066, 0.03, -0.64]);

    box(g, GUNMETAL, [0.06, 0.025, 1.08], [0, 0.1, -0.36]);
    for (let i = 0; i < 12; i++) box(g, POLYMER, [0.064, 0.012, 0.03], [0, 0.118, 0.12 - i * 0.085]);
    box(g, GUNMETAL, [0.05, 0.06, 0.06], [0, 0.14, 0.14]);
    box(g, GUNMETAL, [0.03, 0.14, 0.04], [0, 0.1, -0.94]);

    tube(g, GUNMETAL, 0.022, 0.34, [0, 0.03, -1.06]);
    tube(g, POLYMER, 0.032, 0.1, [0, 0.03, -1.26]);

    const mag = new THREE.Group();
    box(mag, POLYMER, [0.075, 0.2, 0.13], [0, -0.2, -0.14], [-0.1, 0, 0]);
    box(mag, POLYMER, [0.075, 0.16, 0.13], [0, -0.36, -0.2], [-0.32, 0, 0]);
    g.add(mag);
    g.userData.mag = mag;

    box(g, POLYMER, [0.08, 0.26, 0.12], [0, -0.22, 0.17], [0.32, 0, 0]);
    box(g, GUNMETAL, [0.02, 0.012, 0.16], [0, -0.14, 0.06]);
    box(g, STEEL, [0.016, 0.06, 0.02], [0, -0.1, 0.07]);

    tube(g, GUNMETAL, 0.035, 0.3, [0, 0, 0.36]);
    box(g, POLYMER, [0.08, 0.16, 0.28], [0, -0.03, 0.58]);
    box(g, POLYMER, [0.085, 0.2, 0.03], [0, -0.04, 0.72]);

    attachMuzzle(g, [0, 0.03, -1.32], 0xffc36b);
    return g;
}

// The AK-47: blued stamped receiver, wooden stock, grip and handguard, the gas
// tube over the barrel, a slanted muzzle brake, and the long curved magazine.
// The selector lever on the right turns between full auto and single shot.
function buildAk() {
    const g = new THREE.Group();
    const blued = metal(0x2e3033, 0.45, 0.55);
    const wood = metal(0x8a4b22, 0.55, 0.05);

    box(g, blued, [0.095, 0.12, 0.62], [0, 0.02, -0.05]);
    box(g, blued, [0.085, 0.03, 0.56], [0, 0.095, -0.03]);
    box(g, blued, [0.06, 0.05, 0.1], [0, 0.1, -0.36]);
    box(g, POLYMER, [0.004, 0.035, 0.12], [0.049, 0.04, -0.02]);
    box(g, STEEL, [0.05, 0.02, 0.03], [0.07, 0.05, -0.2]);

    const selector = new THREE.Group();
    selector.position.set(0.051, 0.03, 0.1);
    box(selector, STEEL, [0.012, 0.022, 0.17], [0.004, 0, -0.07]);
    g.add(selector);
    g.userData.selector = selector;

    box(g, wood, [0.11, 0.1, 0.34], [0, -0.01, -0.54]);
    box(g, wood, [0.08, 0.06, 0.3], [0, 0.085, -0.54]);
    tube(g, blued, 0.022, 0.24, [0, 0.085, -0.82]);
    box(g, blued, [0.05, 0.1, 0.05], [0, 0.05, -0.95]);
    tube(g, blued, 0.02, 0.5, [0, 0.03, -0.98]);
    box(g, blued, [0.03, 0.1, 0.04], [0, 0.1, -1.12]);
    tube(g, blued, 0.03, 0.08, [0, 0.03, -1.26]);
    box(g, blued, [0.062, 0.02, 0.06], [0, 0.058, -1.27], [0.4, 0, 0]);

    // The magazine curves forward in three steps.
    const mag = new THREE.Group();
    const bakelite = metal(0x6e3a1f, 0.6, 0.15);
    box(mag, bakelite, [0.07, 0.16, 0.14], [0, -0.12, -0.2], [-0.15, 0, 0]);
    box(mag, bakelite, [0.07, 0.15, 0.14], [0, -0.26, -0.25], [-0.35, 0, 0]);
    box(mag, bakelite, [0.07, 0.14, 0.14], [0, -0.38, -0.33], [-0.55, 0, 0]);
    g.add(mag);
    g.userData.mag = mag;

    box(g, wood, [0.075, 0.22, 0.11], [0, -0.17, 0.12], [0.35, 0, 0]);
    box(g, blued, [0.02, 0.012, 0.16], [0, -0.1, 0]);
    box(g, STEEL, [0.014, 0.05, 0.016], [0, -0.08, 0.01]);
    box(g, wood, [0.08, 0.12, 0.32], [0, -0.01, 0.4], [-0.08, 0, 0]);
    box(g, wood, [0.085, 0.2, 0.2], [0, -0.05, 0.64], [-0.08, 0, 0]);
    box(g, blued, [0.09, 0.21, 0.02], [0, -0.06, 0.75], [-0.08, 0, 0]);

    const port = new THREE.Object3D();
    port.position.set(0.055, 0.04, -0.02);
    g.add(port);
    g.userData.port = port;

    attachMuzzle(g, [0, 0.03, -1.32], 0xffb456);
    return g;
}

// A striker-fired polymer pistol: a boxy slide with rear serrations over a
// short frame, three-dot sights and a steep grip.
function buildPistol() {
    const g = new THREE.Group();

    // The slide, with its sights, runs back on every shot.
    const slide = new THREE.Group();
    box(slide, GUNMETAL, [0.075, 0.085, 0.46], [0, 0.05, -0.2]);
    for (let i = 0; i < 5; i++) box(slide, POLYMER, [0.078, 0.06, 0.008], [0, 0.05, -i * 0.02]);
    tube(slide, POLYMER, 0.014, 0.01, [0, 0.05, -0.432]);
    box(slide, STEEL, [0.012, 0.018, 0.018], [0, 0.1, -0.4]);
    box(slide, STEEL, [0.05, 0.02, 0.02], [0, 0.1, 0]);
    g.add(slide);
    g.userData.slide = slide;
    box(g, POLYMER, [0.07, 0.05, 0.4], [0, -0.02, -0.2]);
    const port = new THREE.Object3D();
    port.position.set(0.04, 0.07, -0.14);
    g.add(port);
    g.userData.port = port;

    box(g, POLYMER, [0.07, 0.26, 0.13], [0, -0.17, 0.03], [0.28, 0, 0]);
    // The magazine, mostly inside the grip; the base plate is what shows.
    const mag = new THREE.Group();
    box(mag, GUNMETAL, [0.055, 0.22, 0.1], [0, -0.2, 0.035], [0.28, 0, 0]);
    box(mag, POLYMER, [0.074, 0.025, 0.135], [0, -0.305, 0.066], [0.28, 0, 0]);
    g.add(mag);
    g.userData.mag = mag;
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

    // The slide runs back under the fixed barrel on every shot, as on the
    // real gun, and cocks the hammer as it goes.
    const slide = new THREE.Group();
    box(slide, CHROME, [0.095, 0.1, 0.56], [0, 0.06, -0.24]);
    for (let i = 0; i < 6; i++) box(slide, STEEL, [0.098, 0.07, 0.008], [0, 0.06, -0.01 - i * 0.018]);
    g.add(slide);
    g.userData.slide = slide;
    box(g, CHROME, [0.07, 0.05, 0.46], [0, 0.13, -0.3]);
    box(g, POLYMER, [0.02, 0.006, 0.44], [0, 0.158, -0.3]);
    box(g, STEEL, [0.09, 0.06, 0.46], [0, -0.02, -0.24]);
    tube(g, POLYMER, 0.02, 0.01, [0, 0.1, -0.53]);

    box(g, STEEL, [0.014, 0.022, 0.02], [0, 0.17, -0.5]);
    box(g, STEEL, [0.05, 0.024, 0.02], [0, 0.17, -0.08]);
    const hammer = new THREE.Group();
    hammer.position.set(0, 0.09, 0.05);
    box(hammer, STEEL, [0.03, 0.05, 0.03], [0, -0.005, 0.01], [-0.4, 0, 0]);
    g.add(hammer);
    g.userData.hammer = hammer;
    const port = new THREE.Object3D();
    port.position.set(0.05, 0.09, -0.12);
    g.add(port);
    g.userData.port = port;

    box(g, POLYMER, [0.085, 0.3, 0.14], [0, -0.2, 0.04], [0.22, 0, 0]);
    const mag = new THREE.Group();
    box(mag, STEEL, [0.065, 0.26, 0.11], [0, -0.22, 0.045], [0.22, 0, 0]);
    box(mag, POLYMER, [0.088, 0.025, 0.145], [0, -0.355, 0.075], [0.22, 0, 0]);
    g.add(mag);
    g.userData.mag = mag;
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

// The AWP: a long olive chassis with a thumbhole stock, a fat scope on rings,
// a bolt handle out to the side and a long barrel ending in a muzzle brake.
function buildAwp() {
    const g = new THREE.Group();

    box(g, OLIVE, [0.11, 0.13, 0.9], [0, -0.02, -0.1]);
    box(g, OLIVE, [0.1, 0.2, 0.34], [0, -0.06, 0.5]);
    box(g, POLYMER, [0.105, 0.07, 0.18], [0, -0.03, 0.48]);
    box(g, POLYMER, [0.11, 0.22, 0.03], [0, -0.06, 0.68]);
    box(g, OLIVE, [0.09, 0.05, 0.22], [0, 0.07, 0.46]);

    box(g, GUNMETAL, [0.08, 0.06, 0.42], [0, 0.07, -0.02]);
    // The bolt handle turns up, comes back, goes forward and turns down after
    // every shot. It pivots where it meets the receiver.
    const boltGroup = new THREE.Group();
    boltGroup.position.set(0.01, 0.06, 0.12);
    box(boltGroup, STEEL, [0.12, 0.018, 0.018], [0.06, 0, 0]);
    const knob = new THREE.Mesh(UNIT_BALL, STEEL);
    knob.scale.setScalar(0.022);
    knob.position.set(0.125, 0, 0);
    boltGroup.add(knob);
    g.add(boltGroup);
    g.userData.boltGroup = boltGroup;

    const mag = new THREE.Group();
    box(mag, POLYMER, [0.075, 0.16, 0.14], [0, -0.16, -0.05]);
    g.add(mag);
    g.userData.mag = mag;
    box(g, OLIVE, [0.08, 0.22, 0.1], [0, -0.18, 0.24], [0.35, 0, 0]);
    box(g, GUNMETAL, [0.02, 0.012, 0.14], [0, -0.11, 0.1]);
    box(g, STEEL, [0.014, 0.05, 0.016], [0, -0.09, 0.1]);

    tube(g, GUNMETAL, 0.026, 1.1, [0, 0, -1.1]);
    tube(g, GUNMETAL, 0.042, 0.13, [0, 0, -1.71]);
    for (const z of [-1.68, -1.74]) box(g, POLYMER, [0.09, 0.012, 0.02], [0, 0, z]);

    tube(g, POLYMER, 0.045, 0.7, [0, 0.2, -0.05]);
    tube(g, POLYMER, 0.064, 0.14, [0, 0.2, -0.44]);
    tube(g, POLYMER, 0.056, 0.12, [0, 0.2, 0.33]);
    tube(g, GLASS, 0.056, 0.01, [0, 0.2, -0.515]);
    tube(g, GLASS, 0.048, 0.01, [0, 0.2, 0.395]);
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.06, 12), GUNMETAL);
    turret.position.set(0, 0.26, -0.04);
    g.add(turret);
    const windage = turret.clone();
    windage.rotation.z = Math.PI / 2;
    windage.position.set(0.06, 0.2, -0.04);
    g.add(windage);
    for (const z of [-0.22, 0.12]) box(g, GUNMETAL, [0.05, 0.1, 0.05], [0, 0.12, z]);

    attachMuzzle(g, [0, 0, -1.8], 0xffc36b);
    return g;
}

// A pump shotgun: a receiver over a barrel and a magazine tube, a ribbed pump
// that racks back after every shot, a bead sight and a wooden stock.
function buildShotgun() {
    const g = new THREE.Group();

    box(g, GUNMETAL, [0.1, 0.13, 0.42], [0, 0, -0.02]);
    box(g, POLYMER, [0.004, 0.05, 0.14], [0.051, 0.02, -0.04]);
    tube(g, STEEL, 0.03, 1.0, [0, 0.035, -0.72]);
    tube(g, GUNMETAL, 0.028, 0.8, [0, -0.04, -0.62]);
    tube(g, GUNMETAL, 0.031, 0.03, [0, -0.04, -1.03]);
    const bead = new THREE.Mesh(UNIT_BALL, STEEL);
    bead.scale.setScalar(0.012);
    bead.position.set(0, 0.07, -1.2);
    g.add(bead);

    const shell = new THREE.Group();
    tube(shell, metal(0xb3261e, 0.5, 0.1), 0.022, 0.1, [0, 0, 0.01], 10);
    tube(shell, metal(0xc9a25a, 0.3, 0.8), 0.023, 0.03, [0, 0, 0.07], 10);
    shell.position.set(0, -0.2, -0.04);
    shell.visible = false;
    g.add(shell);
    g.userData.shell = shell;

    const pump = new THREE.Group();
    box(pump, POLYMER, [0.11, 0.1, 0.3], [0, -0.035, -0.5]);
    for (let i = 0; i < 6; i++) box(pump, GUNMETAL, [0.114, 0.104, 0.012], [0, -0.035, -0.39 - i * 0.045]);
    g.add(pump);
    g.userData.pump = pump;

    box(g, WOOD, [0.09, 0.16, 0.44], [0, -0.05, 0.42], [0.08, 0, 0]);
    box(g, POLYMER, [0.095, 0.18, 0.03], [0, -0.07, 0.65], [0.08, 0, 0]);
    box(g, WOOD, [0.08, 0.2, 0.1], [0, -0.15, 0.2], [0.45, 0, 0]);
    box(g, GUNMETAL, [0.02, 0.012, 0.14], [0, -0.1, 0.06]);
    box(g, STEEL, [0.014, 0.05, 0.016], [0, -0.08, 0.06]);

    attachMuzzle(g, [0, 0.035, -1.24], 0xffb456);
    return g;
}

// A compact SMG: a short railed receiver, a long suppressor, a vertical
// foregrip, a stick magazine through the grip and a folded stock.
function buildSmg() {
    const g = new THREE.Group();

    box(g, POLYMER, [0.08, 0.12, 0.44], [0, 0.03, -0.12]);
    box(g, GUNMETAL, [0.05, 0.02, 0.4], [0, 0.1, -0.12]);
    for (let i = 0; i < 7; i++) box(g, POLYMER, [0.054, 0.01, 0.02], [0, 0.114, 0.05 - i * 0.055]);
    box(g, GUNMETAL, [0.07, 0.07, 0.16], [0, 0.03, -0.42]);
    tube(g, POLYMER, 0.04, 0.36, [0, 0.03, -0.66]);
    tube(g, GUNMETAL, 0.042, 0.02, [0, 0.03, -0.49]);

    box(g, POLYMER, [0.05, 0.16, 0.05], [0, -0.1, -0.3], [0.1, 0, 0]);
    box(g, POLYMER, [0.07, 0.24, 0.1], [0, -0.15, 0.05], [0.15, 0, 0]);
    const mag = new THREE.Group();
    box(mag, GUNMETAL, [0.05, 0.2, 0.08], [0, -0.34, 0.02], [0.15, 0, 0]);
    g.add(mag);
    g.userData.mag = mag;
    box(g, GUNMETAL, [0.02, 0.012, 0.12], [0, -0.07, -0.08]);
    box(g, STEEL, [0.014, 0.045, 0.016], [0, -0.05, -0.08]);

    box(g, GUNMETAL, [0.016, 0.03, 0.3], [0.05, -0.02, 0.2]);
    box(g, GUNMETAL, [0.016, 0.12, 0.03], [0.05, -0.07, 0.34]);
    box(g, STEEL, [0.03, 0.02, 0.05], [0, 0.1, 0.1]);
    const port = new THREE.Object3D();
    port.position.set(0.045, 0.05, -0.08);
    g.add(port);
    g.userData.port = port;

    attachMuzzle(g, [0, 0.03, -0.86], 0xffc36b);
    return g;
}

/* ---------- inspects ----------

   Every gun has its own. Each one is a function of how far through the
   inspect it is, returning a handful of channels that updateGun layers onto
   the resting pose: how far up into the inspect position (pose), turns in the
   camera's frame (yaw, pitch, roll), a lift, turns about the gun's own axes
   round its pivot (flip end over end, twist round the barrel), and the moving
   parts (the revolver's cylinder, the shotgun's pump). Whole turns only, so
   every inspect lands exactly where it started. */

const TAU = Math.PI * 2;
const hump = (t, a, b) => Math.sin(Math.PI * clamp((t - a) / (b - a), 0, 1));
const raise = (t, edge = 0.16) => easeInOut(t / edge) * easeInOut((1 - t) / edge);

const INSPECTS = {
    // Up, one slow turn all the way round, back down.
    showoff: (t) => ({
        pose: raise(t, 0.18),
        yaw: easeInOut((t - 0.12) / 0.7) * TAU,
        roll: hump(t, 0.1, 0.9) * 0.45,
    }),
    // The deagle: two quick turns round the trigger finger, then onto its side.
    twirl: (t) => ({
        pose: raise(t, 0.15),
        flip: easeInOut((t - 0.18) / 0.4) * TAU * 2,
        roll: hump(t, 0.6, 0.92) * 0.95,
        yaw: hump(t, 0.6, 0.92) * 0.45,
    }),
    // The rifle: rolled to show one side, over to the other, then tipped up
    // to look down the rail.
    sides: (t) => {
        const a = hump(t, 0.12, 0.45);
        const b = hump(t, 0.42, 0.74);
        return {
            pose: raise(t),
            roll: a * 0.9 - b * 0.9,
            yaw: a * 0.3 - b * 0.55,
            pitch: hump(t, 0.7, 0.95) * 0.35,
            lift: hump(t, 0.7, 0.95) * 0.02,
        };
    },
    // The AK: rolled over to look at the magazine, which is tugged and seated
    // again, then a tap on the bottom of it.
    magcheck: (t) => ({
        pose: raise(t),
        roll: hump(t, 0.1, 0.9) * 1.0,
        yaw: hump(t, 0.1, 0.9) * 0.35,
        pitch: -hump(t, 0.15, 0.85) * 0.15,
        mag: hump(t, 0.35, 0.55) * 0.22,
        back: hump(t, 0.64, 0.72) * 0.03,
    }),
    // The pistol: turned out, flipped over round the barrel to show the other
    // side, and flipped back.
    flipside: (t) => ({
        pose: raise(t),
        twist: Math.PI * (easeInOut((t - 0.22) / 0.22) - easeInOut((t - 0.6) / 0.22)),
        yaw: hump(t, 0.15, 0.85) * 0.3,
    }),
    // The revolver: tilted to show the cylinder, the cylinder spun hard, then
    // one spin backwards round the finger.
    cylinder: (t) => ({
        pose: raise(t),
        roll: hump(t, 0.08, 0.55) * 0.9,
        drum: easeOut((t - 0.12) / 0.38) * TAU * 3,
        flip: -easeInOut((t - 0.58) / 0.3) * TAU,
    }),
    // The AWP: brought up and swung round so the scope glass faces you.
    glass: (t) => ({
        pose: raise(t, 0.14),
        yaw: hump(t, 0.14, 0.86) * 2.5,
        pitch: hump(t, 0.2, 0.8) * 0.2,
        roll: hump(t, 0.3, 0.9) * 0.25,
    }),
    // The shotgun: tilted out and the pump racked twice.
    rack: (t) => ({
        pose: raise(t),
        roll: hump(t, 0.1, 0.9) * 0.55,
        yaw: hump(t, 0.1, 0.9) * 0.3,
        pump: hump(t, 0.28, 0.44) + hump(t, 0.5, 0.66),
    }),
    // The SMG: tossed up, spun round its own barrel in the air, caught.
    toss: (t) => ({
        pose: raise(t, 0.14),
        lift: hump(t, 0.2, 0.62) * 0.13,
        twist: easeInOut((t - 0.22) / 0.36) * TAU,
        yaw: hump(t, 0.15, 0.85) * 0.2,
    }),
};

const REST = {
    pose: 0, yaw: 0, pitch: 0, roll: 0, lift: 0, back: 0,
    flip: 0, twist: 0, drum: 0, pump: 0, mag: 0, bolt: 0, swing: 0, shell: 0,
};

/* ---------- reloads ----------

   Same channels as the inspects, plus the parts a reload moves: how far the
   magazine has dropped out (mag), where the AWP's bolt is in its cycle (bolt),
   how far the revolver's cylinder has swung out (swing), and a shell on its
   way into the shotgun (shell). Every reload ends with every channel back at
   zero, so the gun settles straight into its resting pose. */

const span = (t, a, b) => easeInOut((t - a) / (b - a));

const RELOADS = {
    // Tilted in, the old magazine dropped, a fresh one seated, then the slide
    // or the charging handle racked.
    mag: (t) => {
        const tilt = hump(t, 0, 1);
        return {
            roll: tilt * 0.5,
            pitch: tilt * 0.12,
            lift: -tilt * 0.035,
            mag: span(t, 0.1, 0.3) - span(t, 0.42, 0.66),
            back: hump(t, 0.78, 0.92) * 0.045,
        };
    },
    // The AWP: magazine out and in, then the bolt worked to chamber a round.
    bolt: (t) => {
        const tilt = hump(t, 0, 1);
        return {
            roll: tilt * 0.45,
            pitch: tilt * 0.1,
            lift: -tilt * 0.03,
            mag: span(t, 0.08, 0.24) - span(t, 0.34, 0.54),
            bolt: clamp((t - 0.64) / 0.32, 0, 1),
        };
    },
    // The revolver: cylinder swung out, emptied and spun, reloaded, closed.
    cylinder: (t) => {
        const tilt = hump(t, 0, 1);
        return {
            roll: tilt * 0.9,
            pitch: tilt * 0.2,
            swing: span(t, 0.08, 0.22) - span(t, 0.8, 0.92),
            drum: span(t, 0.25, 0.75) * TAU,
            lift: -hump(t, 0.35, 0.6) * 0.02,
        };
    },
    // The shotgun: turned on its side, a shell pushed in each beat.
    shells: (t, phase) => ({
        roll: raise(t, 0.08) * 0.45,
        yaw: raise(t, 0.08) * 0.2,
        lift: -Math.sin(phase * Math.PI) * 0.012,
        shell: phase < 0.7 ? phase / 0.7 : 0,
    }),
};

// Where the AWP's bolt handle is for a point in its cycle: up, back, forward,
// down.
function boltPose(b) {
    const up = span(b, 0, 0.22) - span(b, 0.78, 1);
    const pull = span(b, 0.26, 0.46) - span(b, 0.52, 0.74);
    return { turn: up * 1.1, pull: pull * 0.14 };
}

// How each gun handles. Cooldown is the fastest it will fire again, spread is
// how far consecutive shots wander from the crosshair (in screen units), punch
// is how far each shot kicks the view up. The scoring surface is the same for
// all of them: the gun changes the rhythm, not the target.
const WEAPONS = [
    { id: 'plasma', label: 'plasma rifle', build: buildPlasma, scale: 0.38, ...RIFLE_HOLD, showcase: 1.9,
        inspectStyle: 'showoff', inspectMs: 2500, mag: 40, reloadStyle: 'mag', reloadMs: 1900,
        cooldown: 120, auto: false, kick: 7.4, punch: 0, spread: null, flash: 1, tracer: 0xffe9bd, tracerWidth: 1 },
    { id: 'ar', label: 'ar', build: buildRifle, scale: 0.36, ...RIFLE_HOLD, showcase: 2.05,
        inspectStyle: 'sides', inspectMs: 3000, mag: 30, reloadStyle: 'mag', reloadMs: 2300,
        cooldown: 95, auto: true, kick: 3.2, punch: 0.0045, spread: { step: 0.005, max: 0.045 }, flash: 0.9, tracer: 0xffd88a, tracerWidth: 0.45 },
    { id: 'ak', label: 'ak-47', build: buildAk, scale: 0.36, ...RIFLE_HOLD, showcase: 2.0,
        inspectStyle: 'magcheck', inspectMs: 2800, mag: 30, reloadStyle: 'mag', reloadMs: 2400,
        selectFire: true, cooldown: 100, auto: true, kick: 3.8, punch: 0.0055, spread: { step: 0.0065, max: 0.05 },
        flash: 1.0, tracer: 0xffd08a, tracerWidth: 0.5 },
    { id: 'pistol', label: 'pistol', build: buildPistol, scale: 0.42, ...PISTOL_HOLD, showcase: 0.95,
        inspectStyle: 'flipside', inspectMs: 2400, mag: 20, reloadStyle: 'mag', reloadMs: 1600, pivot: new THREE.Vector3(0, 0.02, -0.18),
        slideTravel: 0.09, muzzleFlip: 0.16, grip: new THREE.Vector3(0, -0.2, 0.05),
        cooldown: 110, auto: false, kick: 4.6, punch: 0.006, spread: { step: 0.006, max: 0.03 }, flash: 0.75, tracer: 0xffd88a, tracerWidth: 0.4 },
    { id: 'deagle', label: 'deagle', build: buildDeagle, scale: 0.42, ...PISTOL_HOLD, showcase: 1.12,
        inspectStyle: 'twirl', inspectMs: 2600, mag: 7, reloadStyle: 'mag', reloadMs: 1900, pivot: new THREE.Vector3(0, -0.08, -0.12),
        slideTravel: 0.13, muzzleFlip: 0.55, grip: new THREE.Vector3(0, -0.24, 0.06),
        cooldown: 380, auto: false, kick: 6.5, punch: 0.02, spread: { step: 0.03, max: 0.06 }, flash: 1.5, tracer: 0xffd08a, tracerWidth: 0.6 },
    { id: 'revolver', label: 'revolver', build: buildRevolver, scale: 0.42, ...PISTOL_HOLD, showcase: 1.25,
        inspectStyle: 'cylinder', inspectMs: 3000, mag: 8, reloadStyle: 'cylinder', reloadMs: 2300, pivot: new THREE.Vector3(0, -0.08, 0.05),
        cooldown: 480, auto: false, kick: 9.5, punch: 0.016, spread: null, flash: 1.3, tracer: 0xffd08a, tracerWidth: 0.55 },
    { id: 'awp', label: 'awp', build: buildAwp, scale: 0.34, ...RIFLE_HOLD, showcase: 2.1,
        inspectStyle: 'glass', inspectMs: 3000, mag: 10, reloadStyle: 'bolt', reloadMs: 2700, boltAction: true,
        cooldown: 820, auto: false, kick: 13, punch: 0.03, spread: null, scope: true, unscopedSpread: 0.09,
        flash: 1.6, tracer: 0xffe2a8, tracerWidth: 0.7 },
    { id: 'shotgun', label: 'shotgun', build: buildShotgun, scale: 0.36, ...RIFLE_HOLD, showcase: 2.1,
        inspectStyle: 'rack', inspectMs: 2600, mag: 8, reloadStyle: 'shells', shellMs: 480,
        cooldown: 850, auto: false, kick: 12, punch: 0.025, spread: null, pellets: 9, pelletSpread: 0.075,
        flash: 1.7, tracer: 0xffd08a, tracerWidth: 0.5 },
    { id: 'smg', label: 'smg', build: buildSmg, scale: 0.4, ...SMG_HOLD, showcase: 1.35,
        inspectStyle: 'toss', inspectMs: 2200, mag: 30, reloadStyle: 'mag', reloadMs: 1900, pivot: new THREE.Vector3(0, 0, -0.15),
        cooldown: 70, auto: true, kick: 2.4, punch: 0.003, spread: { step: 0.007, max: 0.06 },
        flash: 0.45, tracer: 0xffd88a, tracerWidth: 0.4 },
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

    buildCasings();
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
    if (scoped) setScope(false);
}

// Recoil, sway, the pulsing core and the inspect animation, all folded into the
// rifle's transform once per frame.
const AIM_POINT = new THREE.Vector3(0, 0, -14);
const TWIRL_PIVOT = new THREE.Vector3();
const twirlStill = new THREE.Vector3();
const twirlTurned = new THREE.Vector3();
const twirlTurn = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const DEFAULT_PIVOT = new THREE.Vector3(0, -0.08, -0.1);
let pumpStart = 0;

// When the current gun last fired, for the slide, the hammer and the muzzle
// flip, which all play out over a few hundred milliseconds after a shot.
let shotAt = 0;

// How far the muzzle has flipped at a moment after the shot: a hard snap up
// in the first few milliseconds, then a settle back with a small dip past
// rest, the way a heavy handgun rolls back into the hand.
function muzzleFlipAt(ms) {
    const e = ms / 1000;
    if (e < 0.04) return easeOut(e / 0.04);
    return Math.exp(-(e - 0.04) * 8) * Math.cos((e - 0.04) * 10);
}

// The slide: slammed back in a few milliseconds, sprung home a little slower.
function slideAt(ms) {
    if (ms < 30) return ms / 30;
    return Math.max(0, 1 - (ms - 30) / 95);
}

/* ---------- brass ----------

   Spent casings kicked out of the ejection port, up and to the right, tumbling
   as they fall. They live in the viewmodel scene rather than on the gun, so
   once they are out they fly free of it. */

const CASING_COUNT = 10;
const casings = [];
const portWorld = new THREE.Vector3();

function buildCasings() {
    const brass = metal(0xc9a25a, 0.3, 0.85);
    const geometry = new THREE.CylinderGeometry(0.006, 0.006, 0.022, 8);
    for (let i = 0; i < CASING_COUNT; i++) {
        const mesh = new THREE.Mesh(geometry, brass);
        mesh.visible = false;
        viewScene.add(mesh);
        casings.push({ mesh, born: 0, v: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
}

function ejectCasing() {
    const port = gun.userData.port;
    if (!port) return;
    let slot = casings.find((c) => !c.born);
    if (!slot) slot = casings.reduce((a, b) => (a.born < b.born ? a : b));
    gun.updateMatrixWorld();
    port.getWorldPosition(portWorld);
    slot.mesh.position.copy(portWorld);
    slot.mesh.visible = true;
    slot.born = performance.now();
    slot.v.set(1.1 + Math.random() * 0.5, 1.0 + Math.random() * 0.5, 0.25 + Math.random() * 0.2);
    slot.spin.set(Math.random() * 30, Math.random() * 20, 18 + Math.random() * 20);
}

function updateCasings(now, dt) {
    for (const c of casings) {
        if (!c.born) continue;
        if (now - c.born > 650) {
            c.born = 0;
            c.mesh.visible = false;
            continue;
        }
        c.v.y -= 7 * dt;
        c.mesh.position.addScaledVector(c.v, dt);
        c.mesh.rotation.x += c.spin.x * dt;
        c.mesh.rotation.y += c.spin.y * dt;
        c.mesh.rotation.z += c.spin.z * dt;
    }
}

/* ---------- ammo ---------- */

// Rounds in the magazine for each gun, refilled at the start of a round.
// Reserve is endless: this is an aim trainer, not an economy.
const ammo = {};

// Reloading is the harder way to play and the default. Off, every magazine
// is bottomless and the gun never reloads.
const RELOAD_MODES = [
    { id: 'on', label: 'on · harder' },
    { id: 'off', label: 'off' },
];
let reloadsOn = true;
let reloadStart = 0;
let reloadLength = 0;
let reloadFrom = 0;
let autoReloadAt = 0;
// The AWP works its bolt after every shot, then scopes back in if it was
// scoped when it fired, the way csgo does.
const BOLT_MS = 620;
let chamberStart = 0;
let rezoom = false;

function fillAmmo() {
    for (const w of WEAPONS) ammo[w.id] = w.mag;
}

function startReload() {
    if (!reloadsOn || !running || reloadStart || ammo[weapon.id] >= weapon.mag) return;
    if (scoped) setScope(false);
    rezoom = false;
    chamberStart = 0;
    inspectStart = 0;
    clearTimeout(autoReloadAt);
    autoReloadAt = 0;
    reloadFrom = ammo[weapon.id];
    reloadStart = performance.now();
    reloadLength = weapon.reloadStyle === 'shells'
        ? weapon.shellMs * (weapon.mag - reloadFrom)
        : weapon.reloadMs;
    reloadSounds();
    updateAmmo();
}

function cancelReload() {
    reloadStart = 0;
    stopQueued();
    updateAmmo();
}

// Called every frame: loads shotgun shells as they go in, finishes reloads,
// closes the AWP's bolt, and starts the reload an empty magazine asks for.
function tickAmmo(now) {
    if (reloadStart) {
        const elapsed = now - reloadStart;
        if (weapon.reloadStyle === 'shells') {
            ammo[weapon.id] = Math.min(weapon.mag, reloadFrom + Math.floor(elapsed / weapon.shellMs));
        }
        if (elapsed >= reloadLength) {
            ammo[weapon.id] = weapon.mag;
            reloadStart = 0;
        }
        updateAmmo();
    }
    if (chamberStart && now > chamberStart + BOLT_MS) {
        chamberStart = 0;
        if (rezoom && running && !reloadStart) setScope(true);
        rezoom = false;
    }
}

function updateAmmo() {
    const left = ammo[weapon.id] ?? weapon.mag;
    elAmmoGun.textContent = weapon.selectFire ? `${weapon.label} · ${akAuto ? 'auto' : 'semi'}` : weapon.label;
    elAmmoMag.textContent = reloadsOn ? String(left) : '∞';
    elAmmoReserve.hidden = !reloadsOn;
    elAmmo.classList.toggle('is-low', reloadsOn && left <= Math.ceil(weapon.mag * 0.2));
    elAmmo.classList.toggle('is-reloading', !!reloadStart);
    const progress = reloadStart ? clamp((performance.now() - reloadStart) / reloadLength, 0, 1) : 0;
    elAmmoFill.style.width = `${progress * 100}%`;
}

/* ---------- sound ----------

   Everything is synthesised with Web Audio, so there are no files to load: a
   shot is a burst of filtered noise for the crack and a falling tone for the
   thump, shaped per gun. Reload clicks are short band-passed ticks, scheduled
   against the reload's own timing so they land with the animation. */

let soundOn = true;
let audio = null;
let master = null;
let noiseBuffer = null;
let queued = [];

function sound() {
    if (!soundOn) return null;
    if (!audio) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        audio = new Ctx();
        master = audio.createGain();
        master.gain.value = 0.45;
        master.connect(audio.destination);
        noiseBuffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (audio.state === 'suspended') audio.resume();
    return audio;
}

function burst({ at = 0, cutoff = 4000, type = 'lowpass', q = 0.7, decay = 0.2, volume = 0.5, queue = false }) {
    const ctx = sound();
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(cutoff, t);
    if (type === 'lowpass') filter.frequency.exponentialRampToValueAtTime(Math.max(180, cutoff * 0.08), t + decay);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
    if (queue) queued.push(src);
}

function tone({ at = 0, from = 140, to = 40, decay = 0.15, volume = 0.5, type = 'sine' }) {
    const ctx = sound();
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + decay);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + decay + 0.05);
}

const tick = (at, pitch = 3000, volume = 0.22) =>
    burst({ at, cutoff: pitch, type: 'bandpass', q: 5, decay: 0.045, volume, queue: true });

function stopQueued() {
    for (const src of queued) {
        try {
            src.stop();
        } catch {
            // already finished
        }
    }
    queued = [];
}

const SHOT_SOUNDS = {
    plasma: () => {
        tone({ from: 1400, to: 180, decay: 0.2, volume: 0.22, type: 'sawtooth' });
        burst({ cutoff: 2600, decay: 0.12, volume: 0.25 });
    },
    ar: () => {
        burst({ cutoff: 6000, decay: 0.16, volume: 0.55 });
        tone({ from: 140, to: 45, decay: 0.1, volume: 0.5 });
    },
    pistol: () => {
        burst({ cutoff: 5200, decay: 0.12, volume: 0.45 });
        tone({ from: 180, to: 60, decay: 0.08, volume: 0.35 });
    },
    deagle: () => {
        burst({ cutoff: 7000, decay: 0.36, volume: 0.8 });
        tone({ from: 110, to: 35, decay: 0.22, volume: 0.75 });
    },
    revolver: () => {
        burst({ cutoff: 6500, decay: 0.32, volume: 0.72 });
        tone({ from: 120, to: 40, decay: 0.2, volume: 0.6 });
    },
    // The AWP: a sharp crack, a heavy boom under it, and the echo coming back.
    awp: () => {
        burst({ cutoff: 12000, decay: 0.07, volume: 0.9 });
        burst({ cutoff: 5200, decay: 0.6, volume: 0.62 });
        tone({ from: 95, to: 28, decay: 0.32, volume: 0.95 });
        burst({ at: 0.14, cutoff: 1600, decay: 0.55, volume: 0.16 });
    },
    shotgun: () => {
        burst({ cutoff: 4500, decay: 0.42, volume: 0.85 });
        tone({ from: 90, to: 30, decay: 0.24, volume: 0.8 });
    },
    ak: () => {
        burst({ cutoff: 5200, decay: 0.2, volume: 0.62 });
        tone({ from: 120, to: 40, decay: 0.12, volume: 0.58 });
    },
    smg: () => {
        burst({ cutoff: 2200, decay: 0.07, volume: 0.3 });
        tone({ from: 220, to: 90, decay: 0.05, volume: 0.2 });
    },
};

// Clicks for each reload, at the points in the animation they belong to.
function reloadSounds() {
    const L = reloadLength / 1000;
    if (weapon.reloadStyle === 'shells') {
        for (let i = 0; i < weapon.mag - reloadFrom; i++) tick(((i + 0.55) * weapon.shellMs) / 1000, 2200, 0.28);
    } else if (weapon.reloadStyle === 'cylinder') {
        tick(L * 0.12, 2600);
        for (let i = 0; i < 4; i++) tick(L * (0.3 + i * 0.03), 4200, 0.12);
        tick(L * 0.52, 2000, 0.26);
        tick(L * 0.9, 2400, 0.3);
    } else {
        tick(L * 0.14, 2400);
        tick(L * 0.58, 1800, 0.3);
        if (weapon.reloadStyle === 'bolt') {
            tick(L * 0.68, 3200);
            tick(L * 0.78, 2600);
            tick(L * 0.88, 2800);
            tick(L * 0.96, 3400);
        } else {
            tick(L * 0.8, 3000);
            tick(L * 0.86, 2400);
        }
    }
}

function boltSounds() {
    const start = 0.06;
    const L = BOLT_MS / 1000;
    tick(start + L * 0.12, 3200);
    tick(start + L * 0.4, 2600);
    tick(start + L * 0.62, 2800);
    tick(start + L * 0.9, 3400);
}

// The AWP's scope: right click toggles it. Scoped, the view narrows, the gun
// is out of frame and the overlay draws the reticle. Every shot unscopes, the
// way it does in csgo.
const SCOPE_FOV = 22;
let scoped = false;

function setScope(on) {
    scoped = !!on && weapon.scope && running && !touchOnly;
    elScope.hidden = !scoped;
    crosshair.hidden = scoped || touchOnly || !running;
    camera.fov = scoped ? SCOPE_FOV : BASE_FOV;
    camera.updateProjectionMatrix();
}

function inspectLength() {
    return weapon.inspectMs || INSPECT_MS;
}
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

    // Inspect: whichever routine this gun has, sampled at how far through it
    // is. Outside an inspect every channel is at rest.
    let ins = REST;
    if (inspectStart) {
        const t = (now - inspectStart) / inspectLength();
        if (t >= 1) inspectStart = 0;
        else ins = { ...REST, ...INSPECTS[weapon.inspectStyle || 'showoff'](t) };
    }
    // A reload overrides any inspect: the gun is busy.
    if (reloadStart) {
        const elapsed = now - reloadStart;
        const t = clamp(elapsed / reloadLength, 0, 1);
        const phase = weapon.shellMs ? (elapsed % weapon.shellMs) / weapon.shellMs : 0;
        ins = { ...REST, ...RELOADS[weapon.reloadStyle](t, phase) };
    }
    const { pose } = ins;

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
            lerp(weapon.home.pos[1], weapon.inspect.pos[1], pose) - sway.y * 0.5 + Math.sin(now / 900) * 0.005 * breathe + kick * 0.022 + ins.lift,
            lerp(weapon.home.pos[2], weapon.inspect.pos[2], pose) + kick * 0.1 + ins.back
        );
        // Walking in bots mode bobs the gun with each stride.
        if (botsMode() && running) {
            const stride = Math.min(1, bots.speed / 21);
            gun.position.x += Math.sin(bots.bobPhase) * 0.012 * stride;
            gun.position.y -= Math.abs(Math.cos(bots.bobPhase)) * 0.01 * stride;
        }
        gun.rotation.set(
            lerp(weapon.home.rot[0], weapon.inspect.rot[0], pose) - kick * 0.26 + sway.y * 0.9 + ins.pitch,
            lerp(weapon.home.rot[1], weapon.inspect.rot[1], pose) + sway.x * 1.1 + ins.yaw,
            lerp(weapon.home.rot[2], weapon.inspect.rot[2], pose) + kick * 0.06 + ins.roll
        );

        // Flips and twists turn round the gun's pivot (the trigger guard on a
        // handgun), not its middle, and about the gun's own axes, so the barrel
        // goes end over end whichever way the gun is angled at the time.
        // Rotating about the origin and then moving the gun by the difference
        // between where the pivot sits with and without the turn keeps that
        // point still while everything else swings round it.
        if (ins.flip || ins.twist) {
            TWIRL_PIVOT.copy(weapon.pivot || DEFAULT_PIVOT).multiplyScalar(weapon.scale);
            twirlStill.copy(TWIRL_PIVOT).applyQuaternion(gun.quaternion);
            if (ins.flip) gun.quaternion.multiply(twirlTurn.setFromAxisAngle(X_AXIS, ins.flip));
            if (ins.twist) gun.quaternion.multiply(twirlTurn.setFromAxisAngle(Z_AXIS, ins.twist));
            twirlTurned.copy(TWIRL_PIVOT).applyQuaternion(gun.quaternion);
            gun.position.add(twirlStill.sub(twirlTurned));
        }

        // Muzzle flip, turning the gun up round the hand on the grip rather
        // than round its middle, the same way the twirl keeps its pivot still.
        if (weapon.muzzleFlip && shotAt && now - shotAt < 700) {
            const flipUp = weapon.muzzleFlip * muzzleFlipAt(now - shotAt);
            TWIRL_PIVOT.copy(weapon.grip).multiplyScalar(weapon.scale);
            twirlStill.copy(TWIRL_PIVOT).applyQuaternion(gun.quaternion);
            gun.quaternion.multiply(twirlTurn.setFromAxisAngle(X_AXIS, flipUp));
            twirlTurned.copy(TWIRL_PIVOT).applyQuaternion(gun.quaternion);
            gun.position.add(twirlStill.sub(twirlTurned));
        }
    }

    // The revolver's cylinder turns one chamber per shot, quickly but not
    // instantly, so the turn reads.
    const drum = gun.userData.drum;
    if (drum) {
        gun.userData.drumNow = (gun.userData.drumNow || 0) + (gun.userData.drumAngle - (gun.userData.drumNow || 0)) * Math.min(1, dt * 18);
        drum.rotation.z = gun.userData.drumNow + ins.drum;
        // Swung out to the side for a reload.
        drum.position.x = ins.swing * 0.13;
    }

    // The AK's selector lever: down a notch for single shot, all the way for auto.
    const lever = gun.userData.selector;
    if (lever) lever.rotation.x += ((akAuto ? -0.45 : -0.18) - lever.rotation.x) * Math.min(1, dt * 20);

    // The magazine drops down out of the gun and a new one comes back up.
    // Hidden at the bottom of the drop, which is where the swap happens.
    const mag = gun.userData.mag;
    if (mag) {
        mag.position.set(0, -ins.mag * 0.45, ins.mag * 0.06);
        mag.visible = ins.mag < 0.97;
    }

    // The AWP's bolt: its reload cycle, or the one after every shot.
    const handle = gun.userData.boltGroup;
    if (handle) {
        const cycle = chamberStart && now > chamberStart ? clamp((now - chamberStart) / BOLT_MS, 0, 1) : 0;
        const b = boltPose(ins.bolt || cycle);
        handle.rotation.z = b.turn;
        handle.position.z = 0.12 + b.pull;
    }

    // The slide runs back on a shot, and is racked at the end of a reload.
    const slide = gun.userData.slide;
    if (slide) {
        const fired = shotAt ? slideAt(now - shotAt) : 0;
        const back = Math.max(fired, ins.back / 0.045);
        slide.position.z = back * (weapon.slideTravel || 0.08);
        const hammer = gun.userData.hammer;
        if (hammer) hammer.rotation.x = Math.max(back, 0) * 0.7;
    }

    updateCasings(now, dt);

    // A shotgun shell rising into the loading port.
    const shell = gun.userData.shell;
    if (shell) {
        shell.visible = ins.shell > 0;
        shell.position.y = -0.2 + ins.shell * 0.12;
    }

    // The shotgun racks its pump after every shot, and twice in its inspect.
    const pump = gun.userData.pump;
    if (pump) {
        const racked = pumpStart && now > pumpStart ? hump((now - pumpStart) / 420, 0, 1) : 0;
        if (pumpStart && now - pumpStart > 420) pumpStart = 0;
        pump.position.z = (racked + ins.pump) * 0.14;
    }

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
    if (gun.userData.pump) pumpStart = flashStart + 140;
    shotAt = flashStart;
    ejectCasing();

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
    if (inspectStart) inspectStart = Math.min(inspectStart, performance.now() - inspectLength() * 0.86);
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
    shotAt = 0;
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
    if (gun && gun.visible && !scoped) {
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
    // Scoped in, the same hand movement should cover the same distance on
    // screen, so the look speed shrinks with the field of view.
    const speed = lookSpeed() * (scoped ? SCOPE_FOV / BASE_FOV : 1);
    yaw -= event.movementX * speed;
    pitch -= event.movementY * speed;
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
// The AK switches between full auto and single shot on G. Every other gun is
// fixed to what its table entry says.
let akAuto = true;
const isAuto = () => (weapon.selectFire ? akAuto : weapon.auto);
let modeNoteTimer = 0;

function toggleFireMode() {
    if (!weapon.selectFire) return;
    akAuto = !akAuto;
    remember(AK_MODE_KEY, akAuto ? 'auto' : 'semi');
    triggerHeld = false;
    burst({ cutoff: 2600, type: 'bandpass', q: 5, decay: 0.05, volume: 0.3 });
    updateAmmo();
    updateHint();
    if (running) {
        setNote(akAuto ? 'full auto' : 'single shot');
        clearTimeout(modeNoteTimer);
        modeNoteTimer = setTimeout(() => setNote(''), 1200);
    }
}

// A click this close to the gun being ready is held and fired the moment it
// is, instead of being dropped and needing a second click.
const BUFFER_MS = 220;
let bufferedShot = 0;

function fire(ndc) {
    if (!running) return;
    if (botsMode() && !bots.alive) return;
    const now = performance.now();
    const ready = Math.max(lastShotAt + weapon.cooldown, chamberStart ? chamberStart + BOLT_MS : 0);
    if (now < ready) {
        if (!isAuto() && !bufferedShot && ready - now <= BUFFER_MS) {
            bufferedShot = setTimeout(() => {
                bufferedShot = 0;
                fire(ndc);
            }, ready - now + 1);
        }
        return;
    }
    // Settle any reload or bolt that finished since the last frame, so a
    // click never waits on the render loop to notice.
    tickAmmo(now);

    // Mid-reload the gun is busy, except the shotgun, which can fire whatever
    // shells are already in, cutting the reload short, as in csgo.
    if (reloadStart) {
        if (weapon.reloadStyle === 'shells' && ammo[weapon.id] > 0) cancelReload();
        else return;
    }
    if (chamberStart) return;
    if (reloadsOn && ammo[weapon.id] <= 0) {
        lastShotAt = now;
        tick(0, 1800, 0.35);
        startReload();
        return;
    }
    if (reloadsOn) ammo[weapon.id]--;
    (SHOT_SOUNDS[weapon.id] || SHOT_SOUNDS.ar)();

    // Shots fired close together wander further from where the player aimed,
    // which is what keeps holding down the AR from being free hits.
    streak = now - lastShotAt < weapon.cooldown * 2.5 ? streak + 1 : 0;
    lastShotAt = now;
    shots++;

    let aim = ndc || CENTRE;
    const wander = (radius) => {
        const r = radius * Math.sqrt(Math.random());
        const a = Math.random() * Math.PI * 2;
        return new THREE.Vector2(aim.x + (Math.cos(a) * r) / camera.aspect, aim.y + Math.sin(a) * r);
    };
    if (weapon.spread && streak) aim = wander(Math.min(weapon.spread.max, streak * weapon.spread.step));
    // A sniper fired from the hip goes roughly where it is pointed. Not on a
    // phone, where there is no way to scope in.
    if (weapon.scope && !scoped && !ndc) aim = wander(weapon.unscopedSpread);
    // Running and jumping throw shots off, as in csgo; walking barely does.
    if (botsMode()) {
        const moving = clamp((bots.speed - 11) / 10, 0, 1) + (bots.airborne ? 1 : 0);
        if (moving > 0) aim = wander(moving * (weapon.scope ? 0.12 : weapon.pellets ? 0.01 : 0.035));
        // Crouched and still, a spray stays tighter, the way it does in csgo.
        if (bots.crouched && streak) aim.lerp(ndc || CENTRE, 0.35);
    }
    fireGun(aim);

    // Bots mode: the bullet (or each pellet) goes into the map and the bots.
    if (botsMode()) {
        camera.updateMatrixWorld();
        // Anything hidden along the line of the shot, checked before the bots
        // move the raycaster on.
        raycaster.setFromCamera(aim, camera);
        const eggHit = eggMeshes.length ? raycaster.intersectObjects(eggMeshes, true)[0] : null;
        let landed = false;
        let nearestWall = Infinity;
        for (let i = 0; i < (weapon.pellets || 1); i++) {
            raycaster.setFromCamera(weapon.pellets ? wander(weapon.pelletSpread) : aim, camera);
            const result = bots.shoot(raycaster.ray, weapon.id, weapon.label);
            if (result.hit) landed = true;
            else nearestWall = Math.min(nearestWall, result.wallDist ?? Infinity);
        }
        if (!landed && eggHit && eggHit.distance <= nearestWall + 0.05) findEgg(eggHit.object);
        if (landed) {
            hits++;
            tone({ at: 0.02, from: 1300, to: 1050, decay: 0.08, volume: 0.1, type: 'triangle' });
        }
        afterShot(now);
        return;
    }

    // A shotgun sends a cone of pellets and scores the nearest target any of
    // them finds. One hit per shot at most, so accuracy stays a fraction.
    let hit;
    for (let i = 0; i < (weapon.pellets || 1); i++) {
        raycaster.setFromCamera(weapon.pellets ? wander(weapon.pelletSpread) : aim, camera);
        const found = raycaster.intersectObjects(targetGroup.children, true)[0];
        if (found && (!hit || found.distance < hit.distance)) hit = found;
    }

    if (hit) {
        let target = hit.object;
        while (target.parent && target.parent !== targetGroup) target = target.parent;
        hits++;
        tone({ at: 0.03, from: 1300, to: 1050, decay: 0.09, volume: 0.12, type: 'triangle' });
        hitPoint.copy(target.position);
        spawnBurst(hitPoint);
        placeTarget(target);
    }

    afterShot(now);
}

// Everything after the bullet: the AWP's bolt, unscoping, the empty-magazine
// reload, and the view punch.
function afterShot(now) {
    // The AWP: out of the scope on the shot, the bolt worked, and back into the
    // scope once it closes if it was scoped when it fired.
    if (weapon.boltAction && ammo[weapon.id] > 0) {
        rezoom = scoped;
        chamberStart = now + 60;
        boltSounds();
        // Close the bolt (and scope back in) on time even if frames lag.
        setTimeout(() => tickAmmo(performance.now()), 60 + BOLT_MS + 5);
    }
    if (scoped) setScope(false);

    // An empty magazine reloads itself a beat after the last round.
    // On a timer rather than the frame loop, so it happens on time even if
    // the tab is drawing slowly.
    if (ammo[weapon.id] === 0) {
        clearTimeout(autoReloadAt);
        autoReloadAt = setTimeout(() => {
            autoReloadAt = 0;
            if (running && ammo[weapon.id] === 0) startReload();
        }, 280);
    }
    updateAmmo();

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
    kills = 0;
    deaths = 0;
    remainingMs = 0;
    yaw = 0;
    pitch = 0;
    applyLook();
    targetGroup.children.forEach(placeTarget);
    targetGroup.visible = !botsMode();
    clearKeys();
    if (botsMode()) {
        bots.start();
        yaw = Math.random() * Math.PI * 2;
        applyLook();
    }

    running = true;
    fallbackAim = false;
    endsAt = performance.now() + (botsMode() ? BOTS_ROUND_MS : ROUND_MS);
    stage.classList.add('is-running');
    panel.hidden = true;
    hideSave();
    lastRun = null;
    hud.hidden = false;
    hud.setAttribute('aria-hidden', 'false');
    crosshair.hidden = false;
    showGun(true);
    fillAmmo();
    reloadStart = 0;
    chamberStart = 0;
    clearTimeout(autoReloadAt);
    autoReloadAt = 0;
    rezoom = false;
    elAmmo.hidden = false;
    updateAmmo();
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
    setScope(false);
    cancelReload();
    chamberStart = 0;
    clearTimeout(autoReloadAt);
    autoReloadAt = 0;
    elAmmo.hidden = true;
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
    clearKeys();

    if (botsMode()) {
        const top = botsBest();
        const beatenBots = kills > top;
        if (beatenBots) remember(BOTS_BEST_KEY, String(kills));
        bots.stop();
        targetGroup.visible = true;
        applyLook();
        elTitle.textContent = beatenBots ? 'new best' : 'time';
        elStatLabel.textContent = 'kills';
        elStatValue.textContent = String(kills);
        elStatNote.textContent = `${deaths} ${deaths === 1 ? 'death' : 'deaths'} · ${headshotRate()}% headshots · ${accuracy()}% accuracy · best ${Math.max(top, kills)}`;
        elStart.textContent = 'go again';
        setNote('');
        lastRun = null;
        lockPicks(false);
        elSaveOpen.hidden = true;
        return;
    }

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

    lastRun = hits > 0 ? { score: hits, shots, gun: weapon.id, reload: reloadsOn } : null;
    lockPicks(false);
    elSaveOpen.hidden = !lastRun || !boardOnline;
}

function accuracy() {
    return shots ? Math.round((hits / shots) * 100) : 100;
}

function updateHud() {
    if (botsMode()) {
        elScore.textContent = String(kills);
        elAcc.textContent = String(deaths);
        return;
    }
    elScore.textContent = String(hits);
    elAcc.textContent = `${accuracy()}%`;
}

/* ---------- easter eggs, found ---------- */

let foundEggs = new Set();
let eggNoteTimer = 0;

function findEgg(object) {
    let g = object;
    while (g && !g.userData.egg) g = g.parent;
    if (!g) return;
    const egg = g.userData.egg;
    g.userData.spinStart = performance.now();
    g.userData.baseTurn ??= g.rotation.y;
    g.userData.baseY ??= g.position.y;
    const isNew = !foundEggs.has(egg.id);
    if (isNew) {
        foundEggs.add(egg.id);
        remember(EGGS_KEY, JSON.stringify([...foundEggs]));
        // A little rising chime for a new one.
        [880, 1109, 1319, 1760].forEach((f, i) => tone({ at: i * 0.08, from: f, to: f, decay: 0.22, volume: 0.14, type: 'triangle' }));
    }
    setNote(`${isNew ? 'easter egg found' : 'already found'} · ${egg.note} · ${foundEggs.size}/${EGGS.length}`);
    clearTimeout(eggNoteTimer);
    eggNoteTimer = setTimeout(() => setNote(''), 3500);
    updateEggLine();
}

function updateEggLine() {
    elEggs.hidden = !botsMode();
    elEggs.textContent = foundEggs.size >= EGGS.length
        ? `all ${EGGS.length} easter eggs found · thanks for looking around`
        : `easter eggs found · ${foundEggs.size} / ${EGGS.length} · hidden on every map, shoot one to find it`;
}

// A found egg spins once and bobs, then settles back.
function spinEggs(now) {
    for (const g of eggMeshes) {
        if (!g.userData.spinStart) continue;
        const t = (now - g.userData.spinStart) / 1000;
        if (t > 1.2) {
            g.userData.spinStart = 0;
            g.rotation.y = g.userData.baseTurn;
            g.position.y = g.userData.baseY;
            continue;
        }
        g.rotation.y = g.userData.baseTurn + easeInOut(t / 1.2) * Math.PI * 2;
        g.position.y = g.userData.baseY + Math.sin((t / 1.2) * Math.PI) * 1.2;
    }
}

function headshotRate() {
    return kills ? Math.round((bots.stats.headshots / kills) * 100) : 0;
}

function botsBest() {
    return Number(recall(BOTS_BEST_KEY)) || 0;
}

// The start panel's big number and labels follow the mode.
function showModeStats() {
    elScoreLabel.textContent = botsMode() ? 'kills' : 'hits';
    elAccLabel.textContent = botsMode() ? 'deaths' : 'accuracy';
    if (botsMode()) {
        const top = botsBest();
        elStatLabel.textContent = 'most kills';
        elStatValue.textContent = String(top);
        elStatNote.textContent = top ? `90 second deathmatch · best ${top}` : '90 second deathmatch · no runs yet';
    } else {
        elStatLabel.textContent = 'high score';
        elStatValue.textContent = String(best);
        elStatNote.textContent = best ? `30 seconds · best ${best}` : '30 seconds · no runs yet';
    }
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
    if (envUpdate) envUpdate(now, dt);
    if (running && botsMode()) bots.update(now, dt, { keys, yaw });
    spinEggs(now);
    cullChunks();
    // The sky stays centred on the viewer, so walking to the edge of a big map
    // never reaches it.
    if (skyMesh) skyMesh.position.copy(camera.position);
    updateGun(now, dt);

    if (running) tickAmmo(now);
    if (running && triggerHeld && isAuto()) fire();

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
    setScope(false);
    // A reload does not survive a pause; the magazine keeps what it had.
    cancelReload();
    chamberStart = 0;
    clearTimeout(autoReloadAt);
    autoReloadAt = 0;
    rezoom = false;
    elAmmo.hidden = true;
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
    clearKeys();
    elHealth.hidden = true;
    elTitle.textContent = 'paused';
    elStatLabel.textContent = botsMode() ? 'kills so far' : 'hits so far';
    elStatValue.textContent = String(botsMode() ? kills : hits);
    elStatNote.textContent = botsMode()
        ? `${(remainingMs / 1000).toFixed(1)}s left · ${deaths} ${deaths === 1 ? 'death' : 'deaths'}`
        : `${(remainingMs / 1000).toFixed(1)}s left · best ${best}`;
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
    elAmmo.hidden = false;
    elHealth.hidden = !botsMode();
    updateAmmo();
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
    for (const chip of [...elModes.children, ...elDifficulty.children, ...elBotCount.children, ...elGuns.children, ...elReloads.children, ...elTargets.children, ...elMaps.children]) chip.disabled = locked;
}

/* ---------- crosshair ---------- */

const CROSSHAIRS = [
    { id: 'classic', label: 'classic' },
    { id: 'plus', label: 'plus' },
    { id: 't', label: 't' },
    { id: 'dot', label: 'dot' },
    { id: 'circle', label: 'circle' },
];

// The csgo green first, then a few that stand out on every map.
const XH_COLORS = [
    { id: 'green', label: 'green', value: '#3cff3c' },
    { id: 'cream', label: 'cream', value: '#f0e9dd' },
    { id: 'yellow', label: 'yellow', value: '#ffe14d' },
    { id: 'cyan', label: 'cyan', value: '#4de3ff' },
    { id: 'pink', label: 'pink', value: '#ff5cb8' },
    { id: 'red', label: 'red', value: '#ff4a3d' },
];

let xhStyle = CROSSHAIRS[0].id;
let xhColor = XH_COLORS[0];

// The real crosshair and the menu's copy always match.
function applyCrosshair() {
    for (const el of [crosshair, elXhPreview]) {
        el.dataset.style = xhStyle;
        el.style.setProperty('--xh', xhColor.value);
    }
}

function buildSwatches() {
    elXhColors.replaceChildren();
    for (const color of XH_COLORS) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'aim-swatch';
        swatch.setAttribute('role', 'radio');
        swatch.setAttribute('aria-label', color.label);
        swatch.setAttribute('aria-checked', String(color === xhColor));
        swatch.style.background = color.value;
        swatch.addEventListener('click', () => {
            for (const other of elXhColors.children) other.setAttribute('aria-checked', String(other === swatch));
            xhColor = color;
            remember(XH_COLOR_KEY, color.id);
            applyCrosshair();
        });
        elXhColors.append(swatch);
    }
}

function updateHint() {
    if (touchOnly) {
        elHint.textContent = `tap the ${targetKind.id === 'bullseye' ? 'targets' : `${targetKind.label}s`} · tap the gun to inspect it`;
    } else {
        const fire = weapon.selectFire
            ? (akAuto ? 'hold to spray · g for single shot' : 'click to fire · g for full auto')
            : isAuto() ? 'hold to spray' : weapon.scope ? 'click to fire · right click to scope' : 'click to fire';
        if (botsMode()) {
            elHint.textContent = `wasd to move · space to jump · shift to walk · ctrl or c to crouch · ${fire}${reloadsOn ? ' · r to reload' : ''} · esc to pause`;
            return;
        }
        elHint.textContent = `${fire} · ${reloadsOn ? 'r to reload · ' : ''}f to inspect · esc to pause`;
    }
}

/* ---------- leaderboard ---------- */

// The board lives behind the Worker. On a static host there is no /api, so the
// first failed read marks it offline and the save button never shows.
let boardOnline = false;

// Where the leaderboard lives. The Worker serves it at /api/aim on its own
// origin; the GitHub Pages copy of the site has no server, so it calls the
// Worker's address across origins instead (the Worker allows that route).
const AIM_WORKER = 'https://youdahe-com.WORKERS_SUBDOMAIN.workers.dev';
const AIM_API = `${location.hostname.endsWith('github.io') ? AIM_WORKER : ''}/api/aim`;

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
            // Scores set without reloading are marked, since they had it easier.
            tag.textContent = ` ${gunName.label}${entry.reload === false ? ' · no reload' : ''}`;
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
        const res = await fetch(AIM_API, { cache: 'no-store' });
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
        const res = await fetch(AIM_API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, score: lastRun.score, shots: lastRun.shots, gun: lastRun.gun, reload: lastRun.reload }),
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
    if (botsMode()) {
        remember(BOTS_BEST_KEY, '0');
        showModeStats();
        return;
    }
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
// Mouse buttons come through mousedown, which fires for every button. A
// pointerdown only fires for the first button pressed, so a left click while
// the right button was still down (scope, then shoot) used to be swallowed.
// Touch and pen still come through pointerdown.
function onPress(event) {
    if (!running) return;

    if (event.button === 2) {
        if (weapon.scope && !reloadStart) {
            rezoom = false;
            setScope(!scoped);
        }
        return;
    }

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
}

// A tap also produces a compatibility mousedown a moment later; ignore it so
// one tap is one shot.
let lastTouchAt = -Infinity;
canvas.addEventListener('mousedown', (event) => {
    if (performance.now() - lastTouchAt > 800) onPress(event);
});
canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    lastTouchAt = performance.now();
    onPress(event);
});

// WASD and friends, only while a bots round is on. Space would otherwise
// scroll the page.
document.addEventListener('keydown', (event) => {
    const action = KEYMAP[event.code];
    if (!action || !running || !botsMode()) return;
    keys[action] = true;
    event.preventDefault();
});
document.addEventListener('keyup', (event) => {
    const action = KEYMAP[event.code];
    if (action) keys[action] = false;
});
window.addEventListener('blur', clearKeys);

// On a phone there is no R key, so the counter itself is the reload button.
elAmmo.addEventListener('click', () => startReload());

// The slider and the number box drive the same value; typing a number is
// for anyone matching an exact csgo setting.
function setSensitivity(value, source) {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    sensitivity = clamp(v, SENS_MIN, SENS_MAX);
    if (source !== elSensRange) elSensRange.value = String(sensitivity);
    if (source !== elSensValue) elSensValue.value = String(sensitivity);
    remember(SENS_KEY, String(sensitivity));
}
elSensRange.addEventListener('input', () => setSensitivity(elSensRange.value, elSensRange));
elSensValue.addEventListener('change', () => setSensitivity(elSensValue.value));

// Fullscreen takes the whole page, so the menu and the ammo counter come with
// it. Safari still wants its prefixed calls, and iPhone Safari has none at
// all, so the button only shows where the browser can actually do it.
const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
const canFullscreen = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

function toggleFullscreen() {
    const root = document.documentElement;
    if (fullscreenElement()) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
        const request = (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
        // If the browser says no, point at the key that always works.
        const mac = /Mac|iPhone|iPad/.test(navigator.platform);
        if (request && typeof request.catch === 'function') {
            request.catch(() => setNote(`fullscreen was blocked, try ${mac ? 'ctrl + cmd + f' : 'f11'}`));
        }
    }
}

function syncFullscreen() {
    elFullscreen.textContent = fullscreenElement() ? 'exit fullscreen' : 'fullscreen';
    // Outside fullscreen the browser keeps shortcuts like ctrl+w (close tab)
    // for itself. In fullscreen, Chrome lets a page take the whole keyboard,
    // so crouch-walking with ctrl+w moves you instead; holding esc still
    // leaves fullscreen.
    if (!navigator.keyboard) return;
    if (fullscreenElement()) navigator.keyboard.lock?.().catch(() => {});
    else navigator.keyboard.unlock?.();
}

// And if a tab close does slip through mid-round, the browser asks first.
window.addEventListener('beforeunload', (event) => {
    if (!running || !botsMode()) return;
    event.preventDefault();
    event.returnValue = '';
});

elFullscreen.hidden = !canFullscreen;
elFullscreen.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', syncFullscreen);
document.addEventListener('webkitfullscreenchange', syncFullscreen);

elSound.addEventListener('click', () => {
    soundOn = !soundOn;
    remember(SOUND_KEY, soundOn ? 'on' : 'off');
    elSound.setAttribute('aria-pressed', String(soundOn));
    elSound.textContent = soundOn ? 'sound on' : 'sound off';
});

// Right click is the scope, never the browser menu.
stage.addEventListener('contextmenu', (event) => event.preventDefault());

document.addEventListener('mouseup', (event) => {
    if (event.button === 0) triggerHeld = false;
});
document.addEventListener('pointerup', (event) => {
    if (event.pointerType !== 'mouse') triggerHeld = false;
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
    if ((event.key === 'f' || event.key === 'F') && running && !inspectStart && !reloadStart && !event.repeat) {
        inspectStart = performance.now();
    }
    if ((event.key === 'r' || event.key === 'R') && running && !event.repeat) startReload();
    if (event.code === 'KeyG' && !event.repeat && !(event.target instanceof HTMLInputElement)) toggleFireMode();
});

// Switching tabs stops requestAnimationFrame, so a round left in the
// background would come back already over. Pause it instead.
document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) pause('');
});

/* ---------- boot ---------- */

selectTarget(recall(TARGET_KEY));
selectMap(recall(MAP_KEY));
buildScene();
buildViewmodel();
selectWeapon(recall(GUN_KEY));
setShowcase(true);
buildChips(elGuns, WEAPONS, weapon.id, (id) => {
    selectWeapon(id);
    remember(GUN_KEY, id);
    updateHint();
});
setSensitivity(recall(SENS_KEY) ?? SENS_DEFAULT);
soundOn = recall(SOUND_KEY) !== 'off';
elSound.setAttribute('aria-pressed', String(soundOn));
elSound.textContent = soundOn ? 'sound on' : 'sound off';
xhStyle = (CROSSHAIRS.find((c) => c.id === recall(XH_KEY)) || CROSSHAIRS[0]).id;
xhColor = XH_COLORS.find((c) => c.id === recall(XH_COLOR_KEY)) || XH_COLORS[0];
buildChips(elCrosshairs, CROSSHAIRS, xhStyle, (id) => {
    xhStyle = id;
    remember(XH_KEY, id);
    applyCrosshair();
});
buildSwatches();
applyCrosshair();
reloadsOn = recall(RELOAD_KEY) !== 'off';
try {
    foundEggs = new Set(JSON.parse(recall(EGGS_KEY) || '[]'));
} catch {
    foundEggs = new Set();
}
akAuto = recall(AK_MODE_KEY) !== 'semi';
buildChips(elReloads, RELOAD_MODES, reloadsOn ? 'on' : 'off', (id) => {
    reloadsOn = id === 'on';
    remember(RELOAD_KEY, id);
    updateHint();
});
buildChips(elMaps, MAPS, mapKind.id, (id) => {
    selectMap(id);
    remember(MAP_KEY, id);
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

bots = createBots({
    scene,
    camera,
    floorY: FLOOR_Y,
    envRoot,
    glow: GLOW,
    sound: { burst, tone },
    el: {
        health: document.getElementById('aimHealthValue'),
        healthBox: document.getElementById('aimHealth'),
        killfeed: document.getElementById('aimKillfeed'),
        damage: document.getElementById('aimDamage'),
        death: document.getElementById('aimDeath'),
    },
    onKill() {
        kills++;
        updateHud();
    },
    onDeath() {
        deaths++;
        setScope(false);
        cancelReload();
        triggerHeld = false;
        showGun(false);
        updateHud();
    },
    onRespawn() {
        fillAmmo();
        updateAmmo();
        showGun(true);
    },
});
bots.setBounds(mapBounds || mapKind.bounds);
bots.setColliders(mapColliders);
// The furniture models arrive a moment after the page; if the bots map was
// already built with stand-ins, build it again with the real thing, unless
// a round is on.
kenneyReady.then(() => {
    if (builtWide && !running && remainingMs <= 0) selectMap(mapKind.id);
});

// Mode, difficulty and bot count. Bots mode needs a keyboard, so phones only
// get the aim trainer.
function applyMode() {
    elTitle.textContent = botsMode() ? 'bots' : 'aim trainer';
    updateEggLine();
    // Bots mode plays on the wider build of the map.
    if (builtWide !== botsMode()) selectMap(mapKind.id);
    elBotRow.hidden = !botsMode();
    elTargetRow.hidden = botsMode();
    showModeStats();
    updateHint();
}
mode = !touchOnly && recall(MODE_KEY) === 'bots' ? 'bots' : 'aim';
elModes.closest('.aim-pick').hidden = touchOnly;
buildChips(elModes, MODES, mode, (id) => {
    mode = id;
    remember(MODE_KEY, id);
    applyMode();
});
const savedDifficulty = recall(DIFFICULTY_KEY) || 'normal';
bots.setDifficulty(savedDifficulty);
buildChips(elDifficulty, DIFFICULTIES, bots.difficulty().id, (id) => {
    bots.setDifficulty(id);
    remember(DIFFICULTY_KEY, id);
});
const savedCount = BOT_COUNTS.find((c) => c.id === recall(BOT_COUNT_KEY)) || BOT_COUNTS[1];
bots.setCount(Number(savedCount.id));
buildChips(elBotCount, BOT_COUNTS, savedCount.id, (id) => {
    bots.setCount(Number(id));
    remember(BOT_COUNT_KEY, id);
});

elStart.disabled = false;
elStart.textContent = 'start';
applyMode();
loadBoard();
updateHint();
