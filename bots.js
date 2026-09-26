// Bots mode: the same guns, maps and settings as the aim trainer, but you walk
// the map (WASD, space to jump, shift to walk) and the targets are bots that
// walk it too and shoot back. aim.js owns the camera, the guns and the frame
// loop, and calls in here for movement, the bots, damage and the kill effects.
//
// Scale: the maps put the eye 8 units over the floor, so a person here is
// about 9 units tall and everything below is built to that.
import * as THREE from './vendor/three/three.module.min.js';
import { buildSoldier, aimPose, disposeSoldier } from './soldier.js';

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
const DAMAGE = { plasma: 30, ar: 33, ak: 36, pistol: 30, deagle: 63, revolver: 86, awp: 115, shotgun: 26, smg: 26 };
const FALLOFF = { shotgun: [12, 45], smg: [40, 130], pistol: [40, 150] };
const MULTIPLIER = { head: 4, body: 1, legs: 0.75 };

const NAMES = ['Albert', 'Brian', 'Crasswater', 'Moe', 'Rock', 'Vitaliy', 'Shark', 'Wolf', 'Zach', 'Ringo', 'Kurt', 'Ivan', 'Pablo', 'Ulysses', 'Yanni', 'Otis'];

// Player movement, in map units and seconds.
const EYE = 8;
// Crouched (ctrl or c), as in csgo: lower, slower, silent, harder to hit.
const EYE_CROUCH = 5.2;
const CROUCH_SPEED = 7;
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

// Anything standing on the floor and taller than a step blocks movement, lines
// of sight and bullets, as a box. Read off the map's meshes, so every map works
// without hand-placed collision. aim.js calls this before it merges the map's
// meshes for drawing, since after that there are no separate pieces left to
// read; from then on collision only ever deals in these boxes.
export function collectColliders(envRoot, floorY) {
    const colliders = [];
    envRoot.updateMatrixWorld(true);
    const box = new THREE.Box3();
    envRoot.traverse((o) => {
        if (!o.isMesh || o.userData.noCollide) return;
        let up = o;
        while (up) {
            if (up.userData.noCollide) return;
            up = up.parent;
        }
        box.setFromObject(o);
        const h = box.max.y - box.min.y;
        const w = box.max.x - box.min.x;
        const d = box.max.z - box.min.z;
        // Raised floors, roofs and landings are flagged walkable: they count
        // however high they are, and however thin.
        const walkable = o.userData.walkable;
        if (!walkable && (h < 1 || w > 110 || d > 110)) return;
        if (!walkable && (box.min.y > floorY + 5 || box.max.y < floorY + 1.2)) return;
        colliders.push({
            minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z,
            minY: box.min.y, top: box.max.y,
        });
    });
    return colliders;
}
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
    let active = false;
    // The menu's demo: a ghost player who cannot be hurt and scores nothing.
    let demoMode = false;

    const player = {
        vel: new THREE.Vector3(),
        onGround: true,
        health: 100,
        alive: true,
        deadAt: 0,
        killer: null,
        stepAt: 0,
        bob: 0,
        eye: EYE,
    };
    const stats = { kills: 0, deaths: 0, headshots: 0 };
    const bots = [];

    /* ---------- the map as something to walk into ---------- */

    function setColliders(list) {
        colliders = list || [];
    }

    // The nearest collision box a ray reaches within `far`, with the point and
    // the face normal where it went in. Boxes are few enough to just test all.
    const worldBox = new THREE.Box3();
    const boxPoint = new THREE.Vector3();
    function rayHitsWorld(ray, far) {
        let best = null;
        for (const c of colliders) {
            worldBox.min.set(c.minX, c.minY, c.minZ);
            worldBox.max.set(c.maxX, c.top, c.maxZ);
            if (!ray.intersectBox(worldBox, boxPoint)) continue;
            const d = boxPoint.distanceTo(ray.origin);
            if (d < 1e-3 || d > far || (best && d >= best.distance)) continue;
            best = { distance: d, point: boxPoint.clone(), c };
        }
        if (best) best.normal = boxNormal(best.point, best.c);
        return best;
    }

    // Which face of the box a point on it is on.
    function boxNormal(p, c) {
        const faces = [
            [Math.abs(p.x - c.minX), -1, 0, 0], [Math.abs(p.x - c.maxX), 1, 0, 0],
            [Math.abs(p.y - c.minY), 0, -1, 0], [Math.abs(p.y - c.top), 0, 1, 0],
            [Math.abs(p.z - c.minZ), 0, 0, -1], [Math.abs(p.z - c.maxZ), 0, 0, 1],
        ];
        faces.sort((a, b) => a[0] - b[0]);
        return new THREE.Vector3(faces[0][1], faces[0][2], faces[0][3]);
    }

    // Circle-versus-box in the ground plane. Things low enough to step onto
    // raise the ground instead of blocking; everything else pushes out.
    function collide(pos, vel, radius, feet) {
        let ground = floorY;
        for (const c of colliders) {
            // Entirely over your head (a roof, a landing above): walk under it.
            if (c.minY > feet + EYE + 0.6) continue;
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
        return colliders.some((c) => c.top > floorY + STEP && c.minY < floorY + EYE
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

    const sightRay = new THREE.Ray();
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();

    function lineOfSight(from, to) {
        tmpA.subVectors(to, from);
        const dist = tmpA.length();
        sightRay.set(from, tmpA.normalize());
        return !rayHitsWorld(sightRay, dist);
    }

    /* ---------- the bots ---------- */

    function makeBot(name) {
        const rig = buildSoldier();
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
        aimPose(bot.rig);
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
        aimPose(bot.rig);
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
        rec({ type: 'spray', at: at.clone(), dir: dir.clone(), count, speed, material, spread, life });
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
        rec({ type: 'mist', at: at.clone(), size });
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

    // Blood thrown onto whatever is behind the hit: the wall if one is close,
    // otherwise the floor where the body lands.
    function splatter(point, dir) {
        sightRay.set(point, tmpA.copy(dir).setY(0).normalize());
        const wall = rayHitsWorld(sightRay, 16);
        if (wall) bloodDecal(wall.point, wall.normal, rand(0.8, 1.3));
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
        rec({ type: 'tracer', from: from.clone(), to: to.clone() });
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
        rec({ type: 'flash', at: at.clone() });
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
        rec({ type: 'dink' });
        sound.tone({ from: 2700, to: 2150, decay: 0.2, volume: 0.22, type: 'triangle' });
        sound.burst({ cutoff: 7000, type: 'highpass', decay: 0.05, volume: 0.18 });
    };
    const thud = (dist) => {
        rec({ type: 'thud' });
        sound.tone({ at: 0.45, from: 95, to: 38, decay: 0.2, volume: 0.35 * near(dist, 90) });
    };
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
        if (!player.alive || demoMode) return;
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
        markKill(bot, point, headshot, weaponLabel);
        if (!demoMode) ctx.onKill?.({ headshot, name: bot.name });
    }

    const shotRay = new THREE.Raycaster();

    // One bullet (or one pellet) from the player. Walls stop it; the nearest
    // bot it reaches first takes the damage. Returns what it hit.
    // `opts` is for the knife: a short reach, a flat damage, no bullet holes,
    // and a stab in the back kills outright, as in csgo.
    function shoot(ray, weaponId, weaponLabel, opts = {}) {
        const reach = opts.range ?? 400;
        // Hit-test against where the bots are now, not where the last frame
        // drew them.
        root.updateMatrixWorld(true);
        shotRay.ray.copy(ray);
        shotRay.far = reach;
        const wall = rayHitsWorld(ray, reach);
        let best = null;
        for (const bot of bots) {
            if (!bot.alive) continue;
            const hit = shotRay.intersectObjects(bot.rig.hitMeshes, false)[0];
            if (hit && (!best || hit.distance < best.hit.distance)) best = { bot, hit };
        }
        if (!opts.melee) recShot(weaponId, best && (!wall || best.hit.distance < wall.distance) ? best.hit.point : wall ? wall.point : ray.at(reach, new THREE.Vector3()));
        if (best && (!wall || best.hit.distance < wall.distance)) {
            const { bot, hit } = best;
            const part = hit.object.userData.part;
            const headshot = part === 'head';
            let dmg = damageFor(weaponId, part, hit.distance);
            if (opts.damage != null) {
                // From behind: the bot is facing the same way the blade is going.
                const facing = Math.sin(bot.heading) * ray.direction.x + Math.cos(bot.heading) * ray.direction.z;
                dmg = facing > 0.5 ? 200 : opts.damage;
            }
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
        if (wall && !opts.melee) {
            const n = wall.normal;
            holeDecal(wall.point, n, rand(0.8, 1.2));
            spray(wall.point, n, 5, 5, dustMat, 1, 0.4);
        }
        // How far the shot got, so aim.js can tell if anything else it aimed
        // at (an easter egg) was in front of the wall.
        return { hit: false, wallDist: wall ? wall.distance : Infinity };
    }

    /* ---------- the bots' side of the fight ---------- */

    const botEye = new THREE.Vector3();
    const muzzleWorld = new THREE.Vector3();
    const aimAt = new THREE.Vector3();

    function botFire(bot, now, dist) {
        bot.rig.muzzle.getWorldPosition(muzzleWorld);
        muzzleFlash(muzzleWorld);
        botShotSound(dist);
        rec({ type: 'botshot', at: muzzleWorld.clone() });

        const moving = Math.hypot(player.vel.x, player.vel.z) > WALK + 1;
        const firstShots = now - bot.spottedAt < difficulty.reaction + 250 ? 0.6 : 1;
        const p = difficulty.accuracy * clamp(1.15 - dist / 120, 0.3, 1) * (moving ? 0.7 : 1) * (player.onGround ? 1 : 0.6) * (player.eye < EYE - 1 ? 0.8 : 1) * firstShots;
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
        const top = keys.crouch ? CROUCH_SPEED : keys.walk ? WALK : RUN;

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
        // Crouching lowers the eye with the feet where they are.
        const eyeWas = player.eye;
        player.eye += ((keys.crouch ? EYE_CROUCH : EYE) - player.eye) * Math.min(1, dt * 14);
        pos.y += player.eye - eyeWas;
        pos.x += player.vel.x * dt;
        pos.z += player.vel.z * dt;
        pos.y += player.vel.y * dt;

        const feet = pos.y - player.eye;
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
        if (pos.y - player.eye <= ground) {
            pos.y = ground + player.eye;
            player.vel.y = 0;
            player.onGround = true;
        } else if (pos.y - player.eye > ground + 0.05) {
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
        player.eye = EYE;
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

        updateEffects(now, dt);
        sample(now, input);
    }

    function updateEffects(now, dt) {
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

    /* ---------- the killcam: recording the round, replaying the best of it ---------- */

    // While a round is on, every bot's pose and where you stood are sampled
    // into a rolling couple of seconds, along with the shots, blood and sounds.
    // Each kill of yours keeps that window and what follows it, and at the end
    // of the round the best of them play back from beside the bot that went
    // down. Kills close together share one clip.
    const PRE_MS = 2000;
    const POST_MS = 1700;
    const SAMPLE_MS = 25;
    const BOT_F = 34;
    const PLAYER_F = 9;
    let frames = [];
    let events = [];
    let clips = [];
    let open = null;
    let lastSample = 0;
    let replay = null;

    // You, as the killcam sees you, dressed as picked on the menu.
    let avatar = null;
    function setLook(look) {
        if (avatar) {
            root.remove(avatar.body);
            disposeSoldier(avatar);
        }
        avatar = buildSoldier(look);
        aimPose(avatar);
        avatar.body.visible = false;
        root.add(avatar.body);
    }
    setLook(ctx.look);

    function resetReel() {
        frames = [];
        events = [];
        clips = [];
        open = null;
        lastSample = 0;
        replay = null;
        avatar.body.visible = false;
    }

    function rec(ev) {
        if (!active || replay) return;
        ev.t = performance.now();
        events.push(ev);
        if (open) open.events.push(ev);
    }

    // Your shot, drawn from the gun of your stand-in on the way back. One
    // sound per trigger pull, however many pellets it threw.
    function recShot(weaponId, end) {
        const last = events[events.length - 1];
        if (!(last && last.type === 'pshot' && performance.now() - last.t < 1)) rec({ type: 'pshot', weapon: weaponId });
        rec({ type: 'ptracer', to: end.clone() });
    }

    function writePose(rig, a, o) {
        const { body, spine, neck, gun } = rig;
        a[o] = body.position.x;
        a[o + 1] = body.position.y;
        a[o + 2] = body.position.z;
        a[o + 3] = body.quaternion.x;
        a[o + 4] = body.quaternion.y;
        a[o + 5] = body.quaternion.z;
        a[o + 6] = body.quaternion.w;
        a[o + 7] = body.visible ? 1 : 0;
        a[o + 8] = rig.hips.position.y;
        a[o + 9] = spine.rotation.x;
        a[o + 10] = spine.rotation.y;
        a[o + 11] = spine.rotation.z;
        a[o + 12] = neck.rotation.x;
        a[o + 13] = neck.rotation.y;
        a[o + 14] = neck.rotation.z;
        rig.legs.forEach((leg, j) => {
            a[o + 15 + j * 2] = leg.thigh.rotation.x;
            a[o + 16 + j * 2] = leg.knee.rotation.x;
        });
        rig.arms.forEach((arm, j) => {
            const k = o + 19 + j * 4;
            a[k] = arm.shoulder.rotation.x;
            a[k + 1] = arm.shoulder.rotation.y;
            a[k + 2] = arm.shoulder.rotation.z;
            a[k + 3] = arm.elbow.rotation.x;
        });
        a[o + 27] = gun.parent === spine ? 0 : 1;
        a[o + 28] = gun.position.x;
        a[o + 29] = gun.position.y;
        a[o + 30] = gun.position.z;
        a[o + 31] = gun.rotation.x;
        a[o + 32] = gun.rotation.y;
        a[o + 33] = gun.rotation.z;
    }

    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    function readPose(rig, A, B, o, k) {
        const L = (i) => A[o + i] + (B[o + i] - A[o + i]) * k;
        rig.body.position.set(L(0), L(1), L(2));
        qa.set(A[o + 3], A[o + 4], A[o + 5], A[o + 6]);
        qb.set(B[o + 3], B[o + 4], B[o + 5], B[o + 6]);
        rig.body.quaternion.slerpQuaternions(qa, qb, k);
        rig.body.visible = A[o + 7] > 0.5;
        rig.hips.position.y = L(8);
        rig.spine.rotation.set(L(9), L(10), L(11));
        rig.neck.rotation.set(L(12), L(13), L(14));
        rig.legs.forEach((leg, j) => {
            leg.thigh.rotation.x = L(15 + j * 2);
            leg.knee.rotation.x = L(16 + j * 2);
        });
        rig.arms.forEach((arm, j) => {
            const i = 19 + j * 4;
            arm.shoulder.rotation.set(L(i), L(i + 1), L(i + 2));
            arm.elbow.rotation.x = L(i + 3);
        });
        const dropped = A[o + 27] > 0.5;
        const home = dropped ? root : rig.spine;
        if (rig.gun.parent !== home) home.add(rig.gun);
        // A rifle that left the hands between two samples jumps, not blends.
        const g = dropped === (B[o + 27] > 0.5) ? k : 0;
        const G = (i) => A[o + i] + (B[o + i] - A[o + i]) * g;
        rig.gun.position.set(G(28), G(29), G(30));
        rig.gun.rotation.set(G(31), G(32), G(33));
    }

    function sample(now, input) {
        if (now - lastSample < SAMPLE_MS) return;
        lastSample = now;
        const p = new Float32Array(PLAYER_F);
        p[0] = camera.position.x;
        p[1] = camera.position.y;
        p[2] = camera.position.z;
        p[3] = input.yaw;
        p[4] = input.pitch ?? 0;
        p[5] = player.eye;
        p[6] = player.bob;
        p[7] = Math.hypot(player.vel.x, player.vel.z);
        p[8] = player.alive ? 1 : 0;
        const b = new Float32Array(bots.length * BOT_F);
        bots.forEach((bot, i) => writePose(bot.rig, b, i * BOT_F));
        const frame = { t: now, p, b };
        frames.push(frame);
        while (frames.length && frames[0].t < now - PRE_MS - 200) frames.shift();
        while (events.length && events[0].t < now - PRE_MS - 200) events.shift();
        if (open) {
            open.frames.push(frame);
            if (now >= open.end) open = null;
        }
    }

    function markKill(bot, point, headshot, weapon) {
        const now = performance.now();
        const kill = {
            t: now,
            victim: bots.indexOf(bot),
            name: bot.name,
            headshot,
            weapon,
            dist: camera.position.distanceTo(point),
            at: bot.pos.clone(),
            from: camera.position.clone(),
        };
        if (open && now >= open.end) open = null;
        if (open) {
            open.kills.push(kill);
            open.end = now + POST_MS;
            return;
        }
        open = {
            start: Math.max(now - PRE_MS, frames.length ? frames[0].t : now),
            end: now + POST_MS,
            kills: [kill],
            frames: [...frames],
            events: events.filter((e) => e.t >= now - PRE_MS),
        };
        clips.push(open);
        // A long round of kills keeps only the best of them in memory.
        if (clips.length > 24) {
            const worst = clips.filter((c) => c !== open).reduce((a, c) => (score(c) < score(a) ? c : a));
            clips.splice(clips.indexOf(worst), 1);
        }
    }

    // What makes a highlight: more kills in one go, headshots, long shots,
    // and above all a knife.
    function score(clip) {
        const each = clip.kills.reduce((s, k) => s + 3 + (k.headshot ? 3 : 0) + Math.min(4, k.dist / 30) + (k.weapon === 'karambit' ? 5 : 0), 0);
        return each + (clip.kills.length - 1) * 4;
    }

    // The best few clips of the round, played in the order they happened.
    function highlights(max = 5) {
        if (open) {
            open.end = Math.min(open.end, open.frames[open.frames.length - 1]?.t ?? open.end);
            open = null;
        }
        return clips
            .filter((c) => c.frames.length > 1)
            .map((c) => ({ c, s: score(c) }))
            .sort((a, b) => b.s - a.s)
            .slice(0, max)
            .map((x) => x.c)
            .sort((a, b) => a.start - b.start);
    }

    function playHighlights(list, hooks = {}) {
        replay = { list, hooks, i: -1 };
        el.killfeed.replaceChildren();
        el.death.hidden = true;
        el.healthBox.hidden = true;
        vignette = 0;
        el.damage.style.opacity = '0';
        camera.rotation.z = 0;
        nextClip();
    }

    function nextClip() {
        const r = replay;
        r.i++;
        if (r.i >= r.list.length) {
            endReplay();
            return;
        }
        const c = r.list[r.i];
        r.clip = c;
        r.t = c.start;
        r.end = Math.min(c.end, c.frames[c.frames.length - 1].t);
        r.cursor = 0;
        r.ev = 0;
        r.fed = 0;
        r.snap = true;
        while (r.ev < c.events.length && c.events[r.ev].t < r.t) r.ev++;
        clearTransient();
        el.killfeed.replaceChildren();
        r.hooks.onClip?.(c, r.i, r.list.length);
    }

    function endReplay() {
        if (!replay) return;
        const { hooks } = replay;
        replay = null;
        avatar.body.visible = false;
        clearTransient();
        el.killfeed.replaceChildren();
        hooks.onDone?.();
    }

    function poseAvatar(A, B, k) {
        const L = (i) => A[i] + (B[i] - A[i]) * k;
        const eye = L(5);
        avatar.body.visible = A[8] > 0.5;
        avatar.body.position.set(L(0), L(1) - eye, L(2));
        const turn = Math.atan2(Math.sin(B[3] - A[3]), Math.cos(B[3] - A[3]));
        // The camera looks down -Z at yaw 0; the soldier faces +Z.
        avatar.body.rotation.set(0, A[3] + turn * k + Math.PI, 0);
        const pitch = L(4);
        const crouch = clamp((EYE - eye) / (EYE - EYE_CROUCH), 0, 1);
        const bob = L(6);
        const swing = Math.min(1, L(7) / 8);
        const [a, b] = avatar.legs;
        a.thigh.rotation.x = -Math.sin(bob) * 0.6 * swing - 0.9 * crouch;
        b.thigh.rotation.x = Math.sin(bob) * 0.6 * swing - 0.9 * crouch;
        a.knee.rotation.x = Math.max(0, Math.sin(bob + 1.6)) * 0.9 * swing + 1.5 * crouch;
        b.knee.rotation.x = Math.max(0, -Math.sin(bob + 1.6)) * 0.9 * swing + 1.5 * crouch;
        avatar.hips.position.y = 4.4 - 1.3 * crouch + Math.abs(Math.cos(bob)) * 0.12 * swing;
        avatar.spine.rotation.x = 0.25 * crouch - pitch * 0.5;
        avatar.neck.rotation.x = -pitch * 0.4;
    }

    const avatarMuzzle = new THREE.Vector3();
    function playEvent(e) {
        switch (e.type) {
            case 'spray': spray(e.at, e.dir, e.count, e.speed, e.material, e.spread, e.life); break;
            case 'mist': mist(e.at, e.size); break;
            case 'tracer': tracer(e.from, e.to); break;
            case 'flash': muzzleFlash(e.at); break;
            case 'botshot': botShotSound(camera.position.distanceTo(e.at)); break;
            case 'dink': dink(); break;
            case 'thud': thud(20); break;
            case 'pshot': ctx.shotSound?.(e.weapon); break;
            case 'ptracer':
                avatar.body.updateMatrixWorld(true);
                avatar.muzzle.getWorldPosition(avatarMuzzle);
                tracer(avatarMuzzle, e.to);
                muzzleFlash(avatarMuzzle);
                break;
        }
    }

    // The camera: over the bot's shoulder, looking at you, until the shot
    // lands; then slow motion as it swings round to watch the body fall.
    const camPos = new THREE.Vector3();
    const camLook = new THREE.Vector3();
    const want = new THREE.Vector3();
    const look = new THREE.Vector3();
    const you = new THREE.Vector3();
    const toYou = new THREE.Vector3();
    const side = new THREE.Vector3();
    const anchor = new THREE.Vector3();
    const camRay = new THREE.Ray();
    const shoulder = (at, d, s, out) => out.copy(at).addScaledVector(d, -5.5).addScaledVector(s, 2.4).setY(at.y + 11);

    function aimCamera(r, pA, pB, k, dt) {
        const c = r.clip;
        const kill = c.kills.find((x) => x.t > r.t - 900) || c.kills[c.kills.length - 1];
        const victim = bots[kill.victim];
        you.set(pA[0] + (pB[0] - pA[0]) * k, pA[1] + (pB[1] - pA[1]) * k - 1, pA[2] + (pB[2] - pA[2]) * k);
        const body = victim ? victim.rig.body.position : kill.at;
        const from = r.t < kill.t ? body : kill.at;
        toYou.subVectors(r.t < kill.t ? you : kill.from, from).setY(0);
        if (toYou.lengthSq() < 1e-4) toYou.set(0, 0, 1);
        toYou.normalize();
        side.set(-toYou.z, 0, toYou.x);

        if (r.t < kill.t) {
            shoulder(body, toYou, side, want);
            look.copy(you);
            anchor.copy(body).setY(body.y + 9);
        } else {
            const b = easeOut((r.t - kill.t) / 900);
            shoulder(kill.at, toYou, side, want);
            tmpB.copy(kill.at).addScaledVector(side, 10).addScaledVector(toYou, 2).setY(kill.at.y + 6);
            want.lerp(tmpB, b);
            look.copy(you).lerp(tmpA.copy(body).setY(body.y + 2), b);
            anchor.copy(kill.at).setY(kill.at.y + 5);
        }

        // Pull in rather than look through a wall.
        tmpA.subVectors(want, anchor);
        const dist = tmpA.length();
        if (dist > 1e-3) {
            camRay.set(anchor, tmpA.divideScalar(dist));
            const wall = rayHitsWorld(camRay, dist);
            if (wall) want.copy(anchor).addScaledVector(camRay.direction, Math.max(1, wall.distance - 0.8));
        }

        if (r.snap) {
            camPos.copy(want);
            camLook.copy(look);
            r.snap = false;
        } else {
            const s = 1 - Math.exp(-dt * 7);
            camPos.lerp(want, s);
            camLook.lerp(look, Math.min(1, s * 1.4));
        }
        camera.position.copy(camPos);
        camera.lookAt(camLook);
    }

    function replayTick(now, dt) {
        const r = replay;
        if (!r) return;
        const c = r.clip;
        // Slow motion through each kill.
        const slow = c.kills.some((x) => r.t - x.t > -180 && r.t - x.t < 750);
        r.t += dt * 1000 * (slow ? 0.3 : 1);
        if (r.t >= r.end) {
            nextClip();
            return;
        }

        const F = c.frames;
        while (r.cursor < F.length - 2 && F[r.cursor + 1].t <= r.t) r.cursor++;
        const A = F[r.cursor];
        const B = F[Math.min(r.cursor + 1, F.length - 1)];
        const k = B.t > A.t ? clamp((r.t - A.t) / (B.t - A.t), 0, 1) : 0;
        const n = Math.min(bots.length, A.b.length / BOT_F, B.b.length / BOT_F);
        for (let i = 0; i < n; i++) readPose(bots[i].rig, A.b, B.b, i * BOT_F, k);
        poseAvatar(A.p, B.p, k);

        while (r.ev < c.events.length && c.events[r.ev].t <= r.t) playEvent(c.events[r.ev++]);
        while (r.fed < c.kills.length && c.kills[r.fed].t <= r.t) {
            const x = c.kills[r.fed++];
            feed('you', x.weapon, x.name, x.headshot, true);
            r.hooks.onKill?.(x, r.fed, c.kills.length);
        }

        aimCamera(r, A.p, B.p, k, dt);
        updateEffects(now, dt);
    }

    /* ---------- lifecycle ---------- */

    function clearTransient() {
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
    }

    function clearEffects() {
        clearTransient();
        bloodDecal.clear();
        holeDecal.clear();
        el.killfeed.replaceChildren();
        vignette = 0;
        el.damage.style.opacity = '0';
    }

    function start(opts = {}) {
        demoMode = !!opts.demo;
        clearEffects();
        removeBots();
        resetReel();
        stats.kills = 0;
        stats.deaths = 0;
        stats.headshots = 0;
        active = true;

        const names = [...NAMES].sort(() => Math.random() - 0.5);
        const spot = spawnPoint([]);
        camera.position.set(spot.x, floorY + EYE, spot.z);
        player.eye = EYE;
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
        el.healthBox.hidden = demoMode;
        updateHealth();
    }

    // Heads of the bots in plain view of the camera, nearest first: what the
    // menu's demo player looks for.
    function visibleTargets() {
        const out = [];
        for (const bot of bots) {
            if (!bot.alive) continue;
            const head = new THREE.Vector3(bot.pos.x, bot.pos.y + 8.35, bot.pos.z);
            const dist = head.distanceTo(camera.position);
            if (dist < 120 && lineOfSight(camera.position, head)) out.push({ head, dist, name: bot.name });
        }
        return out.sort((a, b) => a.dist - b.dist);
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
        resetReel();
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
        setColliders,
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
        get crouched() {
            return player.eye < EYE - 1;
        },
        get airborne() {
            return !player.onGround;
        },
        get bobPhase() {
            return player.bob;
        },
        setLook,
        visibleTargets,
        highlights,
        playHighlights,
        replayTick,
        skipClip: () => replay && nextClip(),
        endReplay,
        get replaying() {
            return !!replay;
        },
        difficulty: () => difficulty,
    };
}
