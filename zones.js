// Builds the fast-travel table from the game's own data.
//
// The game splits outdoor areas into "zones": invisible floor tiles that set variable 696
// (LOCATION_VAR) when you walk over them. The in-game map item (common event 443) places the
// "you are here" marker on the Prehevil map picture based on that variable. So each zone gives us
// a spot on the map picture AND real floor tiles in the game to teleport to.
const fs = require('fs');
const path = require('path');

const LOCATION_VAR = 696;
const MAP_EVENT = 443;
// Alternate/test copies of maps used for special story moments - never teleport into those.
const SKIP_MAPS = /alternate|otherside|test/i;

// Picture placement used by the in-game map: map at top-left (32,10), 90% scale; marker centred.
const toImage = ([sx, sy]) => [Math.round((sx - 32) / 0.9), Math.round((sy - 10) / 0.9)];

module.exports = function buildZones(www) {
  const read = n => JSON.parse(fs.readFileSync(path.join(www, 'data', n + '.json'), 'utf8'));
  const infos = read('MapInfos');

  // zone -> marker position, from the map item's event
  const markers = {};
  let pending = null;
  for (const c of read('CommonEvents')[MAP_EVENT].list) {
    if (c.code === 111 && c.parameters[0] === 1 && c.parameters[1] === LOCATION_VAR) pending = c.parameters[3];
    if (c.code === 231 && c.parameters[1] === 'map_player' && pending != null) {
      if (!(pending in markers)) markers[pending] = toImage([c.parameters[4], c.parameters[5]]);
      pending = null;
    }
  }

  // zone -> map -> floor tiles that set it (each tile marked "good" if it's a safe place to land)
  const tilesets = read('Tilesets');
  const tiles = {};
  const mapFiles = fs.readdirSync(path.join(www, 'data')).filter(f => /^Map\d+\.json$/.test(f));
  for (const f of mapFiles) {
    const mapId = +f.slice(3, -5);
    if (!infos[mapId] || SKIP_MAPS.test(infos[mapId].name)) continue;
    const map = read(f.slice(0, -5));
    const flags = tilesets[map.tilesetId].flags;
    const walkable = (x, y) => {
      for (let layer = 3; layer >= 0; layer--) {
        const t = map.data[(layer * map.height + y) * map.width + x] || 0;
        if (t === 0 || flags[t] & 0x10) continue; // empty or drawn-above-player tile
        return (flags[t] & 0x0f) !== 0x0f;
      }
      return false;
    };
    const setsZone = page => page.list.some(c => c.code === 122 && c.parameters[0] === LOCATION_VAR);
    const occupied = new Set(); // tiles holding any other event (doors, exits, objects, NPCs)
    for (const ev of map.events || []) if (ev && !ev.pages.every(setsZone)) occupied.add(ev.x + ',' + ev.y);
    for (const ev of map.events || []) {
      if (!ev) continue;
      for (const page of ev.pages) {
        if (page.trigger !== 1 || page.priorityType !== 0) continue; // walk-over, below-player tiles only
        for (const c of page.list) {
          const p = c.parameters;
          if (c.code === 122 && p[0] === LOCATION_VAR && p[1] === LOCATION_VAR && p[2] === 0 && p[3] === 0 && markers[p[4]]) {
            const edge = ev.x <= 0 || ev.y <= 0 || ev.x >= map.width - 1 || ev.y >= map.height - 1;
            const good = !edge && !occupied.has(ev.x + ',' + ev.y) && walkable(ev.x, ev.y);
            ((tiles[p[4]] = tiles[p[4]] || {})[mapId] = tiles[p[4]][mapId] || []).push([ev.x, ev.y, good]);
          }
        }
      }
    }
  }

  const pretty = id => {
    const name = infos[id].name.replace(/_/g, ' ').replace(/\d+$/, '').trim();
    return name.charAt(0).toUpperCase() + name.slice(1);
  };
  // every zone tile per map (used to place other things, like ritual circles, on the map picture)
  const tilesByMap = {};
  for (const [zone, perMap] of Object.entries(tiles)) {
    for (const [mapId, list] of Object.entries(perMap)) {
      for (const [x, y] of list) (tilesByMap[mapId] = tilesByMap[mapId] || []).push({ zone: +zone, x, y, px: markers[zone][0], py: markers[zone][1] });
    }
  }

  const zones = [];
  zones.tilesByMap = tilesByMap;
  zones.prettyMapName = pretty;
  const isSewer = id => /sewer|sewage/i.test(infos[id].name);
  for (const zone of Object.keys(tiles).map(Number).sort((a, b) => a - b)) {
    // A zone number can cover a street AND the sewer underneath it (same spot on the town map).
    // Give each its own travel spot: the street one where the marker is, the sewer one just beside it.
    const byArea = { street: [], sewer: [] };
    for (const [mapId, all] of Object.entries(tiles[zone])) {
      const good = all.filter(s => s[2]);
      if (good.length) byArea[isSewer(mapId) ? 'sewer' : 'street'].push([mapId, good]);
    }
    for (const area of ['street', 'sewer']) {
      if (!byArea[area].length) continue; // no safe tile to land on there
      // the map with the most trigger tiles for this zone is where it really lives
      const [mapId, spots] = byArea[area].sort((a, b) => b[1].length - a[1].length)[0];
      spots.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const [x, y] = spots[Math.floor(spots.length / 2)];
      const shift = area === 'sewer' && byArea.street.length ? 10 : 0;
      zones.push({ key: zone + (area === 'sewer' ? 's' : ''), zone, map: +mapId, x, y, area, name: pretty(mapId),
        px: markers[zone][0] + shift, py: markers[zone][1] + shift });
    }
  }
  return zones;
};

// Map pictures are lightly encrypted (.rpgmvp): skip a 16-byte header, XOR the next 16 bytes with the key.
module.exports.readPicture = function (www, name, folder = 'pictures') {
  const key = Buffer.from(JSON.parse(fs.readFileSync(path.join(www, 'data', 'System.json'), 'utf8')).encryptionKey, 'hex');
  const buf = fs.readFileSync(path.join(www, 'img', folder, name + '.rpgmvp')).subarray(16);
  for (let i = 0; i < 16; i++) buf[i] ^= key[i];
  return buf;
};
