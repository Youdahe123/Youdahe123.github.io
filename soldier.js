// The soldier everyone in bots mode is built from: the bots in their csgo
// terrorist kit, and you, dressed however you like, in the killcam and on the
// menu. Blocky on purpose, jointed at the hips, knees, shoulders, elbows and
// neck so it can walk and fall. Faces +Z, feet at y = 0, about 10 units tall.

import * as THREE from './vendor/three/three.module.min.js';

export const HAIR = [
    { id: 'none', label: 'bald' },
    { id: 'buzz', label: 'buzz' },
    { id: 'spiky', label: 'spiky' },
    { id: 'long', label: 'long' },
    { id: 'ponytail', label: 'ponytail' },
    { id: 'mohawk', label: 'mohawk' },
    { id: 'afro', label: 'afro' },
    { id: 'anime', label: 'anime' },
];

export const HATS = [
    { id: 'none', label: 'none' },
    { id: 'cap', label: 'cap' },
    { id: 'beanie', label: 'beanie' },
    { id: 'helmet', label: 'helmet' },
    { id: 'headband', label: 'headband' },
    { id: 'ears', label: 'cat ears' },
    { id: 'crown', label: 'crown' },
];

export const FACES = [
    { id: 'bare', label: 'face' },
    { id: 'anime', label: 'anime eyes' },
    { id: 'shades', label: 'shades' },
    { id: 'bandana', label: 'bandana' },
    { id: 'mask', label: 'balaclava' },
];

export const TOPS = [
    { id: 'hoodie', label: 'hoodie' },
    { id: 'jacket', label: 'jacket' },
    { id: 'tee', label: 'tee' },
    { id: 'suit', label: 'suit' },
    { id: 'armor', label: 'armor' },
];

export const HAIR_COLORS = [
    { id: 'black', label: 'black', value: 0x1d1a18 },
    { id: 'brown', label: 'brown', value: 0x5a3825 },
    { id: 'blonde', label: 'blonde', value: 0xd9b45a },
    { id: 'ginger', label: 'ginger', value: 0xb5542a },
    { id: 'white', label: 'white', value: 0xe8e4dc },
    { id: 'pink', label: 'pink', value: 0xff7ab8 },
    { id: 'blue', label: 'blue', value: 0x4f7bff },
    { id: 'green', label: 'green', value: 0x3fbf6a },
];

export const TOP_COLORS = [
    { id: 'navy', label: 'navy', value: 0x3b4d66 },
    { id: 'black', label: 'black', value: 0x232427 },
    { id: 'olive', label: 'olive', value: 0x55603f },
    { id: 'red', label: 'red', value: 0x9a2f2a },
    { id: 'white', label: 'white', value: 0xd9d4ca },
    { id: 'pink', label: 'pink', value: 0xe07aa8 },
    { id: 'orange', label: 'orange', value: 0xd9772b },
    { id: 'purple', label: 'purple', value: 0x5d3f8f },
];

export const PANTS_COLORS = [
    { id: 'charcoal', label: 'charcoal', value: 0x2c3340 },
    { id: 'black', label: 'black', value: 0x1e1e20 },
    { id: 'khaki', label: 'khaki', value: 0x8a7a55 },
    { id: 'denim', label: 'denim', value: 0x3e5a80 },
    { id: 'olive', label: 'olive', value: 0x4b5236 },
    { id: 'white', label: 'white', value: 0xcfcac0 },
];

export const SKINS = [
    { id: 's1', label: 'light', value: 0xf1c7a5 },
    { id: 's2', label: 'fair', value: 0xe0ac86 },
    { id: 's3', label: 'medium', value: 0xc69474 },
    { id: 's4', label: 'tan', value: 0x9c6b4b },
    { id: 's5', label: 'brown', value: 0x6e4630 },
    { id: 's6', label: 'dark', value: 0x4a2f22 },
];

// Every part of a look, what it can be, and whether it is a colour.
export const LOOK_PARTS = [
    { key: 'hair', label: 'hair', options: HAIR },
    { key: 'hairColor', label: 'hair colour', options: HAIR_COLORS, swatch: true },
    { key: 'hat', label: 'hat', options: HATS },
    { key: 'face', label: 'face', options: FACES },
    { key: 'top', label: 'top', options: TOPS },
    { key: 'topColor', label: 'top colour', options: TOP_COLORS, swatch: true },
    { key: 'pants', label: 'pants', options: PANTS_COLORS, swatch: true },
    { key: 'skin', label: 'skin', options: SKINS, swatch: true },
];

export const DEFAULT_LOOK = {
    hair: 'spiky',
    hairColor: 'black',
    hat: 'none',
    face: 'bare',
    top: 'hoodie',
    topColor: 'navy',
    pants: 'charcoal',
    skin: 's3',
};

// Anything unknown (an old save, a hand-edited one) falls back part by part.
export function cleanLook(raw) {
    const look = { ...DEFAULT_LOOK };
    for (const part of LOOK_PARTS) {
        if (raw && part.options.some((o) => o.id === raw[part.key])) look[part.key] = raw[part.key];
    }
    return look;
}

export function randomLook() {
    const look = {};
    for (const part of LOOK_PARTS) look[part.key] = part.options[Math.floor(Math.random() * part.options.length)].id;
    return look;
}

const valueOf = (options, id) => (options.find((o) => o.id === id) || options[0]).value;

// The bots: the csgo terrorist, masked, in a plate carrier. Colours given
// directly rather than from the lists above.
const T_KIT = {
    hair: 'none',
    hat: 'none',
    face: 'mask',
    top: 'armor',
    colors: {
        hair: 0x1d1a18,
        top: 0x5b5146,
        pants: 0x3a3833,
        skin: 0xc69474,
        vest: 0x5e5e3c,
        mask: 0x262626,
    },
};

function kitFor(look) {
    const l = cleanLook(look);
    const top = valueOf(TOP_COLORS, l.topColor);
    return {
        hair: l.hair,
        hat: l.hat,
        face: l.face,
        top: l.top,
        colors: {
            hair: valueOf(HAIR_COLORS, l.hairColor),
            top,
            pants: valueOf(PANTS_COLORS, l.pants),
            skin: valueOf(SKINS, l.skin),
            vest: new THREE.Color(top).multiplyScalar(0.7).getHex(),
            mask: 0x262626,
        },
    };
}

// One material per colour, shared by everyone wearing it.
const materials = new Map();
function mat(color, roughness = 0.9, metalness = 0) {
    const key = `${color}/${roughness}/${metalness}`;
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
    return materials.get(key);
}
const BOOTS = 0x1c1b19;
const GLOVES = 0x2a2a2a;
const METAL = 0x2a2b2c;
const WOOD = 0x7a4a22;
const WHITE = 0xf2efe8;
const INK = 0x141312;

function piece(parent, material, size, position, part, rotation) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    mesh.position.set(position[0], position[1], position[2]);
    if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    mesh.userData.part = part;
    parent.add(mesh);
    return mesh;
}

/* ---------- the head ---------- */

// Head box: 1.0 wide, 1.15 tall, 1.05 deep, centred at y 0.85 on the neck,
// so its top is at 1.425 and its face at z 0.525.
function buildFace(neck, kit) {
    const c = kit.colors;
    const skin = mat(c.skin, 0.8);
    const h = (m, size, pos, rot) => piece(neck, m, size, pos, 'head', rot);

    h(skin, [0.5, 0.4, 0.5], [0, 0.2, 0]);
    if (kit.face === 'mask') {
        const mask = mat(c.mask);
        h(mask, [1.0, 1.15, 1.05], [0, 0.85, 0]);
        h(skin, [1.02, 0.26, 0.2], [0, 0.95, 0.45]);
        for (const x of [-0.22, 0.22]) h(mask, [0.14, 0.1, 0.05], [x, 0.95, 0.56]);
        h(mask, [1.06, 0.32, 1.1], [0, 1.45, 0]);
        return;
    }

    h(skin, [1.0, 1.15, 1.05], [0, 0.85, 0]);
    h(skin, [0.12, 0.2, 0.1], [0, 0.76, 0.57]);
    const brow = mat(c.hair);
    if (kit.face === 'anime') {
        // Big shiny eyes and a blush, as the site's anime corner demands.
        for (const x of [-0.22, 0.22]) {
            h(mat(WHITE, 0.5), [0.28, 0.32, 0.04], [x, 0.9, 0.535]);
            h(mat(c.hair === 0x1d1a18 ? 0x3b6fd8 : c.hair, 0.4), [0.2, 0.26, 0.05], [x + (x < 0 ? 0.03 : -0.03), 0.88, 0.55]);
            h(mat(WHITE, 0.3), [0.08, 0.08, 0.05], [x - 0.04, 0.97, 0.57]);
            h(mat(0xf08a9a, 0.8), [0.17, 0.06, 0.03], [x * 1.5, 0.7, 0.535]);
            h(brow, [0.26, 0.06, 0.05], [x, 1.12, 0.54]);
        }
        h(mat(0x6b3b2b, 0.8), [0.14, 0.05, 0.04], [0, 0.56, 0.54]);
        return;
    }

    for (const x of [-0.22, 0.22]) {
        h(mat(INK, 0.6), [0.14, 0.14, 0.05], [x, 0.95, 0.54]);
        h(brow, [0.26, 0.07, 0.05], [x, 1.1, 0.54]);
    }
    if (kit.face === 'shades') {
        const glass = mat(0x0c0c0e, 0.15, 0.6);
        h(glass, [1.06, 0.2, 0.08], [0, 0.95, 0.56]);
        for (const x of [-0.53, 0.53]) h(glass, [0.05, 0.08, 0.9], [x, 0.97, 0.1]);
        h(mat(0x6b3b2b, 0.8), [0.3, 0.06, 0.04], [0, 0.55, 0.54]);
    } else if (kit.face === 'bandana') {
        const cloth = mat(0x9c2a2a);
        h(cloth, [1.06, 0.5, 1.09], [0, 0.55, 0]);
        h(cloth, [0.6, 0.3, 0.08], [0, 0.3, 0.52], [0, 0, Math.PI / 4]);
    } else {
        h(mat(0x6b3b2b, 0.8), [0.3, 0.06, 0.04], [0, 0.55, 0.54]);
    }
}

// Hair on top of the head. Pieces marked `crown` sit where a hat goes and are
// left off under one; the rest (a ponytail, long hair down the back) show.
function buildHair(neck, kit, hatCovers) {
    if (kit.face === 'mask' || kit.hair === 'none') return;
    const m = mat(kit.colors.hair, 0.85);
    const crown = (size, pos, rot) => !hatCovers && piece(neck, m, size, pos, 'head', rot);
    const rest = (size, pos, rot) => piece(neck, m, size, pos, 'head', rot);

    switch (kit.hair) {
        case 'buzz':
            crown([1.04, 0.1, 1.09], [0, 1.46, 0]);
            rest([1.04, 0.4, 0.2], [0, 1.2, -0.45]);
            break;
        case 'spiky':
            crown([1.06, 0.22, 1.1], [0, 1.5, 0]);
            for (const [x, z, tx, tz] of [[-0.3, 0.25, 0.3, -0.3], [0.05, 0.3, 0.3, 0], [0.35, 0.2, 0.3, 0.3], [-0.35, -0.2, -0.3, -0.3], [0, -0.15, -0.3, 0], [0.35, -0.25, -0.3, 0.35], [0, 0.08, 0, 0.1]]) {
                crown([0.26, 0.5, 0.26], [x, 1.75, z], [tx, 0.4, tz]);
            }
            rest([1.04, 0.5, 0.2], [0, 1.2, -0.46]);
            break;
        case 'long':
            crown([1.08, 0.22, 1.12], [0, 1.5, 0]);
            crown([1.0, 0.22, 0.1], [0, 1.33, 0.54]);
            rest([1.08, 1.5, 0.22], [0, 0.9, -0.56]);
            for (const x of [-0.56, 0.56]) rest([0.12, 1.1, 0.8], [x, 0.95, -0.1]);
            break;
        case 'ponytail':
            crown([1.08, 0.22, 1.12], [0, 1.5, 0]);
            rest([1.04, 0.5, 0.2], [0, 1.2, -0.46]);
            rest([0.3, 1.0, 0.3], [0, 1.0, -0.78], [0.35, 0, 0]);
            piece(neck, mat(0xd9372b), [0.34, 0.12, 0.34], [0, 1.45, -0.62], 'head');
            break;
        case 'mohawk':
            crown([0.24, 0.6, 1.12], [0, 1.68, 0]);
            break;
        case 'afro':
            crown([1.5, 1.0, 1.45], [0, 1.55, -0.08]);
            rest([1.3, 0.6, 0.5], [0, 1.0, -0.5]);
            break;
        case 'anime':
            crown([1.12, 0.3, 1.16], [0, 1.52, 0]);
            for (const [x, rz] of [[-0.32, 0.25], [0, 0], [0.32, -0.25]]) crown([0.32, 0.55, 0.12], [x, 1.22, 0.58], [0, 0, rz]);
            for (const [x, rz] of [[-0.4, 0.5], [-0.15, 0.2], [0.15, -0.2], [0.4, -0.5]]) crown([0.3, 0.8, 0.3], [x, 1.8, -0.3], [-0.7, 0, rz]);
            for (const x of [-0.57, 0.57]) rest([0.14, 0.85, 0.32], [x, 0.95, 0.22]);
            rest([1.08, 0.7, 0.2], [0, 1.1, -0.56]);
            break;
    }
}

function buildHat(neck, kit) {
    const h = (m, size, pos, rot) => piece(neck, m, size, pos, 'head', rot);
    const cloth = mat(kit.colors.top);
    switch (kit.hat) {
        case 'cap':
            h(cloth, [1.12, 0.36, 1.14], [0, 1.58, 0]);
            h(cloth, [1.0, 0.08, 0.55], [0, 1.43, 0.78]);
            h(mat(WHITE), [0.14, 0.08, 0.14], [0, 1.8, 0]);
            break;
        case 'beanie':
            h(cloth, [1.14, 0.55, 1.16], [0, 1.6, 0]);
            h(cloth, [1.18, 0.2, 1.2], [0, 1.36, 0]);
            h(mat(WHITE), [0.3, 0.2, 0.3], [0, 1.95, 0]);
            break;
        case 'helmet': {
            const shell = mat(0x3d4a3a, 0.7);
            h(shell, [1.26, 0.6, 1.3], [0, 1.58, -0.02]);
            h(shell, [1.32, 0.1, 1.36], [0, 1.3, -0.02]);
            break;
        }
        case 'headband': {
            const band = mat(0xc0322b);
            h(band, [1.08, 0.16, 1.12], [0, 1.22, 0]);
            for (const r of [0.3, -0.25]) h(band, [0.1, 0.45, 0.06], [r * 0.3, 1.0, -0.6], [0.3, 0, r]);
            break;
        }
        case 'ears': {
            const fur = mat(kit.face === 'mask' ? kit.colors.mask : kit.colors.hair, 0.85);
            const pink = mat(0xf08a9a, 0.8);
            for (const x of [-0.34, 0.34]) {
                const ear = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 4), fur);
                ear.position.set(x, 1.72, 0);
                ear.rotation.set(0, Math.PI / 4, x * 0.4);
                ear.userData.part = 'head';
                neck.add(ear);
                h(pink, [0.18, 0.22, 0.04], [x, 1.65, 0.12], [0, 0, x * 0.4]);
            }
            break;
        }
        case 'crown': {
            const gold = mat(0xe0b33a, 0.3, 0.8);
            h(gold, [1.06, 0.26, 1.1], [0, 1.58, 0]);
            for (const [x, z] of [[-0.42, 0.44], [0.42, 0.44], [-0.42, -0.44], [0.42, -0.44], [0, 0.44], [0, -0.44]]) h(gold, [0.18, 0.28, 0.18], [x, 1.84, z]);
            h(mat(0xc0322b, 0.3), [0.16, 0.16, 0.05], [0, 1.6, 0.56]);
            break;
        }
    }
}

/* ---------- the body ---------- */

function buildTorso(spine, kit) {
    const c = kit.colors;
    const top = mat(c.top);
    const skin = mat(c.skin, 0.8);
    const b = (m, size, pos, rot) => piece(spine, m, size, pos, 'body', rot);

    b(mat(c.pants, 0.95), [1.6, 0.8, 0.9], [0, 0.2, 0]);
    b(top, [1.8, 2.6, 1.0], [0, 1.8, 0]);

    switch (kit.top) {
        case 'armor': {
            const vest = mat(c.vest);
            b(vest, [1.9, 1.7, 1.12], [0, 2.0, 0.02]);
            for (const x of [-0.55, 0, 0.55]) b(vest, [0.45, 0.5, 0.25], [x, 1.55, 0.65]);
            break;
        }
        case 'hoodie':
            b(top, [1.3, 0.7, 0.5], [0, 3.0, -0.45]);
            b(mat(new THREE.Color(c.top).multiplyScalar(0.8).getHex()), [1.0, 0.45, 0.06], [0, 1.1, 0.52]);
            for (const x of [-0.18, 0.18]) b(mat(WHITE), [0.05, 0.45, 0.04], [x, 2.55, 0.52]);
            break;
        case 'suit':
            b(mat(WHITE, 0.6), [0.5, 1.3, 0.05], [0, 2.45, 0.51]);
            b(mat(0xa3262a, 0.6), [0.18, 1.1, 0.06], [0, 2.2, 0.54]);
            for (const x of [-1, 1]) b(top, [0.3, 1.2, 0.06], [x * 0.33, 2.45, 0.53], [0, 0, x * 0.35]);
            break;
        case 'tee':
            b(mat(WHITE, 0.8), [0.9, 0.9, 0.05], [0, 2.1, 0.51]);
            break;
        case 'jacket':
            b(mat(new THREE.Color(c.top).multiplyScalar(0.75).getHex()), [0.08, 2.5, 0.05], [0, 1.8, 0.51]);
            b(top, [1.9, 0.35, 1.1], [0, 3.0, 0]);
            break;
    }
    return { top, skin };
}

function buildArm(shoulder, elbow, kit, top, skin) {
    const bare = kit.top === 'tee';
    const hands = kit.top === 'armor' || kit.top === 'jacket' ? mat(GLOVES, 0.8) : skin;
    if (bare) {
        piece(shoulder, top, [0.64, 0.7, 0.68], [0, -0.35, 0], 'body');
        piece(shoulder, skin, [0.5, 1.0, 0.54], [0, -1.0, 0], 'body');
        piece(elbow, skin, [0.48, 1.45, 0.52], [0, -0.7, 0], 'body');
    } else {
        piece(shoulder, top, [0.58, 1.6, 0.62], [0, -0.75, 0], 'body');
        piece(elbow, top, [0.52, 1.45, 0.56], [0, -0.7, 0], 'body');
    }
    piece(elbow, hands, [0.5, 0.45, 0.55], [0, -1.5, 0], 'body');
}

// `look` is a saved player look (ids from the lists above); leave it out for
// a bot in the terrorist kit.
export function buildSoldier(look) {
    const kit = look ? kitFor(look) : T_KIT;
    const c = kit.colors;

    const body = new THREE.Group();
    const hips = new THREE.Group();
    hips.position.y = 4.4;
    body.add(hips);

    const pants = mat(c.pants, 0.95);
    const boots = mat(BOOTS, 0.8);
    const legs = [];
    for (const side of [-1, 1]) {
        const thigh = new THREE.Group();
        thigh.position.set(side * 0.45, 0, 0);
        piece(thigh, pants, [0.72, 2.3, 0.8], [0, -1.1, 0], 'legs');
        const knee = new THREE.Group();
        knee.position.y = -2.2;
        piece(knee, pants, [0.66, 2.1, 0.72], [0, -1.05, 0], 'legs');
        piece(knee, boots, [0.72, 0.45, 1.05], [0, -2.0, 0.15], 'legs');
        thigh.add(knee);
        hips.add(thigh);
        legs.push({ thigh, knee });
    }

    const spine = new THREE.Group();
    hips.add(spine);
    const { top, skin } = buildTorso(spine, kit);

    const neck = new THREE.Group();
    neck.position.y = 3.1;
    spine.add(neck);
    buildFace(neck, kit);
    const hatCovers = ['cap', 'beanie', 'helmet'].includes(kit.hat);
    buildHair(neck, kit, hatCovers);
    buildHat(neck, kit);

    const arms = [];
    for (const side of [-1, 1]) {
        const shoulder = new THREE.Group();
        shoulder.position.set(side * 1.12, 2.85, 0);
        const elbow = new THREE.Group();
        elbow.position.y = -1.5;
        buildArm(shoulder, elbow, kit, top, skin);
        shoulder.add(elbow);
        spine.add(shoulder);
        arms.push({ shoulder, elbow, side });
    }

    // The rifle, held across the chest.
    const metal = mat(METAL, 0.5, 0.5);
    const wood = mat(WOOD, 0.7);
    const gun = new THREE.Group();
    gun.position.set(0.35, 2.05, 1.25);
    piece(gun, metal, [0.28, 0.42, 2.6], [0, 0, 0.3], 'gun');
    piece(gun, wood, [0.32, 0.36, 0.9], [0, -0.05, 1.1], 'gun');
    piece(gun, wood, [0.26, 0.5, 1.0], [0, -0.1, -1.4], 'gun');
    piece(gun, metal, [0.22, 0.8, 0.35], [0, -0.55, 0.45], 'gun', [0.3, 0, 0]);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8), metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 2.1;
    gun.add(barrel);
    const muzzle = new THREE.Object3D();
    muzzle.position.z = 2.7;
    gun.add(muzzle);
    spine.add(gun);

    const hitMeshes = [];
    body.traverse((o) => {
        if (o.isMesh && o.userData.part && o.userData.part !== 'gun') hitMeshes.push(o);
    });

    return { body, hips, spine, neck, legs, arms, gun, muzzle, hitMeshes };
}

// Arms up on the rifle: the rest pose while alive.
export function aimPose(rig) {
    const [left, right] = rig.arms;
    left.shoulder.rotation.set(-1.35, 0.45, 0);
    left.elbow.rotation.set(-0.35, 0, 0);
    right.shoulder.rotation.set(-1.05, -0.2, 0);
    right.elbow.rotation.set(-0.7, 0, 0);
    rig.neck.rotation.set(0, 0, 0);
    rig.spine.rotation.set(0, 0, 0);
    rig.hips.position.y = 4.4;
    for (const leg of rig.legs) {
        leg.thigh.rotation.set(0, 0, 0);
        leg.knee.rotation.set(0, 0, 0);
    }
}

// Throws away a rig's geometry. Materials are shared, so they stay.
export function disposeSoldier(rig) {
    rig.body.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
    });
    // The rifle may have been dropped into the world, away from the body.
    rig.gun.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
    });
}
