// God affinity. Drawing a sigil on a ritual circle ("Your affinity with X has increased") adds 1
// to a per-god game variable named "<god>_affliction". The skill shrine (the "hexen" map) then
// offers that god's skills for Lesser souls once the variable reaches 1, 2 or 3.
// This reads both from the game data, so the table below is just display names.
const fs = require('fs');
const path = require('path');

const NAMES = { fear: 'God of Fear and Hunger', 'alll-mer': 'Alll-mer', rher: 'Rher', sylvian: 'Sylvian', vinushka: 'Vinushka', grogoroth: 'Gro-goroth' };
const ORDER = ['Alll-mer', 'Gro-goroth', 'Sylvian', 'Rher', 'Vinushka', 'God of Fear and Hunger'];
const clean = t => t.replace(/\\[A-Za-z]+\[\d*\]|\\[{}<>|.!^]/g, '').trim();

module.exports = function buildAffinity(www) {
  const read = n => JSON.parse(fs.readFileSync(path.join(www, 'data', n + '.json'), 'utf8'));
  const varNames = read('System').variables;
  const gods = [];
  varNames.forEach((n, id) => {
    const m = (n || '').match(/^(.+)_affliction$/i);
    if (m) gods.push({ id, name: NAMES[m[1].toLowerCase()] || m[1], unlocks: {} });
  });
  const byVar = Object.fromEntries(gods.map(g => [g.id, g]));

  // What each level unlocks at the shrine.
  const infos = read('MapInfos');
  const shrine = infos.find(i => i && /^hexen$/i.test(i.name));
  let max = 3;
  if (shrine) {
    const map = read('Map' + String(shrine.id).padStart(3, '0'));
    let top = 0;
    for (const ev of map.events || []) {
      if (!ev) continue;
      const needs = new Map(); // var -> level
      for (const pg of ev.pages) {
        const c = pg.conditions;
        if (c.variableValid && byVar[c.variableId]) needs.set(c.variableId, Math.max(needs.get(c.variableId) || 0, c.variableValue));
        for (const cmd of pg.list) {
          const p = cmd.parameters;
          if (cmd.code === 111 && p[0] === 1 && byVar[p[1]] && p[2] === 0 && p[4] === 1) needs.set(p[1], Math.max(needs.get(p[1]) || 0, p[3]));
        }
      }
      if (!needs.size) continue;
      const text = ev.pages.flatMap(pg => pg.list.filter(c => c.code === 401).map(c => clean(c.parameters[0])));
      const offer = text.map(t => t.match(/to (?:learn the skill|get) (.+?)\?$/)).find(Boolean);
      if (!offer) continue;
      const also = [...needs.keys()];
      for (const [v, lvl] of needs) {
        top = Math.max(top, lvl);
        const others = also.filter(o => o !== v).map(o => `${byVar[o].name} ${needs.get(o)}`);
        const label = offer[1] + (others.length ? ` (also needs ${others.join(', ')})` : '');
        const list = (byVar[v].unlocks[lvl] = byVar[v].unlocks[lvl] || []);
        if (!list.includes(label)) list.push(label);
      }
    }
    if (top) max = top;
  }
  gods.sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
  return { gods, max };
};
