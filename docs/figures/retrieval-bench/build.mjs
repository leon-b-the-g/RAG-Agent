/**
 * The retrieval bench: an animated figure of the rags2riches pipeline, drawn as one machine.
 *
 *   back row   a conveyor carries a page through four stations (scanner / cutter / stamp / embedder)
 *              into a locked filing cabinet (Postgres: one drawer per tenant, the lock is row-level security)
 *   front row  a query carriage on rails dips two probes (dense, full-text) into the open drawer,
 *              a dial fuses what they found (RRF), a gate lifts and the answer card rises with its citation tabs
 *   left end   the eval gauge reads recall@10 against the golden set
 *
 * Every number the readout shows is the pipeline's real default (src/ingest/chunk.ts, src/embed.ts, src/search.ts).
 *   node build.mjs            -> retrieval-bench.html
 *   node build.mjs --light    -> retrieval-bench-light.html
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as k from './kit/iso-kit.mjs';
import { kitScript } from './kit/inline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes('--light') ? 'light' : 'dark';
const WIDTH = 680;
const HEIGHT = 420;

// ---- the model: real defaults of the pipeline --------------------------------------------------
const MODEL = {
  chunkChars: 1200,
  overlap: 150,
  dims: 1024,
  embedModel: 'voyage-4',
  candidates: 50,
  rrfK: 60,
  topK: 10,
  recallTarget: 0.85,
  mrrTarget: 0.6,
};
const rrf = (rank) => 1 / (MODEL.rrfK + rank); // reciprocal rank fusion, Cormack et al. 2009
// a chunk first on both lists scores 2/61; the dial's full scale is that number
const FUSED_MAX = 2 * rrf(1);

// ---- world layout (units ≈ px) ------------------------------------------------------------------
const PLATE = { x: -186, y: -80, w: 364, d: 160, r: 8 };
const PLATE_H = 12;
const FOOT_H = 5;

const BELT = { x: -162, y: -52, w: 226, d: 22, r: 2 };
const BELT_H = 4;
const PAGE_X0 = -150; // where a page starts
const STATIONS = { scan: -118, cut: -82, stamp: -46, embed: -10 };
const STORE_X = 60; // belt end: the slot in the cabinet's left wall
const PAGE = { x: -8, y: -47, w: 16, d: 12, r: 0.6 };
const PAGE_H = 1.2;
const PAGE_TOP = BELT_H + PAGE_H;
const CHUNK_W = 4.6;
const CHUNK_GAP = 1.1;
const POST_Y = -66; // C-arm posts stand behind the belt
const ARM_Z = 30;
const TOOL_Y = -41; // tools hang over the belt centre

const CAB = { x: 70, y: -66, w: 96, d: 60, r: 2 };
const CAB_H = 58;
const CAB_FRONT = CAB.y + CAB.d; // the +y face, toward the viewer
const DRAWER_Z = [4, 22, 40];
const DRAWER_H = 16;
const DRAWER_OPEN = 30;
const DRAWER_BOX = { x: 82, y: CAB_FRONT, w: 72, d: DRAWER_OPEN, r: 1 };

const RAIL_Y = [44, 62];
const RAIL_X = [-160, 118];
const CARRIAGE = { x: -18, y: 40, w: 36, d: 28, r: 3 };
const CAR_Z = 3;
const CAR_TOP = 9;
const CAR_X0 = -125;
const CAR_X1 = 118; // over the open drawer
const ARM_TOP = 47;
const PROBE_Y = 12;
const PROBE_UP = 40; // tip height at rest, above the drawer walls
const PROBE_DOWN = 26; // tip height dipped into the drawer

const FUSE = [162, 22];
const FUSE_R = 12;
const FUSE_Z = 20;
const FUSE_TOP = FUSE_Z + 8;

const SLOT = { x: 128, y: 46, w: 36, d: 22, r: 2 };
const SLOT_H = 12;
const CARD = { x: 134, y: 52, w: 24, d: 10, r: 0.6 };
const CARD_DOWN = 1;
const CARD_UP = 20;
const GATE_DOWN = 14;
const GATE_UP = 28;

const EVAL = [-176, 58];
const EVAL_R = 11;
const EVAL_Z = 12;
const EVAL_TOP = EVAL_Z + 8;

const P = k.fitProjection(
  [
    ...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0),
    ...k.boxCorners(CAB, 0, CAB_H),
    [STATIONS.scan, POST_Y, ARM_Z + 10],
    [CAR_X1 + 20, 70, ARM_TOP + 4],
  ],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: 40, elevation: 32 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) =>
  [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const screws = (points, z, size = 0.45) =>
  D(
    points.map(([x, y]) => at([x, y, z])),
    { size },
  );

// ---- base plate on feet, groove, ruler, label plate ---------------------------------------------
function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: 'lo' }));
    out.push(
      S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: 'mid' }),
    );
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: 'mid' }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: 'lo' }));
  const heads = k.corners(PLATE, 10);
  out.push(L(heads.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(''), { tone: 'lo' }));
  out.push(screws(heads, 0, 0.5));
  // ruler strip along the front edge: one tick every 4 units, a major every 5th
  const strip = { x: -160, y: PLATE.y + PLATE.d - 11, w: 300, d: 6, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: 'lo', crease: 'none' }));
  const ticks = k.topTicks(
    strip.x + 4,
    strip.x + strip.w - 4,
    4,
    5,
    strip.y + 0.6,
    0.6,
    [1.8, 3.2],
    P,
  );
  out.push(L(ticks.minor, { tone: 'lo' }), L(ticks.major, { tone: 'mid' }));
  out.push(
    D([at([strip.x + 2, strip.y + 3, 0.6]), at([strip.x + strip.w - 2, strip.y + 3, 0.6])], {
      size: 0.45,
    }),
  );
  // two T-slot grooves run the bench between the rows, from the groove outline to the cabinet wall
  for (const y of [0, 12])
    out.push(L(k.lineOnTop([PLATE.x + 5, y], [PLATE.x + PLATE.w - 5, y], 0, P), { tone: 'faint' }));
  // label plate at the back left, three rule lines standing for its print
  const label = { x: -176, y: -74, w: 34, d: 12, r: 1 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 4), { tone: 'mid', crease: 'none' }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.6), 0.8, P), { tone: 'faint' }));
  for (const [i, len] of [20, 14, 24].entries())
    out.push(
      L(
        k.lineOnTop(
          [label.x + 4, label.y + 3 + i * 3],
          [label.x + 4 + len, label.y + 3 + i * 3],
          0.8,
          P,
        ),
        { tone: 'lo', free: true },
      ),
    );
  out.push(
    screws(
      [
        [label.x + 2.2, label.y + 2.2],
        [label.x + label.w - 2.2, label.y + label.d - 2.2],
      ],
      0.8,
      0.4,
    ),
  );
  return out.join('');
}

// ---- conveyor: bed, side rails, rollers at both ends, belt stripes ------------------------------
function conveyor() {
  const out = [];
  out.push(S(k.slabOf(BELT, 0, BELT_H, P, 3, 0.4), { tone: 'mid' }));
  // belt stripes run edge to edge across the bed
  for (let x = BELT.x + 8; x < BELT.x + BELT.w - 4; x += 10)
    out.push(L(k.lineOnTop([x, BELT.y], [x, BELT.y + BELT.d], BELT_H, P), { tone: 'faint' }));
  // guide rails on both sides, slightly taller than a page
  for (const y of [BELT.y - 3, BELT.y + BELT.d]) {
    out.push(
      S(k.slabOf({ x: BELT.x - 2, y, w: BELT.w + 4, d: 3, r: 0.8 }, 0, 6.5, P, 3, 0.4), {
        tone: 'mid',
      }),
    );
    out.push(
      screws(
        [
          [BELT.x + 6, y + 1.5],
          [BELT.x + BELT.w / 2, y + 1.5],
          [BELT.x + BELT.w - 6, y + 1.5],
        ],
        6.5,
      ),
    );
  }
  // end rollers as drums with a knurl
  for (const x of [BELT.x + 3, BELT.x + BELT.w - 3]) {
    out.push(S(k.cylinder(x, BELT.y + BELT.d / 2, 3.2, BELT_H, 4.2, P, 24), { tone: 'mid' }));
    out.push(L(k.knurl(x, BELT.y + BELT.d / 2, 3.2, BELT_H, BELT_H + 4.2, 20, P), { tone: 'lo' }));
  }
  return out.join('');
}

// ---- a C-arm station: post behind the belt, collar, arm over the belt, tool hanging from it -----
function carm(x, armLen = 32) {
  const out = [];
  out.push(S(k.cylinder(x, POST_Y, 4.6, 0, 4, P, 28), { tone: 'mid' }));
  out.push(S(k.cylinder(x, POST_Y, 3.2, 4, ARM_Z - 4, P, 28), { tone: 'mid', crease: 'none' }));
  out.push(L([12, 20].map((z) => k.sideArc(x, POST_Y, 3.2, z, P, 16)).join(''), { tone: 'faint' }));
  out.push(S(k.cylinder(x, POST_Y, 4.2, ARM_Z, 6, P, 28), { tone: 'mid' }));
  const arm = { x: x - 3.5, y: POST_Y, w: 7, d: armLen, r: 1.5 };
  out.push(S(k.slabOf(arm, ARM_Z + 1, 4, P, 3, 0.5), { tone: 'mid' }));
  out.push(
    screws(
      [
        [x, POST_Y + 6],
        [x, POST_Y + armLen - 4],
      ],
      ARM_Z + 5,
    ),
  );
  return out.join('');
}

function scanner() {
  const out = [carm(STATIONS.scan)];
  const x = STATIONS.scan;
  // camera can under the arm, lens ring on its underside, lamp bar across the belt
  out.push(S(k.cylinder(x, TOOL_Y, 4.5, ARM_Z - 7, 8, P, 28), { tone: 'hi' }));
  out.push(L(k.knurl(x, TOOL_Y, 4.5, ARM_Z - 7, ARM_Z - 5, 28, P), { tone: 'lo' }));
  out.push(
    `<g data-part="lamp">${S(k.slabOf({ x: x - 10, y: TOOL_Y - 10, w: 20, d: 20, r: 1 }, 18, 2.2, P, 3), { tone: 'mid' })}</g>`,
  );
  out.push(
    L(k.planOutline({ x: x - 7, y: TOOL_Y - 7, w: 14, d: 14, r: 0.8 }, 20.2, P, 3), {
      tone: 'faint',
    }),
  );
  out.push(screws(k.corners({ x: x - 10, y: TOOL_Y - 10, w: 20, d: 20 }, 2), 20.2, 0.4));
  // two rods from the arm to the lamp bar
  for (const y of [TOOL_Y - 7, TOOL_Y + 7])
    out.push(
      S(k.cylinder(x + 7.5, y, 1, 20.2, ARM_Z + 1 - 20.2, P, 12), { tone: 'mid', crease: 'none' }),
    );
  return out.join('');
}

function cutter() {
  const out = [carm(STATIONS.cut)];
  const x = STATIONS.cut;
  // blade guides: two blocks under the arm with a slot between them
  for (const y of [TOOL_Y - 12, TOOL_Y + 9]) {
    out.push(
      S(k.slabOf({ x: x - 4, y, w: 8, d: 3, r: 0.6 }, ARM_Z - 6, 7, P, 2, 0.4), { tone: 'mid' }),
    );
    out.push(screws([[x, y + 1.5]], ARM_Z + 1, 0.4));
  }
  return out.join('');
}
const BLADE_REST = 10;
const BLADE_CUT = BELT_H - 10; // its bottom edge reaches the belt
function blade() {
  const x = STATIONS.cut;
  const out = [
    S(k.slabOf({ x: x - 0.9, y: TOOL_Y - 9, w: 1.8, d: 18, r: 0.3 }, 0, 10, P, 2), {
      tone: 'hi',
      lit: true,
    }),
  ];
  out.push(
    S(k.slabOf({ x: x - 2.4, y: TOOL_Y - 9, w: 4.8, d: 18, r: 0.6 }, 10, 3, P, 2, 0.4), {
      tone: 'mid',
    }),
  );
  out.push(
    S(k.cylinder(x, TOOL_Y, 1.6, 13, ARM_Z + 1 - 13 + 14, P, 12), { tone: 'mid', crease: 'none' }),
  );
  return out.join('');
}

function stamper() {
  const out = [carm(STATIONS.stamp)];
  const x = STATIONS.stamp;
  // a bushing on the arm's tip that the stamp shaft runs through, and a thumb knob to set it
  out.push(S(k.cylinder(x, TOOL_Y, 3.4, ARM_Z - 4, 4, P, 24), { tone: 'mid' }));
  out.push(S(k.cylinder(x, TOOL_Y, 3.4, ARM_Z + 5, 2, P, 24), { tone: 'mid' }));
  const knob = [x + 7.5, POST_Y + 12];
  out.push(S(k.cylinder(knob[0], knob[1], 2.8, ARM_Z + 5, 3.2, P, 20), { tone: 'mid' }));
  out.push(L(k.knurl(knob[0], knob[1], 2.8, ARM_Z + 5, ARM_Z + 8.2, 18, P), { tone: 'lo' }));
  out.push(
    L(k.lineOnTop([knob[0], knob[1]], [knob[0] + 2.2, knob[1]], ARM_Z + 8.2, P), { tone: 'hi' }),
  );
  out.push(D([at([knob[0], knob[1], ARM_Z + 8.2])], { size: 0.45, tone: 'hi' }));
  return out.join('');
}
const STAMP_REST = 10;
const STAMP_DOWN = PAGE_TOP;
function stamp() {
  const x = STATIONS.stamp;
  const out = [S(k.cylinder(x, TOOL_Y, 4.2, 0, 3, P, 24), { tone: 'hi', lit: true })];
  out.push(S(k.cylinder(x, TOOL_Y, 2.4, 3, 6, P, 16), { tone: 'hi', crease: 'none' }));
  out.push(
    S(k.cylinder(x, TOOL_Y, 1.4, 9, ARM_Z + 10 - 9, P, 12), { tone: 'mid', crease: 'none' }),
  );
  out.push(S(k.cylinder(x, TOOL_Y, 2.6, ARM_Z + 10, 2.4, P, 16), { tone: 'mid' }));
  return out.join('');
}

function embedder() {
  const out = [carm(STATIONS.embed)];
  const x = STATIONS.embed;
  const hood = { x: x - 11, y: TOOL_Y - 11, w: 22, d: 22, r: 2 };
  out.push(S(k.slabOf(hood, 8, 6, P, 4, 0.6), { tone: 'hi', crease: 'lo' }));
  out.push(L(k.planOutline(k.insetPlan(hood, 2.5), 14, P, 4), { tone: 'faint' }));
  out.push(
    `<g data-part="grid">${D(k.dotGrid(x - 6, TOOL_Y - 6, 4, 4, 4, 14, P), { size: 0.55, tone: 'lo', pulse: true })}</g>`,
  );
  out.push(screws(k.corners(hood, 1.6), 14, 0.4));
  for (const y of [TOOL_Y - 8, TOOL_Y + 8])
    out.push(
      S(k.cylinder(x + 8.5, y, 1, 14, ARM_Z + 1 - 14, P, 12), { tone: 'mid', crease: 'none' }),
    );
  return out.join('');
}

// ---- pages and chunks (built at x = 0; moved along the belt) -------------------------------------
function page() {
  const out = [S(k.slabOf(PAGE, BELT_H, PAGE_H, P, 2), { tone: 'hi', crease: 'lo' })];
  for (const [i, len] of [11, 8, 12, 6].entries())
    out.push(
      L(
        k.lineOnTop(
          [PAGE.x + 2, PAGE.y + 2.4 + i * 2.2],
          [PAGE.x + 2 + len, PAGE.y + 2.4 + i * 2.2],
          PAGE_TOP,
          P,
        ),
        { tone: 'lo', free: true },
      ),
    );
  return out.join('');
}
const chunkPlans = () =>
  [0, 1, 2].map((i) => ({
    x: PAGE.x + i * (CHUNK_W + CHUNK_GAP),
    y: PAGE.y,
    w: CHUNK_W,
    d: PAGE.d,
    r: 0.5,
  }));
function chunks() {
  const out = [];
  for (const [i, plan] of chunkPlans().entries()) {
    out.push(S(k.slabOf(plan, BELT_H, PAGE_H, P, 2), { tone: 'hi', crease: 'lo' }));
    for (const [j, len] of [2.4, 1.8, 2.8].entries())
      out.push(
        L(
          k.lineOnTop(
            [plan.x + 1, plan.y + 2.4 + j * 2.2],
            [plan.x + 1 + len, plan.y + 2.4 + j * 2.2],
            PAGE_TOP,
            P,
          ),
          { tone: 'lo', free: true },
        ),
      );
    out.push(
      `<g data-part="mark${i}" opacity="0">${L(k.ring(plan.x + CHUNK_W / 2, plan.y + PAGE.d - 2.6, 1.1, PAGE_TOP, P, 14), { tone: 'hi' })}</g>`,
    );
    out.push(
      `<g data-part="dots${i}" opacity="0">${D(k.dotGrid(plan.x + 1.3, plan.y + 9, 3, 2, 1, PAGE_TOP, P), { size: 0.35, tone: 'hi' })}</g>`,
    );
  }
  return out.join('');
}

// ---- cabinet (Postgres): three drawers, pulls, label holders, a lock ------------------------------
function cabinet() {
  const out = [
    `<path class="iso-halo" d="${k.haloOf(k.insetPlan(CAB, 2), 0, 0.1, P)}" style="filter:blur(4px)"/>`,
  ];
  out.push(
    S(k.slabOf(CAB, 0, CAB_H, P, 4, 1), {
      tone: 'mid',
      inner: L(k.sideSeam(CAB, CAB_H - 3, P, 4), { tone: 'faint' }),
    }),
  );
  out.push(L(k.planOutline(k.insetPlan(CAB, 4), CAB_H, P, 4), { tone: 'faint' }));
  out.push(screws(k.corners(CAB, 3), CAB_H, 0.45));
  // the slot in the left wall where the belt feeds in is hidden from this camera; its lip shows on the top edge
  for (const [i, z] of DRAWER_Z.entries()) {
    if (i === 1) continue; // the middle drawer is the live one, drawn as its own group
    out.push(drawerFront(z));
  }
  // the opening the live drawer slides out of: a dark recess in the front face, covered by the drawer front when closed
  out.push(
    S(
      k.slabOf(
        { x: CAB.x + 5, y: CAB_FRONT - 0.4, w: CAB.w - 10, d: 0.4, r: 0.2 },
        DRAWER_Z[1] + 0.5,
        DRAWER_H - 1,
        P,
        2,
      ),
      { tone: 'lo', crease: 'none' },
    ),
  );
  // vent slots on the right face, closed outlines; a nameplate on the lid with its print as rule lines
  const vx = CAB.x + CAB.w + 0.05;
  for (let i = 0; i < 6; i++) {
    const y0 = CAB.y + 10 + i * 7,
      z0 = CAB_H - 14,
      z1 = CAB_H - 6;
    out.push(
      L(
        [
          k.segment([vx, y0, z0], [vx, y0 + 2.4, z0], P),
          k.segment([vx, y0 + 2.4, z0], [vx, y0 + 2.4, z1], P),
          k.segment([vx, y0 + 2.4, z1], [vx, y0, z1], P),
          k.segment([vx, y0, z1], [vx, y0, z0], P),
        ].join(''),
        { tone: 'lo' },
      ),
    );
  }
  const plateOn = { x: CAB.x + 30, y: CAB.y + 20, w: 36, d: 14, r: 1 };
  out.push(S(k.slabOf(plateOn, CAB_H, 0.8, P, 3), { tone: 'hi', crease: 'none' }));
  out.push(L(k.planOutline(k.insetPlan(plateOn, 1.6), CAB_H + 0.8, P, 3), { tone: 'faint' }));
  for (const [i, len] of [22, 16, 26].entries())
    out.push(
      L(
        k.lineOnTop(
          [plateOn.x + 4, plateOn.y + 3.5 + i * 3.4],
          [plateOn.x + 4 + len, plateOn.y + 3.5 + i * 3.4],
          CAB_H + 0.8,
          P,
        ),
        { tone: 'lo', free: true },
      ),
    );
  out.push(
    screws(
      [
        [plateOn.x + 2.2, plateOn.y + 2.2],
        [plateOn.x + plateOn.w - 2.2, plateOn.y + plateOn.d - 2.2],
      ],
      CAB_H + 0.8,
      0.4,
    ),
  );
  // lock: a round escutcheon on the front face, top right
  const lockAt = [CAB.x + CAB.w - 8, CAB_FRONT, CAB_H - 8];
  out.push(
    S(
      k.slabOf(
        { x: lockAt[0] - 3.2, y: CAB_FRONT - 0.6, w: 6.4, d: 1.8, r: 0.8 },
        CAB_H - 11.2,
        6.4,
        P,
        3,
      ),
      { tone: 'hi' },
    ),
  );
  out.push(L(k.sideRing([lockAt[0], CAB_FRONT + 1.2, lockAt[2]], 2, 'y', P, 20), { tone: 'lo' }));
  out.push(
    L(
      k.segment(
        [lockAt[0], CAB_FRONT + 1.3, lockAt[2] - 1.2],
        [lockAt[0], CAB_FRONT + 1.3, lockAt[2] + 1.2],
        P,
      ),
      { tone: 'hi' },
    ),
  );
  return out.join('');
}
function drawerFront(z, dy = 0) {
  const out = [];
  const front = { x: CAB.x + 5, y: CAB_FRONT + dy, w: CAB.w - 10, d: 1.6, r: 0.6 };
  out.push(S(k.slabOf(front, z, DRAWER_H, P, 3, 0.4), { tone: 'mid' }));
  // label holder: a rectangle on the face, with a card line inside
  const lx = front.x + 6;
  const face = CAB_FRONT + dy + 1.6 + 0.05;
  out.push(
    L(
      [
        k.segment([lx, face, z + 4], [lx + 16, face, z + 4], P),
        k.segment([lx + 16, face, z + 4], [lx + 16, face, z + 11], P),
        k.segment([lx + 16, face, z + 11], [lx, face, z + 11], P),
        k.segment([lx, face, z + 11], [lx, face, z + 4], P),
      ].join(''),
      { tone: 'lo' },
    ),
  );
  out.push(
    L(k.segment([lx + 3, face, z + 7.5], [lx + 12, face, z + 7.5], P), {
      tone: 'faint',
      free: true,
    }),
  );
  // pull: two posts and a bar
  const px = front.x + front.w / 2;
  for (const dx of [-7, 7])
    out.push(
      S(
        k.slabOf({ x: px + dx - 1, y: CAB_FRONT + dy + 1.6, w: 2, d: 3, r: 0.6 }, z + 6.5, 3, P, 2),
        { tone: 'mid', crease: 'none' },
      ),
    );
  out.push(
    S(
      k.slabOf({ x: px - 9, y: CAB_FRONT + dy + 4.4, w: 18, d: 1.6, r: 0.7 }, z + 6, 4, P, 3, 0.3),
      { tone: 'hi' },
    ),
  );
  return out.join('');
}
// the live drawer: its box only exists in front of the cabinet face, so it is drawn when open
function drawerBox() {
  const z = DRAWER_Z[1];
  const out = [S(k.slabOf(DRAWER_BOX, z + 1, 1.6, P, 2), { tone: 'mid', crease: 'none' })];
  for (const x of [DRAWER_BOX.x, DRAWER_BOX.x + DRAWER_BOX.w - 1.6])
    out.push(
      S(
        k.slabOf(
          { x, y: DRAWER_BOX.y, w: 1.6, d: DRAWER_BOX.d, r: 0.3 },
          z + 1,
          DRAWER_H - 2,
          P,
          2,
        ),
        { tone: 'mid', crease: 'none' },
      ),
    );
  // stored chunks standing in rows, like cards in a file
  for (let i = 0; i < 8; i++) {
    const plan = { x: DRAWER_BOX.x + 6 + i * 7.6, y: DRAWER_BOX.y + 5, w: 1.4, d: 18, r: 0.3 };
    out.push(S(k.slabOf(plan, z + 2.6, 9, P, 2), { tone: i < 6 ? 'lo' : 'hi', crease: 'none' }));
  }
  // the three chunks that just arrived, lit, standing at the back
  out.push(
    `<g data-part="stored">${[0, 1, 2].map((i) => S(k.slabOf({ x: DRAWER_BOX.x + 52 + i * 5.4, y: DRAWER_BOX.y + 5, w: 1.4, d: 18, r: 0.3 }, z + 2.6, 9, P, 2), { tone: 'hi', lit: true, crease: 'none' })).join('')}</g>`,
  );
  return out.join('');
}

// ---- front rails, end stops, the query carriage with its two probes ------------------------------
function rails() {
  const out = [];
  for (const y of RAIL_Y) {
    out.push(
      S(k.slabOf({ x: RAIL_X[0], y, w: RAIL_X[1] - RAIL_X[0], d: 4, r: 1 }, 0, 3, P, 3, 0.4), {
        tone: 'mid',
      }),
    );
    out.push(
      screws(
        [
          [RAIL_X[0] + 6, y + 2],
          [(RAIL_X[0] + RAIL_X[1]) / 2, y + 2],
          [RAIL_X[1] - 6, y + 2],
        ],
        3,
        0.4,
      ),
    );
  }
  for (const x of [RAIL_X[0] - 5, RAIL_X[1]]) {
    out.push(
      S(
        k.slabOf(
          { x, y: RAIL_Y[0] - 3, w: 5, d: RAIL_Y[1] - RAIL_Y[0] + 10, r: 1.2 },
          0,
          7,
          P,
          3,
          0.5,
        ),
        { tone: 'mid' },
      ),
    );
    out.push(
      screws(
        [
          [x + 2.5, RAIL_Y[0]],
          [x + 2.5, RAIL_Y[1] + 4],
        ],
        7,
      ),
    );
  }
  return out.join('');
}
function carriage() {
  const out = [
    `<path class="iso-halo" d="${k.haloOf(k.insetPlan(CARRIAGE, 3), CAR_Z, 0.1, P)}" style="filter:blur(4px)"/>`,
  ];
  out.push(S(k.slabOf(CARRIAGE, CAR_Z, CAR_TOP - CAR_Z, P, 5, 0.6), { tone: 'mid' }));
  for (const [x, y] of k.corners(CARRIAGE, 4)) {
    out.push(
      S(k.slabOf({ x: x - 2.5, y: y - 2.5, w: 5, d: 5, r: 1 }, CAR_TOP, 2.5, P, 2, 0.3), {
        tone: 'mid',
      }),
    );
    out.push(screws([[x, y]], CAR_TOP + 2.5, 0.4));
  }
  out.push(
    L(
      k.lineOnTop(
        [CARRIAGE.x, RAIL_Y[0] + 2],
        [CARRIAGE.x + CARRIAGE.w, RAIL_Y[0] + 2],
        CAR_TOP,
        P,
      ),
      { tone: 'faint' },
    ),
  );
  out.push(
    L(
      k.lineOnTop(
        [CARRIAGE.x, RAIL_Y[1] + 2],
        [CARRIAGE.x + CARRIAGE.w, RAIL_Y[1] + 2],
        CAR_TOP,
        P,
      ),
      { tone: 'faint' },
    ),
  );
  out.push(
    D(
      [-12, -4, 4, 12].map((x) => at([x, CARRIAGE.y + CARRIAGE.d - 2.4, CAR_TOP])),
      { size: 0.4, tone: 'lo' },
    ),
  );
  // handle on the front face
  const handle = [CARRIAGE.x + CARRIAGE.w - 7, CARRIAGE.y + CARRIAGE.d + 3];
  out.push(
    S(
      k.slabOf(
        { x: handle[0] - 2, y: CARRIAGE.y + CARRIAGE.d - 1, w: 4, d: 4, r: 1 },
        CAR_Z + 1,
        3,
        P,
        2,
      ),
      { tone: 'mid', crease: 'none' },
    ),
  );
  out.push(S(k.cylinder(handle[0], handle[1] + 1, 3, CAR_Z, 5, P, 20), { tone: 'mid' }));
  out.push(L(k.knurl(handle[0], handle[1] + 1, 3, CAR_Z, CAR_Z + 5, 18, P), { tone: 'lo' }));
  // mast and arm reaching back over the drawer
  out.push(S(k.cylinder(0, 54, 4.4, CAR_TOP + 2.5, 3, P, 24), { tone: 'mid' }));
  out.push(
    S(k.cylinder(0, 54, 3, CAR_TOP + 5.5, ARM_TOP - 5 - CAR_TOP - 5.5, P, 24), {
      tone: 'mid',
      crease: 'none',
    }),
  );
  out.push(L([24, 34].map((z) => k.sideArc(0, 54, 3, z, P, 16)).join(''), { tone: 'faint' }));
  out.push(S(k.cylinder(0, 54, 4, ARM_TOP - 5, 5, P, 24), { tone: 'mid' }));
  const arm = { x: -4, y: PROBE_Y - 4, w: 8, d: 54 - PROBE_Y + 4, r: 1.6 };
  out.push(S(k.slabOf(arm, ARM_TOP, 4, P, 3, 0.5), { tone: 'mid' }));
  out.push(
    screws(
      [
        [0, PROBE_Y + 1],
        [0, 48],
      ],
      ARM_TOP + 4,
    ),
  );
  // the crossbar carrying the two probe bushings
  out.push(
    S(k.slabOf({ x: -12, y: PROBE_Y - 3, w: 24, d: 6, r: 1.2 }, ARM_TOP + 1, 3, P, 3, 0.4), {
      tone: 'mid',
    }),
  );
  for (const x of [-8, 8])
    out.push(S(k.cylinder(x, PROBE_Y, 2.6, ARM_TOP - 3, 3, P, 18), { tone: 'mid' }));
  return out.join('');
}
// probes are built with their tip at z = 0 and lifted with translateAlong
function denseProbe() {
  const out = [S(k.cylinder(-8, PROBE_Y, 2.2, 0, 2.6, P, 18), { tone: 'hi', lit: true })];
  out.push(
    S(k.cylinder(-8, PROBE_Y, 1.1, 2.6, ARM_TOP + 6 - PROBE_UP - 2.6, P, 12), {
      tone: 'hi',
      crease: 'none',
      lit: true,
    }),
  );
  out.push(S(k.cylinder(-8, PROBE_Y, 2, ARM_TOP + 6 - PROBE_UP, 2, P, 16), { tone: 'mid' }));
  return out.join('');
}
function ftsProbe() {
  const out = [];
  for (let i = 0; i < 5; i++)
    out.push(
      S(k.cylinder(8, PROBE_Y - 4 + i * 2, 0.5, 0, 3, P, 8), {
        tone: 'hi',
        crease: 'none',
        lit: true,
      }),
    );
  out.push(
    S(k.slabOf({ x: 6.6, y: PROBE_Y - 5, w: 2.8, d: 10, r: 0.5 }, 3, 1.6, P, 2), {
      tone: 'hi',
      lit: true,
    }),
  );
  out.push(
    S(k.cylinder(8, PROBE_Y, 1.1, 4.6, ARM_TOP + 6 - PROBE_UP - 4.6, P, 12), {
      tone: 'hi',
      crease: 'none',
      lit: true,
    }),
  );
  out.push(S(k.cylinder(8, PROBE_Y, 2, ARM_TOP + 6 - PROBE_UP, 2, P, 16), { tone: 'mid' }));
  return out.join('');
}

// ---- dial gauges: the fusion dial by the drawer, the eval gauge at the left end -------------------
function gauge([x, y], r, z, top, count) {
  const out = [
    S(k.slabOf({ x: x - 7, y: y - 7, w: 14, d: 14, r: 2 }, 0, z - 6, P, 4, 0.6), { tone: 'mid' }),
  ];
  out.push(S(k.cylinder(x, y, 3.2, z - 6, 6, P, 20), { tone: 'mid', crease: 'none' }));
  out.push(S(k.cylinder(x, y, r, z, top - z, P, 56, 0.8), { tone: 'hi', crease: 'lo' }));
  out.push(L(k.knurl(x, y, r, top - 3, top, 60, P, 0.3), { tone: 'lo' }));
  out.push(L(k.sideArc(x, y, r, top - 3, P, 30), { tone: 'faint' }));
  out.push(L(k.ring(x, y, r - 2, top, P, 48), { tone: 'lo' }));
  const ticks = k.radialTicks(
    x,
    y,
    r - 2.6,
    count,
    5,
    top,
    [1.1, 2.4],
    P,
    -Math.PI * 0.75,
    Math.PI * 1.5,
  );
  out.push(L(ticks.minor, { tone: 'lo' }), L(ticks.major, { tone: 'mid' }));
  out.push(
    S(k.slabOf({ x: x + r - 1, y: y - 2, w: 4, d: 4, r: 1 }, z + 2, 4, P, 2), { tone: 'mid' }),
  );
  out.push(
    S(k.slabOf({ x: x + r + 2.6, y: y - 2.6, w: 2.2, d: 5.2, r: 1 }, z + 1.4, 5.2, P, 2), {
      tone: 'mid',
    }),
  );
  out.push(L(k.ring(x, y, 1.4, top, P, 14), { tone: 'mid' }));
  return out.join('');
}
const needleAt = ([x, y], r, top, share) => {
  const angle = -Math.PI * 0.75 + share * Math.PI * 1.5;
  return k.lineOnTop(
    [x - Math.sin(angle) * 3, y + Math.cos(angle) * 3],
    [x + Math.sin(angle) * (r - 3.4), y - Math.cos(angle) * (r - 3.4)],
    top + 0.2,
    P,
  );
};

// ---- output: a slot with a lifting gate; the answer card rises out of it with three citation tabs --
function outputSlot() {
  const out = [S(k.slabOf(SLOT, 0, SLOT_H, P, 3, 0.6), { tone: 'mid' })];
  out.push(L(k.planOutline(k.insetPlan(SLOT, 4.6), SLOT_H, P, 2), { tone: 'lo' }));
  out.push(screws(k.corners(SLOT, 2.4), SLOT_H, 0.4));
  for (const x of [SLOT.x + 3, SLOT.x + SLOT.w - 3]) {
    out.push(
      S(k.cylinder(x, SLOT.y + SLOT.d / 2, 1.3, SLOT_H, GATE_UP + 4 - SLOT_H, P, 12), {
        tone: 'mid',
        crease: 'none',
      }),
    );
    out.push(S(k.cylinder(x, SLOT.y + SLOT.d / 2, 2, GATE_UP + 4, 1.6, P, 14), { tone: 'mid' }));
  }
  return out.join('');
}
function gate() {
  const y = SLOT.y + SLOT.d / 2;
  const out = [
    S(k.slabOf({ x: SLOT.x + 1, y: y - 1.2, w: SLOT.w - 2, d: 2.4, r: 0.8 }, 0, 2.4, P, 3, 0.3), {
      tone: 'hi',
    }),
  ];
  for (const x of [SLOT.x + 3, SLOT.x + SLOT.w - 3])
    out.push(S(k.cylinder(x, y, 2.4, -0.6, 3.6, P, 14), { tone: 'mid' }));
  return out.join('');
}
function card() {
  const out = [S(k.slabOf(CARD, 0, 1.2, P, 2), { tone: 'hi', lit: true, crease: 'lo' })];
  for (const [i, len] of [16, 12, 18, 9].entries())
    out.push(
      L(
        k.lineOnTop(
          [CARD.x + 2.4, CARD.y + 1.8 + i * 1.9],
          [CARD.x + 2.4 + len, CARD.y + 1.8 + i * 1.9],
          1.2,
          P,
        ),
        { tone: 'lo', free: true },
      ),
    );
  // three citation tabs along the far edge, each a small raised block
  for (let i = 0; i < 3; i++)
    out.push(
      S(k.slabOf({ x: CARD.x + 3 + i * 7, w: 5, y: CARD.y - 1.6, d: 2.2, r: 0.4 }, 0, 1.6, P, 2), {
        tone: 'hi',
        crease: 'none',
      }),
    );
  return out.join('');
}

// ---- assemble, back to front ----------------------------------------------------------------------
const fused0 = 0;
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    'The retrieval bench: a page rides a conveyor through a scanner, a cutter, a stamp and an embedding hood into a locked filing cabinet; a carriage on front rails dips a round probe and a comb into the open drawer, a dial fuses the two readings, a gate lifts and an answer card rises with three citation tabs. A gauge at the left end reads recall against the golden set.',
  body: [
    plate(),
    gauge(EVAL, EVAL_R, EVAL_Z, EVAL_TOP, 40),
    `<path data-part="eval-needle" class="iso-line" data-tone="lit" data-free="start" d="${needleAt(EVAL, EVAL_R, EVAL_TOP, 0)}" style="stroke-width:1.1"/>`,
    conveyor(),
    scanner(),
    cutter(),
    stamper(),
    embedder(),
    `<g data-part="page" transform="${k.translateAlong(P, [PAGE_X0, 0, 0])}">${page()}</g>`,
    `<g data-part="chunks" opacity="0" transform="${k.translateAlong(P, [PAGE_X0, 0, 0])}">${chunks()}</g>`,
    `<g data-part="blade" transform="${k.translateAlong(P, [0, 0, BLADE_REST])}">${blade()}</g>`,
    `<g data-part="stamp" transform="${k.translateAlong(P, [0, 0, STAMP_REST])}">${stamp()}</g>`,
    cabinet(),
    `<g data-part="drawer-box" opacity="0">${drawerBox()}</g>`,
    `<g data-part="drawer">${drawerFront(DRAWER_Z[1])}</g>`,
    gauge(FUSE, FUSE_R, FUSE_Z, FUSE_TOP, 40),
    `<path data-part="fuse-needle" class="iso-line" data-tone="lit" data-free="start" d="${needleAt(FUSE, FUSE_R, FUSE_TOP, fused0)}" style="stroke-width:1.1"/>`,
    rails(),
    outputSlot(),
    `<g data-part="card" transform="${k.translateAlong(P, [0, 0, CARD_DOWN])}">${card()}</g>`,
    `<g data-part="gate" transform="${k.translateAlong(P, [0, 0, GATE_DOWN])}">${gate()}</g>`,
    `<g data-part="carriage" transform="${k.translateAlong(P, [CAR_X0, 0, 0])}">${carriage()}<g data-part="dense" transform="${k.translateAlong(P, [0, 0, PROBE_UP])}">${denseProbe()}</g><g data-part="fts" transform="${k.translateAlong(P, [0, 0, PROBE_UP])}">${ftsProbe()}</g></g>`,
  ],
});

// ---- live: one tour clock drives every part from the model ----------------------------------------
const live = `
const P = ${JSON.stringify(P)};
const M = ${JSON.stringify(MODEL)};
const X = ${JSON.stringify({ PAGE_X0, STATIONS, STORE_X, CAR_X0, CAR_X1, BLADE_REST, BLADE_CUT, STAMP_REST, STAMP_DOWN, PROBE_UP, PROBE_DOWN, DRAWER_OPEN, CARD_DOWN, CARD_UP, GATE_DOWN, GATE_UP, FUSE, FUSE_R, FUSE_TOP, EVAL, EVAL_R, EVAL_TOP, FUSED_MAX })};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const part = (name) => svg.querySelector('[data-part="' + name + '"]');
const el = Object.fromEntries(["page", "chunks", "blade", "stamp", "lamp", "grid", "drawer", "drawer-box", "stored", "carriage", "dense", "fts", "fuse-needle", "eval-needle", "card", "gate", "mark0", "mark1", "mark2", "dots0", "dots1", "dots2"].map((n) => [n, part(n)]));
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const needleAt = ${needleAt.toString().replace('k.lineOnTop', 'lineOnTop')};
const rrf = (rank) => 1 / (M.rrfK + rank);

// The tour: one clock, seven phases. Each phase maps the clock to targets for every moving part.
const PHASES = [
  { name: "parse", dur: 2.6, say: "parse · per page, OCR when no text layer" },
  { name: "chunk", dur: 2.2, say: "chunk · § headings, " + M.chunkChars.toLocaleString() + " chars, " + M.overlap + " overlap" },
  { name: "context", dur: 2.0, say: "context · stamped file › section" },
  { name: "embed", dur: 2.2, say: "embed · " + M.embedModel + ", " + M.dims.toLocaleString() + " dims" },
  { name: "store", dur: 2.2, say: "store · Postgres row: text, tsv, vector, ACL" },
  { name: "search", dur: 3.4, say: "search · dense " + M.candidates + " ∥ full text " + M.candidates + ", as caller" },
  { name: "answer", dur: 3.0, say: "answer · fused" },
  { name: "eval", dur: 2.6, say: "eval · recall@10" },
];
const TOTAL = PHASES.reduce((s, p) => s + p.dur, 0);
const phaseAt = (t) => { let acc = 0; for (const [i, p] of PHASES.entries()) { if (t < acc + p.dur) return { i, p, u: (t - acc) / p.dur }; acc += p.dur; } return { i: PHASES.length - 1, p: PHASES[PHASES.length - 1], u: 1 }; };
const bump = (u, a, b) => clamp((u - a) / (b - a), 0, 1);

// targets at tour time t, all in world units or 0..1 shares
function targets(t) {
  const { i, p, u } = phaseAt(t);
  const T = { page: X.PAGE_X0, pageOn: 1, chunksOn: 0, blade: X.BLADE_REST, stamp: X.STAMP_REST, lamp: 0, grid: 0, mark: 0, dots: 0, drawer: 0, stored: 0, car: X.CAR_X0, dense: X.PROBE_UP, fts: X.PROBE_UP, fuse: 0, card: X.CARD_DOWN, gate: X.GATE_DOWN, evalv: 0, phase: p, i };
  const e = ease(u);
  if (i === 0) { T.page = lerp(X.PAGE_X0, X.STATIONS.scan, bump(e, 0, 0.6)); T.lamp = bump(u, 0.5, 0.65) * (1 - bump(u, 0.9, 1)); }
  if (i >= 1) T.page = X.STATIONS.cut;
  if (i === 1) { T.page = lerp(X.STATIONS.scan, X.STATIONS.cut, bump(e, 0, 0.45)); const down = bump(u, 0.5, 0.65), up = bump(u, 0.72, 0.9); T.blade = lerp(X.BLADE_REST, X.BLADE_CUT, down - up * down); T.pageOn = u < 0.6 ? 1 : 0; T.chunksOn = u < 0.6 ? 0 : 1; }
  if (i >= 2) { T.pageOn = 0; T.chunksOn = 1; T.page = X.STATIONS.stamp; }
  if (i === 2) { T.page = lerp(X.STATIONS.cut, X.STATIONS.stamp, bump(e, 0, 0.45)); const down = bump(u, 0.5, 0.65), up = bump(u, 0.74, 0.9); T.stamp = lerp(X.STAMP_REST, X.STAMP_DOWN, down - up * down); T.mark = bump(u, 0.66, 0.72); }
  if (i >= 3) { T.mark = 1; T.page = X.STATIONS.embed; }
  if (i === 3) { T.page = lerp(X.STATIONS.stamp, X.STATIONS.embed, bump(e, 0, 0.45)); T.grid = bump(u, 0.45, 0.6) * (1 - bump(u, 0.85, 1)); T.dots = bump(u, 0.6, 0.72); }
  if (i >= 4) { T.dots = 1; T.chunksOn = 0; }
  if (i === 4) { T.page = lerp(X.STATIONS.embed, X.STORE_X, bump(e, 0, 0.5)); T.chunksOn = u < 0.5 ? 1 : 0; T.drawer = bump(e, 0.55, 1); T.stored = bump(u, 0.8, 0.95); }
  if (i >= 5) { T.drawer = 1; T.stored = 1; }
  if (i === 5) { T.car = lerp(X.CAR_X0, X.CAR_X1, bump(e, 0, 0.5)); const dip = bump(e, 0.55, 0.75); T.dense = lerp(X.PROBE_UP, X.PROBE_DOWN, dip); T.fts = lerp(X.PROBE_UP, X.PROBE_DOWN, dip * bump(e, 0.6, 0.8)); T.fuse = (rrf(1) * bump(u, 0.7, 0.85) + rrf(1) * bump(u, 0.82, 0.97)) / X.FUSED_MAX; }
  if (i >= 6) { T.car = X.CAR_X1; T.fuse = 1; }
  if (i === 6) { const lift = bump(e, 0, 0.3); T.dense = lerp(X.PROBE_DOWN, X.PROBE_UP, lift); T.fts = T.dense; T.gate = lerp(X.GATE_DOWN, X.GATE_UP, bump(e, 0.3, 0.55)); T.card = lerp(X.CARD_DOWN, X.CARD_UP, bump(e, 0.55, 0.9)); }
  if (i >= 7) { T.gate = X.GATE_UP; T.card = X.CARD_UP; }
  if (i === 7) { T.evalv = M.recallTarget * bump(e, 0.05, 0.6); T.car = lerp(X.CAR_X1, X.CAR_X0, bump(e, 0.5, 1)); T.drawer = 1 - bump(e, 0.6, 1); T.card = lerp(X.CARD_UP, X.CARD_DOWN, bump(e, 0.7, 1)); T.gate = lerp(X.GATE_UP, X.GATE_DOWN, bump(e, 0.85, 1)); }
  return T;
}

// state follows targets with exponential easing, so a scrub or a key press never snaps
const keys = ["page", "blade", "stamp", "lamp", "grid", "mark", "dots", "drawer", "stored", "car", "dense", "fts", "fuse", "card", "gate", "evalv"];
let S = targets(0), clock = 0, frame = 0, last = 0, touring = !still.matches, visible = false, idleTimer = 0, scrub = 0;
const tau = { page: 0.14, car: 0.18, blade: 0.06, stamp: 0.08, drawer: 0.16, card: 0.12, gate: 0.1, dense: 0.1, fts: 0.1, fuse: 0.2, evalv: 0.3 };
const opacity = (node, v) => node.setAttribute("opacity", String(Math.round(v * 100) / 100));
function draw(T) {
  el.page.setAttribute("transform", translateAlong(P, [S.page, 0, 0]));
  el.chunks.setAttribute("transform", translateAlong(P, [S.page, 0, 0]));
  opacity(el.page, T.pageOn); opacity(el.chunks, T.chunksOn);
  el.blade.setAttribute("transform", translateAlong(P, [0, 0, S.blade]));
  el.stamp.setAttribute("transform", translateAlong(P, [0, 0, S.stamp]));
  el.lamp.toggleAttribute("data-on", S.lamp > 0.5); el.grid.toggleAttribute("data-on", S.grid > 0.5);
  for (const i of [0, 1, 2]) { opacity(el["mark" + i], S.mark); opacity(el["dots" + i], S.dots); }
  el.drawer.setAttribute("transform", translateAlong(P, [0, S.drawer * X.DRAWER_OPEN, 0]));
  el["drawer-box"].setAttribute("transform", translateAlong(P, [0, (S.drawer - 1) * X.DRAWER_OPEN, 0]));
  opacity(el["drawer-box"], clamp(S.drawer / 0.12, 0, 1)); opacity(el.stored, S.stored);
  el.carriage.setAttribute("transform", translateAlong(P, [S.car, 0, 0]));
  el.dense.setAttribute("transform", translateAlong(P, [0, 0, S.dense]));
  el.fts.setAttribute("transform", translateAlong(P, [0, 0, S.fts]));
  el["fuse-needle"].setAttribute("d", needleAt(X.FUSE, X.FUSE_R, X.FUSE_TOP, S.fuse));
  el["eval-needle"].setAttribute("d", needleAt(X.EVAL, X.EVAL_R, X.EVAL_TOP, S.evalv));
  el.card.setAttribute("transform", translateAlong(P, [0, 0, S.card]));
  el.gate.setAttribute("transform", translateAlong(P, [0, 0, S.gate]));
  const fused = (S.fuse * X.FUSED_MAX).toFixed(4);
  const extra = T.i === 6 ? " " + fused + " by RRF k=" + M.rrfK + ", top " + M.topK + ", cited [n]" : T.i === 7 ? " " + S.evalv.toFixed(2) + ", gate " + M.recallTarget + " · MRR " + M.mrrTarget : "";
  const text = T.phase.say + extra;
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuenow", String(T.i));
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (touring) clock = (clock + dt) % TOTAL; else clock = scrub;
  const T = targets(clock);
  for (const key of keys) { const want = T[key]; S[key] = calm ? want : S[key] + (want - S[key]) * (1 - Math.exp(-dt / (tau[key] ?? 0.1))); if (Math.abs(want - S[key]) < 0.002) S[key] = want; }
  draw(T);
  const settled = !touring && keys.every((key) => S[key] === T[key]);
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const hold = () => { touring = false; clearTimeout(idleTimer); idleTimer = setTimeout(() => { touring = !still.matches; run(); }, 3600); run(); };
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("pointermove", (event) => {
  const box = svg.getBoundingClientRect();
  scrub = clamp((event.clientX - box.left) / box.width, 0, 0.999) * TOTAL;
  hold();
});
stage.addEventListener("pointerleave", () => { scrub = clock; hold(); });
stage.addEventListener("keydown", (event) => {
  const here = phaseAt(touring ? clock : scrub).i;
  let to = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") to = Math.min(PHASES.length - 1, here + 1);
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") to = Math.max(0, here - 1);
  if (event.key === "Home") to = 0;
  if (event.key === "End") to = PHASES.length - 1;
  if (to === null) return;
  event.preventDefault();
  let acc = 0; for (let i = 0; i < to; i++) acc += PHASES[i].dur;
  scrub = acc + PHASES[to].dur * 0.98; // the end of the phase: every part of that step in place
  hold();
});
draw(targets(0));
`;

const body = k.plateHtml({
  fig: 'Fig 1',
  title: 'The retrieval bench',
  hint: 'Hover to scrub · arrows step',
  readout: 'parse · per page, OCR when no text layer',
  keys: [
    {
      mark: 'lit',
      label: 'What moves: the blade, the stamp, the probes, the needles and the answer card',
    },
    {
      mark: 'raised',
      label: 'Cabinet = Postgres: one drawer per tenant, the lock is row-level security',
    },
    {
      mark: 'dotted',
      label: 'Dot grid = the embedding; every chunk leaves the hood carrying its own',
    },
  ],
  caption: `A page rides the back conveyor: the scanner reads it (OCR when there is no text layer), the blade cuts it into ${MODEL.chunkChars.toLocaleString()}-character chunks at section headings, the stamp marks each with file › section, the hood embeds it (${MODEL.embedModel}, ${MODEL.dims.toLocaleString()} dims) and it files into the cabinet. On the front rails the query carriage dips a round probe (dense) and a comb (full text) into the open drawer; the dial fuses the two lists by reciprocal rank (k = ${MODEL.rrfK}), the gate lifts and the answer card rises with its citation tabs. The gauge at the left reads recall@10 against the golden set; CI fails below ${MODEL.recallTarget}.`,
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="The retrieval bench: hover to scrub through the pipeline, arrow keys step through parse, chunk, context, embed, store, search, answer and eval" aria-valuemin="0" aria-valuemax="7" aria-valuenow="0">${svg}</div>`,
});

const extraCss = `<style>
[data-part="lamp"] .iso-top, [data-part="lamp"] .iso-side { transition: fill .25s; }
[data-part="lamp"][data-on] .iso-top { fill: var(--anatomy-lit-top); }
[data-part="lamp"][data-on] .iso-shade { fill: var(--anatomy-lit-shade); }
[data-part="grid"] circle { transition: r .25s, opacity .25s; }
[data-part="grid"][data-on] circle { r: 0.9; }
</style>`;

const file = theme === 'light' ? 'retrieval-bench-light.html' : 'retrieval-bench.html';
writeFileSync(
  join(HERE, file),
  k.pageHtml({
    title: 'The retrieval bench',
    theme,
    body: extraCss + body,
    script: kitScript() + live,
    width: 720,
  }),
);
console.log('wrote', file);

// A fragment for hosting inside another page (claude.ai artifact): same card, theme follows the host or the OS.
if (process.argv.includes('--artifact')) {
  const script = (kitScript() + live).replace(/<\/(script)/gi, '<\\/$1');
  const fragment = `<title>Retrieval bench</title><meta name="description" content="Animated anatomy of the rags2riches RAG pipeline: ingestion, hybrid search, permissions, eval."><style>${k.ISO_CSS}
*{box-sizing:border-box}
:root{--anatomy-page:#0b0b0b;--page-bg:#0b0b0b}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--page-bg:#f2f2ef}}
:root[data-theme="light"]{--page-bg:#f2f2ef}
body{margin:0;background:var(--page-bg);font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.iso-page{width:min(720px,100% - 32px);margin:32px auto 48px}
</style>${extraCss}<div class="iso" id="wrap"><main class="iso-page">${body}</main></div><script>
(function(){const w=document.getElementById("wrap");const pick=()=>{const forced=document.documentElement.dataset.theme;const light=forced?forced==="light":matchMedia("(prefers-color-scheme: light)").matches;w.dataset.theme=light?"light":"dark";};pick();matchMedia("(prefers-color-scheme: light)").addEventListener("change",pick);new MutationObserver(pick).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});})();
</script><script type="module">${script}</script>`;
  writeFileSync(join(HERE, 'retrieval-bench.artifact.html'), fragment);
  console.log('wrote retrieval-bench.artifact.html');
}
