/* DSA Visual engine — step-by-step animated diagrams that play like a GIF.
 *
 * Usage in a lesson page:
 *   Viz.mount('#reverse-demo', { code: `java code`, frames: [...] });
 * A frame is { panels: [panel, ...], line: 3 | [3,4], say: 'beginner caption (HTML ok)' }.
 * Panels (every panel needs a unique `id` inside the viz):
 *   { type:'array', id, label, values:[..], keys?:[..], marks?:{i:cls}, pointers?:{name:i},
 *     window?:[l,r], bars?:bool, indices?:bool }
 *   { type:'list',  id, label, nodes:[{id,val}], next:{id:id|null}, pointers?:{name:id|null},
 *     marks?:{id:cls}, pos?:{id:[slot,row]}, nullAt?:'left'|'right' }
 *   { type:'tree',  id, label, root, nodes:{id:{val,left,right}}, marks?, pointers?, badges?:{id:text},
 *     edgeMarks?:{'p-c':cls} }
 *   { type:'graph', id, label, h?, nodes:[{id,x,y,label?}], edges:[{a,b,w?,dir?}], marks?,
 *     edgeMarks?:{'a-b':cls}, badges?:{id:text}, pointers? }
 *   { type:'grid',  id, label, cells:[[..]], rowLabels?, colLabels?, marks?:{'r,c':cls},
 *     arrows?:[[r1,c1,r2,c2,cls?]], cell? }
 *   { type:'stack', id, label, items:[val | {id,val}], kind?:'stack'|'queue'|'heap'|'set', marks?:{i:cls} }
 *   { type:'vars',  id, vars:{name:value}, marks?:{name:cls} }
 *   { type:'text',  id, text, cls? }
 * Mark classes: active, compare, done, bad, path, visited, dim, window.
 */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 760;
  const NUMS = ['x', 'y', 'w', 'h', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'bend', 'op'];
  const MARKS = ['', 'active', 'compare', 'done', 'bad', 'path', 'visited', 'dim'];
  let uid = 0;

  const tw = s => 7.6 * String(s).length + 18; // approximate box width for text
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ---------- panel builders: each returns { h, shapes } in panel-local coordinates ----------
  const B = {};
  function header(p, shapes) {
    if (!p.label) return 0;
    shapes.push({ k: `${p.id}:label`, t: 'text', x: 14, y: 16, text: p.label, cls: 'plabel', anchor: 'start' });
    return 24;
  }
  function pointerLabels(p, shapes, at, yBase, prefix = '↑ ') {
    // at: name -> {x}; stacks names that share an x
    const byX = new Map();
    for (const [name, pos] of Object.entries(at)) {
      if (!pos) continue;
      const key = Math.round(pos.x);
      const k = byX.get(key) || 0; byX.set(key, k + 1);
      shapes.push({ k: `${p.id}:p:${name}`, t: 'text', x: pos.x, y: yBase + 14 + k * 16, text: prefix + name, cls: `ptr ptr-${k % 4}` });
    }
    return byX.size ? 14 + (Math.max(...byX.values()) - 1) * 16 + 8 : 0;
  }

  B.array = p => {
    const s = []; let y = header(p, s);
    const n = p.values.length;
    const cw = Math.min(p.cell || 58, (W - 40) / Math.max(n, 1));
    const x0 = (W - n * cw) / 2;
    const maxV = p.bars ? Math.max(1, ...p.values.map(v => Math.abs(+v || 0))) : 1;
    const ch = p.bars ? 130 : 44;
    if (p.indices !== false) {
      for (let i = 0; i < n; i++) s.push({ k: `${p.id}:i:${i}`, t: 'text', x: x0 + i * cw + cw / 2, y: y + 11, text: i, cls: 'idx' });
      y += 16;
    }
    if (p.window && p.window[0] <= p.window[1]) {
      const [l, r] = p.window;
      s.push({ k: `${p.id}:win`, t: 'rect', x: x0 + l * cw - 4, y: y - 4, w: (r - l + 1) * cw + 8, h: ch + 8, cls: 'window', rx: 9 });
    }
    for (let i = 0; i < n; i++) {
      const key = p.keys ? p.keys[i] : i;
      const v = p.values[i];
      const cls = 'cell ' + (p.marks?.[i] || '');
      if (p.bars) {
        const bh = Math.max(4, (Math.abs(+v || 0) / maxV) * (ch - 18));
        s.push({ k: `${p.id}:c:${key}`, t: 'rect', x: x0 + i * cw + 3, y: y + ch - bh, w: cw - 6, h: bh, cls, rx: 4 });
        s.push({ k: `${p.id}:t:${key}`, t: 'text', x: x0 + i * cw + cw / 2, y: y + ch - bh - 5, text: v, cls: 'val small' });
      } else {
        s.push({ k: `${p.id}:c:${key}`, t: 'rect', x: x0 + i * cw + 2, y, w: cw - 4, h: ch, cls, rx: 7 });
        s.push({ k: `${p.id}:t:${key}`, t: 'text', x: x0 + i * cw + cw / 2, y: y + ch / 2 + 5, text: v, cls: 'val' + (p.marks?.[i] === 'path' ? ' on-path' : '') });
      }
    }
    y += ch;
    const at = {};
    for (const [name, i] of Object.entries(p.pointers || {})) if (i != null && i >= -1 && i <= n) at[name] = { x: x0 + i * cw + cw / 2 };
    y += pointerLabels(p, s, at, y);
    return { h: y + 8, shapes: s };
  };

  B.list = p => {
    const s = []; let y = header(p, s) + 4;
    const slotW = 92, nw = 62, nh = 38, rowH = 74;
    const order = p.nodes.map(n => n.id);
    const nSlots = order.length + 1;
    const x0 = (W - nSlots * slotW) / 2 + 14;
    const pos = {};
    order.forEach((id, i) => {
      const o = p.pos?.[id];
      pos[id] = { slot: o ? o[0] : i, row: o ? o[1] || 0 : 0 };
    });
    const nullSlot = p.nullAt === 'left' ? -0.9 : order.length;
    const X = slot => x0 + slot * slotW;
    const rows = Math.max(0, ...Object.values(pos).map(q => q.row)) + 1;
    const Y = row => y + row * rowH;
    const hasNullPtr = Object.values(p.pointers || {}).some(v => v === null);
    if (hasNullPtr) {
      s.push({ k: `${p.id}:nullbox`, t: 'rect', x: X(nullSlot) + 8, y: Y(0) + 4, w: 46, h: nh - 8, cls: 'nullbox', rx: 6 });
      s.push({ k: `${p.id}:nulltext`, t: 'text', x: X(nullSlot) + 31, y: Y(0) + nh / 2 + 5, text: 'null', cls: 'val small muted' });
    }
    for (const n of p.nodes) {
      const { slot, row } = pos[n.id];
      const cls = 'cell ' + (p.marks?.[n.id] || '');
      s.push({ k: `${p.id}:n:${n.id}`, t: 'rect', x: X(slot), y: Y(row), w: nw, h: nh, cls, rx: 7 });
      s.push({ k: `${p.id}:d:${n.id}`, t: 'line', x1: X(slot) + nw - 20, y1: Y(row) + 4, x2: X(slot) + nw - 20, y2: Y(row) + nh - 4, cls: 'divider' });
      s.push({ k: `${p.id}:v:${n.id}`, t: 'text', x: X(slot) + (nw - 20) / 2, y: Y(row) + nh / 2 + 5, text: n.val, cls: 'val' + (p.marks?.[n.id] === 'path' ? ' on-path' : '') });
      const nx = p.next?.[n.id];
      if (nx === null) s.push({ k: `${p.id}:z:${n.id}`, t: 'text', x: X(slot) + nw - 10, y: Y(row) + nh / 2 + 5, text: '∅', cls: 'val small muted' });
      else if (nx !== undefined && pos[nx]) {
        const t = pos[nx];
        const sx = X(slot) + nw - 10, sy = Y(row) + nh / 2;
        const d = t.slot - slot;
        let e;
        if (t.row !== row) e = { x1: sx, y1: Y(row) + (t.row > row ? nh : 0), x2: X(t.slot) + nw / 2 - 10, y2: Y(t.row) + (t.row > row ? 0 : nh), bend: 0 };
        else if (d === 1) e = { x1: sx + 4, y1: sy, x2: X(t.slot) - 2, y2: sy, bend: 0 };
        else if (d > 1) e = { x1: sx, y1: Y(row) - 1, x2: X(t.slot) + 20, y2: Y(row) - 3, bend: 22 + 6 * d };
        else e = { x1: sx, y1: Y(row) + nh + 1, x2: X(t.slot) + (nw - 20) / 2, y2: Y(row) + nh + 3, bend: 20 - 6 * d };
        s.push({ k: `${p.id}:e:${n.id}`, t: 'line', ...e, arrow: true, cls: 'edge ' + (p.edgeMarks?.[n.id] || '') });
      }
    }
    y += rows * rowH - 26;
    const at = {};
    for (const [name, id] of Object.entries(p.pointers || {})) {
      if (id === null) at[name] = { x: X(nullSlot) + 31 };
      else if (pos[id]) at[name] = { x: X(pos[id].slot) + (nw - 20) / 2 };
    }
    y += 12 + pointerLabels(p, s, at, y + 4);
    return { h: y + 8, shapes: s };
  };

  B.tree = p => {
    const s = []; let y = header(p, s) + 26;
    const nodes = p.nodes, rank = {}, depth = {};
    let r = 0, maxD = 0;
    (function walk(id, d) {
      if (id == null || !nodes[id]) return;
      walk(nodes[id].left, d + 1); rank[id] = r++; depth[id] = d; maxD = Math.max(maxD, d); walk(nodes[id].right, d + 1);
    })(p.root, 0);
    const n = r, R = 19, gapY = 66;
    const span = Math.min(W - 80, Math.max(n - 1, 1) * 64);
    const x0 = (W - span) / 2;
    const P = id => ({ x: n > 1 ? x0 + (rank[id] / (n - 1)) * span : W / 2, y: y + depth[id] * gapY });
    for (const id of Object.keys(rank)) for (const c of [nodes[id].left, nodes[id].right]) {
      if (c == null || rank[c] === undefined) continue;
      const a = P(id), b = P(c), dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      s.push({ k: `${p.id}:e:${c}`, t: 'line', x1: a.x + dx / L * R, y1: a.y + dy / L * R, x2: b.x - dx / L * R, y2: b.y - dy / L * R,
        cls: 'edge ' + (p.edgeMarks?.[`${id}-${c}`] || ''), bend: 0 });
    }
    for (const id of Object.keys(rank)) {
      const q = P(id);
      s.push({ k: `${p.id}:n:${id}`, t: 'circle', cx: q.x, cy: q.y, r: R, cls: 'cell ' + (p.marks?.[id] || '') });
      s.push({ k: `${p.id}:v:${id}`, t: 'text', x: q.x, y: q.y + 5, text: nodes[id].val, cls: 'val' + (p.marks?.[id] === 'path' ? ' on-path' : '') });
      if (p.badges?.[id] != null) s.push({ k: `${p.id}:b:${id}`, t: 'text', x: q.x, y: q.y + R + 15, text: p.badges[id], cls: 'badge' });
    }
    const byNode = {};
    for (const [name, id] of Object.entries(p.pointers || {})) {
      if (id == null || rank[id] === undefined) continue;
      const q = P(id), k = byNode[id] = (byNode[id] || 0) + 1;
      s.push({ k: `${p.id}:p:${name}`, t: 'text', x: q.x + R + 5, y: q.y + 5 + (k - 1) * 15, text: '← ' + name, cls: 'ptr ptr-0', anchor: 'start' });
    }
    return { h: y + maxD * gapY + R + (p.badges ? 26 : 12), shapes: s };
  };

  B.graph = p => {
    const s = []; const y0 = header(p, s) + 8; const H = p.h || 240; const R = 20;
    const at = {}; for (const n of p.nodes) at[n.id] = { x: n.x, y: y0 + n.y };
    for (const e of p.edges) {
      const a = at[e.a], b = at[e.b]; if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      const cls = 'edge ' + (p.edgeMarks?.[`${e.a}-${e.b}`] || (!e.dir && p.edgeMarks?.[`${e.b}-${e.a}`]) || '');
      s.push({ k: `${p.id}:e:${e.a}-${e.b}`, t: 'line', x1: a.x + dx / L * R, y1: a.y + dy / L * R, x2: b.x - dx / L * (R + 2), y2: b.y - dy / L * (R + 2),
        bend: e.bend || 0, arrow: !!e.dir, cls });
      if (e.w != null) s.push({ k: `${p.id}:w:${e.a}-${e.b}`, t: 'text', x: (a.x + b.x) / 2 - dy / L * 11, y: (a.y + b.y) / 2 + dx / L * 11 + 4, text: e.w, cls: 'weight' });
    }
    for (const n of p.nodes) {
      const q = at[n.id];
      s.push({ k: `${p.id}:n:${n.id}`, t: 'circle', cx: q.x, cy: q.y, r: R, cls: 'cell ' + (p.marks?.[n.id] || '') });
      s.push({ k: `${p.id}:v:${n.id}`, t: 'text', x: q.x, y: q.y + 5, text: n.label ?? n.id, cls: 'val' + (p.marks?.[n.id] === 'path' ? ' on-path' : '') });
      if (p.badges?.[n.id] != null) {
        const text = String(p.badges[n.id]), bw = tw(text) - 6;
        s.push({ k: `${p.id}:bb:${n.id}`, t: 'rect', x: q.x + R * .55, y: q.y - R - 16, w: bw, h: 20, rx: 10, cls: 'chip done' });
        s.push({ k: `${p.id}:b:${n.id}`, t: 'text', x: q.x + R * .55 + bw / 2, y: q.y - R - 2, text, cls: 'badge' });
      }
    }
    const byNode = {};
    for (const [name, id] of Object.entries(p.pointers || {})) {
      if (id == null || !at[id]) continue;
      const q = at[id], k = byNode[id] = (byNode[id] || 0) + 1;
      s.push({ k: `${p.id}:p:${name}`, t: 'text', x: q.x + R + 6, y: q.y + 4 + (k - 1) * 15, text: '← ' + name, cls: 'ptr ptr-0', anchor: 'start' });
    }
    return { h: y0 + H, shapes: s };
  };

  B.grid = p => {
    const s = []; let y = header(p, s);
    const rows = p.cells.length, cols = p.cells[0]?.length || 0;
    const lw = p.rowLabels ? 46 : 0;
    const cs = Math.min(p.cell || 46, (W - 40 - lw) / Math.max(cols, 1));
    const x0 = (W - cols * cs - lw) / 2 + lw;
    if (p.colLabels) { p.colLabels.forEach((t, c) => s.push({ k: `${p.id}:cl:${c}`, t: 'text', x: x0 + c * cs + cs / 2, y: y + 13, text: t, cls: 'idx' })); y += 20; }
    for (let r = 0; r < rows; r++) {
      if (p.rowLabels) s.push({ k: `${p.id}:rl:${r}`, t: 'text', x: x0 - 10, y: y + r * cs + cs / 2 + 4, text: p.rowLabels[r], cls: 'idx', anchor: 'end' });
      for (let c = 0; c < cols; c++) {
        const v = p.cells[r][c];
        s.push({ k: `${p.id}:c:${r},${c}`, t: 'rect', x: x0 + c * cs + 1.5, y: y + r * cs + 1.5, w: cs - 3, h: cs - 3, rx: 5, cls: 'cell ' + (p.marks?.[`${r},${c}`] || '') });
        if (v !== '' && v != null) s.push({ k: `${p.id}:t:${r},${c}`, t: 'text', x: x0 + c * cs + cs / 2, y: y + r * cs + cs / 2 + 5, text: v, cls: (cs < 34 ? 'val small' : 'val') + (p.marks?.[`${r},${c}`] === 'path' ? ' on-path' : '') });
      }
    }
    (p.arrows || []).forEach(([r1, c1, r2, c2, cls], i) => {
      const ax = x0 + c1 * cs + cs / 2, ay = y + r1 * cs + cs / 2, bx = x0 + c2 * cs + cs / 2, by = y + r2 * cs + cs / 2;
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, t = cs * 0.32;
      s.push({ k: `${p.id}:a:${i}`, t: 'line', x1: ax + dx / L * t, y1: ay + dy / L * t, x2: bx - dx / L * t, y2: by - dy / L * t, bend: 0, arrow: true, top: true, cls: 'edge ' + (cls || 'active') });
    });
    return { h: y + rows * cs + 10, shapes: s };
  };

  B.stack = p => {
    const s = []; let y = header(p, s);
    const items = p.items.map((it, i) => (it && typeof it === 'object' && 'val' in it) ? it : { id: i, val: it });
    const hint = { stack: ['bottom', 'top'], queue: ['front', 'back'], heap: ['', ''], set: ['', ''] }[p.kind || 'stack'];
    let x = 30 + (hint[0] ? 50 : 0);
    if (hint[0]) s.push({ k: `${p.id}:h0`, t: 'text', x: 30, y: y + 27, text: hint[0], cls: 'idx', anchor: 'start' });
    items.forEach((it, i) => {
      const w = Math.max(44, tw(it.val));
      s.push({ k: `${p.id}:c:${it.id}`, t: 'rect', x, y: y + 4, w, h: 36, rx: 7, cls: 'cell ' + (p.marks?.[i] || '') });
      s.push({ k: `${p.id}:t:${it.id}`, t: 'text', x: x + w / 2, y: y + 27, text: it.val, cls: 'val' });
      x += w + 6;
    });
    if (!items.length) s.push({ k: `${p.id}:empty`, t: 'text', x: x + 4, y: y + 27, text: '(empty)', cls: 'idx', anchor: 'start' });
    else if (hint[1]) s.push({ k: `${p.id}:h1`, t: 'text', x: x + 4, y: y + 27, text: '← ' + hint[1], cls: 'idx', anchor: 'start' });
    return { h: y + 50, shapes: s };
  };

  B.vars = p => {
    const s = []; let x = 20;
    const y = 4;
    for (const [k, v] of Object.entries(p.vars)) {
      const text = `${k} = ${v}`, w = tw(text);
      s.push({ k: `${p.id}:c:${k}`, t: 'rect', x, y, w, h: 30, rx: 15, cls: 'chip ' + (p.marks?.[k] || '') });
      s.push({ k: `${p.id}:t:${k}`, t: 'text', x: x + w / 2, y: y + 20, text, cls: 'val small' });
      x += w + 8;
    }
    return { h: 42, shapes: s };
  };

  B.text = p => ({ h: 30, shapes: [{ k: `${p.id}:t`, t: 'text', x: W / 2, y: 20, text: p.text, cls: 'note ' + (p.cls || '') }] });

  function layout(frame) {
    let y = 6; const shapes = [];
    for (const p of frame.panels || []) {
      const b = B[p.type]; if (!b) throw new Error('Unknown panel type ' + p.type);
      const r = b(p);
      // centre rows of chips / stacks; put the panel label at the content's left edge
      const body = r.shapes.filter(s => !s.k.endsWith(':label'));
      const xs = body.flatMap(s => s.t === 'rect' ? [s.x, s.x + s.w] : s.t === 'circle' ? [s.cx - s.r, s.cx + s.r] : s.t === 'line' ? [s.x1, s.x2] : [s.x]);
      if (xs.length) {
        const lo = Math.min(...xs), hi = Math.max(...xs);
        if (p.type === 'vars' || p.type === 'stack') {
          const dx = W / 2 - (lo + hi) / 2;
          for (const s of body) { if ('x' in s) s.x += dx; if ('cx' in s) s.cx += dx; if ('x1' in s) { s.x1 += dx; s.x2 += dx; } }
        }
        const lab = r.shapes.find(s => s.k.endsWith(':label'));
        if (lab) lab.x = p.type === 'vars' || p.type === 'stack' ? W / 2 - (hi - lo) / 2 : Math.max(8, lo);
      }
      for (const sh of r.shapes) {
        if ('y' in sh) sh.y += y; if ('cy' in sh) sh.cy += y; if ('y1' in sh) { sh.y1 += y; sh.y2 += y; }
        sh.op = 1; shapes.push(sh);
      }
      y += r.h + 8;
    }
    return { h: y, shapes };
  }

  // ---------- SVG rendering with keyed tweening ----------
  function makeEl(sh, id) {
    const tag = { rect: 'rect', circle: 'circle', text: 'text', line: 'path' }[sh.t];
    const el = document.createElementNS(NS, tag);
    if (sh.t === 'text') el.setAttribute('text-anchor', sh.anchor || 'middle');
    if (sh.t === 'rect' && sh.rx) el.setAttribute('rx', sh.rx);
    return el;
  }
  function paint(el, sh, v, id) {
    el.setAttribute('class', sh.cls || '');
    el.style.opacity = v.op * (/(^| )dim( |$)/.test(sh.cls || '') ? 0.35 : 1);
    switch (sh.t) {
      case 'rect': el.setAttribute('x', v.x); el.setAttribute('y', v.y); el.setAttribute('width', Math.max(0, v.w)); el.setAttribute('height', Math.max(0, v.h)); break;
      case 'circle': el.setAttribute('cx', v.cx); el.setAttribute('cy', v.cy); el.setAttribute('r', v.r); break;
      case 'text': el.setAttribute('x', v.x); el.setAttribute('y', v.y); if (el.textContent !== String(sh.text)) el.textContent = sh.text; break;
      case 'line': {
        const mx = (v.x1 + v.x2) / 2, my = (v.y1 + v.y2) / 2, dx = v.x2 - v.x1, dy = v.y2 - v.y1, L = Math.hypot(dx, dy) || 1;
        const cx = mx - dy / L * (v.bend || 0) * -1, cy = my + dx / L * (v.bend || 0) * -1;
        el.setAttribute('d', `M${v.x1},${v.y1} Q${cx},${cy} ${v.x2},${v.y2}`);
        const m = MARKS.find(c => c && (' ' + sh.cls + ' ').includes(' ' + c + ' ')) || 'base';
        if (sh.arrow) el.setAttribute('marker-end', `url(#ah-${id}-${m})`); else el.removeAttribute('marker-end');
      }
    }
  }
  const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  function codeHtml(code) {
    const kw = /\b(int|long|double|boolean|char|void|var|new|return|if|else|for|while|do|break|continue|null|true|false|class|public|private|static|final|record|this|import|String|List|Map|Set|Deque|Queue|ArrayDeque|ArrayList|HashMap|HashSet|PriorityQueue|TreeNode|ListNode|function|const|let)\b/g;
    return code.replace(/\n$/, '').split('\n').map((ln, i) => {
      let h = esc(ln);
      const ci = h.indexOf('//');
      let comment = '';
      if (ci >= 0) { comment = `<span class="c">${h.slice(ci)}</span>`; h = h.slice(0, ci); }
      h = h.replace(kw, '<span class="k">$1</span>').replace(/\b(\d+)\b/g, '<span class="n">$1</span>');
      return `<div class="ln" data-l="${i + 1}"><span class="no">${i + 1}</span><span class="src">${h}${comment || ' '}</span></div>`;
    }).join('');
  }

  function mount(target, opts) {
    const host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) return;
    const id = ++uid;
    const frames = opts.frames;
    const layouts = frames.map(layout);
    const H = Math.max(...layouts.map(l => l.h));
    // crop the drawing to its content so small arrays/trees are not shrunk into a wide empty canvas
    let minX = Infinity, maxX = -Infinity;
    for (const L of layouts) for (const s of L.shapes) {
      const xs = s.t === 'rect' ? [s.x, s.x + s.w] : s.t === 'circle' ? [s.cx - s.r, s.cx + s.r]
        : s.t === 'line' ? [s.x1, s.x2] : s.anchor === 'start' ? [s.x, s.x + tw(s.text) - 10] : s.anchor === 'end' ? [s.x - tw(s.text), s.x] : [s.x - tw(s.text) / 2, s.x + tw(s.text) / 2];
      for (const x of xs) if (Number.isFinite(x)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    }
    const vx = Math.max(0, minX - 16), vw = Math.min(W, maxX + 16) - vx;
    host.classList.add('viz');
    host.tabIndex = 0;
    host.innerHTML = `
      <div class="viz-main">
        <div class="viz-stage"><svg viewBox="${vx} 0 ${vw} ${H}" style="max-width:${Math.round(vw * 1.25)}px;margin:0 auto" preserveAspectRatio="xMidYMin meet" role="img" aria-label="${esc(opts.title || 'animation')}">
          <defs>${MARKS.map(m => `<marker id="ah-${id}-${m || 'base'}" class="ah ${m}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker>`).join('')}</defs>
          <g class="layer"></g></svg></div>
        <div class="viz-say" aria-live="polite"></div>
        <div class="viz-bar">
          <button class="b-restart" title="Restart" aria-label="Restart">⟲</button>
          <button class="b-prev" title="Previous step (←)" aria-label="Previous step">◀</button>
          <button class="b-play" title="Play / pause (space)" aria-label="Play">▶</button>
          <button class="b-next" title="Next step (→)" aria-label="Next step">▶|</button>
          <input class="b-scrub" type="range" min="0" max="${frames.length - 1}" value="0" aria-label="Step">
          <span class="b-count"></span>
          <select class="b-speed" aria-label="Speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.6">1.6×</option><option value="2.5">2.5×</option></select>
        </div>
      </div>
      ${opts.code ? `<div class="viz-code"><div class="viz-code-title">${esc(opts.lang || 'Java')}</div><div class="code-lines">${codeHtml(opts.code)}</div></div>` : ''}`;
    const layer = host.querySelector('.layer');
    const say = host.querySelector('.viz-say');
    const scrub = host.querySelector('.b-scrub');
    const count = host.querySelector('.b-count');
    const playBtn = host.querySelector('.b-play');
    const lines = [...host.querySelectorAll('.ln')];
    const live = new Map(); // key -> {el, sh, v}
    let idx = 0, playing = false, timer = 0, raf = 0, speed = 1, userTook = false, visible = false;

    function show(i, animate = true) {
      idx = Math.max(0, Math.min(frames.length - 1, i));
      const f = frames[idx], L = layouts[idx];
      const dur = animate ? 520 / speed : 0;
      const plan = [];
      const seen = new Set();
      for (const sh of L.shapes) {
        seen.add(sh.k);
        let cur = live.get(sh.k);
        if (!cur || cur.sh.t !== sh.t) {
          if (cur) cur.el.remove();
          const el = makeEl(sh, id); layer.appendChild(el);
          cur = { el, sh, v: { ...sh, op: 0 } };
          live.set(sh.k, cur);
        }
        const from = { ...cur.v }; cur.sh = sh;
        plan.push({ cur, from, to: sh });
      }
      for (const [k, cur] of live) if (!seen.has(k)) plan.push({ cur, from: { ...cur.v }, to: { ...cur.v, op: 0 }, dying: k });
      // z-order: rects/circles of windows first, edges, then cells, then text
      const z = sh => sh.top ? 4 : sh.t === 'rect' && /window/.test(sh.cls) ? 0 : sh.t === 'line' ? 1 : sh.t === 'text' ? 3 : 2;
      [...live.values()].sort((a, b) => z(a.sh) - z(b.sh)).forEach(c => layer.appendChild(c.el));
      cancelAnimationFrame(raf);
      const t0 = performance.now();
      const step = now => {
        const t = dur ? Math.min(1, (now - t0) / dur) : 1, e = ease(t);
        for (const p of plan) {
          const v = {};
          for (const k of NUMS) {
            const a = p.from[k], b = p.to[k];
            if (typeof b === 'number') v[k] = typeof a === 'number' ? a + (b - a) * e : b;
          }
          p.cur.v = v;
          paint(p.cur.el, p.cur.sh, v, id);
        }
        if (t < 1) raf = requestAnimationFrame(step);
        else for (const p of plan) if (p.dying) { p.cur.el.remove(); live.delete(p.dying); }
      };
      raf = requestAnimationFrame(step);
      if (!dur) step(performance.now() + 1);
      say.innerHTML = f.say || '';
      scrub.value = idx;
      count.textContent = `${idx + 1} / ${frames.length}`;
      const hl = new Set([].concat(f.line ?? []));
      lines.forEach(l => l.classList.toggle('on', hl.has(+l.dataset.l)));
      const on = lines.find(l => l.classList.contains('on'));
      if (on) { const box = on.parentElement; const top = on.offsetTop - box.clientHeight / 2; if (top > 0 || box.scrollTop > 0) box.scrollTo({ top: Math.max(0, top), behavior: animate ? 'smooth' : 'auto' }); }
    }
    function tick() {
      if (!playing) return;
      const last = idx >= frames.length - 1;
      timer = setTimeout(() => {
        if (!playing) return;
        show(last ? 0 : idx + 1);
        tick();
      }, (last ? 2600 : (frames[idx].wait || 1500)) / speed);
    }
    function setPlay(on) {
      playing = on; clearTimeout(timer);
      playBtn.textContent = on ? '❚❚' : '▶';
      playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
      host.classList.toggle('playing', on);
      if (on) tick();
    }
    const take = () => { userTook = true; };
    playBtn.onclick = () => { take(); setPlay(!playing); };
    host.querySelector('.b-next').onclick = () => { take(); setPlay(false); show(idx + 1); };
    host.querySelector('.b-prev').onclick = () => { take(); setPlay(false); show(idx - 1); };
    host.querySelector('.b-restart').onclick = () => { take(); show(0); setPlay(true); };
    scrub.oninput = () => { take(); setPlay(false); show(+scrub.value); };
    host.querySelector('.b-speed').onchange = e => { speed = +e.target.value; };
    host.addEventListener('keydown', e => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') { take(); setPlay(false); show(idx + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { take(); setPlay(false); show(idx - 1); e.preventDefault(); }
      else if (e.key === ' ') { take(); setPlay(!playing); e.preventDefault(); }
    });
    // GIF-like: play automatically while on screen, until the reader takes control
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if ('IntersectionObserver' in window && !reduce && opts.autoplay !== false) {
      new IntersectionObserver(es => {
        for (const e of es) {
          visible = e.isIntersecting;
          if (userTook) continue;
          setPlay(visible);
        }
      }, { threshold: 0.45 }).observe(host);
    }
    show(0, false);
    const api = { show: i => show(i, false), count: frames.length, play: () => setPlay(true), pause: () => setPlay(false) };
    (Viz.instances ||= []).push(api);
    return api;
  }

  // Helper for lessons: record frames while running real code.
  function recorder() {
    const frames = [];
    return { frames, step(panels, line, say, extra = {}) { frames.push({ panels: JSON.parse(JSON.stringify(panels)), line, say, ...extra }); } };
  }

  window.Viz = { mount, recorder, W };
})();
