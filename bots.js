// Bots mode: the same guns, maps and settings as the aim trainer, but you walk
// the map (WASD, space to jump, shift to walk) and the targets are bots that
// walk it too and shoot back. aim.js owns the camera, the guns and the frame
// loop, and calls in here for movement, the bots, damage and the kill effects.
//
// Scale: the maps put the eye 8 units over the floor, so a person here is
// about 9 units tall and everything below is built to that.
import * as THREE from './vendor/three/three.module.min.js';

export const DIFFICULTIES = [
    { id: 'easy', label: 'easy', reaction: 950, accuracy: 0.14, fireGap: 380, speed: 9, turn: 2.2, headshot: 0.03 },
    { id: 'normal', label: 'normal', reaction: 600, accuracy: 0.24, fireGap: 240, speed: 11, turn: 3.4, headshot: 0.07 },
    { id: 'hard', label: 'hard', reaction: 360, accuracy: 0.36, fireGap: 160, speed: 13, turn: 5, headshot: 0.12 },
    { id: 'expert', label: 'expert', reaction: 200, accuracy: 0.5, fireGap: 120, speed: 15, turn: 7.5, headshot: 0.2 },
];

export const BOT_COUNTS = [
    { id: '3', label: '3' },
    { id: '5', label: '5' },
    { id: '8', label: '8' },
];

// Body damage per gun, roughly csgo's. Headshots are x4, legs x0.75, and the
// short-range guns lose damage over distance.
const DAMAGE = { plasma: 30, ar: 33, pistol: 30, deagle: 63, revolver: 86, awp: 115, shotgun: 26, smg: 26 };
const FALLOFF = { shotgun: [12, 45], smg: [40, 130], pistol: [40, 150] };
const MULTIPLIER = { head: 4, body: 1, legs: 0.75 };

const NAMES = ['Albert', 'Brian', 'Crasswater', 'Moe', 'Rock', 'Vitaliy', 'Shark', 'Wolf', 'Zach', 'Ringo', 'Kurt', 'Ivan', 'Pablo', 'Ulysses', 'Yanni', 'Otis'];

// Player movement, in map units and seconds.
const EYE = 8;
const RADIUS = 1.2;
const BOT_RADIUS = 1.1;
const RUN = 21;
const WALK = 10;
const GRAVITY = 62;
const JUMP = 22;
const STEP = 1.1;
const RESPAWN_MS = 3000;
const BOT_RESPAWN_MS = 4500;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const UP = new THREE.Vector3(0, 1, 0);

export function createBots(ctx) {
    const { scene, camera, floorY, envRoot, sound, glow, el } = ctx;

    const root = new THREE.Group();
    scene.add(root);

    let difficulty = DIFFICULTIES[1];
    let botCount = 5;
    let bounds = [-30, 30, -30, 30];
    let colliders = [];
    let colliderMeshes = [];
    let active = false;

    const player = {
        vel: new THREE.Vector3(),
        onGround: true,
        health: 100,
        alive: true,
        deadAt: 0,
        killer: null,
        stepAt: 0,
        bob: 0,
    };
    const stats = { kills: 0, deaths: 0, headshots: 0 };
    const bots = [];

    /* ---------- the map as something to walk into ---------- */

    // Anything standing on the floor and taller than a step blocks movement,
    // lines of sight and bullets. Read off the map's meshes, so every map works
    // without hand-placed collision.
    function rebuildColliders() {
        colliders = [];
        colliderMeshes = [];
        envRoot.updateMatrixWorld(true);
        const box = new THREE.Box3();
        envRoot.traverse((o) => {
            if (!o.isMesh) return;
            box.setFromObject(o);
            const h = box.max.y - box.min.y;
            const w = box.max.x - box.min.x;
            const d = box.max.z - box.min.z;
            if (h < 1 || w > 110 || d > 110) return;
            if (box.min.y > floorY + 5 || box.max.y < floorY + 1.2) return;
            colliders.push({ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, top: box.max.y });
            colliderMeshes.push(o);
        });
    }

    // Circle-versus-box in the ground plane. Things low enough to step onto
    // raise the ground instead of blocking; everything else pushes out.
    function collide(pos, vel, radius, feet) {
        let ground = floorY;
        for (const c of colliders) {
            const cx = clamp(pos.x, c.minX, c.maxX);
            const cz = clamp(pos.z, c.minZ, c.maxZ);
            let dx = pos.x - cx;
            let dz = pos.z - cz;
            const d2 = dx * dx + dz * dz;
            if (d2 >= radius * radius) continue;
            if (c.top <= feet + STEP) {
                // Standing on it counts only once the centre is over it.
                if (pos.x > c.minX && pos.x < c.maxX && pos.z > c.minZ && pos.z < c.maxZ) ground = Math.max(ground, c.top);
                continue;
            }
            if (d2 > 1e-6) {
                const d = Math.sqrt(d2);
                dx /= d;
                dz /= d;
                pos.x += dx * (radius - d);
                pos.z += dz * (radius - d);
            } else {
                // Centre inside the box: out along the shallowest side.
                const out = [pos.x - c.minX, c.maxX - pos.x, pos.z - c.minZ, c.maxZ - pos.z];
                const m = Math.min(...out);
                if (m === out[0]) { pos.x = c.minX - radius; dx = -1; dz = 0; }
                else if (m === out[1]) { pos.x = c.maxX + radius; dx = 1; dz = 0; }
                else if (m === out[2]) { pos.z = c.minZ - radius; dx = 0; dz = -1; }
                else { pos.z = c.maxZ + radius; dx = 0; dz = 1; }
            }
            if (vel) {
                const into = vel.x * dx + vel.z * dz;
                if (into < 0) {
                    vel.x -= into * dx;
                    vel.z -= into * dz;
                }
            }
        }
        pos.x = clamp(pos.x, bounds[0] + radius, bounds[1] - radius);
        pos.z = clamp(pos.z, bounds[2] + radius, bounds[3] - radius);
        return ground;
    }

    function blockedAt(x, z, radius) {
        if (x < bounds[0] + radius || x > bounds[1] - radius || z < bounds[2] + radius || z > bounds[3] - radius) return true;
        return colliders.some((c) => c.top > floorY + STEP
            && x + radius > c.minX && x - radius < c.maxX && z + radius > c.minZ && z - radius < c.maxZ);
    }

    // A free spot, as far from the given points as a few tries can find.
    function spawnPoint(awayFrom) {
        let best = null;
        let bestScore = -1;
        for (let i = 0; i < 40; i++) {
            const x = rand(bounds[0] + 3, bounds[1] - 3);
            const z = rand(bounds[2] + 3, bounds[3] - 3);
            if (blockedAt(x, z, 2)) continue;
            const score = Math.min(200, ...awayFrom.map((p) => Math.hypot(p.x - x, p.z - z)));
            if (score > bestScore) {
                bestScore = score;
                best = new THREE.Vector3(x, floorY, z);
            }
            if (score > 55) break;
        }
        return best || new THREE.Vector3(0, floorY, 0);
    }

    const sightRay = new THREE.Raycaster();
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();

    function lineOfSight(from, to) {
        tmpA.subVectors(to, from);
        const dist = tmpA.length();
        sightRay.set(from, tmpA.normalize());
        sightRay.far = dist;
        return sightRay.intersectObjects(colliderMeshes, false).length === 0;
    }

    /* ---------- the bots ---------- */

    const MAT = {
        jacket: new THREE.MeshStandardMaterial({ color: 0x5b5146, roughness: 0.9 }),
        pants: new THREE.MeshStandardMaterial({ color: 0x3a3833, roughness: 0.95 }),
        boots: new THREE.MeshStandardMaterial({ color: 0x1c1b19, roughness: 0.8 }),
        vest: new THREE.MeshStandardMaterial({ color: 0x5e5e3c, roughness: 0.9 }),
        mask: new THREE.MeshStandardMaterial({ color: 0x262626, roughness: 0.9 }),
        skin: new THREE.MeshStandardMaterial({ color: 0xc69474, roughness: 0.8 }),
        gloves: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 }),
        metal: new THREE.MeshStandardMaterial({ color: 0x2a2b2c, roughness: 0.5, metalness: 0.5 }),
        wood: new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 0.7 }),
    };

    function piece(parent, material, size, position, part, rotation) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
        mesh.position.set(position[0], position[1], position[2]);
        if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
        mesh.userData.part = part;
        parent.add(mesh);
        return mesh;
    }

    // A masked soldier with an AK, in the csgo terrorist palette: jacket, plate
    // carrier, balaclava. Jointed at the hips, knees, shoulders, elbows and
    // neck so it can walk and fall. Faces +Z.
    function buildBot() {
        const body = new THREE.Group();
        const hips = new THREE.Group();
        hips.position.y = 4.4;
        body.add(hips);

        const legs = [];
        for (const side of [-1, 1]) {
            const thigh = new THREE.Group();
            thigh.position.set(side * 0.45, 0, 0);
            piece(thigh, MAT.pants, [0.72, 2.3, 0.8], [0, -1.1, 0], 'legs');
            const knee = new THREE.Group();
            knee.position.y = -2.2;
            piece(knee, MAT.pants, [0.66, 2.1, 0.72], [0, -1.05, 0], 'legs');
            piece(knee, MAT.boots, [0.72, 0.45, 1.05], [0, -2.0, 0.15], 'legs');
            thigh.add(knee);
            hips.add(thigh);
            legs.push({ thigh, knee });
        }

        const spine = new THREE.Group();
        hips.add(spine);
        piece(spine, MAT.pants, [1.6, 0.8, 0.9], [0, 0.2, 0], 'body');
        piece(spine, MAT.jacket, [1.8, 2.6, 1.0], [0, 1.8, 0], 'body');
        piece(spine, MAT.vest, [1.9, 1.7, 1.12], [0, 2.0, 0.02], 'body');
        for (const x of [-0.55, 0, 0.55]) piece(spine, MAT.vest, [0.45, 0.5, 0.25], [x, 1.55, 0.65], 'body');

        const neck = new THREE.Group();
        neck.position.y = 3.1;
        spine.add(neck);
        piece(neck, MAT.skin, [0.5, 0.4, 0.5], [0, 0.2, 0], 'head');
        piece(neck, MAT.mask, [1.0, 1.15, 1.05], [0, 0.85, 0], 'head');
        piece(neck, MAT.skin, [1.02, 0.26, 0.2], [0, 0.95, 0.45], 'head');
        for (const x of [-0.22, 0.22]) piece(neck, MAT.mask, [0.14, 0.1, 0.05], [x, 0.95, 0.56], 'head');
        piece(neck, MAT.mask, [1.06, 0.32, 1.1], [0, 1.45, 0], 'head');

        const arms = [];
        for (const side of [-1, 1]) {
            const shoulder = new THREE.Group();
            shoulder.position.set(side * 1.12, 2.85, 0);
            piece(shoulder, MAT.jacket, [0.58, 1.6, 0.62], [0, -0.75, 0], 'body');
            const elbow = new THREE.Group();
            elbow.position.y = -1.5;
            piece(elbow, MAT.jacket, [0.52, 1.45, 0.56], [0, -0.7, 0], 'body');
            piece(elbow, MAT.gloves, [0.5, 0.45, 0.55], [0, -1.5, 0], 'body');
            shoulder.add(elbow);
            spine.add(shoulder);
            arms.push({ shoulder, elbow, side });
        }

        // The rifle, held across the chest.
        const gun = new THREE.Group();
        gun.position.set(0.35, 2.05, 1.25);
        piece(gun, MAT.metal, [0.28, 0.42, 2.6], [0, 0, 0.3], 'gun');
        piece(gun, MAT.wood, [0.32, 0.36, 0.9], [0, -0.05, 1.1], 'gun');
        piece(gun, MAT.wood, [0.26, 0.5, 1.0], [0, -0.1, -1.4], 'gun');
        piece(gun, MAT.metal, [0.22, 0.8, 0.35], [0, -0.55, 0.45], 'gun', [0.3, 0, 0]);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8), MAT.metal);
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
    function aimPose(bot) {
        const [left, right] = bot.rig.arms;
        left.shoulder.rotation.set(-1.35, 0.45, 0);
        left.elbow.rotation.set(-0.35, 0, 0);
        right.shoulder.rotation.set(-1.05, -0.2, 0);
        right.elbow.rotation.set(-0.7, 0, 0);
        bot.rig.neck.rotation.set(0, 0, 0);
        bot.rig.spine.rotation.set(0, 0, 0);
        bot.rig.hips.position.y = 4.4;
        for (const leg of bot.rig.legs) {
            leg.thigh.rotation.set(0, 0, 0);
            leg.knee.rotation.set(0, 0, 0);
        }
    }

    function makeBot(name) {
        const rig = buildBot();
        root.add(rig.body);
        const bot = {
            name,
            rig,
            pos: rig.body.position,
            vel: new THREE.Vector3(),
            heading: 0,
            health: 100,
            alive: true,
            state: 'roam',
            waypoint: null,
            nextThink: 0,
            sees: false,
            spottedAt: 0,
            lastSeen: 0,
            lastKnown: new THREE.Vector3(),
            nextShot: 0,
            burstLeft: 0,
            strafe: 0,
            strafeUntil: 0,
            stuckCheck: 0,
            stuckFrom: new THREE.Vector3(),
            phase: Math.random() * 6,
            flinchAt: 0,
            deadAt: 0,
            respawnAt: 0,
            fall: null,
            stepAt: 0,
        };
        aimPose(bot);
        return bot;
    }

    function spawnBot(bot) {
        const others = [camera.position, ...bots.filter((b) => b !== bot && b.alive).map((b) => b.pos)];
        bot.pos.copy(spawnPoint(others));
        bot.heading = Math.atan2(camera.position.x - bot.pos.x, camera.position.z - bot.pos.z) + rand(-1.2, 1.2);
        bot.health = 100;
        bot.alive = true;
        bot.state = 'roam';
        bot.waypoint = null;
        bot.fall = null;
        bot.sees = false;
        bot.burstLeft = 0;
        bot.rig.body.quaternion.identity();
        bot.rig.body.visible = true;
        // The dropped rifle goes back in its hands.
        if (bot.rig.gun.parent !== bot.rig.spine) bot.rig.spine.add(bot.rig.gun);
        bot.rig.gun.position.set(0.35, 2.05, 1.25);
        bot.rig.gun.rotation.set(0, 0, 0);
        aimPose(bot);
        bot.rig.body.rotation.y = bot.heading;
    }

    /* ---------- effects: blood, tracers, impacts, decals ---------- */

    const PARTICLES = 120;
    const particles = [];
    const particleGeometry = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    const bloodMat = new THREE.MeshBasicMaterial({ color: 0x7a0c0c });
    const dustMat = new THREE.MeshBasicMaterial({ color: 0x9a9384 });
    for (let i = 0; i < PARTICLES; i++) {
        const mesh = new THREE.Mesh(particleGeometry, bloodMat);
        mesh.visible = false;
        root.add(mesh);
        particles.push({ mesh, born: 0, v: new THREE.Vector3(), life: 0 });
    }
    let particleCursor = 0;

    function spray(at, dir, count, speed, material, spread = 0.9, life = 0.6) {
        for (let i = 0; i < count; i++) {
            const p = particles[particleCursor++ % PARTICLES];
            p.mesh.material = material;
            p.mesh.position.copy(at);
            p.mesh.visible = true;
            p.mesh.scale.setScalar(rand(0.6, 1.4));
            p.born = performance.now();
            p.life = life * rand(0.7, 1.2);
            p.v.set(dir.x + rand(-spread, spread), dir.y + rand(-spread * 0.5, spread), dir.z + rand(-spread, spread))
                .normalize().multiplyScalar(speed * rand(0.4, 1));
        }
    }

    // A mist that swells and fades: the csgo headshot puff.
    const mists = [];
    for (let i = 0; i < 6; i++) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0x8a1010, transparent: true, depthWrite: false }));
        sprite.visible = false;
        root.add(sprite);
        mists.push({ sprite, born: 0, size: 1 });
    }
    function mist(at, size) {
        const m = mists.find((x) => !x.born) || mists[0];
        m.sprite.position.copy(at);
        m.sprite.visible = true;
        m.born = performance.now();
        m.size = size;
    }

    const splatTexture = (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g = c.getContext('2d');
        g.fillStyle = 'rgba(95, 8, 8, 0.9)';
        for (let i = 0; i < 26; i++) {
            const r = i === 0 ? 30 : rand(3, 14);
            const a = Math.random() * Math.PI * 2;
            const d = i === 0 ? 0 : rand(10, 52);
            g.beginPath();
            g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, 0, Math.PI * 2);
            g.fill();
        }
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    })();
    const holeTexture = (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
        grad.addColorStop(0, 'rgba(10, 10, 10, 1)');
        grad.addColorStop(0.35, 'rgba(30, 28, 25, 0.9)');
        grad.addColorStop(0.6, 'rgba(60, 55, 48, 0.35)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    })();

    function decalPool(count, texture, size) {
        const material = new THREE.MeshBasicMaterial({
            map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
        });
        const geometry = new THREE.PlaneGeometry(size, size);
        const pool = [];
        for (let i = 0; i < count; i++) {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.visible = false;
            root.add(mesh);
            pool.push(mesh);
        }
        let cursor = 0;
        const place = (point, normal, scale = 1) => {
            const mesh = pool[cursor++ % count];
            mesh.visible = true;
            mesh.scale.setScalar(scale);
            mesh.position.copy(point).addScaledVector(normal, 0.04);
            mesh.lookAt(tmpB.copy(point).add(normal));
            mesh.rotateZ(Math.random() * Math.PI * 2);
        };
        place.clear = () => {
            for (const mesh of pool) mesh.visible = false;
        };
        return place;
    }
    const bloodDecal = decalPool(24, splatTexture, 3.2);
    const holeDecal = decalPool(60, holeTexture, 0.45);

    const normalOf = (hit) => {
        const n = hit.face ? hit.face.normal.clone() : UP.clone();
        return n.transformDirection(hit.object.matrixWorld);
    };

    // Blood thrown onto whatever is behind the hit: the wall if one is close,
    // otherwise the floor where the body lands.
    function splatter(point, dir) {
        sightRay.set(point, tmpA.copy(dir).setY(0).normalize());
        sightRay.far = 16;
        const wall = sightRay.intersectObjects(colliderMeshes, false)[0];
        if (wall) bloodDecal(wall.point, normalOf(wall), rand(0.8, 1.3));
    }

    const tracers = [];
    for (let i = 0; i < 12; i++) {
        const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
            color: 0xffe2a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        line.visible = false;
        line.frustumCulled = false;
        root.add(line);
        tracers.push({ line, born: 0 });
    }
    function tracer(from, to) {
        const t = tracers.find((x) => !x.born) || tracers[0];
        const p = t.line.geometry.attributes.position;
        p.setXYZ(0, from.x, from.y, from.z);
        p.setXYZ(1, to.x, to.y, to.z);
        p.needsUpdate = true;
        t.line.visible = true;
        t.born = performance.now();
    }

    const flashes = [];
    for (let i = 0; i < 8; i++) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        sprite.scale.setScalar(1.6);
        sprite.visible = false;
        root.add(sprite);
        flashes.push({ sprite, born: 0 });
    }
    function muzzleFlash(at) {
        const f = flashes.find((x) => !x.born) || flashes[0];
        f.sprite.position.copy(at);
        f.sprite.visible = true;
        f.born = performance.now();
    }

    /* ---------- sound ---------- */

    const near = (dist, reach = 140) => clamp(1 - dist / reach, 0.06, 1);
    function botShotSound(dist) {
        const v = near(dist);
        sound.burst({ cutoff: 5200 - Math.min(dist, 120) * 25, decay: 0.2, volume: 0.5 * v });
        sound.tone({ from: 130, to: 45, decay: 0.11, volume: 0.4 * v });
    }
    function footstep(dist, loud = 1) {
        sound.burst({ cutoff: 700, decay: 0.07, volume: 0.16 * loud * near(dist, 70) });
    }
    const dink = () => {
        sound.tone({ from: 2700, to: 2150, decay: 0.2, volume: 0.22, type: 'triangle' });
        sound.burst({ cutoff: 7000, type: 'highpass', decay: 0.05, volume: 0.18 });
    };
    const thud = (dist) => sound.tone({ at: 0.45, from: 95, to: 38, decay: 0.2, volume: 0.35 * near(dist, 90) });
    const hurt = () => {
        sound.tone({ from: 190, to: 80, decay: 0.12, volume: 0.35 });
        sound.burst({ cutoff: 900, decay: 0.08, volume: 0.25 });
    };

    /* ---------- the kill feed ---------- */

    const HEADSHOT_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-label="headshot"><circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><path d="M8 0.5v3M8 12.5v3M0.5 8h3M12.5 8h3" stroke="currentColor" stroke-width="1.6"/></svg>';

    function feed(killer, weapon, victim, headshot, mine) {
        const row = document.createElement('div');
        row.className = `kf-row${mine ? ' is-mine' : ''}`;
        const k = document.createElement('span');
        k.className = killer === 'you' ? 'kf-ct' : 'kf-t';
        k.textContent = killer;
        const w = document.createElement('span');
        w.className = 'kf-gun';
        w.textContent = weapon;
        const v = document.createElement('span');
        v.className = victim === 'you' ? 'kf-ct' : 'kf-t';
        v.textContent = victim;
        row.append(k, w);
        if (headshot) {
            const hs = document.createElement('span');
            hs.className = 'kf-hs';
            hs.innerHTML = HEADSHOT_ICON;
            row.append(hs);
        }
        row.append(v);
        el.killfeed.prepend(row);
        while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
        setTimeout(() => row.classList.add('is-leaving'), 5000);
        setTimeout(() => row.remove(), 5600);
    }

    /* ---------- damage ---------- */

    let vignette = 0;

    function hurtPlayer(amount, bot, headshot) {
        if (!player.alive) return;
        player.health = Math.max(0, player.health - amount);
        vignette = Math.min(0.75, vignette + 0.35 + amount / 200);
        hurt();
        updateHealth();
        if (player.health > 0) return;

        player.alive = false;
        player.deadAt = performance.now();
        player.killer = bot.name;
        stats.deaths++;
        feed(bot.name, 'ak-47', 'you', headshot, false);
        el.death.textContent = `killed by ${bot.name} · ak-47${headshot ? ' · headshot' : ''}`;
        el.death.hidden = false;
        ctx.onDeath?.();
    }

    function updateHealth() {
        el.health.textContent = String(Math.ceil(player.health));
        el.healthBox.classList.toggle('is-low', player.health <= 30);
    }

    function damageFor(weaponId, part, dist) {
        let dmg = DAMAGE[weaponId] ?? 30;
        const fall = FALLOFF[weaponId];
        if (fall) dmg *= clamp(1 - (dist - fall[0]) / (fall[1] - fall[0]) * 0.6, 0.4, 1);
        return dmg * (MULTIPLIER[part] ?? 1);
    }

    function killBot(bot, point, dir, headshot, weaponLabel) {
        bot.alive = false;
        bot.deadAt = performance.now();
        bot.respawnAt = bot.deadAt + BOT_RESPAWN_MS;
        const flat = tmpA.copy(dir).setY(0);
        if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
        flat.normalize();
        bot.fall = {
            dir: flat.clone(),
            axis: new THREE.Vector3(flat.z, 0, -flat.x),
            heading: new THREE.Quaternion().setFromAxisAngle(UP, bot.heading),
            from: bot.pos.clone(),
            headshot,
            arms: bot.rig.arms.map(() => [rand(-2.8, -1.6), rand(-0.9, 0.9)]),
            gunVel: new THREE.Vector3(flat.x * 4 + rand(-2, 2), 5, flat.z * 4 + rand(-2, 2)),
            gunSpin: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)),
            gunLanded: false,
        };
        // The rifle leaves its hands and drops on its own. attach() keeps it
        // exactly where it was in the world as it changes parent.
        root.attach(bot.rig.gun);

        stats.kills++;
        if (headshot) {
            stats.headshots++;
            dink();
            mist(point, 2.4);
            spray(point, dir, 26, 14, bloodMat, 0.8);
        } else {
            spray(point, dir, 16, 11, bloodMat, 0.8);
        }
        splatter(point, dir);
        thud(point.distanceTo(camera.position));
        feed('you', weaponLabel, bot.name, headshot, true);
        ctx.onKill?.({ headshot, name: bot.name });
    }

    const shotRay = new THREE.Raycaster();

    // One bullet (or one pellet) from the player. Walls stop it; the nearest
    // bot it reaches first takes the damage. Returns what it hit.
    function shoot(ray, weaponId, weaponLabel) {
        // Hit-test against where the bots are now, not where the last frame
        // drew them.
        root.updateMatrixWorld(true);
        shotRay.ray.copy(ray);
        shotRay.far = 400;
        const wall = shotRay.intersectObjects(colliderMeshes, false)[0];
        let best = null;
        for (const bot of bots) {
            if (!bot.alive) continue;
            const hit = shotRay.intersectObjects(bot.rig.hitMeshes, false)[0];
            if (hit && (!best || hit.distance < best.hit.distance)) best = { bot, hit };
        }
        if (best && (!wall || best.hit.distance < wall.distance)) {
            const { bot, hit } = best;
            const part = hit.object.userData.part;
            const headshot = part === 'head';
            const dmg = damageFor(weaponId, part, hit.distance);
            bot.health -= dmg;
            if (bot.health <= 0) {
                killBot(bot, hit.point, ray.direction, headshot, weaponLabel);
                return { hit: true, kill: true, headshot };
            }
            // Hurt but standing: a flinch, a little blood, and it knows where
            // you are now.
            bot.flinchAt = performance.now();
            spray(hit.point, ray.direction, 7, 8, bloodMat, 0.7, 0.45);
            if (headshot) dink();
            bot.state = 'fight';
            bot.spottedAt = Math.min(bot.spottedAt || Infinity, performance.now() - difficulty.reaction * 0.5);
            bot.lastSeen = performance.now();
            return { hit: true, kill: false, headshot };
        }
        if (wall) {
            const n = normalOf(wall);
            holeDecal(wall.point, n, rand(0.8, 1.2));
            spray(wall.point, n, 5, 5, dustMat, 1, 0.4);
        }
        return { hit: false };
    }

    /* ---------- the bots' side of the fight ---------- */

    const botEye = new THREE.Vector3();
    const muzzleWorld = new THREE.Vector3();
    const aimAt = new THREE.Vector3();

    function botFire(bot, now, dist) {
        bot.rig.muzzle.getWorldPosition(muzzleWorld);
        muzzleFlash(muzzleWorld);
        botShotSound(dist);

        const moving = Math.hypot(player.vel.x, player.vel.z) > WALK + 1;
        const firstShots = now - bot.spottedAt < difficulty.reaction + 250 ? 0.6 : 1;
        const p = difficulty.accuracy * clamp(1.15 - dist / 120, 0.3, 1) * (moving ? 0.7 : 1) * (player.onGround ? 1 : 0.6) * firstShots;
        aimAt.copy(camera.position);
        if (Math.random() < p) {
            const headshot = Math.random() < difficulty.headshot;
            aimAt.y -= headshot ? 0 : 2;
            tracer(muzzleWorld, aimAt);
            hurtPlayer(headshot ? 111 : rand(22, 31), bot, headshot);
        } else {
            // A miss goes past you: somewhere around, not through.
            aimAt.x += rand(-2.5, 2.5);
            aimAt.y += rand(-1.5, 2);
            aimAt.z += rand(-2.5, 2.5);
            tracer(muzzleWorld, aimAt);
        }
    }

    // Somewhere to walk to. Half the time it is roughly where you are, so on a
    // big map the bots come looking instead of wandering the far corners.
    function newWaypoint() {
        const hunt = player.alive && Math.random() < 0.5;
        for (let i = 0; i < 20; i++) {
            const x = hunt ? camera.position.x + rand(-25, 25) : rand(bounds[0] + 3, bounds[1] - 3);
            const z = hunt ? camera.position.z + rand(-25, 25) : rand(bounds[2] + 3, bounds[3] - 3);
            if (!blockedAt(x, z, 1.6)) return new THREE.Vector3(x, floorY, z);
        }
        return new THREE.Vector3(0, floorY, 0);
    }

    function turnToward(bot, target, rate, dt) {
        let diff = target - bot.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        bot.heading += clamp(diff, -rate * dt, rate * dt);
        return Math.abs(diff);
    }

    function updateBot(bot, now, dt) {
        const rig = bot.rig;
        if (!bot.alive) {
            ragdoll(bot, now, dt);
            if (now > bot.respawnAt) spawnBot(bot);
            return;
        }

        botEye.set(bot.pos.x, bot.pos.y + EYE, bot.pos.z);
        const toX = camera.position.x - bot.pos.x;
        const toZ = camera.position.z - bot.pos.z;
        const dist = Math.hypot(toX, toZ);

        if (now >= bot.nextThink) {
            bot.nextThink = now + rand(110, 190);
            const facing = Math.abs(Math.atan2(Math.sin(Math.atan2(toX, toZ) - bot.heading), Math.cos(Math.atan2(toX, toZ) - bot.heading)));
            const aware = bot.state === 'fight' || facing < 1.4 || dist < 12;
            bot.sees = player.alive && dist < 120 && aware && lineOfSight(botEye, camera.position);
            if (bot.sees) {
                if (bot.state !== 'fight') {
                    bot.state = 'fight';
                    bot.spottedAt = now;
                }
                bot.lastSeen = now;
                bot.lastKnown.copy(camera.position);
            } else if (bot.state === 'fight' && now - bot.lastSeen > 1800) {
                // Lost you: go and look where you were last seen.
                bot.state = 'roam';
                bot.waypoint = new THREE.Vector3(bot.lastKnown.x, floorY, bot.lastKnown.z);
            }
        }

        let moveX = 0;
        let moveZ = 0;
        let speed = 0;
        if (bot.state === 'fight') {
            turnToward(bot, Math.atan2(toX, toZ), difficulty.turn, dt);
            if (now > bot.strafeUntil) {
                bot.strafe = [-1, 0, 1][Math.floor(Math.random() * 3)];
                bot.strafeUntil = now + rand(500, 1300);
            }
            const rightX = Math.cos(bot.heading);
            const rightZ = -Math.sin(bot.heading);
            moveX = rightX * bot.strafe;
            moveZ = rightZ * bot.strafe;
            if (dist > 55) {
                moveX += Math.sin(bot.heading);
                moveZ += Math.cos(bot.heading);
            }
            speed = difficulty.speed * 0.6;

            const onTarget = Math.abs(Math.atan2(Math.sin(Math.atan2(toX, toZ) - bot.heading), Math.cos(Math.atan2(toX, toZ) - bot.heading))) < 0.14;
            if (bot.sees && player.alive && onTarget && now - bot.spottedAt > difficulty.reaction && now >= bot.nextShot) {
                botFire(bot, now, Math.hypot(toX, toZ, camera.position.y - botEye.y));
                if (--bot.burstLeft <= 0) {
                    bot.burstLeft = 3 + Math.floor(Math.random() * 3);
                    bot.nextShot = now + rand(380, 720);
                } else {
                    bot.nextShot = now + difficulty.fireGap * rand(0.8, 1.3);
                }
            }
        } else {
            if (!bot.waypoint || Math.hypot(bot.waypoint.x - bot.pos.x, bot.waypoint.z - bot.pos.z) < 3) bot.waypoint = newWaypoint(bot);
            const wx = bot.waypoint.x - bot.pos.x;
            const wz = bot.waypoint.z - bot.pos.z;
            turnToward(bot, Math.atan2(wx, wz), 4, dt);
            moveX = Math.sin(bot.heading);
            moveZ = Math.cos(bot.heading);
            speed = difficulty.speed * 0.75;
            // Wedged against something: pick somewhere else.
            if (now > bot.stuckCheck) {
                if (bot.pos.distanceTo(bot.stuckFrom) < 1.5) bot.waypoint = newWaypoint(bot);
                bot.stuckFrom.copy(bot.pos);
                bot.stuckCheck = now + 1200;
            }
        }

        const len = Math.hypot(moveX, moveZ);
        if (len > 0) {
            bot.vel.x = (moveX / len) * speed;
            bot.vel.z = (moveZ / len) * speed;
        } else {
            bot.vel.x = 0;
            bot.vel.z = 0;
        }
        bot.pos.x += bot.vel.x * dt;
        bot.pos.z += bot.vel.z * dt;
        const ground = collide(bot.pos, bot.vel, BOT_RADIUS, bot.pos.y);
        bot.pos.y += (ground - bot.pos.y) * Math.min(1, dt * 12);
        rig.body.rotation.y = bot.heading;

        // Walk cycle: legs swing opposite, knees bend on the back swing.
        const moving = Math.hypot(bot.vel.x, bot.vel.z);
        bot.phase += dt * moving * 0.55;
        const swing = Math.min(1, moving / 8);
        rig.legs[0].thigh.rotation.x = -Math.sin(bot.phase) * 0.6 * swing;
        rig.legs[1].thigh.rotation.x = Math.sin(bot.phase) * 0.6 * swing;
        rig.legs[0].knee.rotation.x = Math.max(0, Math.sin(bot.phase + 1.6)) * 0.9 * swing;
        rig.legs[1].knee.rotation.x = Math.max(0, -Math.sin(bot.phase + 1.6)) * 0.9 * swing;
        rig.hips.position.y = 4.4 + Math.abs(Math.cos(bot.phase)) * 0.12 * swing;
        const flinch = bot.flinchAt ? Math.exp(-(now - bot.flinchAt) / 90) : 0;
        rig.spine.rotation.x = -flinch * 0.35 + Math.sin(now / 900 + bot.phase) * 0.02;

        if (swing > 0.3 && Math.sin(bot.phase) * Math.sin(bot.phase - dt * moving * 0.55) < 0 && now > bot.stepAt) {
            bot.stepAt = now + 120;
            footstep(dist, 0.9);
        }
    }

    // csgo bodies go limp and fall with the shot: knees buckle first, then the
    // whole body topples away from the shooter, arms flung out, head lolling
    // (snapped back on a headshot), with a small bounce as it lands. The rifle
    // clatters down on its own. After a few seconds the body sinks away.
    function ragdoll(bot, now, dt) {
        const f = bot.fall;
        const rig = bot.rig;
        const t = (now - bot.deadAt) / 1000;

        const buckle = easeOut(t / 0.2);
        for (const leg of rig.legs) {
            leg.thigh.rotation.x = -0.9 * buckle;
            leg.knee.rotation.x = 1.5 * buckle;
        }
        rig.hips.position.y = 4.4 - 1.3 * buckle;
        rig.spine.rotation.x = 0.35 * buckle;

        const tt = Math.max(0, t - 0.06);
        const LIE = 1.5;
        let angle = 6 * tt * tt;
        if (angle >= LIE) {
            const since = tt - Math.sqrt(LIE / 6);
            angle = LIE - 0.14 * Math.exp(-since * 8) * Math.abs(Math.sin(since * 16));
        }
        rig.body.quaternion.setFromAxisAngle(f.axis, angle).multiply(f.heading);
        const slide = easeOut(t / 0.55) * 1.8;
        const sink = t > 3.6 ? (t - 3.6) * 2.2 : 0;
        rig.body.position.set(f.from.x + f.dir.x * slide, f.from.y + 0.5 * Math.sin(angle) - sink, f.from.z + f.dir.z * slide);

        rig.arms.forEach((arm, i) => {
            const k = easeOut(t / 0.35);
            arm.shoulder.rotation.x = -1.2 + (f.arms[i][0] + 1.2) * k;
            arm.shoulder.rotation.z = f.arms[i][1] * k * arm.side;
            arm.elbow.rotation.x = -0.6 + 0.5 * k;
        });
        const snap = f.headshot ? -0.9 * easeOut(t / 0.08) + 0.5 * easeOut((t - 0.08) / 0.5) : 0.4 * easeOut(t / 0.4);
        rig.neck.rotation.set(snap, 0, 0.3 * easeOut(t / 0.5));

        // The dropped rifle: thrown, spinning, then lying still on the floor.
        const gun = rig.gun;
        if (!f.gunLanded) {
            f.gunVel.y -= GRAVITY * 0.6 * dt;
            gun.position.addScaledVector(f.gunVel, dt);
            gun.rotation.x += f.gunSpin.x * dt;
            gun.rotation.y += f.gunSpin.y * dt;
            gun.rotation.z += f.gunSpin.z * dt;
            if (gun.position.y < floorY + 0.25) {
                gun.position.y = floorY + 0.25;
                gun.rotation.set(0, gun.rotation.y, Math.PI / 2);
                f.gunLanded = true;
                sound.burst({ cutoff: 3000, type: 'bandpass', q: 3, decay: 0.08, volume: 0.2 * near(gun.position.distanceTo(camera.position), 80) });
            }
        }
        if (sink) gun.position.y = Math.max(floorY - 2, gun.position.y - dt * 2.2);

        // One pool of blood where the body comes to rest.
        if (!f.pooled && t > 0.6) {
            f.pooled = true;
            bloodDecal(tmpB.set(rig.body.position.x + f.dir.x * 3, floorY, rig.body.position.z + f.dir.z * 3), UP, rand(1, 1.5));
        }
        if (t > 4.4) rig.body.visible = false;
    }

    /* ---------- the player ---------- */

    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const wish = new THREE.Vector3();

    function movePlayer(now, dt, input) {
        const keys = input.keys;
        forward.set(-Math.sin(input.yaw), 0, -Math.cos(input.yaw));
        right.set(Math.cos(input.yaw), 0, -Math.sin(input.yaw));
        wish.set(0, 0, 0)
            .addScaledVector(forward, (keys.forward ? 1 : 0) - (keys.back ? 1 : 0))
            .addScaledVector(right, (keys.right ? 1 : 0) - (keys.left ? 1 : 0));
        if (wish.lengthSq() > 0) wish.normalize();
        const top = keys.walk ? WALK : RUN;

        // Quick to get going and to stop on the ground, sluggish in the air.
        const grip = player.onGround ? 12 : 1.8;
        const k = Math.min(1, grip * dt);
        player.vel.x += (wish.x * top - player.vel.x) * k;
        player.vel.z += (wish.z * top - player.vel.z) * k;
        if (keys.jump && player.onGround) {
            player.vel.y = JUMP;
            player.onGround = false;
        }
        player.vel.y -= GRAVITY * dt;

        const pos = camera.position;
        pos.x += player.vel.x * dt;
        pos.z += player.vel.z * dt;
        pos.y += player.vel.y * dt;

        const feet = pos.y - EYE;
        const ground = collide(pos, player.vel, RADIUS, feet);
        // Bots are solid too.
        for (const bot of bots) {
            if (!bot.alive) continue;
            const dx = pos.x - bot.pos.x;
            const dz = pos.z - bot.pos.z;
            const d = Math.hypot(dx, dz);
            const min = RADIUS + BOT_RADIUS;
            if (d < min && d > 1e-4) {
                pos.x += (dx / d) * (min - d);
                pos.z += (dz / d) * (min - d);
            }
        }
        if (pos.y - EYE <= ground) {
            pos.y = ground + EYE;
            player.vel.y = 0;
            player.onGround = true;
        } else if (pos.y - EYE > ground + 0.05) {
            player.onGround = false;
        }

        // Footsteps when running, the way csgo gives you away; shift walks
        // quietly.
        const speed = Math.hypot(player.vel.x, player.vel.z);
        player.bob += dt * speed * 0.55;
        if (player.onGround && speed > WALK + 2 && now > player.stepAt) {
            player.stepAt = now + 330;
            footstep(0, 0.7);
        }
    }

    function respawnPlayer() {
        const spot = spawnPoint(bots.filter((b) => b.alive).map((b) => b.pos));
        camera.position.set(spot.x, floorY + EYE, spot.z);
        camera.rotation.z = 0;
        player.vel.set(0, 0, 0);
        player.health = 100;
        player.alive = true;
        player.onGround = true;
        el.death.hidden = true;
        updateHealth();
        ctx.onRespawn?.();
    }

    /* ---------- per frame ---------- */

    function update(now, dt, input) {
        if (!active) return;

        if (player.alive) {
            movePlayer(now, dt, input);
        } else {
            // Dead: the view drops to the floor and tips over, then respawns.
            const t = (now - player.deadAt) / 1000;
            camera.position.y += (floorY + 2 - camera.position.y) * Math.min(1, dt * 6);
            camera.rotation.z = -0.5 * easeOut(t / 0.6);
            if (now - player.deadAt > RESPAWN_MS) respawnPlayer();
        }

        for (const bot of bots) updateBot(bot, now, dt);

        // Bots keep out of each other.
        for (let i = 0; i < bots.length; i++) {
            for (let j = i + 1; j < bots.length; j++) {
                const a = bots[i];
                const b = bots[j];
                if (!a.alive || !b.alive) continue;
                const dx = a.pos.x - b.pos.x;
                const dz = a.pos.z - b.pos.z;
                const d = Math.hypot(dx, dz);
                if (d < BOT_RADIUS * 2 && d > 1e-4) {
                    const push = (BOT_RADIUS * 2 - d) / 2;
                    a.pos.x += (dx / d) * push;
                    a.pos.z += (dz / d) * push;
                    b.pos.x -= (dx / d) * push;
                    b.pos.z -= (dz / d) * push;
                }
            }
        }

        for (const p of particles) {
            if (!p.born) continue;
            const age = (now - p.born) / 1000;
            if (age > p.life) {
                p.born = 0;
                p.mesh.visible = false;
                continue;
            }
            p.v.y -= 30 * dt;
            p.mesh.position.addScaledVector(p.v, dt);
            if (p.mesh.position.y < floorY + 0.05) {
                p.mesh.position.y = floorY + 0.05;
                p.v.set(0, 0, 0);
            }
        }
        for (const m of mists) {
            if (!m.born) continue;
            const t = (now - m.born) / 280;
            if (t >= 1) {
                m.born = 0;
                m.sprite.visible = false;
                continue;
            }
            m.sprite.scale.setScalar(m.size * (0.5 + t));
            m.sprite.material.opacity = 0.8 * (1 - t);
        }
        for (const t of tracers) {
            if (!t.born) continue;
            const age = (now - t.born) / 90;
            if (age >= 1) {
                t.born = 0;
                t.line.visible = false;
                continue;
            }
            t.line.material.opacity = 1 - age;
        }
        for (const f of flashes) {
            if (!f.born) continue;
            if (now - f.born > 60) {
                f.born = 0;
                f.sprite.visible = false;
            }
        }

        vignette = Math.max(0, vignette - dt * 1.2);
        el.damage.style.opacity = String(vignette);
    }

    /* ---------- lifecycle ---------- */

    function clearEffects() {
        for (const p of particles) {
            p.born = 0;
            p.mesh.visible = false;
        }
        for (const m of mists) {
            m.born = 0;
            m.sprite.visible = false;
        }
        for (const f of flashes) {
            f.born = 0;
            f.sprite.visible = false;
        }
        for (const t of tracers) {
            t.born = 0;
            t.line.visible = false;
        }
        bloodDecal.clear();
        holeDecal.clear();
        el.killfeed.replaceChildren();
        vignette = 0;
        el.damage.style.opacity = '0';
    }

    function start() {
        rebuildColliders();
        clearEffects();
        removeBots();
        stats.kills = 0;
        stats.deaths = 0;
        stats.headshots = 0;
        active = true;

        const names = [...NAMES].sort(() => Math.random() - 0.5);
        const spot = spawnPoint([]);
        camera.position.set(spot.x, floorY + EYE, spot.z);
        for (let i = 0; i < botCount; i++) {
            const bot = makeBot(names[i % names.length]);
            bots.push(bot);
            spawnBot(bot);
        }
        player.vel.set(0, 0, 0);
        player.health = 100;
        player.alive = true;
        player.onGround = true;
        el.death.hidden = true;
        el.healthBox.hidden = false;
        updateHealth();
    }

    function removeBots() {
        for (const bot of bots) {
            root.remove(bot.rig.body);
            bot.rig.gun.parent?.remove(bot.rig.gun);
        }
        bots.length = 0;
    }

    function stop() {
        active = false;
        removeBots();
        clearEffects();
        camera.position.set(0, 0, 0);
        camera.rotation.z = 0;
        el.death.hidden = true;
        el.healthBox.hidden = true;
    }

    return {
        start,
        stop,
        update,
        shoot,
        rebuildColliders,
        stats,
        setDifficulty(id) {
            difficulty = DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[1];
        },
        setCount(n) {
            botCount = n;
        },
        setBounds(b) {
            bounds = b;
        },
        get active() {
            return active;
        },
        get alive() {
            return player.alive;
        },
        get speed() {
            return Math.hypot(player.vel.x, player.vel.z);
        },
        get airborne() {
            return !player.onGround;
        },
        get bobPhase() {
            return player.bob;
        },
        difficulty: () => difficulty,
    };
}
