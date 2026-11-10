// Shared isometric drawing engine for the two UI mockups (canvas 2D, no dependencies).
// It draws one fixed demo office; each theme decides how it looks. Not part of the product.
(function () {
  const hex = (h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const clamp = (v) => Math.max(0, Math.min(255, v)) | 0;
  const rgb = (c, f = 1, a = 1) => `rgba(${clamp(c[0] * f)},${clamp(c[1] * f)},${clamp(c[2] * f)},${a})`;

  // Fake data, the same in both mockups.
  const AGENTS = [
    { role: "Lead", acct: "work", model: "claude-opus-5-5", color: "#966edc", status: "working", tokens: 184230, interns: 2 },
    { role: "Lead", acct: "personal", model: "claude-sonnet-5-5", color: "#d97757", status: "waiting", tokens: 96410, interns: 1 },
    { role: "Coder", acct: "work", model: "gpt-6.1-sol", color: "#10a37f", status: "working", tokens: 71820, interns: 0 },
    { role: "Agent", acct: "work", model: "gemini-pro", color: "#508ceb", status: "waiting", tokens: 41200, interns: 1 },
    { role: "Coder", acct: "personal", model: "gpt-6.1-sol", color: "#10a37f", status: "working", tokens: 28104, interns: 0 },
    { role: "Lead", acct: "work", model: "claude-haiku-5-5", color: "#e6be46", status: "sleeping", tokens: 52330, interns: 0 },
    { role: "Agent", acct: "personal", model: "foo-model-9", color: "#8b90a0", status: "sleeping", tokens: 9120, interns: 0 },
  ];
  const DESKS = [[1.2, 0.9], [4.3, 0.9], [7.4, 0.9], [1.2, 4.1], [4.3, 4.1]]; // desk corners (x, y)
  const SOFAS = [[7.3, 4.5], [7.3, 6.3]]; // lounge sofas
  const ROOM = { w: 10.2, d: 8.0, h: 3.3 };

  function create(canvas, theme) {
    const W = theme.W, H = theme.H, dpr = theme.dpr || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const { tw, ox, oy } = theme;
    const sh = theme.shade;
    const P = (x, y, z = 0) => [ox + ((x - y) * tw) / 2, oy + ((x + y) * tw) / 4 - (z * tw) / 2];

    function poly(pts, fill, stroke, lw = 1) {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
    }
    // Box with base corner (x,y,z), size w (along x), d (along y), h (up). Visible: top, +y face, +x face.
    function box(x, y, z, w, d, h, c, o = {}) {
      const a = o.a ?? 1;
      const e = o.edge || null;
      poly([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], rgb(c, sh.top, a), e);
      poly([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)], rgb(c, sh.y, a), e);
      poly([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)], rgb(c, sh.x, a), e);
    }
    // Drawing surfaces: 1 plane unit = 1/100 of a world unit, origin at the top-left, v pointing down.
    // planeX lies along +x (the back wall and the +y face of a box); planeY lies along y (the left wall and +x faces).
    function planeX(x, y, zTop, fn) {
      const [ex, ey] = P(x, y, zTop);
      ctx.save();
      ctx.transform(tw / 200, tw / 400, 0, tw / 200, ex, ey);
      fn();
      ctx.restore();
    }
    // y here is the FAR (largest-y) end: text on the left wall and on +x faces runs toward smaller y, left to right on screen.
    function planeY(x, yMax, zTop, fn) {
      const [ex, ey] = P(x, yMax, zTop);
      ctx.save();
      ctx.transform(tw / 200, -tw / 400, 0, tw / 200, ex, ey);
      fn();
      ctx.restore();
    }
    // A flat shape lying on the floor, drawn in world units.
    function floorPlane(fn) {
      ctx.save();
      ctx.transform(tw / 2, tw / 4, -tw / 2, tw / 4, ox, oy);
      fn();
      ctx.restore();
    }
    function shadow(cx, cy, rx, ry, a = 0.18) {
      floorPlane(() => {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, 7);
        ctx.fillStyle = `rgba(0,0,0,${a})`;
        ctx.fill();
      });
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    return { ctx, W, H, tw, ox, oy, P, poly, box, planeX, planeY, floorPlane, shadow, roundRect, rgb, mix, hex, theme };
  }

  // ---- robots ----
  // A robot stands at (rx, ry) (base center). scale < 1 makes an intern.
  function robot(g, rx, ry, a, o = {}) {
    const t = g.theme.robot;
    const s = (o.scale ?? 1) * (g.theme.robotScale ?? 1);
    const col = g.hex(a.color);
    const asleep = a.status === "sleeping";
    const slump = asleep ? 0.1 * s : 0;
    const chassis = t.chassis(col, a);
    const head = t.head;
    const z0 = 0.16 * s;
    const bodyH = 0.8 * s;
    const headZ = z0 + bodyH - slump;
    // wheels / feet
    g.box(rx - 0.28 * s, ry - 0.22 * s, 0, 0.56 * s, 0.44 * s, z0, t.base);
    // body
    g.box(rx - 0.31 * s, ry - 0.25 * s, z0, 0.62 * s, 0.5 * s, bodyH - slump, chassis);
    // chest plate on the +y face
    g.planeX(rx - 0.31 * s, ry + 0.25 * s, z0 + bodyH - slump, () => {
      const W = 62 * s, Hh = (bodyH - slump) * 100;
      g.ctx.fillStyle = t.plate(col, a);
      g.ctx.fillRect(W * 0.2, Hh * 0.18, W * 0.6, Hh * 0.22);
      g.ctx.fillStyle = "rgba(255,255,255,.55)";
      g.ctx.fillRect(W * 0.28, Hh * 0.26, W * 0.16, Hh * 0.06);
    });
    // arms
    const armZ = z0 + bodyH * 0.3;
    g.box(rx - 0.47 * s, ry - 0.1 * s, armZ, 0.15 * s, 0.22 * s, bodyH * 0.55 - slump, g.mix(chassis, [0, 0, 0], 0.18));
    g.box(rx + 0.32 * s, ry - 0.1 * s, armZ, 0.15 * s, 0.22 * s, bodyH * 0.55 - slump, g.mix(chassis, [0, 0, 0], 0.18));
    // head
    const hw = 0.7 * s, hd = 0.54 * s, hh = 0.5 * s;
    const tilt = asleep ? 0.06 * s : 0;
    g.box(rx - hw / 2, ry - hd / 2 + tilt, headZ, hw, hd, hh, head);
    // face screen on the +y face
    g.planeX(rx - hw / 2, ry + hd / 2 + tilt, headZ + hh, () => {
      const c = g.ctx;
      const Wf = hw * 100, Hf = hh * 100;
      c.fillStyle = t.visor;
      c.fillRect(Wf * 0.1, Hf * 0.16, Wf * 0.8, Hf * 0.66);
      if (t.visorEdge) {
        c.strokeStyle = t.visorEdge(col);
        c.lineWidth = 2 * s;
        c.strokeRect(Wf * 0.1, Hf * 0.16, Wf * 0.8, Hf * 0.66);
      }
      const eye = t.eye(a.status, col);
      c.save();
      if (t.glow) {
        c.shadowColor = eye;
        c.shadowBlur = 10 * s;
      }
      c.strokeStyle = eye;
      c.fillStyle = eye;
      c.lineWidth = 5 * s;
      c.lineCap = "round";
      const ey = Hf * 0.46, lx = Wf * 0.32, rx2 = Wf * 0.68, r = Wf * 0.07;
      if (a.status === "working") {
        // happy ^ ^ eyes
        for (const x of [lx, rx2]) {
          c.beginPath();
          c.moveTo(x - r, ey + r * 0.6);
          c.lineTo(x, ey - r * 0.7);
          c.lineTo(x + r, ey + r * 0.6);
          c.stroke();
        }
      } else if (a.status === "waiting") {
        for (const x of [lx, rx2]) {
          c.beginPath();
          c.arc(x, ey, r * 0.8, 0, 7);
          c.fill();
        }
        c.beginPath();
        c.moveTo(Wf * 0.42, Hf * 0.68);
        c.lineTo(Wf * 0.58, Hf * 0.68);
        c.stroke();
      } else {
        for (const x of [lx, rx2]) {
          c.beginPath();
          c.moveTo(x - r, ey);
          c.lineTo(x + r, ey);
          c.stroke();
        }
      }
      c.restore();
    });
    // antenna
    const ax = rx - 0.03 * s, ay = ry - 0.03 * s + tilt;
    g.box(ax, ay, headZ + hh, 0.06 * s, 0.06 * s, 0.2 * s, t.base);
    const tip = t.antenna(col, a);
    if (t.glow && !asleep) {
      const [px, py] = g.P(rx, ry + tilt, headZ + hh + 0.3 * s);
      const grad = g.ctx.createRadialGradient(px, py, 1, px, py, 26 * s);
      grad.addColorStop(0, g.rgb(tip, 1, 0.55));
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.ctx.fillStyle = grad;
      g.ctx.fillRect(px - 30, py - 30, 60, 60);
    }
    g.box(rx - 0.065 * s, ry - 0.065 * s + tilt, headZ + hh + 0.2 * s, 0.13 * s, 0.13 * s, 0.13 * s, tip);
    return { top: g.P(rx, ry, headZ + hh + 0.4 * s) };
  }

  // ---- desk ----
  function desk(g, dx, dy, a) {
    const t = g.theme.desk;
    const top = 0.74;
    g.theme.underglow && g.theme.underglow(g, dx + 1.0, dy + 0.5, 1.5, 1.0, a);
    g.shadow(dx + 1.0, dy + 0.5, 1.25, 0.75, g.theme.shadowAlpha ?? 0.16);
    for (const [lx, ly] of [[0.06, 0.06], [1.82, 0.06], [0.06, 0.86], [1.82, 0.86]]) g.box(dx + lx, dy + ly, 0, 0.1, 0.1, top, t.leg);
    g.box(dx, dy, top, 2.0, 1.0, 0.08, t.top);
    // keyboard + mug
    g.box(dx + 0.7, dy + 0.52, top + 0.08, 0.6, 0.22, 0.03, t.key);
    g.box(dx + 1.65, dy + 0.55, top + 0.08, 0.16, 0.16, 0.16, t.mug);
    // monitor, seen from behind
    g.box(dx + 0.88, dy + 0.22, top + 0.08, 0.24, 0.1, 0.1, t.stand);
    g.box(dx + 0.5, dy + 0.18, top + 0.18, 1.0, 0.07, 0.55, t.monitor);
    // status light on the back of the monitor
    const lit = g.theme.statusColor(a.status);
    g.planeX(dx + 0.5, dy + 0.25, top + 0.18 + 0.55, () => {
      const c = g.ctx;
      c.save();
      if (g.theme.glow) {
        c.shadowColor = lit;
        c.shadowBlur = 14;
      }
      c.fillStyle = lit;
      c.beginPath();
      c.arc(88, 14, 6, 0, 7);
      c.fill();
      c.restore();
    });
    g.theme.nameplate && g.theme.nameplate(g, dx, dy, top, a);
  }

  function sofa(g, sx, sy, a) {
    const t = g.theme.sofa;
    g.theme.underglow && g.theme.underglow(g, sx + 0.8, sy + 0.45, 1.3, 0.9, a);
    g.shadow(sx + 0.8, sy + 0.45, 1.1, 0.7, g.theme.shadowAlpha ?? 0.16);
    g.box(sx, sy, 0, 1.6, 0.85, 0.32, t.base);
    g.box(sx, sy, 0.32, 1.6, 0.22, 0.5, t.back);
    g.box(sx - 0.14, sy, 0, 0.16, 0.85, 0.52, t.arm);
    g.box(sx + 1.58, sy, 0, 0.16, 0.85, 0.52, t.arm);
    robot(g, sx + 0.8, sy + 0.42, a, { scale: 0.92 });
  }

  // ---- frame ----
  function render(canvas, theme) {
    const g = create(canvas, theme);
    const { ctx, P } = g;
    theme.background(g);

    // floor slab and floor
    g.box(0, 0, -0.34, ROOM.w, ROOM.d, 0.34, theme.slab);
    g.poly([P(0, 0), P(ROOM.w, 0), P(ROOM.w, ROOM.d), P(0, ROOM.d)], theme.floorBase);
    theme.floor(g, ROOM);

    // walls: interior faces are the +y face of the back wall and the +x face of the left wall
    g.box(0, -0.3, 0, ROOM.w, 0.3, ROOM.h, theme.wall.back);
    g.box(-0.3, 0, 0, 0.3, ROOM.d, ROOM.h, theme.wall.left);
    g.box(0, 0, 0, ROOM.w, 0.06, 0.16, theme.wall.base);
    g.box(0, 0, 0, 0.06, ROOM.d, 0.16, theme.wall.base);
    theme.decor(g, ROOM);

    // things on the floor, painter's order by depth
    const items = [];
    const desksAgents = AGENTS.filter((a) => a.status !== "sleeping");
    const sleepers = AGENTS.filter((a) => a.status === "sleeping");
    desksAgents.forEach((a, i) => {
      const [dx, dy] = DESKS[i];
      items.push({ depth: dx + dy + 1.6, draw: () => {
        // an intern or two, standing beside the desk
        for (let k = 0; k < a.interns; k++) robot(g, dx + (k ? 2.55 : -0.55), dy + 1.0 + k * 0.2, { ...a, status: k ? "waiting" : "working" }, { scale: 0.42 });
        robot(g, dx + 1.0, dy - 0.32, a);
        desk(g, dx, dy, a);
      } });
    });
    sleepers.forEach((a, i) => {
      const [sx, sy] = SOFAS[i];
      items.push({ depth: sx + sy + 1.2, draw: () => sofa(g, sx, sy, a) });
    });
    (theme.props ? theme.props(g, ROOM) : []).forEach((p) => items.push(p));
    items.sort((p, q) => p.depth - q.depth);
    items.forEach((it) => it.draw());

    // speech bubbles and overlay on top of everything
    desksAgents.forEach((a, i) => {
      const [dx, dy] = DESKS[i];
      theme.bubble(g, g.P(dx + 1.0, dy - 0.32, 2.05), a);
    });
    sleepers.forEach((a, i) => {
      const [sx, sy] = SOFAS[i];
      theme.bubble(g, g.P(sx + 0.8, sy + 0.42, 1.95), a);
    });
    theme.overlay(g, AGENTS);
  }

  window.OFFICE = { render, AGENTS, ROOM, DESKS, SOFAS, hex, mix, rgb };
})();
