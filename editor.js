// Fear & Hunger 2: Termina - local save editor
// Usage: node editor.js ["path\to\Fear & Hunger 2 Termina"]
// Starts a small web page on http://127.0.0.1:7777 for editing saves.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');

const PORT = 7777;
const FULLNESS_MAX = 156; // the game's food logic caps fullness (stored as EXP) below 157
// Ritual-circle sigils are game switches that the game turns on when you PICK UP the matching
// skin bible (not when you read it), so books added through the editor need these set too.
const SIGILS = [
  { sw: 1421, name: 'Gro-goroth', items: [210] },
  { sw: 1422, name: 'Sylvian', items: [317] },
  { sw: 1423, name: 'Alll-mer', items: [244] },
  { sw: 1424, name: 'Rher (moon)', items: [211] },
  { sw: 1425, name: 'Vinushka', items: [316, 314] },
  { sw: 1426, name: 'God of Fear and Hunger', items: [315] },
];

const GAME = require('./find-game.js')(process.argv[2]);
if (!GAME) {
  console.error('Could not find the game folder automatically.');
  console.error('Put this tool\'s folder inside the game folder, or start it with the path, e.g.:');
  console.error('  start.bat "D:\\Games\\Fear & Hunger 2 Termina"');
  process.exit(1);
}
const WWW = path.join(GAME, 'www');
const SAVE_DIR = process.env.TERMINA_SAVE_DIR || path.join(WWW, 'save');
const BACKUP_DIR = path.join(SAVE_DIR, 'editor-backups');
const LZString = require(path.join(WWW, 'js', 'libs', 'lz-string.js'));

const readData = n => JSON.parse(fs.readFileSync(path.join(WWW, 'data', n + '.json'), 'utf8'));
const DB = {
  item: readData('Items'),
  weapon: readData('Weapons'),
  armor: readData('Armors'),
  actors: readData('Actors'),
  classes: readData('Classes'),
  states: readData('States'),
  params: readData('System').terms.params,
  equipTypes: readData('System').equipTypes,
};
const typeOf = (kind, x) => kind === 'item' ? 'Item' : kind === 'weapon' ? 'Weapon' : (DB.equipTypes[x.etypeId] || 'Armor');
const dbList = kind => DB[kind].filter(x => x && x.name && x.name.trim())
  .map(x => ({ id: x.id, name: x.name, type: typeOf(kind, x), desc: (x.description || '').replace(/\s+/g, ' ').trim() }));
const CATALOG = { item: dbList('item'), weapon: dbList('weapon'), armor: dbList('armor') };
const buildZones = require('./zones.js');
const ZONES = buildZones(WWW);
const LEGEND = require('./pois.js')(WWW, ZONES);
const { buildCircles, circleStatus, resetOps } = require('./circles.js');
const CIRCLES = buildCircles(WWW, LEGEND);
const AFFINITY = require('./affinity.js')(WWW);
const SKILLS = require('./skills.js')(WWW);
const AFFINITY_CAP = 9;
const { buildLimbs, limbStatus } = require('./limbs.js');
const LIMBS = buildLimbs(readData('CommonEvents'), readData('System').switches);
const { buildRosterRules, evaluateRoster } = require('./roster.js');
const ROSTER_RULES = buildRosterRules(WWW, Object.keys(LIMBS).map(Number));
const mainCharacter = sw => +(Object.keys(LIMBS).find(id => LIMBS[id].select && sw(LIMBS[id].select)) || 0) || null;

// Roster from a save file.
function rosterFromSave(s) {
  const W = arr(s.switches._data), V = arr(s.variables._data), SS = s.selfSwitches._data, actorData = arr(s.actors._data);
  const sw = i => !!W[i];
  const actors = {};
  for (const c of ROSTER_RULES.companions) {
    const a = actorData[c.id];
    if (a) actors[c.id] = { name: a._name, faceName: a._faceName, faceIndex: a._faceIndex };
  }
  return evaluateRoster(ROSTER_RULES, {
    sw, v: i => V[i] || 0, self: (m, e, ch) => !!SS[[m, e, ch].join(',')],
    item: i => !!s.party._items[i], party: arr(s.party._actors), main: mainCharacter(sw), actors,
  });
}

// Talk to the in-game plugin.
function liveRequest(method, p, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: 7778, path: p, method,
      headers: { 'X-Termina-Editor': '1', 'Content-Type': 'application/json' } }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.error || j.notInGame) return reject(new Error(j.error || 'Load a save in the game first'));
          resolve(j);
        } catch (err) { reject(err); }
      });
    });
    req.on('error', () => reject(new Error('The game is not running (or the live plugin is not installed)')));
    req.setTimeout(3000, () => req.destroy(new Error('game not responding')));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
// Game flags as simple lookups, from a save file or from the running game's /flags.
function flagsFromSave(s) {
  const W = arr(s.switches._data), V = arr(s.variables._data), SS = s.selfSwitches._data, party = arr(s.party._actors);
  return { sw: i => !!W[i], v: i => V[i] || 0, self: (m, e, ch) => !!SS[[m, e, ch].join(',')],
    item: i => !!s.party._items[i], inParty: id => party.includes(id) };
}
function flagsFromLive(f) {
  const self = new Set(f.selfSwitches);
  return { sw: i => !!f.switches[i], v: i => f.variables[i] || 0, self: (m, e, ch) => self.has([m, e, ch].join(',')),
    item: i => !!f.items[i], inParty: id => f.party.includes(id) };
}
async function circlesFor(slot) {
  return circleStatus(CIRCLES, slot === 'live' ? flagsFromLive(await liveRequest('GET', '/flags')) : flagsFromSave(readSave(slot)));
}
async function resetCircle(slot, key) {
  const c = CIRCLES.find(x => x.key === key);
  if (!c) throw new Error('unknown circle');
  if (slot === 'live') {
    const ops = resetOps(c, flagsFromLive(await liveRequest('GET', '/flags')));
    await liveRequest('POST', '/set-flags', ops);
    return { ops };
  }
  const s = readSave(slot);
  const ops = resetOps(c, flagsFromSave(s));
  const W = arr(s.switches._data), V = arr(s.variables._data);
  for (const [id, val] of Object.entries(ops.switches)) W[id] = val;
  for (const [id, val] of Object.entries(ops.variables)) V[id] = val;
  for (const k of ops.selfOff) delete s.selfSwitches._data[k];
  return { ops, backup: writeSave(slot, s) };
}

// Roster from the running game (asks the live plugin for its raw switches/variables).
function rosterFromGame() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 7778, path: '/flags', headers: { 'X-Termina-Editor': '1' } }, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => {
        try {
          const f = JSON.parse(body);
          if (f.error || f.notInGame) return reject(new Error(f.error || 'no save loaded'));
          const self = new Set(f.selfSwitches);
          const sw = i => !!f.switches[i];
          resolve(evaluateRoster(ROSTER_RULES, {
            sw, v: i => f.variables[i] || 0, self: (m, e, ch) => self.has([m, e, ch].join(',')),
            item: i => !!f.items[i], party: f.party, main: mainCharacter(sw), actors: f.actors,
          }));
        } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('game not responding')));
  });
}
const MAP_PICTURES = ['map_prehevil', 'map_prehevil2', 'map_prehevil3', 'map_prehevil4', 'map_player'];

// ---------- save file helpers ----------
const slotPath = slot => {
  if (!/^file\d+$/.test(slot)) throw new Error('bad slot');
  return path.join(SAVE_DIR, slot + '.rpgsave');
};
const readSave = slot => JSON.parse(LZString.decompressFromBase64(fs.readFileSync(slotPath(slot), 'utf8')));
const arr = v => (v && v['@a']) ? v['@a'] : v; // RPG Maker's JsonEx wraps arrays as {"@a": [...]}

function listSlots() {
  return fs.readdirSync(SAVE_DIR).filter(f => /^file\d+\.rpgsave$/.test(f)).map(f => {
    const st = fs.statSync(path.join(SAVE_DIR, f));
    return { slot: f.replace('.rpgsave', ''), modified: st.mtime };
  }).sort((a, b) => a.slot.localeCompare(b.slot, undefined, { numeric: true }));
}

function describe(slot) {
  const s = readSave(slot);
  const p = s.party;
  const inv = {};
  for (const [kind, key] of [['item', '_items'], ['weapon', '_weapons'], ['armor', '_armors']]) {
    inv[kind] = Object.entries(p[key]).filter(([k]) => /^\d+$/.test(k))
      .map(([id, qty]) => ({ id: +id, qty, name: (DB[kind][id] || {}).name || `#${id}` }));
  }
  const actorData = arr(s.actors._data);
  const switchVals = arr(s.switches._data);
  const actors = arr(p._actors).map(id => {
    const a = actorData[id];
    const cls = DB.classes[a._classId];
    const plus = arr(a._paramPlus);
    const base = i => (cls.params[i][a._level] || 0) + (plus[i] || 0);
    return {
      id, name: a._name || DB.actors[id].name, level: a._level,
      hp: a._hp, mp: a._mp, baseMaxHp: base(0), baseMaxMp: base(1),
      fullness: a._exp[a._classId] || 0,
      paramPlus: plus,
      states: arr(a._states).map(sid => ({ id: sid, name: (DB.states[sid] || {}).name || `#${sid}` })),
      skills: arr(a._skills).map(sid => ({ id: sid, name: SKILLS.names[sid] || `#${sid}` })),
      limbs: LIMBS[id] ? limbStatus(LIMBS[id], sw => !!switchVals[sw]) : [],
    };
  });
  const switches = arr(s.switches._data);
  const sigils = SIGILS.map(g => ({ sw: g.sw, name: g.name, known: !!switches[g.sw] }));
  const vars = arr(s.variables._data);
  const affinity = Object.fromEntries(AFFINITY.gods.map(g => [g.id, vars[g.id] || 0]));
  return { slot, inventory: inv, actors, sigils, affinity, roster: rosterFromSave(s), paramNames: DB.params.slice(0, 8), fullnessMax: FULLNESS_MAX };
}

function applyEdits(slot, edits) {
  const s = readSave(slot);
  const p = s.party;
  for (const [kind, key] of [['item', '_items'], ['weapon', '_weapons'], ['armor', '_armors']]) {
    if (!edits.inventory || !edits.inventory[kind]) continue;
    const bag = p[key];
    for (const k of Object.keys(bag)) if (/^\d+$/.test(k)) delete bag[k];
    for (const [id, qty] of Object.entries(edits.inventory[kind])) {
      const n = Math.max(0, Math.min(9999, Math.floor(+qty || 0)));
      if (n > 0 && DB[kind][id]) bag[id] = n;
    }
  }
  const actorData = arr(s.actors._data);
  for (const e of edits.actors || []) {
    const a = actorData[e.id];
    if (!a) continue;
    a._hp = Math.max(1, Math.floor(+e.hp));
    a._mp = Math.max(0, Math.floor(+e.mp));
    a._exp[a._classId] = Math.max(0, Math.min(FULLNESS_MAX, Math.floor(+e.fullness)));
    const plus = arr(a._paramPlus);
    e.paramPlus.forEach((v, i) => { plus[i] = Math.floor(+v || 0); });
    if (e.removeStates && e.removeStates.length) {
      const states = arr(a._states);
      const keep = states.filter(id => !e.removeStates.includes(id));
      states.length = 0; states.push(...keep);
      for (const id of e.removeStates) { delete a._stateTurns[id]; if (a._stateSteps) delete a._stateSteps[id]; }
    }
  }
  const switches = arr(s.switches._data);
  // Skills: learn/forget like the game's "Change Skills" command; shrine skills also turn on their
  // SKILL_ switch (what the shrine itself does), so prerequisites and world checks see them.
  for (const e of edits.actors || []) {
    const a = actorData[e.id];
    if (!a) continue;
    const learned = arr(a._skills);
    for (const id of e.removeSkills || []) { const i = learned.indexOf(id); if (i >= 0) learned.splice(i, 1); }
    for (const id of e.addSkills || []) {
      const sk = SKILLS.byId[id];
      if (!sk) continue;
      if (!learned.includes(id)) learned.push(id);
      for (const sw of sk.switches) switches[sw] = true;
    }
    learned.sort((x, y) => x - y);
  }
  // Restoring a limb = turning its "lost" switches off (what the game's own full-heal event does).
  for (const e of edits.actors || []) {
    const own = LIMBS[e.id] ? [...LIMBS[e.id].leg, ...LIMBS[e.id].arm] : [];
    for (const sw of e.restoreLimbs || []) if (own.includes(sw)) switches[sw] = false;
  }
  for (const g of SIGILS) {
    if (edits.sigils && g.sw in edits.sigils) switches[g.sw] = !!edits.sigils[g.sw];
  }
  const vars = arr(s.variables._data);
  for (const g of AFFINITY.gods) {
    if (edits.affinity && g.id in edits.affinity) vars[g.id] = Math.max(0, Math.min(AFFINITY_CAP, Math.floor(+edits.affinity[g.id] || 0)));
  }
  return writeSave(slot, s);
}

// backup, then write
function writeSave(slot, s) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(BACKUP_DIR, `${slot}_${stamp}.rpgsave`);
  fs.copyFileSync(slotPath(slot), backup);
  fs.writeFileSync(slotPath(slot), LZString.compressToBase64(JSON.stringify(s)));
  return backup;
}

// ---------- web server ----------
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), 'text/html');
    }
    if (url.pathname === '/api/info') return send(res, 200, { game: GAME, slots: listSlots(), catalog: CATALOG, sigils: SIGILS, affinity: AFFINITY, skills: SKILLS.list });
    if (url.pathname === '/api/zones') return send(res, 200, ZONES);
    if (url.pathname === '/api/legend') return send(res, 200, LEGEND);
    if (url.pathname === '/api/roster-live') {
      rosterFromGame().then(r => send(res, 200, r), err => send(res, 409, { error: err.message }));
      return;
    }
    const face = url.pathname.match(/^\/img\/faces\/([\w$%!-]+)\.png$/);
    if (face) {
      const file = path.join(WWW, 'img', 'faces', face[1] + '.rpgmvp');
      if (!fs.existsSync(file)) return send(res, 404, { error: 'no such face' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' });
      return res.end(buildZones.readPicture(WWW, face[1], 'faces'));
    }
    const pic = url.pathname.match(/^\/img\/(\w+)\.png$/);
    if (pic && MAP_PICTURES.includes(pic[1])) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' });
      return res.end(buildZones.readPicture(WWW, pic[1]));
    }
    if (url.pathname === '/api/circles') {
      circlesFor(url.searchParams.get('slot')).then(r => send(res, 200, r), err => send(res, 409, { error: err.message }));
      return;
    }
    if (url.pathname === '/api/circle-reset' && req.method === 'POST') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        const slot = url.searchParams.get('slot');
        Promise.resolve().then(() => resetCircle(slot, JSON.parse(body).key))
          .then(async r => send(res, 200, { ok: true, ...r, circles: await circlesFor(slot) }), err => send(res, 409, { error: err.message }));
      });
      return;
    }
    if (url.pathname === '/api/load') return send(res, 200, describe(url.searchParams.get('slot')));
    if (url.pathname === '/api/save' && req.method === 'POST') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try {
          const slot = url.searchParams.get('slot');
          const backup = applyEdits(slot, JSON.parse(body));
          send(res, 200, { ok: true, backup, data: describe(slot) });
        } catch (err) { send(res, 500, { error: err.message }); }
      });
      return;
    }
    send(res, 404, { error: 'not found' });
  } catch (err) { send(res, 500, { error: err.message }); }
}).listen(PORT, '127.0.0.1', () => {
  const link = `http://127.0.0.1:${PORT}`;
  console.log(`Game folder: ${GAME}`);
  console.log(`Save editor running at ${link}  (close this window to stop it)`);
  if (process.env.TERMINA_NO_BROWSER) return;
  const open = process.platform === 'win32' ? `start "" "${link}"` : process.platform === 'darwin' ? `open "${link}"` : `xdg-open "${link}"`;
  exec(open, () => {}); // if no browser can be opened, the link printed above still works
}).on('error', err => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`The editor already seems to be running - open http://127.0.0.1:${PORT} in your browser.`);
  process.exit(1);
});
