// The arenas: three maps built by hand for walking round, where the older
// maps are a courtyard with a procedural town round it. Each is a closed
// square with two ends to start from, a way through the middle, a tunnel
// down one side, high ground you climb to, and things to look at.
//
//   pharaoh    a desert temple: the sphinx, obelisks, a torch-lit catacomb
//              and the golden ankh up on its dais.
//   frostbite  a snowed-in rail yard: a train parked in the tunnel through
//              the mountain, boxcars, fuel tanks and the radar on its deck.
//   jungle     a step pyramid you climb, a flooded cave with a waterfall,
//              a ball court, and the stone heads in the trees.
//
// Everything is boxes standing on the floor, so bots.js reads the collision
// straight off them (collectColliders), and anything up in the air that
// should still stop you or a bullet is flagged walkable. North is -Z, which
// is where the aim trainer looks, so the middle of each map is kept clear
// for the targets and the landmark is what you see behind them.

import * as THREE from './vendor/three/three.module.min.js';

export const ARENA_BOUNDS = [-64, 64, -64, 64];

// aim.js's bricks and textures, handed in on each build.
let K;
const fy = () => K.FLOOR_Y;

/* ---------- bricks ---------- */

// A box by its corners on the ground plan, h tall, its bottom y off the floor.
function box(root, mat, x0, z0, x1, z1, h, y = 0) {
    return K.block(root, mat, [x1 - x0, h, z1 - z0], [(x0 + x1) / 2, y, (z0 + z1) / 2]);
}

// Up in the air but still solid: a roof, a statue on a dais, a parapet.
const raised = (mesh) => K.flagWalkable(mesh);

// A material cut from a texture so one repeat covers about `scale` units.
function tiled(tex, w, h, scale = 6, opts) {
    return K.surface(tex, Math.max(1, w / scale), Math.max(1, h / scale), opts);
}

function wall(root, tex, x0, z0, x1, z1, h, y = 0, scale = 6) {
    return box(root, tiled(tex, Math.max(x1 - x0, z1 - z0), h, scale), x0, z0, x1, z1, h, y);
}

// The four outer walls. Longer than a collider normally counts, so flagged.
function perimeter(root, tex, h) {
    const [x0, x1, z0, z1] = ARENA_BOUNDS;
    raised(wall(root, tex, x0 - 3, z0 - 3, x1 + 3, z0, h));
    raised(wall(root, tex, x0 - 3, z1, x1 + 3, z1 + 3, h));
    raised(wall(root, tex, x0 - 3, z0, x0, z1, h));
    raised(wall(root, tex, x1, z0, x1 + 3, z1, h));
}

// Solid steps up to something `rise` tall, over the given patch of ground,
// climbing toward `dir` ('x+', 'x-', 'z+' or 'z-'). One unit a step.
function stairs(root, mat, x0, z0, x1, z1, rise, dir) {
    const n = Math.ceil(rise);
    for (let i = 0; i < n; i++) {
        const h = (rise * (i + 1)) / n;
        const f0 = i / n;
        const f1 = (i + 1) / n;
        let a0 = x0;
        let a1 = x1;
        let b0 = z0;
        let b1 = z1;
        if (dir === 'x+') [a0, a1] = [x0 + (x1 - x0) * f0, x0 + (x1 - x0) * f1];
        if (dir === 'x-') [a0, a1] = [x1 - (x1 - x0) * f1, x1 - (x1 - x0) * f0];
        if (dir === 'z+') [b0, b1] = [z0 + (z1 - z0) * f0, z0 + (z1 - z0) * f1];
        if (dir === 'z-') [b0, b1] = [z1 - (z1 - z0) * f1, z1 - (z1 - z0) * f0];
        K.flagWalkable(box(root, mat, a0, b0, a1, b1, h));
    }
}

// A flat sheet laid on a wall or the floor, only to look at.
function panel(root, mat, x, y, z, w, h, turn = 0, flat = false) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, fy() + y, z);
    if (flat) m.rotation.x = -Math.PI / 2;
    m.rotation.y = flat ? 0 : turn;
    if (flat) m.rotation.z = turn;
    root.add(m);
    return K.deco(m);
}

function mesh(root, geometry, mat, x, y, z, collide = false) {
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(x, fy() + y, z);
    root.add(m);
    return collide ? m : K.deco(m);
}

// A flame: a little cone and a glow round it that flickers (see flicker).
function flame(root, flames, x, y, z, size = 1, color = 0xff9a3c) {
    const f = mesh(root, new THREE.ConeGeometry(0.32 * size, 0.9 * size, 6), new THREE.MeshBasicMaterial({ color: 0xffc46b }), x, y + 0.45 * size, z);
    f.userData.dynamic = true;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: K.GLOW, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.position.set(x, fy() + y + 0.5 * size, z);
    glow.scale.setScalar(3.6 * size);
    root.add(glow);
    flames.push({ glow, flame: f, size, phase: Math.random() * 10 });
}

// A torch on a wall: a bracket and a flame.
function torch(root, flames, x, y, z) {
    K.deco(box(root, K.plain(0x2e2217), x - 0.22, z - 0.22, x + 0.22, z + 0.22, 1.1, y));
    K.deco(box(root, K.plain(0x4a3a2a), x - 0.4, z - 0.4, x + 0.4, z + 0.4, 0.3, y + 1.1));
    flame(root, flames, x, y + 1.4, z);
}

function flicker(flames, now) {
    for (const f of flames) {
        const t = now / 1000 + f.phase;
        const k = 1 + Math.sin(t * 11) * 0.08 + Math.sin(t * 23.7) * 0.06;
        f.glow.scale.setScalar(3.6 * f.size * k);
        f.glow.material.opacity = 0.75 + Math.sin(t * 17.3) * 0.15;
        f.flame.scale.set(1, k, 1);
    }
}

// A clay jar: a round body and a neck.
function jar(root, x, z, s, mat) {
    const body = new THREE.Mesh(K.UNIT_BALL, mat);
    body.scale.set(1.1 * s, 1.3 * s, 1.1 * s);
    body.position.set(x, fy() + 1.3 * s, z);
    root.add(body);
    mesh(root, new THREE.CylinderGeometry(0.45 * s, 0.6 * s, 0.9 * s, 10), mat, x, 2.8 * s, z);
}

// A column: a shaft with a flared top, and a square block of collision.
function column(root, x, z, h, shaft, cap) {
    mesh(root, new THREE.CylinderGeometry(1.15, 1.3, h - 1.2, 14), shaft, x, (h - 1.2) / 2, z, true);
    mesh(root, new THREE.CylinderGeometry(1.7, 1.15, 1.2, 14), cap, x, h - 0.6, z);
}

// The easter eggs from the other maps, hidden on this one too. The ones that
// live on rooftops stay on the city maps.
function hideEggs(root, spots) {
    const eggs = K.EGGS.filter((e) => !e.roof);
    eggs.forEach((egg, i) => {
        if (spots[i]) K.placeEgg(root, egg, spots[i][0], spots[i][1]);
    });
}

/* ---------- textures ---------- */

// Carved and painted hieroglyphs in columns on sandstone.
function hieroglyphs(ctx, size) {
    ctx.fillStyle = '#d1b07a';
    ctx.fillRect(0, 0, size, size);
    K.speckle('rgba(0,0,0,0)', ['#a8834d', '#e8d0a0'], 1200, size)(ctx);
    const cols = 4;
    const rows = 6;
    const cw = size / cols;
    const rh = size / rows;
    ctx.strokeStyle = 'rgba(90, 62, 30, 0.8)';
    ctx.lineWidth = 2;
    for (let c = 0; c <= cols; c++) {
        ctx.beginPath();
        ctx.moveTo(c * cw, 0);
        ctx.lineTo(c * cw, size);
        ctx.stroke();
    }
    const paints = ['#6b4a26', '#6b4a26', '#6b4a26', '#2f5fa8', '#a8432f'];
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
            const x = c * cw + cw / 2;
            const y = r * rh + rh / 2;
            const s = Math.min(cw, rh) * 0.32;
            ctx.strokeStyle = ctx.fillStyle = paints[Math.floor(Math.random() * paints.length)];
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            switch (Math.floor(Math.random() * 6)) {
                case 0: // eye
                    ctx.ellipse(x, y, s, s * 0.45, 0, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.arc(x, y, s * 0.22, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.beginPath();
                    ctx.moveTo(x - s * 0.3, y + s * 0.45);
                    ctx.lineTo(x - s * 0.5, y + s);
                    ctx.stroke();
                    break;
                case 1: // ankh
                    ctx.ellipse(x, y - s * 0.55, s * 0.3, s * 0.42, 0, 0, Math.PI * 2);
                    ctx.moveTo(x - s * 0.6, y);
                    ctx.lineTo(x + s * 0.6, y);
                    ctx.moveTo(x, y - s * 0.13);
                    ctx.lineTo(x, y + s);
                    ctx.stroke();
                    break;
                case 2: // bird
                    ctx.arc(x, y, s * 0.5, Math.PI * 0.9, Math.PI * 2.1);
                    ctx.moveTo(x + s * 0.5, y);
                    ctx.lineTo(x + s * 0.9, y - s * 0.3);
                    ctx.moveTo(x - s * 0.2, y + s * 0.4);
                    ctx.lineTo(x - s * 0.2, y + s);
                    ctx.moveTo(x + s * 0.2, y + s * 0.4);
                    ctx.lineTo(x + s * 0.2, y + s);
                    ctx.stroke();
                    break;
                case 3: // water
                    for (let k = -1; k <= 1; k++) {
                        ctx.moveTo(x - s, y + k * s * 0.4);
                        for (let i = 0; i <= 6; i++) ctx.lineTo(x - s + (i * s) / 3, y + k * s * 0.4 + (i % 2 ? -s * 0.15 : s * 0.15));
                    }
                    ctx.stroke();
                    break;
                case 4: // sun
                    ctx.arc(x, y, s * 0.5, 0, Math.PI * 2);
                    ctx.fill();
                    break;
                default: // reed
                    ctx.moveTo(x, y + s);
                    ctx.lineTo(x, y - s * 0.6);
                    ctx.quadraticCurveTo(x + s * 0.6, y - s, x + s * 0.2, y - s * 0.2);
                    ctx.stroke();
            }
        }
    }
}

// Gold with bands of lapis: a sarcophagus, the pharaoh's headdress.
function bands(ctx, size) {
    for (let i = 0; i < 12; i++) {
        ctx.fillStyle = i % 2 ? '#1f4a94' : '#d9a93a';
        ctx.fillRect(0, (i * size) / 12, size, size / 12);
    }
}

// The winged sun over the gate.
function wingedSun(ctx, size) {
    ctx.clearRect(0, 0, size, size);
    const y = size / 2;
    ctx.fillStyle = '#c9942e';
    for (const side of [-1, 1]) {
        for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            ctx.moveTo(size / 2 + side * size * 0.1, y - size * 0.06 + i * size * 0.03);
            ctx.lineTo(size / 2 + side * size * (0.48 - i * 0.05), y - size * 0.1 + i * size * 0.045);
            ctx.lineTo(size / 2 + side * size * (0.46 - i * 0.05), y - size * 0.07 + i * size * 0.045);
            ctx.lineTo(size / 2 + side * size * 0.1, y - size * 0.02 + i * size * 0.03);
            ctx.fill();
        }
    }
    ctx.fillStyle = '#b8321f';
    ctx.beginPath();
    ctx.arc(size / 2, y, size * 0.09, 0, Math.PI * 2);
    ctx.fill();
}

// Grey rock with darker cracks.
function rock(ctx, size) {
    K.speckle('#6c6f73', ['#55585c', '#84878b', '#4a4c50'], 3000, size)(ctx);
    ctx.strokeStyle = 'rgba(35, 36, 40, 0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
        let x = Math.random() * size;
        let y = Math.random() * size;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 4; k++) {
            x += (Math.random() - 0.5) * 50;
            y += Math.random() * 40;
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
}

// Water: deep green-blue with pale streaks, scrolled to flow.
function water(ctx, size) {
    ctx.fillStyle = '#1d5b5e';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(190, 235, 230, 0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 30; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 6 + Math.random() * 10, y + 30 + Math.random() * 40);
        ctx.stroke();
    }
}

function thatch(ctx, size) {
    ctx.fillStyle = '#9c7a3c';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 400; i++) {
        ctx.strokeStyle = Math.random() < 0.5 ? '#7a5c28' : '#c29a52';
        ctx.lineWidth = 1.5;
        const x = Math.random() * size;
        const y = Math.random() * size;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (Math.random() - 0.5) * 6, y + 18);
        ctx.stroke();
    }
}

// The Aztec sun stone, carved in rings.
function sunStone(ctx, size) {
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    const rings = ['#8b8a78', '#76755f', '#8b8a78', '#6a6a55', '#9a9985'];
    rings.forEach((col, i) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(c, c, size * (0.5 - i * 0.08), 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.strokeStyle = '#4d4c3c';
    ctx.lineWidth = 3;
    for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * size * 0.3, c + Math.sin(a) * size * 0.3);
        ctx.lineTo(c + Math.cos(a) * size * 0.46, c + Math.sin(a) * size * 0.46);
        ctx.stroke();
    }
    ctx.fillStyle = '#4d4c3c';
    ctx.beginPath();
    ctx.arc(c - size * 0.05, c - size * 0.03, size * 0.025, 0, Math.PI * 2);
    ctx.arc(c + size * 0.05, c - size * 0.03, size * 0.025, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(c - size * 0.04, c + size * 0.05, size * 0.08, size * 0.02);
}

/* ---------- pharaoh ---------- */

function buildPharaoh(root, kit) {
    K = kit;
    const flames = [];
    K.sunAndSky(root, 0x3f7fc6, 0xf3dcae, 0xd9b77e, 0xfff0d6, [30, 40, 20]);
    K.ground(root, new THREE.MeshStandardMaterial({
        map: K.paint(256, K.speckle('#e3c48c', ['#b8945c', '#f5dfb5', '#a8834d'], 2600), 40),
        roughness: 1,
    }));

    const stone = K.paint(256, K.sandstone);
    const carved = K.paint(256, hieroglyphs);
    const tomb = K.paint(256, K.speckle('#4a3a28', ['#3a2c1e', '#5c4832', '#2e2317'], 2400));
    const tombWall = tiled(tomb, 40, 14, 8);
    const sphinx = K.plain(0xd2ad6e);
    const gold = K.plain(0xd9a93a, { metalness: 0.7, roughness: 0.3 });
    const banded = K.surface(K.paint(128, bands), 1, 1);
    const black = K.plain(0x1d1a18, { roughness: 0.6 });
    const clay = K.plain(0xa9552e);
    const stoneMat = tiled(stone, 10, 4);

    perimeter(root, stone, 18);
    // The north wall behind the temple front is all hieroglyphs.
    panel(root, tiled(carved, 54, 16, 8), -37, 8, -63.95, 54, 16);

    /* The catacombs: a roofed tunnel down the west side from the south end
       to the temple, with a side passage into the middle. Dark stone, torch
       light, sarcophagi along the wall. */
    wall(root, stone, -64, -40, -52, 40, 18);
    wall(root, stone, -40, -40, -28, -4, 14);
    wall(root, stone, -40, 4, -28, 20, 14);
    wall(root, stone, -40, 20, -38, 40, 14);
    raised(box(root, tombWall, -52, -40, -38, 40, 1.2, 14));
    raised(box(root, tombWall, -40, -4, -28, 4, 1.2, 14));
    panel(root, tombWall, -51.95, 7, 0, 80, 14, Math.PI / 2);
    panel(root, tombWall, -40.05, 7, -22, 36, 14, -Math.PI / 2);
    panel(root, tombWall, -40.05, 7, 22, 36, 14, -Math.PI / 2);
    panel(root, tiled(tomb, 12, 80, 8), -46, 0.03, 0, 12, 80, 0, true);
    panel(root, tiled(tomb, 12, 8, 8), -34, 0.03, 0, 12, 8, 0, true);
    for (const z of [-30, -12, 16, 32]) {
        box(root, banded, -51.6, z - 3, -49.2, z + 3, 1.8);
        K.deco(box(root, gold, -51.3, z - 2.7, -49.5, z - 1.5, 0.3, 1.8));
    }
    wall(root, stone, -44, -22, -40, -18, 14);
    wall(root, stone, -52, 6, -48, 10, 14);
    for (const [x, z] of [[-51.6, -34], [-51.6, -2], [-51.6, 26], [-40.4, -28], [-40.4, 12], [-40.4, 34]]) torch(root, flames, x, 6, z);
    K.light(root, 'point', 0xff9a40, 90, [-46, fy() + 10, -20]);
    K.light(root, 'point', 0xff9a40, 90, [-46, fy() + 10, 20]);

    /* The middle: a court between the gate and the sphinx, two obelisks. */
    wall(root, stone, -28, 20, -4, 23, 12);
    wall(root, stone, 4, 20, 28, 23, 12);
    box(root, tiled(stone, 8, 3), -4, 20, 4, 23, 3, 9);
    K.decal(root, wingedSun, 9, 0, 10.5, 23.06);
    K.decal(root, wingedSun, 9, 0, 10.5, 19.94, Math.PI);
    wall(root, stone, 28, -24, 30, 0, 12);
    for (const x of [-16, 16]) {
        box(root, stoneMat, x - 1.6, -21.6, x + 1.6, -18.4, 1.2);
        const shaft = mesh(root, new THREE.CylinderGeometry(0.85, 1.35, 20, 4), tiled(carved, 2, 20, 3), x, 11.2, -20, true);
        shaft.rotation.y = Math.PI / 4;
        const tip = mesh(root, new THREE.ConeGeometry(0.85, 1.6, 4), gold, x, 22, -20);
        tip.rotation.y = Math.PI / 4;
    }
    box(root, stoneMat, -24, 4, -19, 8, 4);
    box(root, stoneMat, 19, -8, 24, -4, 4);
    box(root, stoneMat, 20, -7.5, 23, -4.5, 2.5, 4);
    box(root, tiled(stone, 14, 3.4), -7, 11, 7, 13, 3.4);
    for (const [x, z, s] of [[-22, 14, 1], [-20, 15.5, 0.8], [24, 8, 1.1], [22, -16, 0.9]]) jar(root, x, z, s, clay);

    /* The sphinx on its plinth, facing the gate. */
    box(root, stoneMat, -11, -48, 11, -24, 2);
    box(root, sphinx, -7, -46, 7, -33, 7, 2);
    box(root, sphinx, -7, -33, -3, -25, 2.2, 2);
    box(root, sphinx, 3, -33, 7, -25, 2.2, 2);
    box(root, sphinx, -4.5, -37, 4.5, -30, 11, 2);
    box(root, sphinx, -3.4, -36, 3.4, -29.5, 5.5, 13);
    box(root, banded, -4.6, -35.5, -3.4, -30.5, 6, 9.5);
    box(root, banded, 3.4, -35.5, 4.6, -30.5, 6, 9.5);
    box(root, banded, -3.9, -36.4, 3.9, -29.8, 1.3, 18.3);
    box(root, black, -2.2, -29.6, -0.9, -29.4, 0.45, 16);
    box(root, black, 0.9, -29.6, 2.2, -29.4, 0.45, 16);
    box(root, sphinx, -0.5, -29.6, 0.5, -28.9, 1.6, 14.4);
    box(root, banded, -0.7, -30.2, 0.7, -29.2, 2.6, 10.6);

    /* A: the temple front along the north wall, the golden sarcophagus on
       its step, Anubis by the tunnel mouth. */
    for (let i = 0; i < 6; i++) column(root, -58 + i * 7.2, -57, 14, tiled(carved, 3, 12, 4), stoneMat);
    raised(box(root, tiled(stone, 44, 2), -61, -59.5, -20, -54.5, 2, 14));
    box(root, stoneMat, -32, -52, -20, -44, 1);
    box(root, banded, -29, -49.5, -23, -46.5, 2.2, 1);
    K.deco(box(root, gold, -28.6, -49.1, -23.4, -46.9, 0.3, 3.2));
    K.decal(root, K.sprayed('A', '#b8321f'), 7, -44, 9, -63.9);
    for (const x of [-56, -37]) {
        box(root, stoneMat, x - 1.6, -47.6, x + 1.6, -44.4, 1.4);
        box(root, black, x - 0.9, -46.8, x + 0.9, -45.2, 4.2, 1.4);
        K.deco(box(root, gold, x - 1, -46.9, x + 1, -45.1, 0.5, 4.4));
        box(root, black, x - 0.7, -46.6, x + 0.7, -44.2, 1.4, 5.6);
        K.deco(box(root, black, x - 0.6, -46.4, x - 0.2, -45.8, 1.6, 7));
        K.deco(box(root, black, x + 0.2, -46.4, x + 0.6, -45.8, 1.6, 7));
    }
    box(root, stoneMat, -48, -56, -44, -52, 3.5);
    box(root, stoneMat, -19, -40, -15, -36, 3.5);
    box(root, stoneMat, -18.5, -39.5, -15.5, -36.5, 3, 3.5);
    // A fallen obelisk, lying where the temple opens onto the middle.
    box(root, tiled(carved, 10, 2), -27, -30, -17, -28, 2.2);
    for (const [x, z, s] of [[-31, -27, 1], [-13, -44, 0.9], [-60, -50, 1.1]]) jar(root, x, z, s, clay);
    torch(root, flames, -61, 5, -63.4);
    torch(root, flames, -21, 5, -63.4);

    /* Behind the sphinx, where one side starts: a reflecting pool. */
    panel(root, K.surface(K.paint(128, water), 3, 1, { roughness: 0.2, metalness: 0.3 }), 0, 0.05, -56, 16, 5, 0, true);
    K.deco(box(root, stoneMat, -8.6, -59, 8.6, -58.5, 0.5));
    K.deco(box(root, stoneMat, -8.6, -53.5, 8.6, -53, 0.5));
    K.palm(root, 22, -58);
    K.palm(root, -22, -60, 12);
    K.palm(root, 26, -30, 10);

    /* B: the golden ankh on a dais up a flight of steps, a market below. */
    box(root, tiled(stone, 20, 5), 44, -20, 64, 0, 5);
    stairs(root, stoneMat, 34, -13, 44, -7, 5, 'x+');
    raised(box(root, stoneMat, 44, -20, 64, -19, 1.4, 5));
    raised(box(root, stoneMat, 44, -1, 64, 0, 1.4, 5));
    raised(box(root, stoneMat, 54, -12, 58, -8, 1.2, 5));
    raised(box(root, gold, 55.4, -10.4, 56.6, -9.6, 4.4, 6.2));
    raised(box(root, gold, 53.6, -10.4, 58.4, -9.6, 1, 9.2));
    const loop = mesh(root, new THREE.TorusGeometry(1.2, 0.4, 8, 24), gold, 56, 12, -10);
    loop.scale.set(1, 1.3, 1);
    for (const z of [-17, -3]) {
        raised(box(root, black, 46.4, z - 0.6, 47.6, z + 0.6, 2, 5));
        flame(root, flames, 47, 7.2, z, 1.4);
    }
    K.decal(root, K.sprayed('B', '#b8321f'), 7, 63.9, 10, -10, -Math.PI / 2);
    const cloth = [K.plain(0xb8321f, { side: THREE.DoubleSide }), K.plain(0x2f6fa8, { side: THREE.DoubleSide })];
    [[38, 10], [52, 12]].forEach(([x, z], i) => {
        for (const [dx, dz] of [[-3, -2.5], [3, -2.5], [-3, 2.5], [3, 2.5]]) box(root, K.plain(0x5b3a22), x + dx - 0.2, z + dz - 0.2, x + dx + 0.2, z + dz + 0.2, 7);
        panel(root, cloth[i], x, 7, z, 7, 6, 0, true);
        box(root, K.plain(0x7a5332), x - 2.6, z - 1, x + 2.6, z + 1, 3);
        jar(root, x - 1.4, z, 0.5, clay);
        jar(root, x + 1.2, z + 0.2, 0.45, clay);
    });
    wall(root, stone, 32, 24, 44, 36, 11);
    box(root, K.plain(0xb38e57), 31.6, 23.6, 44.4, 36.4, 0.8, 11);
    // A colossal head, fallen in the sand.
    box(root, sphinx, 50, 26, 58, 33, 6);
    box(root, banded, 49.6, 25.6, 58.4, 29, 5, 1);
    box(root, black, 51.5, 33, 53, 33.2, 0.6, 3.5);
    box(root, black, 55, 33, 56.5, 33.2, 0.6, 3.5);
    K.palm(root, 60, 46);
    K.palm(root, 36, 50, 12);
    K.palm(root, 61, 8);

    /* The south end, where the other side starts: tents and a scarab. */
    for (const [x, z] of [[-30, 52], [28, 56]]) {
        box(root, K.plain(0xe4d2b0), x - 3, z - 2.5, x + 3, z + 2.5, 4);
        const roof = mesh(root, new THREE.ConeGeometry(4.6, 3, 4), K.plain(0xc9a46a), x, 5.5, z);
        roof.rotation.y = Math.PI / 4;
    }
    const scarab = K.plain(0x1f5a52, { metalness: 0.5, roughness: 0.35 });
    box(root, stoneMat, -22, 46, -16, 52, 1.5);
    const shell = mesh(root, K.UNIT_BALL, scarab, -19, 2.6, 49, true);
    shell.scale.set(2.2, 1.3, 2.8);
    mesh(root, K.UNIT_BALL, gold, -19, 2.8, 46.2).scale.set(0.9, 0.7, 0.8);
    for (const [x, z, s] of [[8, 44, 1], [10, 46, 0.8], [-44, 58, 1.1], [58, 58, 0.9]]) jar(root, x, z, s, clay);

    hideEggs(root, [[-24, -34], [-46, 0], [40, 16], [-10, 50], [18, -50], [22, 14], [-61, -61], [60, 56], [-34, 30], [60, -40]]);

    return {
        fog: [0xf3dcae, 70, 220],
        halo: 0x3a2a18,
        bounds: ARENA_BOUNDS,
        spawns: [
            [[-8, 56], [0, 58], [8, 56], [-14, 58], [16, 54]],
            [[-8, -57], [0, -60], [8, -57], [16, -56], [-16, -56]],
        ],
        update: (now) => flicker(flames, now),
    };
}

/* ---------- frostbite ---------- */

function buildFrostbite(root, kit) {
    K = kit;
    const flames = [];
    K.sunAndSky(root, 0x6d8fb3, 0xdfe7ee, 0xc9d4dc, 0xeef4ff, [-30, 35, 25], 0xdfeaf5, 0x9aa6b0);
    K.ground(root, new THREE.MeshStandardMaterial({
        map: K.paint(256, K.speckle('#eef3f7', ['#d5dee6', '#ffffff', '#c3ceda'], 2200), 40),
        roughness: 1,
    }));

    const stone = K.paint(256, rock);
    const concrete = K.paint(256, K.speckle('#9da3a6', ['#80868a', '#b8bdc0', '#6f7477'], 2600));
    const redCar = K.paint(128, K.corrugated('#b5452f', '#7e2c1d'));
    const blueCar = K.paint(128, K.corrugated('#3b6a9a', '#23456a'));
    const greenCar = K.paint(128, K.corrugated('#4f7a45', '#2f4f2a'));
    const snowCap = K.plain(0xf4f7fa, { roughness: 1 });
    const steel = K.plain(0x5d6166, { metalness: 0.6, roughness: 0.45 });
    const dark = K.plain(0x24262a);
    const concreteMat = tiled(concrete, 8, 4);
    const crate = K.surface(K.shared('crate', () => K.paint(128, K.crateTexture)));
    const hazardMat = K.surface(K.paint(128, K.hazard), 2, 1);

    perimeter(root, stone, 18);
    // Snow along the top of the outer walls.
    for (const [x0, z0, x1, z1] of [[-67, -67, 67, -64], [-67, 64, 67, 67], [-67, -64, -64, 64], [64, -64, 67, 64]]) {
        K.deco(box(root, snowCap, x0, z0, x1, z1, 0.8, 18));
    }

    // Railway sleepers and rails, drawn only.
    const rails = (x, z0, z1) => {
        panel(root, K.plain(0x6b5a48), x, 0.04, (z0 + z1) / 2, 3.6, z1 - z0, 0, true);
        for (const dx of [-0.9, 0.9]) K.deco(box(root, steel, x + dx - 0.12, z0, x + dx + 0.12, z1, 0.25));
    };
    // A boxcar: corrugated sides, a darker roof, wheels.
    const boxcar = (x, z0, z1, tex, h = 5.5) => {
        box(root, tiled(tex, z1 - z0, h, 4), x - 2.2, z0, x + 2.2, z1, h - 0.8, 0.8);
        K.deco(box(root, dark, x - 1.8, z0 + 0.4, x + 1.8, z1 - 0.4, 0.8));
        K.deco(box(root, snowCap, x - 2.3, z0 - 0.1, x + 2.3, z1 + 0.1, 0.25, h));
    };

    /* The mountain down the west side, and the tunnel through it with a
       train parked inside, a lane either side of it. */
    wall(root, stone, -64, -40, -52, 40, 20);
    wall(root, stone, -36, -40, -28, -6, 20);
    wall(root, stone, -36, 6, -28, 40, 20);
    raised(box(root, tiled(stone, 30, 3), -52, -40, -36, 40, 2, 14));
    raised(box(root, tiled(stone, 10, 3), -36, -6, -28, 6, 2, 14));
    const peak = K.plain(0x6c6f73, { flatShading: true });
    for (const [x, z, r, h] of [[-50, -26, 16, 16], [-44, 4, 18, 20], [-52, 30, 14, 13]]) {
        mesh(root, new THREE.ConeGeometry(r, h, 7), peak, x, 20 + h / 2 - 1, z);
        mesh(root, new THREE.ConeGeometry(r * 0.42, h * 0.42, 7), snowCap, x, 20 + h - h * 0.21 - 1, z);
    }
    // The tunnel mouths: concrete portals with hazard stripes.
    for (const z of [-40, 40]) {
        const s = Math.sign(z);
        K.deco(box(root, concreteMat, -53, z - 0.5 + s * 0.5, -35, z + 0.5 + s * 0.5, 3, 13));
        K.deco(box(root, hazardMat, -52, z - 0.3 + s * 0.7, -36, z + 0.3 + s * 0.7, 0.8, 12.2));
    }
    panel(root, K.plain(0x2c2d30), -51.95, 7, 0, 80, 14, Math.PI / 2);
    panel(root, K.plain(0x2c2d30), -36.05, 7, -23, 34, 14, -Math.PI / 2);
    panel(root, K.plain(0x2c2d30), -36.05, 7, 23, 34, 14, -Math.PI / 2);
    rails(-44, -64, 64);
    // The locomotive: a long hood, a cab, a headlight looking north.
    box(root, tiled(blueCar, 14, 5, 4), -46.2, -30, -41.8, -16, 4.2, 0.8);
    box(root, tiled(blueCar, 4, 7, 4), -46.4, -16, -41.6, -11, 6.2, 0.8);
    K.deco(box(root, dark, -45.6, -16.1, -42.4, -15.9, 1.6, 4.6));
    K.deco(box(root, K.plain(0xffe9a8, { emissive: 0xffe9a8, emissiveIntensity: 1 }), -44.6, -30.1, -43.4, -29.9, 0.7, 3.4));
    flame(root, flames, -44, 3.3, -30.6, 1.4, 0xfff0c0);
    boxcar(-44, -9, 6, redCar);
    boxcar(-44, 8, 22, greenCar);
    for (const z of [-24, -2, 20]) {
        const lamp = K.plain(0xffd98a, { emissive: 0xffd98a, emissiveIntensity: 1 });
        K.deco(box(root, lamp, -51.9, z - 0.4, -51.5, z + 0.4, 0.6, 10));
        K.deco(box(root, lamp, -36.5, z + 5.6, -36.1, z + 6.4, 0.6, 10));
    }
    K.light(root, 'point', 0xffd08a, 80, [-44, fy() + 11, -22]);
    K.light(root, 'point', 0xffd08a, 80, [-44, fy() + 11, 18]);

    /* The middle: the yard, two tracks, boxcars and a flatcar of crates. */
    rails(-20, -64, 64);
    rails(20, -64, 64);
    boxcar(20, -34, -18, redCar);
    boxcar(20, 8, 24, blueCar);
    box(root, steel, -22.2, -12, -17.8, 4, 1.6, 0.4);
    box(root, crate, -21.8, -10, -18.8, -7, 3, 2);
    box(root, crate, -21.6, -2, -18.6, 1, 3, 2);
    box(root, crate, -21.4, -1.6, -18.9, 0.9, 2.5, 5);
    box(root, concreteMat, -10, -31, 10, -29, 6);
    K.deco(box(root, snowCap, -10.1, -31.1, 10.1, -28.9, 0.3, 6));
    wall(root, concrete, -28, 26, -6, 28, 12);
    wall(root, concrete, 6, 26, 28, 28, 12);
    K.deco(box(root, hazardMat, -6, 26.2, 6, 27.8, 1.2, 10.8));
    wall(root, concrete, 28, -26, 30, -6, 12);
    wall(root, concrete, 28, 10, 30, 26, 12);
    for (const [x, z] of [[-26, -26], [26, 14], [-8, 18]]) {
        box(root, concreteMat, x - 2, z - 1, x + 2, z + 1, 3.2);
        K.deco(box(root, snowCap, x - 2.1, z - 1.1, x + 2.1, z + 1.1, 0.25, 3.2));
    }

    /* B: the radar deck up a flight of concrete steps, and the fuel tanks. */
    box(root, tiled(concrete, 22, 6), 42, -46, 64, -20, 6);
    stairs(root, concreteMat, 30, -32, 42, -26, 6, 'x+');
    raised(box(root, steel, 42, -46, 64, -45.4, 1.4, 6));
    raised(box(root, steel, 42, -20.6, 64, -20, 1.4, 6));
    raised(box(root, steel, 42, -46, 42.6, -33, 1.4, 6));
    raised(box(root, concreteMat, 50, -37, 58, -29, 3, 6));
    const dome = mesh(root, new THREE.SphereGeometry(5.2, 24, 16), K.plain(0xe8ecef, { roughness: 0.6 }), 54, 13.5, -33);
    dome.scale.y = 0.95;
    raised(box(root, steel, 44.4, -44.6, 45.2, -43.8, 14, 6));
    mesh(root, new THREE.CylinderGeometry(2.4, 0.3, 0.6, 16), K.plain(0xdfe3e6), 44.8, 20.4, -44.2);
    K.decal(root, K.sprayed('B', '#b8321f'), 7, 63.9, 12, -33, -Math.PI / 2);
    const tank = K.plain(0xd8dcdf, { metalness: 0.3, roughness: 0.5 });
    for (const [x, z, r] of [[46, 4, 3.2], [56, 12, 3.6], [46, 20, 2.8]]) {
        mesh(root, new THREE.CylinderGeometry(r, r, 9, 20), tank, x, 4.5, z, true);
        mesh(root, new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), snowCap, x, 9, z);
        K.deco(box(root, hazardMat, x - r - 0.05, z - 0.5, x - r + 0.1, z + 0.5, 1, 3));
    }
    K.deco(box(root, steel, 46, 3.6, 56, 4.4, 0.6, 7));

    /* The warehouse at the south-east corner: in one door, out the other. */
    const shed = K.paint(128, K.corrugated('#8e969c', '#6a7177'));
    const T = 0.8;
    wall(root, shed, 36, 34, 44, 34 + T, 11, 0, 4);
    wall(root, shed, 52, 34, 64, 34 + T, 11, 0, 4);
    wall(root, shed, 36, 34, 36 + T, 44, 11, 0, 4);
    wall(root, shed, 36, 50, 36 + T, 64, 11, 0, 4);
    K.deco(box(root, tiled(shed, 8, 2, 4), 44, 34, 52, 34 + T, 2, 9));
    K.deco(box(root, tiled(shed, 6, 2, 4), 36, 44, 36 + T, 50, 2, 9));
    raised(box(root, tiled(shed, 28, 30, 6), 36, 34, 64, 64, 1, 11));
    K.deco(box(root, snowCap, 35.8, 33.8, 64, 64, 0.4, 12));
    for (const [x, z, n] of [[44, 42, 2], [54, 44, 3], [48, 56, 2], [58, 58, 1]]) {
        for (let i = 0; i < n; i++) box(root, crate, x + i * 3.1, z, x + i * 3.1 + 3, z + 3, 3);
        if (n > 1) box(root, crate, x + 1.5, z + 0.2, x + 4.3, z + 2.8, 2.8, 3);
    }
    K.light(root, 'point', 0xffe2b8, 70, [50, fy() + 9, 48]);

    /* North, where one side starts: stacked containers and a water tower.
       North-west is A, at the tunnel's north mouth. */
    const container = (x0, z0, x1, z1, tex, y = 0) => {
        box(root, tiled(tex, Math.max(x1 - x0, z1 - z0), 4.4, 3), x0, z0, x1, z1, 4.4, y);
        K.deco(box(root, snowCap, x0 - 0.05, z0 - 0.05, x1 + 0.05, z1 + 0.05, 0.25, y + 4.4));
    };
    container(-30, -58, -21, -53.8, blueCar);
    container(-29, -57.6, -20, -53.8, redCar, 4.4);
    container(-60, -56, -55.8, -47, greenCar);
    container(-18, -46, -9, -41.8, redCar);
    box(root, crate, -36, -50, -33, -47, 3);
    box(root, crate, -35.6, -49.6, -33.2, -47.4, 2.4, 3);
    K.decal(root, K.sprayed('A', '#b8321f'), 7, -58, 9, -40.05, Math.PI);
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) box(root, steel, 26 + dx - 0.3, -52 + dz - 0.3, 26 + dx + 0.3, -52 + dz + 0.3, 12);
    mesh(root, new THREE.CylinderGeometry(3.4, 3.4, 5, 16), K.plain(0x8a4a32), 26, 14.5, -52);
    mesh(root, new THREE.ConeGeometry(3.8, 2, 16), snowCap, 26, 18, -52);
    container(34, -62, 43, -57.8, blueCar);
    box(root, crate, 6, -50, 9, -47, 3);
    box(root, crate, 9.2, -49.6, 12.2, -46.6, 3);

    /* South, where the other side starts: a guard hut and a barrier. */
    box(root, concreteMat, -16, 50, -8, 56, 7);
    K.deco(box(root, snowCap, -16.3, 49.7, -7.7, 56.3, 0.4, 7));
    K.deco(box(root, dark, -15, 49.9, -9, 50, 2, 3));
    box(root, concreteMat, 14, 44, 24, 46, 2.6);
    K.deco(box(root, hazardMat, 14, 43.9, 24, 44, 1, 1.2));

    // Pines, outside the walls and a few in.
    const needles = [K.plain(0x2d4a38, { flatShading: true }), K.plain(0x3a5c45, { flatShading: true })];
    const pine = (x, z, h) => {
        mesh(root, new THREE.CylinderGeometry(0.5, 0.7, h * 0.35, 6), K.plain(0x4a3524), x, h * 0.175, z, true);
        for (let i = 0; i < 3; i++) {
            mesh(root, new THREE.ConeGeometry(h * (0.3 - i * 0.07), h * 0.38, 7), needles[i % 2], x, h * (0.42 + i * 0.2), z);
            mesh(root, new THREE.ConeGeometry(h * (0.3 - i * 0.07) * 0.6, h * 0.14, 7), snowCap, x, h * (0.56 + i * 0.2), z);
        }
    };
    for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        const r = 78 + (i % 3) * 7;
        pine(Math.cos(a) * r, Math.sin(a) * r, 20 + (i % 4) * 4);
    }
    pine(-4, 40, 13);
    pine(40, -6, 12);
    pine(-58, 56, 14);

    hideEggs(root, [[-40, -50], [-32, 0], [40, 28], [0, 50], [16, -46], [24, 0], [60, 40], [-58, -60], [-24, 40], [30, -44]]);

    // Snow, falling through the whole map.
    const N = 2400;
    const flakes = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
        flakes[i * 3] = (Math.random() - 0.5) * 140;
        flakes[i * 3 + 1] = Math.random() * 44;
        flakes[i * 3 + 2] = (Math.random() - 0.5) * 140;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(flakes, 3));
    const snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, transparent: true, opacity: 0.85, depthWrite: false }));
    snow.position.y = fy();
    snow.frustumCulled = false;
    root.add(snow);

    return {
        fog: [0xdfe7ee, 55, 190],
        halo: 0x2a2f33,
        bounds: ARENA_BOUNDS,
        spawns: [
            [[-6, 56], [4, 58], [0, 52], [-24, 56], [26, 58]],
            [[0, -58], [10, -56], [-4, -54], [18, -60], [-12, -60]],
        ],
        update(now, dt) {
            flicker(flames, now);
            const p = geo.attributes.position;
            const t = now / 1000;
            for (let i = 0; i < N; i++) {
                let y = flakes[i * 3 + 1] - (2.6 + (i % 5) * 0.35) * dt;
                if (y < 0) y += 44;
                flakes[i * 3 + 1] = y;
                flakes[i * 3] += Math.sin(t * 0.7 + i) * 0.6 * dt;
            }
            p.needsUpdate = true;
        },
    };
}

/* ---------- jungle ---------- */

function buildJungle(root, kit) {
    K = kit;
    const flames = [];
    K.sunAndSky(root, 0x4f8fb8, 0xdfe6d4, 0x9fb08a, 0xfff2d0, [20, 36, 30], 0xd8ecd8, 0x4a5a30);
    K.ground(root, new THREE.MeshStandardMaterial({
        map: K.paint(256, K.speckle('#4d6b31', ['#3d5a26', '#6b8a45', '#5a4a2e'], 3000), 40),
        roughness: 1,
    }));

    const mossy = K.paint(256, K.glyphs);
    const stone = K.paint(256, K.speckle('#7d7f6a', ['#5f6450', '#94967f', '#4f6b35'], 2800));
    const cave = K.paint(256, K.speckle('#3a3c33', ['#2c2e26', '#4a4d40', '#2f4a2a'], 2600));
    const stoneMat = tiled(stone, 8, 4);
    const caveMat = tiled(cave, 30, 14, 8);
    const jade = K.plain(0x3fae7a, { metalness: 0.2, roughness: 0.3 });
    const gold = K.plain(0xd9a93a, { metalness: 0.7, roughness: 0.3 });
    const leaves = [K.plain(0x2f6b2a, { flatShading: true }), K.plain(0x3f8a35, { flatShading: true }), K.plain(0x285a24, { flatShading: true })];
    const flowing = K.paint(128, water);
    flowing.repeat.set(1, 4);
    // The water moves, so it is kept out of the merged map meshes.
    const flows = [flowing];
    const moving = (m) => {
        m.userData.dynamic = true;
        if (m.material.map !== flowing) flows.push(m.material.map);
        return m;
    };

    perimeter(root, mossy, 16);
    // Vines down the outer walls.
    const vine = K.plain(0x2f6b2a, { side: THREE.DoubleSide });
    for (let i = 0; i < 40; i++) {
        const along = -60 + (i % 20) * 6.3;
        const h = 4 + (i * 7) % 8;
        if (i < 20) panel(root, vine, along, 16 - h / 2, -63.9, 0.6, h);
        else panel(root, vine, 63.9, 16 - h / 2, along, 0.6, h, -Math.PI / 2);
    }

    /* The pyramid: five stepped tiers up the north side of the middle, a
       stair up its face between two serpent heads, a shrine on top. */
    for (let k = 0; k < 5; k++) {
        const x = 22 - 4 * k;
        const zf = -22 - 4 * k;
        const h = 2 * (k + 1);
        stairsSide(root, tiled(mossy, x, h, 4), -x, -64, -3, zf, h);
        stairsSide(root, tiled(mossy, x, h, 4), 3, -64, x, zf, h);
    }
    stairs(root, tiled(stone, 6, 2, 3), -3, -42, 3, -22, 10, 'z-');
    K.flagWalkable(box(root, stoneMat, -3, -64, 3, -42, 10));
    for (const x of [-3.6, 3.6]) {
        const s = Math.sign(x);
        box(root, tiled(stone, 3, 2.5), x - 1, -21, x + 1, -17.5, 2.5);
        K.deco(box(root, jade, x - 0.9, -17.6, x + 0.9, -17.4, 0.4, 1.6));
        K.deco(box(root, K.plain(0xe8e2cf), x - 0.8 + s * 0.2, -17.45, x - 0.5 + s * 0.2, -17.35, 0.5, 0.9));
        K.deco(box(root, K.plain(0xe8e2cf), x + 0.5 + s * 0.2, -17.45, x + 0.8 + s * 0.2, -17.35, 0.5, 0.9));
    }
    // The shrine on top, open to the stair, the sun stone on its back wall.
    const shrine = tiled(stone, 12, 7);
    raised(box(root, shrine, -6, -64, 6, -62.8, 7, 10));
    raised(box(root, shrine, -6, -62.8, -5, -52, 7, 10));
    raised(box(root, shrine, 5, -62.8, 6, -52, 7, 10));
    raised(box(root, shrine, -6, -53, -2.5, -52, 7, 10));
    raised(box(root, shrine, 2.5, -53, 6, -52, 7, 10));
    raised(box(root, tiled(stone, 13, 12), -6.5, -64.5, 6.5, -51.5, 1.2, 17));
    const sun = new THREE.Mesh(new THREE.CircleGeometry(3.4, 40), new THREE.MeshStandardMaterial({ map: K.paint(256, sunStone), transparent: true, roughness: 0.9 }));
    sun.position.set(0, fy() + 14, -62.75);
    root.add(K.deco(sun));
    raised(box(root, stoneMat, -1.2, -61, 1.2, -58.6, 1.2, 10));
    const idol = mesh(root, new THREE.CylinderGeometry(0.5, 0.8, 1.6, 8), jade, 0, 12, -59.8);
    idol.scale.z = 0.7;
    mesh(root, new THREE.SphereGeometry(0.62, 12, 10), jade, 0, 13.3, -59.8);
    for (const x of [-4.5, 4.5]) {
        raised(box(root, stoneMat, x - 0.8, -50.4, x + 0.8, -48.8, 1.4, 10));
        flame(root, flames, x, 11.4, -49.6, 1.5);
    }

    /* The cave: in from the south-west, north along the wall, then east
       into the middle, knee-deep in water, a waterfall at the bend. */
    wall(root, stone, -64, -22, -58, 40, 18);
    wall(root, stone, -46, 0, -30, 40, 18);
    wall(root, stone, -58, -22, -30, -12, 18);
    raised(box(root, caveMat, -58, 0, -46, 40, 2, 14));
    raised(box(root, caveMat, -58, -12, -30, 0, 2, 14));
    panel(root, caveMat, -57.95, 7, 14, 52, 14, Math.PI / 2);
    panel(root, caveMat, -46.05, 7, 20, 40, 14, -Math.PI / 2);
    panel(root, caveMat, -44, 7, -11.95, 28, 14);
    const pool = K.surface(flowing, 1, 6, { roughness: 0.15, metalness: 0.3 });
    moving(panel(root, pool, -52, 0.05, 14, 8, 50, 0, true));
    moving(panel(root, K.surface(flowing, 4, 1, { roughness: 0.15, metalness: 0.3 }), -44, 0.05, -6, 28, 8, 0, true));
    panel(root, caveMat, -38, 7, -0.05, 16, 14, Math.PI);
    const fall = new THREE.MeshStandardMaterial({ map: flowing, transparent: true, opacity: 0.85, roughness: 0.1, emissive: 0x2a6a6a, emissiveIntensity: 0.4 });
    moving(panel(root, fall, -57.9, 7, -6, 10, 14, Math.PI / 2));
    const mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.GLOW, color: 0xcff5f0, transparent: true, opacity: 0.5, depthWrite: false }));
    mist.position.set(-55, fy() + 1.5, -6);
    mist.scale.set(10, 4, 1);
    root.add(mist);
    // Stepping stones, and glowing crystals for light.
    for (const [x, z] of [[-54, 30], [-50, 22], [-54, 12], [-50, 4]]) box(root, stoneMat, x - 1.4, z - 1.4, x + 1.4, z + 1.4, 1);
    const crystal = K.plain(0x6ff0e0, { emissive: 0x3fd8c8, emissiveIntensity: 1.2, flatShading: true });
    for (const [x, z, y] of [[-57.5, 26, 3], [-46.5, 8, 5], [-57.5, 2, 9], [-36, -1, 1], [-40, -11.5, 6]]) {
        const c = mesh(root, new THREE.OctahedronGeometry(0.9, 0), crystal, x, y, z);
        c.scale.y = 1.8;
    }
    box(root, stoneMat, -53, -6, -49, -2, 3);
    K.light(root, 'point', 0x5fe0d0, 70, [-52, fy() + 9, 18]);
    K.light(root, 'point', 0x5fe0d0, 70, [-46, fy() + 9, -6]);

    /* The middle: the plaza before the pyramid, a fallen stela or two. */
    for (const [x, z] of [[-20, 4], [21, -6]]) {
        box(root, tiled(mossy, 2, 6, 3), x - 1.2, z - 0.6, x + 1.2, z + 0.6, 6);
    }
    box(root, tiled(mossy, 7, 2, 3), 14, 10, 21, 12, 2.2);
    box(root, stoneMat, -8, 12, 8, 14, 3.4);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.5, 40), [
        K.plain(0x76755f),
        new THREE.MeshStandardMaterial({ map: K.paint(256, sunStone), roughness: 0.9 }),
        K.plain(0x76755f),
    ]);
    disc.position.set(-16, fy() + 0.25, 16);
    root.add(K.deco(disc));
    wall(root, mossy, 30, -22, 32, -2, 10, 0, 4);
    wall(root, mossy, 30, 10, 32, 24, 10, 0, 4);
    wall(root, mossy, -30, 24, -6, 26, 10, 0, 4);
    wall(root, mossy, 6, 24, 30, 26, 10, 0, 4);
    for (const x of [-7, 7]) {
        box(root, stoneMat, x - 1, 23.6, x + 1, 26.4, 11);
        flame(root, flames, x, 11.2, 25, 1.2);
    }

    /* East: the ball court, two long walls with a stone ring on each. */
    box(root, tiled(mossy, 34, 6, 4), 36, -16, 40, 20, 6);
    box(root, tiled(mossy, 34, 6, 4), 54, -16, 58, 20, 6);
    for (const x of [40.1, 53.9]) {
        const ring = mesh(root, new THREE.TorusGeometry(1.3, 0.35, 8, 24), stoneMat, x, 4.4, 2);
        ring.rotation.y = Math.PI / 2;
    }
    mesh(root, new THREE.SphereGeometry(0.7, 16, 12), K.plain(0x2a2320), 47, 0.7, 6);
    box(root, stoneMat, 45, -4, 49, -1, 2.4);

    /* B, north-east: a temple platform up its steps, and the jungle side
       starts behind it. */
    box(root, tiled(mossy, 24, 4, 4), 40, -50, 64, -30, 4);
    stairs(root, stoneMat, 46, -30, 54, -22, 4, 'z-');
    raised(box(root, stoneMat, 40, -50, 64, -49, 1.4, 4));
    raised(box(root, stoneMat, 48, -44, 52, -40, 1, 4));
    const skull = mesh(root, new THREE.SphereGeometry(1.2, 16, 12), K.plain(0xe8e2cf), 50, 6.2, -42);
    skull.scale.set(1, 0.9, 1.15);
    K.deco(box(root, gold, 49.2, -40.9, 49.8, -40.8, 0.4, 6.2));
    K.deco(box(root, gold, 50.2, -40.9, 50.8, -40.8, 0.4, 6.2));
    K.decal(root, K.sprayed('B', '#b8321f'), 7, 63.9, 10, -40, -Math.PI / 2);

    /* A, north-west: ruins, a colossal stone head, broken columns. */
    const head = (x, z, turn) => {
        box(root, stoneMat, x - 4, z - 4, x + 4, z + 4, 1);
        const face = mesh(root, K.UNIT_BALL, K.plain(0x6f705c, { flatShading: true }), x, 4.6, z, true);
        face.scale.set(3.6, 3.8, 3.4);
        const helmet = mesh(root, K.UNIT_BALL, K.plain(0x5d5f4c, { flatShading: true }), x, 6.4, z);
        helmet.scale.set(3.8, 2.4, 3.6);
        const fx = Math.sin(turn);
        const fz = Math.cos(turn);
        for (const s of [-1, 1]) {
            mesh(root, new THREE.SphereGeometry(0.55, 10, 8), K.plain(0x2d2e25), x + fx * 3.1 + fz * s * 1.2, 5.4, z + fz * 3.1 - fx * s * 1.2);
        }
        mesh(root, new THREE.BoxGeometry(2, 0.5, 0.6), K.plain(0x3d3e33), x + fx * 3.2, 3.2, z + fz * 3.2).rotation.y = turn;
    };
    head(-44, -44, Math.PI * 0.25);
    head(40, 40, -Math.PI * 0.75);
    for (const [x, z, h] of [[-54, -30, 8], [-40, -30, 5], [-30, -52, 9], [-54, -58, 4]]) {
        column(root, x, z, h, tiled(mossy, 3, h, 4), stoneMat);
    }
    box(root, tiled(mossy, 10, 2), -36, -60, -26, -58, 2.2);
    K.decal(root, K.sprayed('A', '#b8321f'), 7, -48, 10, -63.9);
    raised(box(root, stoneMat, -36, -40, -32, -36, 1.2));
    mesh(root, new THREE.CylinderGeometry(0.9, 0.5, 1.2, 10), gold, -34, 1.8, -38);

    /* South: a village of thatched huts, where the other side starts. */
    const wattle = K.plain(0x8a6a44);
    const straw = K.surface(K.paint(128, thatch), 3, 2);
    for (const [x, z] of [[-26, 50], [-4, 58], [22, 52], [44, 58]]) {
        mesh(root, new THREE.CylinderGeometry(3.2, 3.4, 5, 12), wattle, x, 2.5, z, true);
        mesh(root, new THREE.ConeGeometry(4.6, 4, 12), straw, x, 7, z);
    }
    box(root, stoneMat, 4, 44, 8, 47, 0.6);
    flame(root, flames, 6, 0.6, 45.5, 1.8);

    // Trees: a wall of them outside, a few in the open for cover.
    for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const r = 76 + (i % 3) * 8;
        K.tree(root, Math.cos(a) * r, Math.sin(a) * r, 16 + (i % 4) * 3, leaves);
    }
    for (const [x, z] of [[-20, 36], [30, 36], [-44, 50], [61, -12], [-50, -50]]) K.tree(root, x, z, 11, leaves);

    hideEggs(root, [[-46, -34], [-52, 18], [47, 12], [-14, 46], [34, -40], [24, 18], [60, 60], [-60, -60], [12, 36], [-20, -6]]);

    return {
        fog: [0xdfe6d4, 55, 190],
        halo: 0x2a2f1c,
        bounds: ARENA_BOUNDS,
        spawns: [
            [[-10, 44], [10, 42], [0, 50], [-36, 56], [32, 44]],
            [[48, -58], [56, -56], [40, -58], [30, -60], [58, -60]],
        ],
        update(now) {
            flicker(flames, now);
            for (const map of flows) map.offset.y = -(now / 1000) * 0.35;
        },
    };
}

// One side of a pyramid tier: a solid block you can stand on top of.
function stairsSide(root, mat, x0, z0, x1, z1, h) {
    K.flagWalkable(box(root, mat, x0, z0, x1, z1, h));
}

export const ARENAS = [
    { id: 'pharaoh', label: 'pharaoh', bounds: ARENA_BOUNDS, build: buildPharaoh },
    { id: 'frostbite', label: 'frostbite', bounds: ARENA_BOUNDS, build: buildFrostbite },
    { id: 'jungle', label: 'jungle', bounds: ARENA_BOUNDS, build: buildJungle },
];
