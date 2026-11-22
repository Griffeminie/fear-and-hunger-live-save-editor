// Companion roster: where every playable companion is right now.
//
// Works from the game's own rules rather than guesses:
//  - Hubs (train cabin, PRHVL Bop) show a companion through "pick-up" events on that map. Which of
//    an event's pages is active - and whether it shows a character - follows RPG Maker's page rules
//    (the last page whose conditions are all met wins), so we evaluate those exactly.
//  - A companion counts as *waiting* there (rather than just being there as a stranger, like on
//    day 1) when the visible page depends on a flag that the hub's drop-off event sets for them, or
//    when it's the page that adds them to the party.
//  - Deaths use each companion's "<name>1" switch, which the game turns on together with
//    "CHARACTERS_LEFT -= 1" (O'saa's is yellow_mage1).
const fs = require('fs');
const path = require('path');

const HUBS = [
  { id: 'train', label: 'Train cabin', map: 14, dropoff: 74 },
  { id: 'club', label: 'PRHVL Bop (club)', map: 67, dropoff: 85 },
];
const DEATH_SWITCH_OVERRIDES = { 6: 'yellow_mage1' };

// Commands inside the "if <actor> is in the party" branch of a drop-off event.
function actorBranches(list) {
  const out = {};
  list.forEach((c, i) => {
    if (c.code !== 111 || c.parameters[0] !== 4 || c.parameters[2] !== 0) return;
    const body = [];
    for (let j = i + 1; j < list.length; j++) {
      const d = list[j];
      if (d.indent <= c.indent && (d.code === 411 || d.code === 412)) break;
      body.push(d);
    }
    (out[c.parameters[1]] = out[c.parameters[1]] || []).push(...body);
  });
  return out;
}

function buildRosterRules(www, companionIds) {
  const read = n => JSON.parse(fs.readFileSync(path.join(www, 'data', n + '.json'), 'utf8'));
  const sys = read('System'), actors = read('Actors');
  const findSwitch = name => sys.switches.findIndex(n => n && n.toLowerCase() === name.toLowerCase());

  const hubs = HUBS.map(hub => {
    const map = read('Map' + String(hub.map).padStart(3, '0'));
    // flags each companion's drop-off sets (ignoring ones every companion's branch sets, like fades)
    const branches = actorBranches(map.events[hub.dropoff].pages[0].list);
    const count = {};
    const flagsOf = {};
    for (const [a, body] of Object.entries(branches)) {
      const flags = new Set();
      for (const c of body) {
        if (c.code === 121 && c.parameters[2] === 0) for (let s = c.parameters[0]; s <= c.parameters[1]; s++) flags.add('s' + s);
        if (c.code === 122) for (let v = c.parameters[0]; v <= c.parameters[1]; v++) flags.add('v' + v);
      }
      flagsOf[a] = flags;
      for (const f of flags) count[f] = (count[f] || 0) + 1;
    }
    for (const a of Object.keys(flagsOf)) flagsOf[a] = [...flagsOf[a]].filter(f => count[f] < 3);

    // pick-up events: any event on the hub map that can add the companion to the party
    const pickups = {};
    for (const ev of map.events) {
      if (!ev) continue;
      for (const a of companionIds) {
        const adds = ev.pages.some(pg => pg.list.some(c => c.code === 129 && c.parameters[0] === a && c.parameters[1] === 0));
        if (!adds) continue;
        (pickups[a] = pickups[a] || []).push({
          event: ev.id,
          pages: ev.pages.map(pg => ({
            c: pg.conditions,
            visible: !!pg.image.characterName || pg.image.tileId > 0,
            adds: pg.list.some(c => c.code === 129 && c.parameters[0] === a && c.parameters[1] === 0),
          })),
        });
      }
    }
    return { id: hub.id, label: hub.label, map: hub.map, flagsOf, pickups };
  });

  const companions = companionIds.map(id => ({
    id,
    name: actors[id].name,
    faceName: actors[id].faceName,
    faceIndex: actors[id].faceIndex,
    deathSwitch: findSwitch(DEATH_SWITCH_OVERRIDES[id] || actors[id].name.replace(/\W/g, '') + '1'),
  }));
  return { hubs, companions };
}

// state: { sw(i), v(i), self(map, event, ch), item(i), party: [ids], main: id|null, actors: {id: {name, faceName, faceIndex}} }
function evaluateRoster(rules, st) {
  const activePage = (pages, mapId, eventId) => {
    for (let i = pages.length - 1; i >= 0; i--) {
      const c = pages[i].c;
      if (c.switch1Valid && !st.sw(c.switch1Id)) continue;
      if (c.switch2Valid && !st.sw(c.switch2Id)) continue;
      if (c.variableValid && st.v(c.variableId) < c.variableValue) continue;
      if (c.selfSwitchValid && !st.self(mapId, eventId, c.selfSwitchCh)) continue;
      if (c.itemValid && !st.item(c.itemId)) continue;
      if (c.actorValid && !st.party.includes(c.actorId)) continue;
      return pages[i];
    }
    return null;
  };
  const dependsOn = (page, flags) => {
    const c = page.c, f = new Set(flags);
    return (c.switch1Valid && f.has('s' + c.switch1Id)) || (c.switch2Valid && f.has('s' + c.switch2Id)) || (c.variableValid && f.has('v' + c.variableId));
  };

  return rules.companions.map(comp => {
    const live = (st.actors && st.actors[comp.id]) || {};
    const entry = {
      id: comp.id,
      name: live.name || comp.name,
      faceName: live.faceName || comp.faceName,
      faceIndex: live.faceIndex != null ? live.faceIndex : comp.faceIndex,
      main: st.main === comp.id,
    };
    if (st.party.includes(comp.id)) return { ...entry, status: 'party', label: entry.main ? 'Main character' : 'In your party' };
    if (comp.deathSwitch > 0 && st.sw(comp.deathSwitch)) return { ...entry, status: 'dead', label: 'Dead' };
    let stranger = null;
    for (const hub of rules.hubs) {
      for (const ev of hub.pickups[comp.id] || []) {
        const page = activePage(ev.pages, hub.map, ev.event);
        if (!page || !page.visible) continue;
        if (page.adds || dependsOn(page, hub.flagsOf[comp.id] || [])) return { ...entry, status: 'waiting', hub: hub.id, label: `Waiting at the ${hub.label}` };
        stranger = stranger || hub;
      }
    }
    if (stranger) return { ...entry, status: 'stranger', hub: stranger.id, label: `At the ${stranger.label} (not recruited yet)` };
    return { ...entry, status: 'away', label: 'Not with you' };
  });
}

module.exports = { buildRosterRules, evaluateRoster };
