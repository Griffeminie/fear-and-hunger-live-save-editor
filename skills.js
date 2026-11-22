// Skill catalog for the editor.
//
// Skills bought at the skill shrine (the "hexen" map) do two things in the game: the character
// learns the skill, and a "SKILL_<name>" switch turns on. The switches matter: other shrine skills
// list them as prerequisites, and some places in the world check them (e.g. ritual circles check
// SKILL_masturbation). Some skills also exist as one copy per character (e.g. Wrench toss), so we
// remember which character the shrine gives which copy to.
const fs = require('fs');
const path = require('path');

module.exports = function buildSkills(www) {
  const read = n => JSON.parse(fs.readFileSync(path.join(www, 'data', n + '.json'), 'utf8'));
  const sys = read('System');
  const skills = read('Skills');
  const shrine = {}; // skill id -> { switches:Set, actors:Set }
  const infos = read('MapInfos');
  const map = infos.find(i => i && /^hexen$/i.test(i.name));
  if (map) {
    for (const ev of read('Map' + String(map.id).padStart(3, '0')).events || []) {
      if (!ev) continue;
      for (const pg of ev.pages) {
        const sws = [];
        for (const c of pg.list) {
          const p = c.parameters;
          if (c.code === 121 && p[2] === 0) for (let s = p[0]; s <= p[1]; s++) if (/^SKILL_/i.test(sys.switches[s] || '')) sws.push(s);
          // Change Skills: [actor by id(0)/variable, actor, learn(0)/forget, skill]
          if (c.code === 318 && p[2] === 0 && skills[p[3]]) {
            const e = (shrine[p[3]] = shrine[p[3]] || { switches: new Set(), actors: new Set() });
            sws.forEach(s => e.switches.add(s));
            if (p[0] === 0 && p[1] > 0) e.actors.add(p[1]);
          }
        }
      }
    }
  }
  // Skills the game itself can give a character anywhere (class level-ups, story events),
  // so enemy-only moves don't clutter the list.
  const teachable = new Set();
  for (const c of read('Classes')) if (c) for (const l of c.learnings || []) teachable.add(l.skillId);
  const scan = list => { for (const c of list || []) if (c.code === 318 && c.parameters[2] === 0) teachable.add(c.parameters[3]); };
  for (const ce of read('CommonEvents')) if (ce) scan(ce.list);
  for (const f of fs.readdirSync(path.join(www, 'data')).filter(f => /^Map\d+\.json$/.test(f))) {
    for (const ev of read(f.slice(0, -5)).events || []) if (ev) for (const pg of ev.pages) scan(pg.list);
  }
  const clean = t => (t || '').replace(/\\[A-Za-z]+\[\d*\]|\\[{}<>|.!^]/g, '').replace(/\s+/g, ' ').trim();
  const list = [];
  for (const s of skills) {
    if (!s || !s.name.trim()) continue;
    const sh = shrine[s.id];
    if (!sh && !teachable.has(s.id)) continue;
    list.push({
      id: s.id, name: s.name.trim(), desc: clean(s.description),
      type: sh ? 'Shrine skill' : sys.skillTypes[s.stypeId] || 'Skill',
      switches: sh ? [...sh.switches] : [], actors: sh ? [...sh.actors] : [],
    });
  }
  list.sort((a, b) => (b.type === 'Shrine skill') - (a.type === 'Shrine skill') || a.name.localeCompare(b.name));
  const byId = Object.fromEntries(list.map(s => [s.id, s]));
  return { list, byId, names: Object.fromEntries(skills.filter(Boolean).map(s => [s.id, s.name])) };
};
