// Points of interest for the map legend.
//
// To add a new kind of marker, add an entry to CATEGORIES with a `match(event, map)` test that
// recognises it in the game's map data. Everything else (finding which street the building's door
// opens onto, placing it on the Prehevil picture, the hover text, the legend toggle) is automatic.
const fs = require('fs');
const path = require('path');

const pageHasChoice = (ev, re) => ev.pages.some(pg => pg.list.some(c => c.code === 102 && c.parameters[0].some(ch => re.test(ch))));
const noConditions = pg => { const c = pg.conditions; return !(c.switch1Valid || c.switch2Valid || c.variableValid || c.selfSwitchValid || c.itemValid || c.actorValid); };
// The page the game shows when nothing has happened yet: the last page without conditions.
const defaultPage = ev => ev.pages.filter(noConditions).pop();
const turnsOn = (ev, sw, re) => ev.pages.some(pg => pg.list.some(c => c.code === 121 && c.parameters[2] === 0 && re.test(sw[c.parameters[0]] || '')));
const goesTo = (pg, maps) => pg && pg.list.some(c => c.code === 201 && c.parameters[0] === 0 && maps.has(c.parameters[1]));
const says = (pg, re) => pg && pg.list.some(c => c.code === 401 && re.test(c.parameters[0]));
// Sigil drawings on circles use one sprite sheet; the column is the god.
const GODS = ['Rher', 'Gro-goroth', 'Alll-mer', 'Vinushka', 'God of Fear and Hunger', 'Sylvian'];
const DRAW = /draw the sigil/i;

// Every circle the player can draw a sigil on, plus the ones that come with a sigil already drawn.
function asymmetric(ev, ctx) {
  if (pageHasChoice(ev, DRAW)) {
    if (turnsOn(ev, ctx.sw, /bloodportal_open|^portal\d+_on$/i)) return null; // that's a perfection circle
    const def = defaultPage(ev);
    if (def && def !== ev.pages[0]) return { note: `Already has a ${GODS[def.image.characterIndex] || 'god'} sigil drawn` + (goesTo(def, ctx.rherMaps) ? ' — leads into the Rher dimension' : '') };
    return { note: 'Blank — draw a sigil here (Vinushka or Rher do something special)' };
  }
  const def = defaultPage(ev);
  if (!def || !def.list.length) return null; // decorations
  if (goesTo(def, ctx.rherMaps) && /iki11/.test(def.image.characterName)) return { note: `Already has a ${GODS[def.image.characterIndex]} sigil drawn — leads into the Rher dimension` };
  if (says(def, /sigil of .* drawn here|ritual circle has been exhausted/i)) return { note: `Already has a ${GODS[def.image.characterIndex] || 'god'} sigil drawn` };
  return null;
}

const CATEGORIES = [
  {
    id: 'perfection',
    label: 'Perfection circles',
    color: '#9b59b6',
    shape: 'ring',
    // Drawing a sigil here opens a blood portal.
    match: (ev, ctx) => pageHasChoice(ev, DRAW) && turnsOn(ev, ctx.sw, /bloodportal_open|^portal\d+_on$/i)
      ? { note: 'Draw a sigil to open a blood portal' } : null,
  },
  {
    id: 'asymmetric',
    label: 'Asymmetric circles',
    color: '#e67e22',
    shape: 'ring',
    match: asymmetric,
  },
  {
    id: 'imperfect',
    label: 'Imperfect circles',
    color: '#f1c40f',
    shape: 'ring',
    // Offerings to the new gods.
    match: ev => pageHasChoice(ev, /pray for the new gods/i) ? { note: 'Pray to the new gods or give an offering' } : null,
  },
];

const SKIP_MAPS = /alternate|otherside|test|_OLD$/i;
// Interiors are drawn with these tilesets; everything else counts as outdoors.
const INDOOR_TILESETS = /inside|church|headquarters|temple_in|house|school|museum|apartment|basement|store|cabin|club/i;

// Which side of an area a tile is on. The box is the walkable area the tile belongs to (one map
// often holds several separate rooms, so the whole map's size would be misleading).
function compass(x, y, box) {
  const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1, rx = x - box.x0, ry = y - box.y0;
  const ns = ry < h / 3 ? 'north' : ry > (2 * h) / 3 ? 'south' : '';
  const ew = rx < w / 3 ? 'west' : rx > (2 * w) / 3 ? 'east' : '';
  return ns || ew ? `${ns}${ns && ew ? '-' : ''}${ew} side` : 'middle';
}

module.exports = function buildPois(www, zones) {
  const read = n => JSON.parse(fs.readFileSync(path.join(www, 'data', n + '.json'), 'utf8'));
  const infos = read('MapInfos');
  const maps = {};
  for (const f of fs.readdirSync(path.join(www, 'data')).filter(f => /^Map\d+\.json$/.test(f))) {
    const id = +f.slice(3, -5);
    if (infos[id] && !SKIP_MAPS.test(infos[id].name)) maps[id] = read(f.slice(0, -5));
  }
  const title = id => maps[id].displayName || zones.prettyMapName(id);
  const tilesets = read('Tilesets');
  const isStreet = id => !!zones.tilesByMap[id] && !INDOOR_TILESETS.test(tilesets[maps[id].tilesetId].name);

  // Doors: every "transfer player" command, as map -> [{to, x, y}] (x,y = where you arrive).
  const doors = {};
  for (const [id, m] of Object.entries(maps)) {
    for (const ev of m.events || []) {
      if (!ev) continue;
      for (const pg of ev.pages) for (const c of pg.list) {
        const p = c.parameters;
        // auto = a cutscene moves you (not a door you can use whenever you like)
        if (c.code === 201 && p[0] === 0 && maps[p[1]] && p[1] !== +id) (doors[id] = doors[id] || []).push({ to: p[1], x: p[2], y: p[3], auto: pg.trigger > 2 });
      }
    }
  }

  // Nearest street zone to a tile on an outdoor map.
  const nearestZone = (mapId, x, y) => {
    let best = null, bd = Infinity;
    for (const t of zones.tilesByMap[mapId] || []) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  };

  // Walk out through doors (shortest route) until we reach a street that's on the town map.
  function locate(mapId, x, y) {
    if (isStreet(mapId)) return { street: mapId, zone: nearestZone(mapId, x, y), via: [] };
    // 1) The game's map folders nest each building under the street it's on - use that first.
    const chain = [];
    for (let cur = mapId; cur && maps[cur]; cur = infos[cur].parentId) {
      if (isStreet(cur)) {
        const entry = chain[chain.length - 1]; // the building map that opens onto this street
        const out = (doors[entry] || []).find(d => d.to === cur);
        if (out) return { street: cur, zone: nearestZone(cur, out.x, out.y), via: chain.slice(1) };
        const ev = (maps[cur].events || []).find(e => e && e.pages.some(pg => pg.list.some(c => c.code === 201 && c.parameters[0] === 0 && c.parameters[1] === entry)));
        if (ev) return { street: cur, zone: nearestZone(cur, ev.x, ev.y), via: chain.slice(1) };
        break;
      }
      chain.push(cur);
    }
    // 2) Otherwise walk out through doors, shortest route first (real doors first, then also
    //    places a cutscene moves you, like elevators).
    for (const allowAuto of [false, true]) {
      const seen = new Set([mapId]);
      let frontier = [{ id: mapId, via: [] }];
      while (frontier.length) {
        const next = [];
        for (const { id, via } of frontier) {
          for (const d of doors[id] || []) {
            if ((d.auto && !allowAuto) || seen.has(d.to)) continue;
            seen.add(d.to);
            if (isStreet(d.to)) return { street: d.to, zone: nearestZone(d.to, d.x, d.y), via };
            next.push({ id: d.to, via: [...via, d.to] });
          }
        }
        frontier = next;
      }
    }
    // no route out found: fall back to the building's own location tiles, if it has any
    return zones.tilesByMap[mapId] ? { street: mapId, zone: nearestZone(mapId, x, y), via: [] } : null;
  }

  // Arrival points in each map, from doors in other maps.
  const arrivals = {};
  for (const [from, list] of Object.entries(doors)) for (const d of list) (arrivals[d.to] = arrivals[d.to] || []).push([d.x, d.y]);

  const clean = t => t.replace(/\[A-Za-z]+\[\d*\]|\[{}<>|.!^]/g, '').trim();
  // A transfer to another spot on the SAME map (e.g. climbing over a "staff only" sign to the
  // upstairs): describe what you interact with and which answer takes you there.
  function describeHop(ev, target) {
    for (const pg of ev.pages) {
      const i = pg.list.findIndex(c => c.code === 201 && c.parameters[0] === 0 && c.parameters[1] === target);
      if (i < 0) continue;
      let choice = null, lines = [];
      for (let j = i - 1; j >= 0; j--) {
        const c = pg.list[j];
        if (!choice && c.code === 402 && c.indent < pg.list[i].indent) choice = c.parameters[1];
      }
      for (const c of pg.list.slice(0, i)) if (c.code === 401) lines.push(clean(c.parameters[0]));
      const said = lines.find(Boolean);
      const quoted = said && (said.match(/"([^"]+)"/) || [])[1];
      const what = quoted ? `the "${quoted}" spot` : said ? `the spot that says "${said}"` : 'the stairs/passage';
      const up = pg.list.some(c => c.code === 401 && /upstairs/i.test(c.parameters[0])) ? 'upstairs' : null;
      return { what, choice: choice && clean(choice), up };
    }
    return null;
  }

  // Flood-fill the walkable floor of a map from a set of starting tiles.
  function regionOf(mapId, starts) {
    const m = maps[mapId], flags = tilesets[m.tilesetId].flags;
    const ok = (x, y) => {
      if (x < 0 || y < 0 || x >= m.width || y >= m.height) return false;
      for (let layer = 3; layer >= 0; layer--) {
        const t = m.data[(layer * m.height + y) * m.width + x] || 0;
        if (t === 0 || flags[t] & 0x10) continue;
        return (flags[t] & 0x0f) !== 0x0f;
      }
      return false;
    };
    const seen = new Set(), todo = starts.filter(([x, y]) => ok(x, y));
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const [x, y] of todo) seen.add(x + ',' + y);
    while (todo.length) {
      const [x, y] = todo.pop();
      box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const k = nx + ',' + ny;
        if (!seen.has(k) && ok(nx, ny)) { seen.add(k); todo.push([nx, ny]); }
      }
    }
    // things you can touch: the tile itself or one next to it
    const near = (x, y) => [[x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].some(([a, b]) => seen.has(a + ',' + b));
    return { near, box };
  }

  // Is the spot reachable from where you come in, or only through in-map passages (stairs, a
  // sign you climb over...)? Follows up to 3 such passages; only ones the player can use count.
  function access(mapId, x, y) {
    const m = maps[mapId];
    const whole = { x0: 0, y0: 0, x1: m.width - 1, y1: m.height - 1 };
    const main = regionOf(mapId, arrivals[mapId] || []);
    if (!isFinite(main.box.x0)) return { box: whole };
    let frontier = [{ region: main, steps: [] }];
    const tried = new Set();
    for (let depth = 0; depth <= 3 && frontier.length; depth++) {
      const next = [];
      for (const { region, steps } of frontier) {
        if (region.near(x, y)) return { box: region.box, steps };
        for (const ev of m.events || []) {
          if (!ev || !region.near(ev.x, ev.y)) continue;
          for (const pg of ev.pages) {
            if (pg.trigger > 2) continue; // cutscenes, not something you walk into or use
            for (const c of pg.list) {
              const p = c.parameters;
              if (c.code !== 201 || p[0] !== 0 || p[1] !== mapId || tried.has(p[2] + ',' + p[3])) continue;
              tried.add(p[2] + ',' + p[3]);
              const hop = describeHop(ev, mapId);
              next.push({ region: regionOf(mapId, [[p[2], p[3]]]), steps: [...steps, { ...hop, side: compass(ev.x, ev.y, region.box) }] });
            }
          }
        }
      }
      frontier = next;
    }
    return { box: whole };
  }

  const ctx = {
    sw: read('System').switches,
    // the "Rher dimension" versions of places are the game's Alternate_* maps
    rherMaps: new Set(infos.filter(i => i && /alternate/i.test(i.name)).map(i => i.id)),
  };
  const pois = [];
  for (const cat of CATEGORIES) {
    for (const [id, m] of Object.entries(maps)) {
      for (const ev of m.events || []) {
        const hit = ev && cat.match(ev, ctx);
        if (!hit) continue;
        const where = locate(+id, ev.x, ev.y);
        if (!where || !where.zone) continue;
        const street = title(where.street);
        const outdoors = where.street === +id;
        const inside = [...new Set([...where.via].reverse().map(title))].filter(t => t !== title(+id));
        const acc = access(+id, ev.x, ev.y);
        const side = compass(ev.x, ev.y, acc.box);
        const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
        const last = acc.steps && acc.steps[acc.steps.length - 1];
        const room = outdoors ? 'area, outdoors' : !last ? 'building' : last.up ? 'upstairs room' : 'separate section';
        let detail = `${cap(side)} of the ${room}` + (inside.length ? `, reached through ${inside.join(' → ')}` : '');
        if (acc.steps && acc.steps.length) detail += '. To get there: ' + acc.steps.map((st, i) =>
          `${i ? 'then ' : ''}use ${st.what} (${st.side} of the ${i ? 'next part' : outdoors ? 'area' : 'main floor'})`
          + (st.choice ? ` and choose "${st.choice}"` : '')).join(', ');
        pois.push({
          category: cat.id,
          place: title(+id),
          note: hit.note,
          detail,
          entrance: outdoors ? `On the street: ${street}` : `Entrance from: ${street}`,
          zone: where.zone.zone, px: where.zone.px, py: where.zone.py,
          map: +id, event: ev.id, x: ev.x, y: ev.y,
        });
      }
    }
  }
  return { categories: CATEGORIES.map(({ id, label, color, shape }) => ({ id, label, color, shape })), pois };
};
