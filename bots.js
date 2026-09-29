// Bots mode: the same guns, maps and settings as the aim trainer, but you walk
// the map (WASD, space to jump, shift to walk) and the targets are bots that
// walk it too and shoot back. aim.js owns the camera, the guns and the frame
// loop, and calls in here for movement, the bots, damage and the kill effects.
//
// Scale: the maps put the eye 8 units over the floor, so a person here is
// about 9 units tall and everything below is built to that.
import * as THREE from './vendor/three/three.module.min.js';
import { buildSoldier, aimPose, disposeSoldier } from './soldier.js';

// `run` is top speed on foot (you run at 21). `smart` is how often a bot plays
// like a person: stopping dead to shoot, crouch spraying at range, jump
// peeking, sneaking up on a sound, falling back to cover to reload.
export const DIFFICULTIES = [
    { id: 'easy', label: 'easy', reaction: 950, accuracy: 0.14, fireGap: 380, run: 15, turn: 2.2, headshot: 0.03, smart: 0.2 },
    { id: 'normal', label: 'normal', reaction: 600, accuracy: 0.24, fireGap: 240, run: 17, turn: 3.4, headshot: 0.07, smart: 0.45 },
    { id: 'hard', label: 'hard', reaction: 360, accuracy: 0.36, fireGap: 160, run: 19, turn: 5, headshot: 0.12, smart: 0.7 },
    { id: 'expert', label: 'expert', reaction: 200, accuracy: 0.5, fireGap: 120, run: 20, turn: 7.5, headshot: 0.2, smart: 0.9 },
];

// 1v1: first to this many rounds takes the match.
export const DUEL_LENGTHS = [
    { id: '3', label: 'first to 3' },
    { id: '5', label: 'first to 5' },
    { id: '8', label: 'first to 8' },
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
// The highest ledge a jump gets you onto.
const JUMP_UP = 3.2;
// A bot's ak: thirty rounds, then a reload it would rather do behind a wall.
const MAG = 30;
const RELOAD_MS = 2400;
// 1v1 rounds: a freeze to get your bearings, the round, and a pause after.
const DUEL_FREEZE_MS = 3000;
const DUEL_ROUND_MS = 75000;
const DUEL_AFTER_MS = 3200;
// The walk grid the bots find their way round the map on.
const CELL = 2;

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
            minY: box.min.y, top: box.max.y, walkable: !!walkable,
        });
    });
    return colliders;
}
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
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
    // Where each side starts a 1v1 round, if the map says: two lists of [x, z].
    let spawns = null;
    // The 1v1 match, while one is on. See startDuelRound.
    let duel = null;

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
        navDirty = true;
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
    // Anything starting well above the feet is a roof or a tunnel's ceiling:
    // walked under, and the lowest one overhead is left in `ceiling` for a
    // jump to bump its head on.
    let ceiling = Infinity;
    function collide(pos, vel, radius, feet) {
        let ground = floorY;
        ceiling = Infinity;
        for (const c of colliders) {
            if (c.minY > feet + 5) {
                if (pos.x > c.minX && pos.x < c.maxX && pos.z > c.minZ && pos.z < c.maxZ) ceiling = Math.min(ceiling, c.minY);
                continue;
            }
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

    /* ---------- the walk grid: how the bots get around ---------- */

    // The map in 2-unit cells. Each cell has a ground height (the floor, or
    // the top of a crate, a stair or a platform it sits on) and is open if a
    // bot could stand in the middle of it without touching anything taller
    // than a step. A bot can walk to a neighbour a step up or down, jump up
    // to one a ledge higher, and drop off anything. Built once per map, the
    // first time the bots need it.
    let nav = null;
    let navDirty = true;
    const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

    function ensureNav() {
        if (navDirty || !nav) buildNav();
        return nav;
    }

    function buildNav() {
        navDirty = false;
        const [x0, x1, z0, z1] = bounds;
        const nx = Math.max(1, Math.floor((x1 - x0) / CELL));
        const nz = Math.max(1, Math.floor((z1 - z0) / CELL));
        const n = nx * nz;
        const h = new Float32Array(n);
        const open = new Uint8Array(n);

        // Colliders sorted into coarse buckets, so each cell only tests the
        // few that are anywhere near it.
        const BK = 8;
        const bx = Math.ceil((x1 - x0) / BK) + 1;
        const bz = Math.ceil((z1 - z0) / BK) + 1;
        const buckets = Array.from({ length: bx * bz }, () => []);
        for (const c of colliders) {
            const i0 = clamp(Math.floor((c.minX - 2 - x0) / BK), 0, bx - 1);
            const i1 = clamp(Math.floor((c.maxX + 2 - x0) / BK), 0, bx - 1);
            const j0 = clamp(Math.floor((c.minZ - 2 - z0) / BK), 0, bz - 1);
            const j1 = clamp(Math.floor((c.maxZ + 2 - z0) / BK), 0, bz - 1);
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) buckets[j * bx + i].push(c);
        }

        const R = BOT_RADIUS + 0.2;
        for (let j = 0; j < nz; j++) {
            for (let i = 0; i < nx; i++) {
                const x = x0 + (i + 0.5) * CELL;
                const z = z0 + (j + 0.5) * CELL;
                const near = buckets[Math.floor((z - z0) / BK) * bx + Math.floor((x - x0) / BK)];
                let H = floorY;
                let tall = false;
                for (const c of near) {
                    if (c.minY > floorY + 1 || x <= c.minX || x >= c.maxX || z <= c.minZ || z >= c.maxZ) continue;
                    if (c.top > H) {
                        H = c.top;
                        // Inside a wall or a building, not on top of something.
                        tall = !c.walkable && c.top - floorY > 6.5;
                    }
                }
                const k = j * nx + i;
                h[k] = H;
                if (tall) continue;
                let ok = true;
                for (const c of near) {
                    if (c.minY > H + 5 || c.top <= H + STEP) continue;
                    const cx = clamp(x, c.minX, c.maxX);
                    const cz = clamp(z, c.minZ, c.maxZ);
                    if ((x - cx) ** 2 + (z - cz) ** 2 < R * R) {
                        ok = false;
                        break;
                    }
                }
                open[k] = ok ? 1 : 0;
            }
        }
        nav = { x0, z0, nx, nz, n, h, open };

        // The biggest patch you can get round both ways is the map; spawns
        // and wandering stay on it, so no one starts in a sealed-off corner.
        const comp = new Int32Array(n).fill(-1);
        const queue = new Int32Array(n);
        let best = -1;
        let bestSize = 0;
        for (let s = 0, id = 0; s < n; s++) {
            if (!open[s] || comp[s] >= 0) continue;
            let head = 0;
            let tail = 0;
            queue[tail++] = s;
            comp[s] = id;
            while (head < tail) {
                const a = queue[head++];
                for (const [di, dj] of NEIGHBOURS) {
                    const b = step(a, di, dj);
                    if (b < 0 || comp[b] >= 0 || Math.abs(h[b] - h[a]) > JUMP_UP) continue;
                    comp[b] = id;
                    queue[tail++] = b;
                }
            }
            if (tail > bestSize) {
                bestSize = tail;
                best = id;
            }
            id++;
        }
        nav.comp = comp;
        nav.main = best;
        nav.cells = [];
        nav.ground = [];
        for (let k = 0; k < n; k++) {
            if (comp[k] !== best) continue;
            nav.cells.push(k);
            if (h[k] <= floorY + 0.5) nav.ground.push(k);
        }
        nav.g = new Float32Array(n);
        nav.from = new Int32Array(n);
        nav.seen = new Uint32Array(n);
        nav.shut = new Uint32Array(n);
        nav.stamp = 0;
    }

    // The neighbour of cell a one over, if it is open and a bot can move
    // there: not too high to jump, and no cutting a corner past a wall.
    function step(a, di, dj) {
        const { nx, nz, open } = nav;
        const i = (a % nx) + di;
        const j = Math.floor(a / nx) + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz) return -1;
        const b = j * nx + i;
        if (!open[b]) return -1;
        if (di && dj && (!open[a + di] || !open[a + dj * nx])) return -1;
        return b;
    }

    function cellAt(x, z) {
        const i = Math.floor((x - nav.x0) / CELL);
        const j = Math.floor((z - nav.z0) / CELL);
        if (i < 0 || j < 0 || i >= nav.nx || j >= nav.nz) return -1;
        return j * nav.nx + i;
    }

    // The open cell nearest a point, for when the point itself is up against
    // a wall. Prefers one at about the same height.
    function openNear(x, z, y = floorY) {
        const k = cellAt(clamp(x, bounds[0], bounds[1] - 0.01), clamp(z, bounds[2], bounds[3] - 0.01));
        if (k < 0) return -1;
        if (nav.open[k] && Math.abs(nav.h[k] - y) < JUMP_UP) return k;
        const ci = k % nav.nx;
        const cj = Math.floor(k / nav.nx);
        let best = -1;
        let bestD = Infinity;
        for (let r = 1; r <= 4 && best < 0; r++) {
            for (let dj = -r; dj <= r; dj++) {
                for (let di = -r; di <= r; di++) {
                    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
                    const i = ci + di;
                    const j = cj + dj;
                    if (i < 0 || j < 0 || i >= nav.nx || j >= nav.nz) continue;
                    const b = j * nav.nx + i;
                    if (!nav.open[b]) continue;
                    const d = di * di + dj * dj + Math.abs(nav.h[b] - y);
                    if (d < bestD) {
                        bestD = d;
                        best = b;
                    }
                }
            }
        }
        return best >= 0 ? best : nav.open[k] ? k : -1;
    }

    const cellPoint = (k) => ({
        x: nav.x0 + ((k % nav.nx) + 0.5) * CELL,
        z: nav.z0 + (Math.floor(k / nav.nx) + 0.5) * CELL,
        h: nav.h[k],
    });

    // A* over the grid, then pulled straight wherever a straight line walks.
    // A list of points to head for, or null if there is no way there.
    const heap = [];
    function findPath(from, to) {
        ensureNav();
        const a = openNear(from.x, from.z, from.y);
        const b = openNear(to.x, to.z, to.y ?? floorY);
        if (a < 0 || b < 0) return null;
        const { nx, h, g, seen, shut } = nav;
        const stamp = ++nav.stamp;
        const bi = b % nx;
        const bj = Math.floor(b / nx);
        const guess = (k) => {
            const di = Math.abs((k % nx) - bi);
            const dj = Math.abs(Math.floor(k / nx) - bj);
            return Math.max(di, dj) + 0.414 * Math.min(di, dj);
        };
        heap.length = 0;
        g[a] = 0;
        seen[a] = stamp;
        nav.from[a] = -1;
        push(heap, guess(a), a);
        let found = false;
        let budget = 9000;
        while (heap.length && budget-- > 0) {
            const k = pop(heap);
            if (shut[k] === stamp) continue;
            shut[k] = stamp;
            if (k === b) {
                found = true;
                break;
            }
            for (const [di, dj] of NEIGHBOURS) {
                const m = step(k, di, dj);
                if (m < 0 || shut[m] === stamp) continue;
                const dh = h[m] - h[k];
                if (dh > JUMP_UP) continue;
                // Jumps and drops cost a little more than walking.
                const cost = (di && dj ? 1.414 : 1) + (dh > STEP ? 1.5 : 0) + (dh < -STEP ? 0.6 : 0);
                const next = g[k] + cost;
                if (seen[m] === stamp && next >= g[m]) continue;
                seen[m] = stamp;
                g[m] = next;
                nav.from[m] = k;
                push(heap, next + guess(m), m);
            }
        }
        if (!found) return null;
        const cells = [];
        for (let k = b; k >= 0; k = nav.from[k]) cells.push(k);
        cells.reverse();

        const out = [];
        let k = 0;
        while (k < cells.length - 1) {
            let j = Math.min(cells.length - 1, k + 24);
            while (j > k + 1 && !straight(cells[k], cells[j])) j--;
            out.push(cellPoint(cells[j]));
            k = j;
        }
        if (!out.length) out.push(cellPoint(b));
        return out;
    }

    // Can a bot just walk from one cell to the other in a line: open all the
    // way, and never more than a step up or down at a time.
    function straight(a, b) {
        const pa = cellPoint(a);
        const pb = cellPoint(b);
        const len = Math.hypot(pb.x - pa.x, pb.z - pa.z);
        const n = Math.ceil(len / (CELL * 0.4));
        let last = pa.h;
        for (let i = 1; i <= n; i++) {
            const t = i / n;
            const k = cellAt(pa.x + (pb.x - pa.x) * t, pa.z + (pb.z - pa.z) * t);
            if (k < 0 || !nav.open[k] || Math.abs(nav.h[k] - last) > STEP) return false;
            last = nav.h[k];
        }
        return true;
    }

    function push(q, f, k) {
        q.push([f, k]);
        let i = q.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (q[p][0] <= q[i][0]) break;
            [q[p], q[i]] = [q[i], q[p]];
            i = p;
        }
    }

    function pop(q) {
        const top = q[0][1];
        const last = q.pop();
        if (q.length) {
            q[0] = last;
            let i = 0;
            for (;;) {
                const l = i * 2 + 1;
                const r = l + 1;
                let m = i;
                if (l < q.length && q[l][0] < q[m][0]) m = l;
                if (r < q.length && q[r][0] < q[m][0]) m = r;
                if (m === i) break;
                [q[m], q[i]] = [q[i], q[m]];
                i = m;
            }
        }
        return top;
    }

    // A free spot on the ground, as far from the given points as a few tries
    // can find.
    function spawnPoint(awayFrom) {
        ensureNav();
        let best = null;
        let bestScore = -1;
        const pool = nav.ground.length ? nav.ground : nav.cells;
        for (let i = 0; i < 50; i++) {
            let x;
            let z;
            let y = floorY;
            if (pool.length) {
                const p = cellPoint(pool[Math.floor(Math.random() * pool.length)]);
                x = p.x;
                z = p.z;
                y = p.h;
            } else {
                x = rand(bounds[0] + 3, bounds[1] - 3);
                z = rand(bounds[2] + 3, bounds[3] - 3);
                if (blockedAt(x, z, 2)) continue;
            }
            const score = Math.min(200, ...awayFrom.map((p) => Math.hypot(p.x - x, p.z - z)));
            if (score > bestScore) {
                bestScore = score;
                best = new THREE.Vector3(x, y, z);
            }
            if (score > 55) break;
        }
        return best || new THREE.Vector3(0, floorY, 0);
    }

    // Somewhere on the map to walk to.
    function randomSpot() {
        ensureNav();
        if (!nav.cells.length) return new THREE.Vector3(0, floorY, 0);
        const p = cellPoint(nav.cells[Math.floor(Math.random() * nav.cells.length)]);
        return new THREE.Vector3(p.x, p.h, p.z);
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
            // patrol: wandering the map. hunt: going to where you were seen
            // or heard. fight: you are in sight. cover: backing off round a
            // corner to reload or heal up, then holding the angle.
            mode: 'patrol',
            path: null,
            pathI: 0,
            goal: new THREE.Vector3(),
            nextThink: 0,
            sees: false,
            seesHead: true,
            spottedAt: 0,
            lastSeen: -1e9,
            lastKnown: new THREE.Vector3(),
            heardAt: -1e9,
            sneak: false,
            holdUntil: 0,
            holdYaw: 0,
            glanceUntil: 0,
            glanceYaw: 0,
            nextShot: 0,
            burstLeft: 0,
            inBurst: false,
            mag: MAG,
            reloadUntil: 0,
            wantsCover: false,
            tookCover: false,
            // How it moves in a fight, picked afresh every so often.
            strafe: 0,
            advance: 0,
            crouchFight: false,
            brake: false,
            moveUntil: 0,
            onGround: true,
            jump: false,
            crouch: 0,
            air: 0,
            stuckCheck: 0,
            stuck: 0,
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

    function spawnBot(bot, at) {
        const others = [camera.position, ...bots.filter((b) => b !== bot && b.alive).map((b) => b.pos)];
        bot.pos.copy(at || spawnPoint(others));
        bot.heading = Math.atan2(camera.position.x - bot.pos.x, camera.position.z - bot.pos.z) + rand(-1.2, 1.2);
        bot.health = 100;
        bot.alive = true;
        bot.mode = 'patrol';
        bot.path = null;
        bot.fall = null;
        bot.sees = false;
        bot.lastSeen = -1e9;
        bot.burstLeft = 0;
        bot.inBurst = false;
        bot.mag = MAG;
        bot.reloadUntil = 0;
        bot.wantsCover = false;
        bot.tookCover = false;
        bot.holdUntil = 0;
        bot.vel.set(0, 0, 0);
        bot.onGround = true;
        bot.jump = false;
        bot.crouch = 0;
        bot.air = 0;
        bot.stuck = 0;
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
        player.deadFeet = camera.position.y - player.eye;
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
        // In a 1v1 the next round brings it back, not a timer.
        bot.respawnAt = duel ? Infinity : bot.deadAt + BOT_RESPAWN_MS;
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
        // A gunshot carries across the map; a knife hardly at all.
        noise(camera.position, opts.melee ? 18 : 150);
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
            const now = performance.now();
            if (bot.mode !== 'fight') {
                bot.mode = 'fight';
                bot.spottedAt = now - difficulty.reaction * 0.5;
                bot.moveUntil = 0;
            }
            bot.lastSeen = now;
            bot.lastKnown.copy(camera.position);
            // Hurt badly: it may decide to fall back and come again.
            if (bot.health < 45 && !bot.tookCover && Math.random() < difficulty.smart * 0.7) bot.wantsCover = true;
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
    const probe = new THREE.Vector3();

    const botSpeed = (bot) => Math.hypot(bot.vel.x, bot.vel.z);

    function botFire(bot, now, dist) {
        bot.rig.muzzle.getWorldPosition(muzzleWorld);
        muzzleFlash(muzzleWorld);
        botShotSound(dist);
        rec({ type: 'botshot', at: muzzleWorld.clone() });

        const moving = Math.hypot(player.vel.x, player.vel.z) > WALK + 1;
        const firstShots = now - bot.spottedAt < difficulty.reaction + 250 ? 0.6 : 1;
        // Its own feet count too, as they do for you: shooting on the run
        // or in the air sprays, standing still is steady, crouched steadier.
        const self = !bot.onGround ? 0.25 : botSpeed(bot) > 7 ? 0.45 : bot.crouch > 0.5 ? 1.15 : 1;
        const p = difficulty.accuracy * clamp(1.15 - dist / 120, 0.3, 1) * (moving ? 0.7 : 1) * (player.onGround ? 1 : 0.6) * (player.eye < EYE - 1 ? 0.8 : 1) * firstShots * self;
        aimAt.copy(camera.position);
        if (Math.random() < p) {
            // Only your legs showing round a box: no headshot on offer.
            const headshot = bot.seesHead && Math.random() < difficulty.headshot;
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
        if (--bot.mag <= 0) startReload(bot, now, dist);
    }

    function startReload(bot, now, dist) {
        bot.reloadUntil = now + RELOAD_MS * rand(0.9, 1.1);
        bot.burstLeft = 0;
        bot.inBurst = false;
        // The mag out and the new one in: a tell, if you are close enough.
        const v = near(dist, 60);
        sound.burst({ cutoff: 2400, type: 'bandpass', q: 4, decay: 0.06, volume: 0.22 * v });
        sound.burst({ at: 0.9, cutoff: 1800, type: 'bandpass', q: 4, decay: 0.08, volume: 0.26 * v });
        if (!bot.tookCover && Math.random() < 0.3 + difficulty.smart * 0.6) bot.wantsCover = true;
    }

    function turnToward(bot, target, rate, dt) {
        const diff = wrap(target - bot.heading);
        bot.heading += clamp(diff, -rate * dt, rate * dt);
        return Math.abs(diff);
    }

    function setPath(bot, to) {
        bot.goal.copy(to);
        bot.path = findPath(bot.pos, to);
        bot.pathI = 0;
        bot.stuck = 0;
        return !!bot.path;
    }

    // Somewhere to go. Now and then it is roughly where you are, since on a
    // big map the bots should come looking instead of wandering the far
    // corners; in a 1v1 that hunch is vaguer, so it is not a wallhack.
    function patrol(bot) {
        bot.mode = 'patrol';
        bot.sneak = false;
        const hunch = player.alive && Math.random() < (duel ? 0.35 : 0.45);
        for (let i = 0; i < 6; i++) {
            let to;
            if (hunch) {
                const spread = duel ? 40 : 28;
                const k = openNear(camera.position.x + rand(-spread, spread), camera.position.z + rand(-spread, spread));
                if (k < 0 || nav.comp[k] !== nav.main) continue;
                const p = cellPoint(k);
                to = new THREE.Vector3(p.x, p.h, p.z);
            } else {
                to = randomSpot();
            }
            if (Math.hypot(to.x - bot.pos.x, to.z - bot.pos.z) < 12) continue;
            if (setPath(bot, to)) return;
        }
        bot.path = null;
    }

    // Go and look where you were last seen or heard. A smart bot walks the
    // last stretch so its footsteps do not give it away, pre-aiming the spot.
    function hunt(bot, now) {
        bot.mode = 'hunt';
        bot.sneak = Math.random() < difficulty.smart * 0.85;
        bot.holdUntil = 0;
        if (!setPath(bot, bot.lastKnown)) patrol(bot);
    }

    // Round a corner from you, close by: a cell you cannot see from where you
    // stand. Picked from a handful of tries, nearer and further from you
    // being better.
    function findCover(bot) {
        ensureNav();
        const here = openNear(bot.pos.x, bot.pos.z, bot.pos.y);
        if (here < 0) return null;
        let best = null;
        let bestScore = Infinity;
        for (let i = 0; i < 40; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = rand(5, 24);
            const k = cellAt(bot.pos.x + Math.sin(a) * r, bot.pos.z + Math.cos(a) * r);
            if (k < 0 || !nav.open[k] || nav.comp[k] !== nav.comp[here]) continue;
            const c = cellPoint(k);
            probe.set(c.x, c.h + EYE, c.z);
            if (lineOfSight(camera.position, probe)) continue;
            const score = r - 0.4 * Math.hypot(c.x - camera.position.x, c.z - camera.position.z);
            if (score < bestScore) {
                bestScore = score;
                best = new THREE.Vector3(c.x, c.h, c.z);
            }
        }
        return best;
    }

    // Anything you do that makes a sound: footsteps, a shot. Bots in earshot
    // that are not already on you come to have a look, a rough guess at the
    // spot, rougher the further off they were.
    function noise(at, reach) {
        if (!active || replay) return;
        const now = performance.now();
        for (const bot of bots) {
            if (!bot.alive || bot.mode === 'fight' || bot.mode === 'cover') continue;
            const d = Math.hypot(at.x - bot.pos.x, at.z - bot.pos.z);
            if (d > reach) continue;
            const blur = d * 0.12;
            bot.lastKnown.set(at.x + rand(-blur, blur), at.y - player.eye, at.z + rand(-blur, blur));
            if (bot.mode !== 'hunt' || now - bot.heardAt > 1500) hunt(bot, now);
            bot.heardAt = now;
        }
    }

    // Looking about, several times a second rather than every frame.
    function think(bot, now, dist, toYou) {
        bot.nextThink = now + rand(100, 180);
        const d = difficulty;
        const off = Math.abs(wrap(toYou - bot.heading));
        const alert = bot.mode === 'fight' || now - bot.lastSeen < 2500;
        const aware = off < (alert ? 2.2 : 1.3) || dist < 9;
        let sees = false;
        if (player.alive && dist < 150 && aware) {
            bot.seesHead = lineOfSight(botEye, camera.position);
            sees = bot.seesHead || lineOfSight(botEye, probe.copy(camera.position).setY(camera.position.y - player.eye * 0.55));
        }
        bot.sees = sees;
        if (sees && bot.mode === 'cover' && bot.path) {
            // Running for cover: keeps running.
            bot.lastSeen = now;
            bot.lastKnown.copy(camera.position).setY(camera.position.y - player.eye);
        } else if (sees) {
            if (bot.mode !== 'fight') {
                // Already looking this way (pre-aiming, holding an angle):
                // quicker on the trigger.
                const ready = off < 0.35 && (bot.mode === 'hunt' || bot.holdUntil > now);
                bot.mode = 'fight';
                bot.spottedAt = now - (ready ? d.reaction * 0.45 : 0);
                bot.moveUntil = 0;
                bot.path = null;
            }
            bot.lastSeen = now;
            bot.lastKnown.copy(camera.position).setY(camera.position.y - player.eye);
        } else if (bot.mode === 'fight' && now - bot.lastSeen > 1400) {
            hunt(bot, now);
        }

        // Back off to reload or lick its wounds, once a life.
        if (bot.wantsCover && (bot.mode === 'fight' || bot.mode === 'hunt')) {
            bot.wantsCover = false;
            const spot = findCover(bot);
            if (spot && setPath(bot, spot)) {
                bot.mode = 'cover';
                bot.tookCover = true;
                bot.holdUntil = 0;
            }
        }
    }

    // How it moves while shooting at you, picked again every half second or
    // so: strafing, stopping dead for the shot, crouching to spray at range,
    // pushing when far, the odd jump.
    function pickFightMove(bot, dist, now) {
        const d = difficulty;
        bot.crouchFight = dist > 25 && Math.random() < d.smart * 0.45;
        bot.strafe = bot.crouchFight && Math.random() < 0.7 ? 0 : Math.random() < 0.5 ? -1 : 1;
        bot.advance = dist > 55 ? 1 : dist < 9 && Math.random() < 0.4 ? -0.6 : dist < 22 && Math.random() < 0.2 ? 0.7 : 0;
        bot.brake = Math.random() < 0.25 + d.smart * 0.65;
        if (!bot.crouchFight && dist < 45 && Math.random() < d.smart * 0.18) bot.jump = true;
        bot.moveUntil = now + (bot.crouchFight ? rand(900, 1700) : rand(320, 900));
    }

    function updateBot(bot, now, dt, frozen) {
        const rig = bot.rig;
        if (!bot.alive) {
            ragdoll(bot, now, dt);
            if (now > bot.respawnAt) spawnBot(bot);
            return;
        }
        const d = difficulty;
        if (bot.reloadUntil && now >= bot.reloadUntil) {
            bot.reloadUntil = 0;
            bot.mag = MAG;
        }

        botEye.set(bot.pos.x, bot.pos.y + EYE - 1.6 * bot.crouch, bot.pos.z);
        const toX = camera.position.x - bot.pos.x;
        const toZ = camera.position.z - bot.pos.z;
        const dist = Math.hypot(toX, toZ);
        const toYou = Math.atan2(toX, toZ);

        if (!frozen && now >= bot.nextThink) think(bot, now, dist, toYou);

        // What it wants to do with its legs this frame, and where it looks.
        let wishX = 0;
        let wishZ = 0;
        let top = 0;
        let crouch = false;
        let quiet = false;

        if (frozen) {
            // The freeze at the start of a round: stands and waits.
        } else if (bot.mode === 'fight') {
            const onTarget = turnToward(bot, toYou, d.turn, dt) < 0.14;
            if (now > bot.moveUntil) pickFightMove(bot, dist, now);
            const reloading = bot.reloadUntil > now;
            const fX = Math.sin(bot.heading);
            const fZ = Math.cos(bot.heading);
            wishX = fZ * bot.strafe + fX * (reloading ? -0.5 : bot.advance);
            wishZ = -fX * bot.strafe + fZ * (reloading ? -0.5 : bot.advance);
            crouch = bot.crouchFight && !reloading;
            top = crouch ? CROUCH_SPEED : d.run * 0.72;

            const ready = bot.sees && player.alive && !reloading && onTarget && now - bot.spottedAt > d.reaction;
            // Counter-strafe: stop dead to shoot, then move again between
            // bursts, the way a good player does.
            if (bot.brake && (ready || bot.inBurst)) {
                wishX = 0;
                wishZ = 0;
            }
            const settled = !bot.brake || botSpeed(bot) < 6 || dist < 12;
            if (ready && now >= bot.nextShot && settled) {
                bot.inBurst = true;
                botFire(bot, now, Math.hypot(toX, toZ, camera.position.y - botEye.y));
                if (--bot.burstLeft <= 0) {
                    // Crouched, it holds the spray longer.
                    bot.burstLeft = (crouch ? 5 : 3) + Math.floor(Math.random() * 3);
                    bot.nextShot = now + rand(380, 720);
                    bot.inBurst = false;
                } else {
                    bot.nextShot = now + d.fireGap * rand(0.8, 1.3);
                }
            }
        } else if (bot.mode === 'cover' && bot.path) {
            // Getting to cover: running, looking where it goes.
            if (follow(bot)) {
                wishX = pathDir.x;
                wishZ = pathDir.z;
                top = d.run;
                turnToward(bot, Math.atan2(wishX, wishZ), 6, dt);
            }
        } else if (bot.mode === 'cover') {
            // Round the corner: crouched, facing the way you would come,
            // until the reload is done and a moment more. Then back at you,
            // quietly.
            if (!bot.holdUntil) bot.holdUntil = Math.max(now + rand(900, 1800), bot.reloadUntil + 300);
            turnToward(bot, Math.atan2(bot.lastKnown.x - bot.pos.x, bot.lastKnown.z - bot.pos.z), 4, dt);
            crouch = true;
            if (now > bot.holdUntil) {
                bot.holdUntil = 0;
                hunt(bot, now);
                bot.sneak = true;
            }
        } else if (bot.holdUntil > now) {
            // Holding an angle: still, maybe crouched, watching one way.
            turnToward(bot, bot.holdYaw, 3, dt);
            crouch = bot.crouchFight;
        } else {
            if (!bot.path) {
                if (bot.mode === 'hunt') {
                    // Got there and you are gone: a look around, then on.
                    bot.mode = 'patrol';
                    bot.holdUntil = now + rand(900, 1800);
                    bot.holdYaw = bot.heading + rand(-2, 2);
                    bot.crouchFight = false;
                    bot.held = true;
                } else if (duel && !bot.held && Math.random() < 0.35 + d.smart * 0.3) {
                    // A 1v1 is patience: take a spot and hold an angle a while.
                    bot.holdUntil = now + rand(2500, 6000);
                    bot.holdYaw = Math.atan2(-bot.pos.x, -bot.pos.z) + rand(-1, 1);
                    bot.crouchFight = Math.random() < d.smart * 0.5;
                    bot.held = true;
                } else {
                    patrol(bot);
                    bot.held = false;
                }
            }
            if (bot.path && follow(bot)) {
                wishX = pathDir.x;
                wishZ = pathDir.z;
                const toGoal = Math.hypot(bot.goal.x - bot.pos.x, bot.goal.z - bot.pos.z);
                const toSpot = Math.hypot(bot.lastKnown.x - bot.pos.x, bot.lastKnown.z - bot.pos.z);
                quiet = bot.mode === 'hunt' && bot.sneak && toGoal < 34;
                crouch = quiet && toGoal < 12 && d.smart > 0.6;
                top = crouch ? CROUCH_SPEED : quiet ? WALK : d.run;
                // Pre-aim where you were, or look where it is going and now
                // and then glance aside.
                if (bot.mode === 'hunt' && toSpot < 50) {
                    turnToward(bot, Math.atan2(bot.lastKnown.x - bot.pos.x, bot.lastKnown.z - bot.pos.z), 5, dt);
                } else {
                    if (now > bot.glanceUntil + 2500 && Math.random() < dt * 0.6) {
                        bot.glanceUntil = now + rand(400, 900);
                        bot.glanceYaw = rand(-1.1, 1.1);
                    }
                    turnToward(bot, Math.atan2(wishX, wishZ) + (now < bot.glanceUntil ? bot.glanceYaw : 0), 5, dt);
                }
                // Running free across the map, some hop, for the fun of it.
                if (!quiet && bot.onGround && bot.mode === 'patrol' && Math.random() < dt * 0.35 * d.smart) bot.jump = true;
            }
        }

        // Wedged against something on the way: hop, and if that fails, go
        // somewhere else.
        if (!frozen && bot.mode !== 'fight' && top > 0 && now > bot.stuckCheck) {
            if (bot.pos.distanceTo(bot.stuckFrom) < 1.5) {
                bot.stuck++;
                if (bot.stuck === 1) bot.jump = true;
                else if (bot.stuck > 2) {
                    if (bot.mode === 'cover') bot.path = null;
                    else patrol(bot);
                }
            } else {
                bot.stuck = 0;
            }
            bot.stuckFrom.copy(bot.pos);
            bot.stuckCheck = now + 900;
        }

        moveBot(bot, wishX, wishZ, top, crouch, dt);

        // Walk cycle: legs swing opposite, knees bend on the back swing;
        // crouched, the knees bend and the hips drop; in the air, the legs
        // tuck.
        const moving = botSpeed(bot);
        bot.phase += dt * moving * 0.55;
        const swing = Math.min(1, moving / 8) * (1 - bot.air);
        const c = bot.crouch;
        const air = bot.air;
        rig.body.rotation.y = bot.heading;
        rig.legs[0].thigh.rotation.x = -Math.sin(bot.phase) * 0.6 * swing - 0.9 * c - 0.7 * air;
        rig.legs[1].thigh.rotation.x = Math.sin(bot.phase) * 0.6 * swing - 0.9 * c - 0.4 * air;
        rig.legs[0].knee.rotation.x = Math.max(0, Math.sin(bot.phase + 1.6)) * 0.9 * swing + 1.5 * c + 1.1 * air;
        rig.legs[1].knee.rotation.x = Math.max(0, -Math.sin(bot.phase + 1.6)) * 0.9 * swing + 1.5 * c + 0.8 * air;
        rig.hips.position.y = 4.4 - 1.3 * c + Math.abs(Math.cos(bot.phase)) * 0.12 * swing;
        const flinch = bot.flinchAt ? Math.exp(-(now - bot.flinchAt) / 90) : 0;
        rig.spine.rotation.x = 0.25 * c - flinch * 0.35 + Math.sin(now / 900 + bot.phase) * 0.02;

        // Footsteps only when running: walking and crouching are silent.
        if (bot.onGround && moving > WALK + 1 && swing > 0.3 && Math.sin(bot.phase) * Math.sin(bot.phase - dt * moving * 0.55) < 0 && now > bot.stepAt) {
            bot.stepAt = now + 120;
            footstep(dist, 0.9);
        }
    }

    // Heading along the path: which way to go, into `pathDir`, and a jump if
    // the next point is up a ledge. False once there.
    const pathDir = { x: 0, z: 0 };
    function follow(bot) {
        const wp = nextWaypoint(bot);
        if (!wp) return false;
        const wx = wp.x - bot.pos.x;
        const wz = wp.z - bot.pos.z;
        const len = Math.hypot(wx, wz) || 1;
        pathDir.x = wx / len;
        pathDir.z = wz / len;
        if (wp.h > bot.pos.y + STEP && len < 3.6) bot.jump = true;
        return true;
    }

    // The next point on the path, moving on past any already reached.
    function nextWaypoint(bot) {
        const p = bot.path;
        if (!p) return null;
        while (bot.pathI < p.length) {
            const w = p[bot.pathI];
            const last = bot.pathI === p.length - 1;
            const d = Math.hypot(w.x - bot.pos.x, w.z - bot.pos.z);
            if (d < (last ? 2 : 1.6) && w.h <= bot.pos.y + STEP + 0.2) {
                bot.pathI++;
                continue;
            }
            return w;
        }
        bot.path = null;
        return null;
    }

    // Feet on the ground the way yours are: quick to start and stop, little
    // control in the air, gravity, jumps, steps up and ledges down.
    function moveBot(bot, wishX, wishZ, top, crouch, dt) {
        const len = Math.hypot(wishX, wishZ);
        const tx = len > 1e-3 ? (wishX / len) * top : 0;
        const tz = len > 1e-3 ? (wishZ / len) * top : 0;
        const k = Math.min(1, (bot.onGround ? 10 : 1.5) * dt);
        bot.vel.x += (tx - bot.vel.x) * k;
        bot.vel.z += (tz - bot.vel.z) * k;
        if (bot.jump) {
            if (bot.onGround && bot.crouch < 0.5) {
                bot.vel.y = JUMP;
                bot.onGround = false;
            }
            bot.jump = false;
        }
        bot.vel.y -= GRAVITY * dt;
        bot.pos.x += bot.vel.x * dt;
        bot.pos.z += bot.vel.z * dt;
        bot.pos.y += bot.vel.y * dt;
        const ground = collide(bot.pos, bot.vel, BOT_RADIUS, bot.pos.y);
        if (bot.pos.y + 9.6 > ceiling) {
            bot.pos.y = ceiling - 9.6;
            if (bot.vel.y > 0) bot.vel.y = 0;
        }
        if (bot.pos.y <= ground) {
            if (!bot.onGround && bot.vel.y < -12) footstep(bot.pos.distanceTo(camera.position), 1.3);
            bot.pos.y = ground;
            bot.vel.y = 0;
            bot.onGround = true;
        } else if (bot.pos.y > ground + 0.05) {
            bot.onGround = false;
        }
        bot.crouch += ((crouch ? 1 : 0) - bot.crouch) * Math.min(1, dt * 10);
        bot.air += ((bot.onGround ? 0 : 1) - bot.air) * Math.min(1, dt * 12);
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
            if (gun.position.y < f.from.y + 0.25) {
                gun.position.y = f.from.y + 0.25;
                gun.rotation.set(0, gun.rotation.y, Math.PI / 2);
                f.gunLanded = true;
                sound.burst({ cutoff: 3000, type: 'bandpass', q: 3, decay: 0.08, volume: 0.2 * near(gun.position.distanceTo(camera.position), 80) });
            }
        }
        if (sink) gun.position.y = Math.max(f.from.y - 2, gun.position.y - dt * 2.2);

        // One pool of blood where the body comes to rest.
        if (!f.pooled && t > 0.6) {
            f.pooled = true;
            bloodDecal(tmpB.set(rig.body.position.x + f.dir.x * 3, f.from.y, rig.body.position.z + f.dir.z * 3), UP, rand(1, 1.5));
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
        // A jump under a roof or in a tunnel stops at the ceiling.
        if (pos.y + 0.6 > ceiling) {
            pos.y = ceiling - 0.6;
            if (player.vel.y > 0) player.vel.y = 0;
        }
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
            // And the bots hear them.
            noise(pos, 55);
        }
    }

    function respawnPlayer(at) {
        const spot = at || spawnPoint(bots.filter((b) => b.alive).map((b) => b.pos));
        camera.position.set(spot.x, spot.y + EYE, spot.z);
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

    /* ---------- 1v1: rounds ---------- */

    // One life each a round. A three second freeze to get your bearings,
    // then the round: whoever is left standing takes it, or on time, whoever
    // has more health. The two of you swap ends every round. First to the
    // set number of rounds wins the match.
    const STILL = { forward: false, back: false, left: false, right: false, jump: false, walk: false, crouch: false };

    function duelSpot(side) {
        ensureNav();
        const list = spawns?.[side];
        if (list?.length) {
            for (let i = 0; i < 6; i++) {
                const [x, z] = list[Math.floor(Math.random() * list.length)];
                const k = openNear(x, z);
                if (k >= 0 && nav.comp[k] === nav.main) {
                    const p = cellPoint(k);
                    return new THREE.Vector3(p.x, p.h, p.z);
                }
            }
        }
        // No spawns on this map: you anywhere, the bot as far off as it gets.
        return side === 0 ? spawnPoint([]) : spawnPoint([camera.position]);
    }

    function startDuelRound() {
        duel.round++;
        duel.phase = 'freeze';
        duel.until = duel.clock + DUEL_FREEZE_MS;
        duel.roundEnd = duel.until + DUEL_ROUND_MS;
        duel.shown = DUEL_ROUND_MS;
        duel.counted = -1;
        clearEffects();

        const side = (duel.round + duel.flip) % 2;
        const you = duelSpot(side);
        respawnPlayer(you);
        const bot = bots[0];
        spawnBot(bot, duelSpot(1 - side));
        // Both face the middle of the map, or each other if already there.
        const face = Math.hypot(you.x, you.z) > 12 ? { x: 0, z: 0 } : bot.pos;
        bot.heading = Math.atan2(-bot.pos.x, -bot.pos.z);
        ctx.onRoundStart?.({ yaw: Math.atan2(-(face.x - you.x), -(face.z - you.z)) });
    }

    function duelTick(dt) {
        const bot = bots[0];
        duel.clock += dt * 1000;
        if (duel.phase === 'freeze') {
            const left = Math.ceil((duel.until - duel.clock) / 1000);
            if (left !== duel.counted) {
                duel.counted = left;
                const last = Math.max(...duel.wins) === duel.first - 1;
                banner(last ? 'match point' : `round ${duel.round}`, `${scoreLine()} · ${left}`);
                sound.tone({ from: 880, to: 880, decay: 0.08, volume: 0.1, type: 'triangle' });
            }
            if (duel.clock >= duel.until) {
                duel.phase = 'live';
                duel.bannerUntil = duel.clock + 700;
                banner('go', scoreLine());
                sound.tone({ from: 1320, to: 1320, decay: 0.16, volume: 0.13, type: 'triangle' });
            }
        } else if (duel.phase === 'live') {
            if (duel.bannerUntil && duel.clock > duel.bannerUntil) {
                duel.bannerUntil = 0;
                banner('');
            }
            duel.shown = Math.max(0, duel.roundEnd - duel.clock);
            if (!player.alive) roundOver(1, 'dead');
            else if (!bot.alive) roundOver(0, 'kill');
            else if (duel.clock >= duel.roundEnd) {
                roundOver(player.health > bot.health ? 0 : bot.health > player.health ? 1 : -1, 'time');
            }
        } else if (duel.phase === 'over' && duel.clock >= duel.until) {
            if (Math.max(...duel.wins) >= duel.first) {
                duel.phase = 'done';
                banner('');
                ctx.onDuelEnd?.({ won: duel.wins[0] >= duel.first, you: duel.wins[0], them: duel.wins[1], name: bot.name, rounds: duel.round });
            } else {
                startDuelRound();
            }
        }
    }

    const scoreLine = () => `you ${duel.wins[0]} : ${duel.wins[1]} ${bots[0].name.toLowerCase()}`;

    function roundOver(winner, how) {
        const bot = bots[0];
        duel.phase = 'over';
        duel.until = duel.clock + DUEL_AFTER_MS;
        duel.bannerUntil = 0;
        if (winner >= 0) duel.wins[winner]++;
        const match = Math.max(...duel.wins) >= duel.first;
        let title;
        if (winner === 0) title = match ? 'match won' : 'round won';
        else if (winner === 1) title = match ? 'match lost' : `${bot.name.toLowerCase()} takes the round`;
        else title = 'draw';
        const why = how === 'time' ? (winner < 0 ? 'time · even on health' : 'time · more health left') : '';
        banner(title, [scoreLine(), why].filter(Boolean).join(' · '), winner === 0 ? 'win' : winner === 1 ? 'loss' : '');
        if (winner === 0) [660, 880, 1100].forEach((f, i) => sound.tone({ at: i * 0.09, from: f, to: f, decay: 0.2, volume: 0.13, type: 'triangle' }));
        else if (winner === 1) [520, 390].forEach((f, i) => sound.tone({ at: i * 0.14, from: f, to: f * 0.9, decay: 0.25, volume: 0.13, type: 'triangle' }));
        ctx.onDuelRound?.();
    }

    function banner(title, sub = '', tone = '') {
        if (!el.round) return;
        el.round.hidden = !title;
        el.roundTitle.textContent = title;
        el.roundSub.textContent = sub;
        el.round.dataset.tone = tone;
    }

    /* ---------- per frame ---------- */

    function update(now, dt, input) {
        if (!active) return;

        if (duel) duelTick(dt);
        // The freeze at the start of a 1v1 round: look around, but no one moves.
        const frozen = !!duel && duel.phase === 'freeze';

        if (player.alive) {
            movePlayer(now, dt, frozen ? { ...input, keys: STILL } : input);
        } else {
            // Dead: the view drops to the floor and tips over, then respawns
            // (in a 1v1, not until the next round).
            const t = (now - player.deadAt) / 1000;
            camera.position.y += ((player.deadFeet ?? floorY) + 2 - camera.position.y) * Math.min(1, dt * 6);
            camera.rotation.z = -0.5 * easeOut(t / 0.6);
            if (!duel && now - player.deadAt > RESPAWN_MS) respawnPlayer();
        }

        for (const bot of bots) updateBot(bot, now, dt, frozen);

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
        banner('');
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
        banner('');
        stats.kills = 0;
        stats.deaths = 0;
        stats.headshots = 0;
        active = true;
        ensureNav();

        const names = [...NAMES].sort(() => Math.random() - 0.5);
        if (opts.duel) {
            // flip: which end you start at, so it is not always the same one.
            duel = { first: opts.duel.first, wins: [0, 0], round: 0, phase: 'freeze', clock: 0, until: 0, roundEnd: 0, shown: DUEL_ROUND_MS, flip: Math.random() < 0.5 ? 0 : 1 };
            bots.push(makeBot(names[0]));
            player.eye = EYE;
            el.healthBox.hidden = false;
            startDuelRound();
            return;
        }
        duel = null;
        const spot = spawnPoint([]);
        camera.position.set(spot.x, spot.y + EYE, spot.z);
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
            const head = new THREE.Vector3(bot.pos.x, bot.pos.y + 8.35 - 1.6 * bot.crouch, bot.pos.z);
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
        duel = null;
        banner('');
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
            navDirty = true;
        },
        setSpawns(list) {
            spawns = list || null;
        },
        // The 1v1 scoreboard, for the HUD: rounds each, and the clock.
        get duel() {
            if (!duel) return null;
            return { you: duel.wins[0], them: duel.wins[1], name: bots[0]?.name ?? '', round: duel.round, first: duel.first, timeLeft: duel.shown, phase: duel.phase };
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
