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
const MAP_KEY = 'aim.map';
const XH_KEY = 'aim.crosshair';
const XH_COLOR_KEY = 'aim.crosshairColor';
const SOUND_KEY = 'aim.sound';
const SENS_KEY = 'aim.sensitivity';

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
const elSound = document.getElementById('aimSound');
const elSensRange = document.getElementById('aimSensRange');
const elSensValue = document.getElementById('aimSensValue');

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

    camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 240);
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
    root.add(dome);
}

function ground(root, material, size = 480) {
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
function buildRange(root) {
    light(root, 'ambient', 0xf0e9dd, 1.35);
    light(root, 'dir', 0xf0e9dd, 1.1, [4, 8, 6]);
    light(root, 'point', 0xf0e9dd, 10, [0, -3, -8]);

    const box = new THREE.BoxGeometry(ROOM.w, ROOM.h, ROOM.d);
    root.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(box),
        new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.18 })
    ));
    root.add(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x191a19, side: THREE.BackSide })));

    const grid = new THREE.GridHelper(ROOM.w, 38, 0xa67d43, INK);
    grid.position.y = FLOOR_Y + 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.12;
    root.add(grid);
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
function buildDust2(root) {
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
    block(root, surface(stone, 14, 3), [2, 16, 72], [-34, 0, -2]);
    block(root, surface(stone, 14, 3), [2, 16, 72], [34, 0, -2]);
    block(root, surface(stone, 14, 3), [70, 16, 2], [0, 0, 32]);
    const trim = plain(0xb38e57);
    block(root, trim, [70, 1, 3], [0, 16, -35]);
    block(root, trim, [3, 1, 72], [-33, 16, -2]);
    block(root, trim, [3, 1, 72], [33, 16, -2]);

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
    const crate = surface(paint(128, crateTexture));
    for (const [x, y, z, size, turn] of [
        [-19, 0, -27, 3, -0.1], [-22, 0, -26, 3, 0.2], [-20.5, 3, -26.5, 3, 0.35],
        [24, 0, -24, 4, 0.1], [20, 0, -28, 3, -0.3], [27, 0, 4, 3, -0.2], [26, 3, 4.5, 3, 0.25],
    ]) block(root, crate, [size, size, size], [x, y, z], turn);

    decal(root, sprayed('A', '#b8321f'), 7, 22, 6.5, -34.9);
    decal(root, sprayed('←', '#1f1f1f'), 3, -14, 4, -34.9);

    return { fog: [0xf1d9a6, 45, 140], halo: 0x3a2a18 };
}

/* ----- mirage ----- */

// A Moroccan square: warm plaster, the palace front with its arches and blue
// shutters, a tiled dome, a market awning, carpets hung out to air, palms.
function buildMirage(root) {
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
    const rug = new THREE.MeshStandardMaterial({ map: paint(128, carpet), side: THREE.DoubleSide, roughness: 1 });
    for (const [x, y, z, turn] of [[4, 9.5, -36.8, 0], [31.9, 5, -8, -Math.PI / 2], [31.9, 5, 2, -Math.PI / 2]]) {
        const hang = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5), rug);
        hang.position.set(x, FLOOR_Y + y, z);
        hang.rotation.y = turn;
        root.add(hang);
    }

    palm(root, -22, -30);
    palm(root, 22, -22, 12);
    palm(root, 26, 18, 10);

    return { fog: [0xf6e3c0, 50, 150], halo: 0x3a2a18 };
}

/* ----- inferno ----- */

// An Italian hill town: stucco houses under terracotta roofs, green shutters,
// the church's bell tower over everything, washing strung across the street,
// cobbles underfoot and cypress trees on green hills beyond.
function buildInferno(root) {
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

    return { fog: [0xf4dcae, 55, 170], halo: 0x3a2a18 };
}

/* ----- nuke ----- */

// The plant: the reactor's containment dome, a blue corrugated warehouse with
// the radiation sign, hazard stripes, stacked shipping containers, pipework
// and painted yard lines, under a flat pale sky.
function buildNuke(root) {
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

    return { fog: [0xd8e0e6, 50, 170], halo: 0x2a2f33 };
}

/* ----- vertigo ----- */

// The top of a tower under construction: a bare concrete floor with nothing
// round its edge but rails, scaffold and a crane, and the city a long way down.
function buildVertigo(root) {
    skyDome(root, 0x3f7fc6, 0xc9dcec, 0x9fb4c6, 0.5);
    root.add(new THREE.HemisphereLight(0xdcebf7, 0x6f7f8c, 1.5));
    light(root, 'dir', 0xfff4e0, 2.3, [-25, 30, 15]);
    light(root, 'ambient', 0xffffff, 0.25);

    // The slab, and the storey below it, in bare concrete.
    const slab = paint(256, speckle('#a9a9a4', ['#8f8f8a', '#c2c2bd', '#7c7c77'], 2400));
    block(root, surface(slab, 10, 10, { roughness: 1 }), [60, 1, 70], [0, -1, -10]);
    block(root, surface(slab, 10, 2), [58, 6, 68], [0, -7, -10]);
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
    for (const [w, d, x, z] of [[60, 0.3, 0, -45], [0.3, 70, -30, -10], [0.3, 70, 30, -10]]) {
        block(root, rail, [w, 0.4, d], [x, 3.2, z]);
        block(root, rail, [w, 0.3, d], [x, 1.6, z]);
    }
    const post = plain(0xe8b923);
    for (let x = -30; x <= 30; x += 6) block(root, post, [0.25, 3.6, 0.25], [x, 0, -45]);

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
        const r = 55 + ((i * 53) % 110);
        const w = 10 + (i % 4) * 4;
        const top = -30 - ((i * 31) % 70) + (i % 5 === 0 ? 62 : 0);
        const h = 140 + top;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), cityMats[i % cityMats.length]);
        mesh.position.set(Math.sin(a) * r, FLOOR_Y + top - h / 2, -Math.cos(a) * r);
        root.add(mesh);
    }

    return { fog: [0xc9dcec, 70, 220], halo: 0x1f2a33 };
}

/* ----- ancient ----- */

// A temple in the rainforest: a stepped pyramid with its stair and shrine,
// the orange of A site and the pale-blue water of B, carved pillars, and
// jungle closing in all round.
function buildAncient(root) {
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

    return { fog: [0xdfe6d4, 40, 150], halo: 0x2a2f1c };
}

const MAPS = [
    { id: 'training', label: 'training', build: buildRange, defaults: { background: 0x121312, fog: [0x121312, 18, 46], halo: INK } },
    { id: 'dust2', label: 'dust ii', build: buildDust2 },
    { id: 'mirage', label: 'mirage', build: buildMirage },
    { id: 'inferno', label: 'inferno', build: buildInferno },
    { id: 'nuke', label: 'nuke', build: buildNuke },
    { id: 'vertigo', label: 'vertigo', build: buildVertigo },
    { id: 'ancient', label: 'ancient', build: buildAncient },
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

    const made = mapKind.build(envRoot) || {};
    const settings = { ...(mapKind.defaults || {}), ...made };
    scene.background = settings.background !== undefined ? new THREE.Color(settings.background) : null;
    scene.fog = settings.fog ? new THREE.Fog(settings.fog[0], settings.fog[1], settings.fog[2]) : null;
    HALO_MATERIAL.color.set(settings.halo ?? INK);
    envUpdate = settings.update || null;
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
    { id: 'pistol', label: 'pistol', build: buildPistol, scale: 0.42, ...PISTOL_HOLD, showcase: 0.95,
        inspectStyle: 'flipside', inspectMs: 2400, mag: 20, reloadStyle: 'mag', reloadMs: 1600, pivot: new THREE.Vector3(0, 0.02, -0.18),
        cooldown: 110, auto: false, kick: 4.6, punch: 0.006, spread: { step: 0.006, max: 0.03 }, flash: 0.75, tracer: 0xffd88a, tracerWidth: 0.4 },
    { id: 'deagle', label: 'deagle', build: buildDeagle, scale: 0.42, ...PISTOL_HOLD, showcase: 1.12,
        inspectStyle: 'twirl', inspectMs: 2600, mag: 7, reloadStyle: 'mag', reloadMs: 1900, pivot: new THREE.Vector3(0, -0.08, -0.12),
        cooldown: 380, auto: false, kick: 11, punch: 0.02, spread: { step: 0.03, max: 0.06 }, flash: 1.5, tracer: 0xffd08a, tracerWidth: 0.6 },
    { id: 'revolver', label: 'revolver', build: buildRevolver, scale: 0.42, ...PISTOL_HOLD, showcase: 1.25,
        inspectStyle: 'cylinder', inspectMs: 3000, mag: 8, reloadStyle: 'cylinder', reloadMs: 2300, pivot: new THREE.Vector3(0, -0.08, 0.05),
        cooldown: 480, auto: false, kick: 9.5, punch: 0.016, spread: null, flash: 1.3, tracer: 0xffd08a, tracerWidth: 0.55 },
    { id: 'awp', label: 'awp', build: buildAwp, scale: 0.34, ...RIFLE_HOLD, showcase: 2.1,
        inspectStyle: 'glass', inspectMs: 3000, mag: 10, reloadStyle: 'bolt', reloadMs: 2700, boltAction: true,
        cooldown: 1300, auto: false, kick: 13, punch: 0.03, spread: null, scope: true, unscopedSpread: 0.09,
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

/* ---------- ammo ---------- */

// Rounds in the magazine for each gun, refilled at the start of a round.
// Reserve is endless: this is an aim trainer, not an economy.
const ammo = {};
let reloadStart = 0;
let reloadLength = 0;
let reloadFrom = 0;
let autoReloadAt = 0;
// The AWP works its bolt after every shot, then scopes back in if it was
// scoped when it fired, the way csgo does.
const BOLT_MS = 950;
let chamberStart = 0;
let rezoom = false;

function fillAmmo() {
    for (const w of WEAPONS) ammo[w.id] = w.mag;
}

function startReload() {
    if (!running || reloadStart || ammo[weapon.id] >= weapon.mag) return;
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
    elAmmoGun.textContent = weapon.label;
    elAmmoMag.textContent = String(left);
    elAmmo.classList.toggle('is-low', left <= Math.ceil(weapon.mag * 0.2));
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
    const start = 0.15;
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
function fire(ndc) {
    if (!running) return;
    const now = performance.now();
    if (now - lastShotAt < weapon.cooldown) return;
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
    if (ammo[weapon.id] <= 0) {
        lastShotAt = now;
        tick(0, 1800, 0.35);
        startReload();
        return;
    }
    ammo[weapon.id]--;
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
    fireGun(aim);

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

    // The AWP: out of the scope on the shot, the bolt worked, and back into the
    // scope once it closes if it was scoped when it fired.
    if (weapon.boltAction && ammo[weapon.id] > 0) {
        rezoom = scoped;
        chamberStart = now + 150;
        boltSounds();
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
    if (envUpdate) envUpdate(now, dt);
    updateGun(now, dt);

    if (running) tickAmmo(now);
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
    elAmmo.hidden = false;
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
    for (const chip of [...elGuns.children, ...elTargets.children, ...elMaps.children]) chip.disabled = locked;
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
        const fire = weapon.auto ? 'hold to spray' : weapon.scope ? 'click to fire · right click to scope' : 'click to fire';
        elHint.textContent = `${fire} · r to reload · f to inspect · esc to pause`;
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
});

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

elSound.addEventListener('click', () => {
    soundOn = !soundOn;
    remember(SOUND_KEY, soundOn ? 'on' : 'off');
    elSound.setAttribute('aria-pressed', String(soundOn));
    elSound.textContent = soundOn ? 'sound on' : 'sound off';
});

// Right click is the scope, never the browser menu.
stage.addEventListener('contextmenu', (event) => event.preventDefault());

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
    if ((event.key === 'f' || event.key === 'F') && running && !inspectStart && !reloadStart && !event.repeat) {
        inspectStart = performance.now();
    }
    if ((event.key === 'r' || event.key === 'R') && running && !event.repeat) startReload();
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

elStart.disabled = false;
elStart.textContent = 'start';
elStatValue.textContent = String(best);
elStatNote.textContent = best ? `30 seconds · best ${best}` : '30 seconds · no runs yet';
loadBoard();
updateHint();
