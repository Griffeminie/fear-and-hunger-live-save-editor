// Ritual circle state and "reset" (wipe the sigil drawn on a circle so you can draw another).
//
// Each circle is one map event. Drawing a sigil runs a choice branch on the circle's first page
// that turns on a flag (a switch or a variable), and the circle has a page per god that shows up
// when that flag is on. So: which page is active = what's drawn, and resetting = undoing what
// that god's branch did (flags off, affinity points taken back) and clearing the event's
// self switches (used for "exhausted" and similar).
const fs = require('fs');
const path = require('path');

const GODS = ['Rher', 'Gro-goroth', 'Alll-mer', 'Vinushka', 'God of Fear and Hunger', 'Sylvian'];
const CIRCLE_KINDS = ['perfection', 'asymmetric', 'imperfect'];

// Split a page's commands into choice branches and work out what each one does in the end.
function branches(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].code !== 402) continue;
    const ind = list[i].indent, b = { sw: {}, vars: [] };
    for (let j = i + 1; j < list.length && !(list[j].indent === ind && (list[j].code === 402 || list[j].code === 404)); j++) {
      const c = list[j], p = c.parameters;
      if (c.code === 121) for (let k = p[0]; k <= p[1]; k++) b.sw[k] = p[2] === 0;
      if (c.code === 122 && p[3] === 0) for (let k = p[0]; k <= p[1]; k++) b.vars.push({ id: k, op: p[2], value: p[4] });
    }
    out.push(b);
  }
  return out;
}

function buildCircles(www, legend) {
  const read = n => JSON.parse(fs.readFileSync(path.join(www, 'data', n + '.json'), 'utf8'));
  const ctx = { sw: read('System').switches };
  const list = legend.pois.filter(p => CIRCLE_KINDS.includes(p.category));
  const circles = [];
  const swUse = {}; // switch -> how many circles' sigil drawings turn it on (shared = leave alone)
  for (const p of list) {
    const ev = read('Map' + String(p.map).padStart(3, '0')).events[p.event];
    const pages = ev.pages.map((pg, i) => {
      const c = pg.conditions;
      return {
        i,
        sw: [c.switch1Valid && c.switch1Id, c.switch2Valid && c.switch2Id].filter(Boolean),
        v: c.variableValid ? [c.variableId, c.variableValue] : null,
        self: c.selfSwitchValid ? c.selfSwitchCh : null,
        item: c.itemValid ? c.itemId : null,
        actor: c.actorValid ? c.actorId : null,
        god: pg.image.characterName ? GODS[pg.image.characterIndex] || null : null,
      };
    });
    const condSw = new Set(pages.flatMap(pg => pg.sw));
    const condVar = new Set(pages.filter(pg => pg.v).map(pg => pg.v[0]));
    // the drawing branches (on any page): the ones that turn on one of this circle's page flags
    const draws = ev.pages.flatMap(pg => branches(pg.list)).map(b => {
      const flagSw = Object.keys(b.sw).map(Number).filter(s => b.sw[s] && condSw.has(s));
      const flagVar = b.vars.filter(x => condVar.has(x.id) && (x.op === 0 || x.op === 1) && x.value > 0).map(x => x.id);
      if (!flagSw.length && !flagVar.length) return null;
      return {
        flagSw, flagVar,
        // only the blood-portal switch (other things a drawing turns on, like quest progress, stay)
        otherSw: Object.keys(b.sw).map(Number).filter(s => b.sw[s] && !condSw.has(s) && /^portal\d+_on$/i.test(ctx.sw[s] || '')),
        adds: b.vars.filter(x => !condVar.has(x.id) && x.op === 1).map(x => ({ id: x.id, value: x.value })),
      };
    }).filter(Boolean);
    for (const d of draws) for (const s of d.otherSw) swUse[s] = (swUse[s] || new Set()).add(p.map + ',' + p.event);
    circles.push({ key: p.map + ',' + p.event, map: p.map, event: p.event, category: p.category, place: p.place, note: p.note, detail: p.detail, pages, draws });
  }
  for (const c of circles) for (const d of c.draws) d.otherSw = d.otherSw.filter(s => swUse[s].size < 2);
  return circles;
}

// st = { sw(id), v(id), self(map, ev, ch), item(id), inParty(actorId) }
function activePage(c, st) {
  let active = null;
  for (const pg of c.pages) {
    if (pg.sw.some(s => !st.sw(s))) continue;
    if (pg.v && st.v(pg.v[0]) < pg.v[1]) continue;
    if (pg.self && !st.self(c.map, c.event, pg.self)) continue;
    if (pg.item && !st.item(pg.item)) continue;
    if (pg.actor && !st.inParty(pg.actor)) continue;
    active = pg;
  }
  return active;
}

function circleStatus(circles, st) {
  return circles.map(c => {
    const pg = activePage(c, st);
    const drawn = c.draws.filter(d => d.flagSw.some(s => st.sw(s)) || d.flagVar.some(v => st.v(v) > 0));
    const used = ['A', 'B', 'C', 'D'].some(ch => st.self(c.map, c.event, ch));
    let state = 'Nothing drawn';
    if (pg && pg.i > 0 && pg.god && drawn.length) state = `${pg.god} sigil drawn`;
    else if (pg && pg.god && pg.i > 0) state = `${pg.god} sigil (came with it)`;
    else if (!c.draws.length) state = used ? 'Used' : 'Unused';
    return { key: c.key, map: c.map, event: c.event, category: c.category, place: c.place, note: c.note, detail: c.detail, state,
      canReset: drawn.length > 0 || used };
  });
}

// What to change to wipe a circle: { switches: {id: false}, variables: {id: value}, selfOff: [keys] }
function resetOps(c, st) {
  const ops = { switches: {}, variables: {}, selfOff: [] };
  for (const d of c.draws) {
    if (!(d.flagSw.some(s => st.sw(s)) || d.flagVar.some(v => st.v(v) > 0))) continue;
    for (const s of [...d.flagSw, ...d.otherSw]) ops.switches[s] = false;
    for (const v of d.flagVar) ops.variables[v] = 0;
    for (const a of d.adds) ops.variables[a.id] = Math.max(0, (ops.variables[a.id] ?? st.v(a.id)) - a.value);
  }
  for (const ch of ['A', 'B', 'C', 'D']) if (st.self(c.map, c.event, ch)) ops.selfOff.push([c.map, c.event, ch].join(','));
  return ops;
}

module.exports = { buildCircles, circleStatus, resetOps };
