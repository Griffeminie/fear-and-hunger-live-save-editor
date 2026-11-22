//=============================================================================
// termina_live.js  -  live link for the Termina Save Editor
//=============================================================================
/*:
 * @plugindesc Lets the Termina Save Editor (http://127.0.0.1:7777) edit the running game.
 * @help Opens a small local-only server on 127.0.0.1:7778 that the editor page
 * talks to. Remove it with uninstall-live.bat in the editor folder.
 */
(function () {
  if (typeof require !== 'function') return;
  var http = require('http');
  var PORT = 7778;
  var EDITOR_ORIGIN = 'http://127.0.0.1:7777';
  var FULLNESS_MAX = 156;
  // Ritual-circle sigils (switches the game sets when you pick up each skin bible)
  var SIGILS = [[1421, 'Gro-goroth'], [1422, 'Sylvian'], [1423, 'Alll-mer'], [1424, 'Rher (moon)'], [1425, 'Vinushka'], [1426, 'God of Fear and Hunger']];
  var KINDS = { item: ['_items', '$dataItems'], weapon: ['_weapons', '$dataWeapons'], armor: ['_armors', '$dataArmors'] };

  // ---- toggles (remembered between game launches) ----
  var CHEATS_KEY = 'termina_live_cheats';
  var cheats = { infiniteStamina: false };
  try { Object.assign(cheats, JSON.parse(localStorage.getItem(CHEATS_KEY) || '{}')); } catch (e) {}
  function saveCheats() { try { localStorage.setItem(CHEATS_KEY, JSON.stringify(cheats)); } catch (e) {} }

  // The game's run meter: variable 2714 counts up while running; at 51 you're exhausted and
  // switch 2243 (cooldown) blocks running. Keeping the meter at 0 = unlimited stamina.
  var RUN_METER = 2714, RUN_COOLDOWN_VAR = 2716, RUN_COOLDOWN_SWITCH = 2243;
  function applyCheats() {
    if (!cheats.infiniteStamina || !window.$gameVariables) return;
    if ($gameVariables.value(RUN_METER) !== 0) $gameVariables.setValue(RUN_METER, 0);
    if ($gameSwitches.value(RUN_COOLDOWN_SWITCH)) {
      $gameSwitches.setValue(RUN_COOLDOWN_SWITCH, false);
      $gameVariables.setValue(RUN_COOLDOWN_VAR, 0);
    }
  }
  // ---- fast travel ----
  // Variable 696 (LOCATION_VAR) is the game's "which part of town am I in" value, set by floor
  // tiles as you walk. We remember every zone you've stood in (stored in the save via $gameSystem).
  var LOCATION_VAR = 696, ROOM_CHANGE_EVENT = 104;
  var RIFLEMAN_SWITCHES = [767, 768, 769, 770, 771, 772, 773, 774, 776, 777, 778, 779, 780, 796, 797, 798, 799];
  function trackZone() {
    if (!window.$gameSystem || !window.$gameVariables) return;
    var zones = $gameSystem._ttZones = $gameSystem._ttZones || {};
    var z = $gameVariables.value(LOCATION_VAR);
    if (z > 0 && !zones[z]) zones[z] = true;
    var maps = $gameSystem._ttMaps = $gameSystem._ttMaps || {}; // which maps you've stood on (street vs sewer)
    if (window.$gameMap && $gameMap.mapId() > 0 && !maps[$gameMap.mapId()]) maps[$gameMap.mapId()] = true;
  }
  // Maps you had already been to before this plugin existed (things you interacted with there).
  function legacyMaps() {
    var seen = {};
    Object.keys($gameSelfSwitches._data || {}).forEach(function (k) { if ($gameSelfSwitches._data[k]) seen[k.split(',')[0]] = true; });
    Object.keys($gameSystem._savedEventLocations || {}).forEach(function (k) { seen[k.split(',')[0]] = true; });
    return Object.keys(seen).map(Number);
  }
  function travelBlocker() {
    var scene = SceneManager._scene;
    if (!(scene instanceof Scene_Map)) return 'Close the menu first';
    if ($gameParty.inBattle()) return 'Not during a battle';
    if ($gamePlayer.isTransferring()) return 'Already moving to another area';
    if ($gameMap.isEventRunning() || $gameMessage.isBusy()) return 'Wait until the current scene/dialogue ends';
    if (!$gamePlayer.canMove()) return "You can't move right now";
    return null;
  }
  function travelInfo() {
    return {
      zones: Object.keys($gameSystem._ttZones || {}).map(Number),
      legacyMaps: legacyMaps(),
      maps: Object.keys($gameSystem._ttMaps || {}).map(Number),
      current: $gameVariables.value(LOCATION_VAR),
      currentMap: $gameMap.mapId(),
      mapUpdate: $gameVariables.value(1411), mapMarkers: $gameVariables.value(1894),
      blocked: travelBlocker()
    };
  }
  function travel(t) {
    var why = travelBlocker();
    if (why) throw new Error(why);
    // Same housekeeping the game's own doors do before and after moving you.
    RIFLEMAN_SWITCHES.forEach(function (s) { $gameSwitches.setValue(s, false); });
    $gameVariables.setValue(LOCATION_VAR, t.zone);
    $gamePlayer.reserveTransfer(+t.map, +t.x, +t.y, 2, 0);
    $gameTemp.reserveCommonEvent(ROOM_CHANGE_EVENT);
    trackZone();
  }

  var _Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function () {
    _Scene_Map_update.apply(this, arguments);
    try { applyCheats(); trackZone(); } catch (e) {}
  };

  // ---- lost limbs (same logic as limbs.js in the editor folder) ----
  // Each playable character has switches like "mercenary_leg1"/"_leg2"/"_arm1"/"_arm2". The game's
  // "Legs_off" events (541, 545) tell us which character each prefix belongs to.
  var limbTable = null;
  function getLimbTable() {
    if (limbTable) return limbTable;
    var names = $dataSystem.switches, byActor = {};
    [541, 545].forEach(function (id) {
      var ev = $dataCommonEvents[id], select = null;
      if (!ev) return;
      ev.list.forEach(function (c) {
        var p = c.parameters;
        if (c.code === 111 && p[0] === 0 && /SELECT/i.test(names[p[1]] || '')) select = p[1];
        if (!select) return;
        if (c.code === 311 && p[0] === 0 && !byActor[p[1]]) byActor[p[1]] = { select: select };
        var owner = Object.keys(byActor).filter(function (a) { return byActor[a].select === select; })[0];
        var m = c.code === 121 && (names[p[0]] || '').match(/^(.*)_leg\d$/i);
        if (m && owner) byActor[owner].prefix = m[1];
      });
    });
    var find = function (n) { for (var i = 1; i < names.length; i++) if (names[i] && names[i].toLowerCase() === n.toLowerCase()) return i; return -1; };
    limbTable = {};
    Object.keys(byActor).forEach(function (a) {
      var pre = byActor[a].prefix;
      if (!pre) return;
      limbTable[a] = {
        select: byActor[a].select, // the "<CHARACTER> SELECT" switch: on = this is your main character
        leg: [find(pre + '_leg1'), find(pre + '_leg2')].filter(function (i) { return i > 0; }),
        arm: [find(pre + '_arm1'), find(pre + '_arm2')].filter(function (i) { return i > 0; })
      };
    });
    return limbTable;
  }
  function limbStatus(actorId) {
    var t = getLimbTable()[actorId], res = [];
    if (!t) return res;
    ['leg', 'arm'].forEach(function (part) {
      var lost = t[part].filter(function (s) { return $gameSwitches.value(s); }).length;
      if (!lost) return;
      res.push({ part: part, switches: t[part],
        name: lost >= 2 ? 'Lost both ' + part + 's' : 'Lost ' + (part === 'arm' ? 'an' : 'a') + ' ' + part });
    });
    return res;
  }
  var OUTFIT_CHECK_SWITCH = 298; // makes the game redraw the character sprite

  // ---- rest hubs: send party members to wait at the train / club ----
  // Each hub has a "drop-off" event that, when you walk into it, makes companions in your party stay
  // there (removes them and sets that character's "waiting here" switches). We run that same event's
  // logic for just the chosen character, minus dialogue, fades, sounds and lighting, so the hub's NPCs
  // show up exactly as if you'd walked there yourself.
  var HUBS = [
    { id: 'train', label: 'Train cabin', map: 14, event: 74 },
    { id: 'club', label: 'PRHVL Bop (club)', map: 67, event: 85, requiresVar: 'been_to_prhvl_bop' }
  ];
  var hubPages = {};
  function hubPage(hub) {
    if (hubPages[hub.id]) return hubPages[hub.id];
    var path = require('path'), fs = require('fs');
    var file = path.join(path.dirname(process.mainModule.filename), 'data', 'Map' + ('000' + hub.map).slice(-3) + '.json');
    var map = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (hubPages[hub.id] = { list: map.events[hub.event].pages[0].list, events: map.events });
  }
  function hubAvailable(hub) {
    if (!hub.requiresVar) return true;
    var id = $dataSystem.variables.indexOf(hub.requiresVar);
    return id > 0 && $gameVariables.value(id) >= 1;
  }
  function hubActors(hub) {
    var seen = {};
    hubPage(hub).list.forEach(function (c) { if (c.code === 111 && c.parameters[0] === 4 && c.parameters[2] === 0) seen[c.parameters[1]] = true; });
    return seen;
  }
  // The hub event rewritten to affect only `actorId`, with nothing that needs the screen or that map.
  function hubCommandsFor(hub, actorId) {
    var page = hubPage(hub), out = [], skipCont = null;
    page.list.forEach(function (c) {
      if (skipCont && c.code === skipCont) return;            // continuation lines of a removed command
      skipCont = null;
      var p = c.parameters;
      if (c.code === 101) { skipCont = 401; return; }        // dialogue
      if (c.code === 205) { skipCont = 505; return; }        // move routes
      if ([223, 230, 250, 356, 224, 225, 241, 245, 249, 108, 408].indexOf(c.code) >= 0) return; // fades, waits, sounds, lights, comments
      if (c.code === 111 && p[0] === 6) { out.push({ code: 111, indent: c.indent, parameters: [12, 'true'] }); return; } // "player facing" checks
      if (c.code === 111 && p[0] === 4 && p[2] === 0 && p[1] !== actorId) { out.push({ code: 111, indent: c.indent, parameters: [12, 'false'] }); return; }
      if (c.code === 203) {                                   // move that hub's NPC to their seat (saved location)
        var ev = page.events[p[0]];
        if (ev && /<Save Event Location>/i.test(ev.note || '') && p[1] === 0) {
          out.push({ code: 355, indent: c.indent, parameters: ['$gameSystem._savedEventLocations = $gameSystem._savedEventLocations || {}; $gameSystem._savedEventLocations[[' + hub.map + ',' + p[0] + ']] = [' + p[2] + ',' + p[3] + ',' + (p[4] || 2) + '];'] });
        }
        return;
      }
      out.push(c);
    });
    return out;
  }
  function runCommands(list) {
    var it = new Game_Interpreter();
    it.setup(list, 0);
    for (var i = 0; i < 5000 && it.isRunning(); i++) it.update();
    it.clear();
  }
  function isMainCharacter(actor) {
    var t = getLimbTable()[actor.actorId()];
    return actor === $gameParty.leader() || !!(t && t.select && $gameSwitches.value(t.select));
  }
  function partyInfo() {
    var hubs = HUBS.filter(hubAvailable);
    return {
      max: $gameParty.maxBattleMembers(),
      hubs: hubs.map(function (h) { return { id: h.id, label: h.label }; }),
      members: $gameParty.members().map(function (a) {
        var id = a.actorId();
        return { id: id, name: a.name(), leader: isMainCharacter(a),
          canGo: hubs.filter(function (h) { return hubActors(h)[id]; }).map(function (h) { return h.id; }) };
      })
    };
  }
  function sendToHub(actorId, hubId) {
    var why = travelBlocker();
    if (why) throw new Error(why);
    var hub = HUBS.filter(function (h) { return h.id === hubId; })[0];
    var actor = $gameActors.actor(actorId);
    if (!hub || !hubAvailable(hub)) throw new Error("You haven't unlocked that place yet");
    if (!actor || $gameParty.members().indexOf(actor) < 0) throw new Error('They are not in your party');
    if (isMainCharacter(actor)) throw new Error("That's your main character");
    if (!hubActors(hub)[actorId]) throw new Error(actor.name() + " doesn't stay at the " + hub.label);
    var list = hubCommandsFor(hub, actorId);
    // Some characters only chat on their first visit (and stay); the second pass is them staying.
    for (var pass = 0; pass < 2 && $gameParty.members().indexOf(actor) >= 0; pass++) runCommands(list);
    if ($gameParty.members().indexOf(actor) >= 0) throw new Error(actor.name() + " won't stay at the " + hub.label + ' at this point in the story');
    $gamePlayer.refresh();
    if (window.SoundManager) SoundManager.playOk();
  }

  function inGame() {
    return window.$gameParty && $gameParty.members && $gameParty.members().length > 0 && window.$dataItems;
  }

  // God affinity variables ("<god>_affliction"), found by name in the game's data.
  var affinityIds = null;
  function affinityVars() {
    if (!affinityIds) {
      affinityIds = [];
      $dataSystem.variables.forEach(function (n, id) { if (/_affliction$/i.test(n || '')) affinityIds.push(id); });
    }
    return affinityIds;
  }

  function state() {
    var inv = {};
    Object.keys(KINDS).forEach(function (kind) {
      var bag = $gameParty[KINDS[kind][0]], db = window[KINDS[kind][1]];
      inv[kind] = Object.keys(bag).filter(function (k) { return /^\d+$/.test(k) && bag[k] > 0; }).map(function (id) {
        return { id: +id, qty: bag[id], name: db[id] ? db[id].name : '#' + id };
      });
    });
    var actors = $gameParty.members().map(function (a) {
      return {
        id: a.actorId(), name: a.name(), level: a.level,
        hp: a.hp, mp: a.mp, baseMaxHp: a.mhp, baseMaxMp: a.mmp,
        fullness: a.currentExp(),
        paramPlus: a._paramPlus.slice(0, 8),
        states: a._states.map(function (id) { return { id: id, name: $dataStates[id] ? $dataStates[id].name : '' }; }),
        skills: a._skills.map(function (id) { return { id: id, name: $dataSkills[id] ? $dataSkills[id].name : '#' + id }; }),
        limbs: limbStatus(a.actorId())
      };
    });
    var sigils = SIGILS.map(function (g) { return { sw: g[0], name: g[1], known: $gameSwitches.value(g[0]) }; });
    var party = null;
    try { party = partyInfo(); } catch (e) { party = { error: String(e.message || e) }; }
    var affinity = {};
    affinityVars().forEach(function (id) { affinity[id] = $gameVariables.value(id); });
    return { slot: 'live', live: true, cheats: cheats, travel: travelInfo(), party: party, inventory: inv, actors: actors, sigils: sigils, affinity: affinity,
      paramNames: $dataSystem.terms.params.slice(0, 8), fullnessMax: FULLNESS_MAX };
  }

  function apply(edits) {
    Object.keys(KINDS).forEach(function (kind) {
      var want = edits.inventory && edits.inventory[kind];
      if (!want) return;
      var bag = $gameParty[KINDS[kind][0]], db = window[KINDS[kind][1]];
      var ids = Object.keys(bag).concat(Object.keys(want)).filter(function (k, i, all) { return /^\d+$/.test(k) && all.indexOf(k) === i; });
      ids.forEach(function (id) {
        var item = db[id];
        if (!item) return;
        var target = Math.max(0, Math.floor(+want[id] || 0));
        var diff = target - $gameParty.numItems(item);
        if (diff !== 0) $gameParty.gainItem(item, diff, false);
      });
    });
    (edits.actors || []).forEach(function (e) {
      var a = $gameActors.actor(e.id);
      if (!a) return;
      (e.paramPlus || []).forEach(function (v, i) { a._paramPlus[i] = Math.floor(+v || 0); });
      (e.removeStates || []).forEach(function (id) { a.removeState(id); });
      (e.removeSkills || []).forEach(function (id) { a.forgetSkill(+id); });
      (e.addSkills || []).forEach(function (id) { if ($dataSkills[+id]) a.learnSkill(+id); });
      // the shrine's "SKILL_<name>" switches for those skills (only switches with that kind of name)
      (e.skillSwitches || []).forEach(function (s) { if (/^SKILL_/i.test($dataSystem.switches[+s] || '')) $gameSwitches.setValue(+s, true); });
      var t = getLimbTable()[e.id], own = t ? t.leg.concat(t.arm) : [];
      var restored = (e.restoreLimbs || []).filter(function (s) { return own.indexOf(s) >= 0 && $gameSwitches.value(s); });
      restored.forEach(function (s) { $gameSwitches.setValue(s, false); });
      if (restored.length) $gameSwitches.setValue(OUTFIT_CHECK_SWITCH, true);
      a.refresh();
      var full = Math.max(0, Math.min(FULLNESS_MAX, Math.floor(+e.fullness)));
      if (full !== a.currentExp()) a.changeExp(full, false);
      a.setHp(Math.max(1, Math.floor(+e.hp)));
      a.setMp(Math.max(0, Math.floor(+e.mp)));
    });
    SIGILS.forEach(function (g) {
      if (edits.sigils && g[0] in edits.sigils) $gameSwitches.setValue(g[0], !!edits.sigils[g[0]]);
    });
    affinityVars().forEach(function (id) {
      if (edits.affinity && id in edits.affinity) $gameVariables.setValue(id, Math.max(0, Math.min(9, Math.floor(+edits.affinity[id] || 0))));
    });
    $gamePlayer.refresh();
    if (window.SoundManager) SoundManager.playUseItem();
  }

  function send(res, code, body) {
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': EDITOR_ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type, X-Termina-Editor',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    res.end(JSON.stringify(body));
  }

  var server = http.createServer(function (req, res) {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    // Only the editor page may talk to the game (custom header forces a CORS check).
    if (req.headers['x-termina-editor'] !== '1') return send(res, 403, { error: 'forbidden' });
    try {
      if (req.url === '/state') return send(res, 200, inGame() ? state() : { notInGame: true, cheats: cheats });
      if (req.url === '/travel' && req.method === 'POST') {
        var tbody = '';
        req.on('data', function (c) { tbody += c; });
        req.on('end', function () {
          try {
            if (!inGame()) return send(res, 409, { error: 'Load a save in the game first' });
            travel(JSON.parse(tbody));
            send(res, 200, { ok: true });
          } catch (err) { send(res, 409, { error: String(err && err.message || err) }); }
        });
        return;
      }
      if (req.url === '/flags') {
        // Raw game flags for the editor's companion roster (it does the reasoning itself).
        if (!inGame()) return send(res, 200, { notInGame: true });
        var actorsOut = {};
        Object.keys(getLimbTable()).forEach(function (id) {
          var a = $gameActors._data[+id]; // only actors the game has already created (don't create new ones)
          if (a) actorsOut[id] = { name: a.name(), faceName: a.faceName(), faceIndex: a.faceIndex() };
        });
        return send(res, 200, {
          switches: $gameSwitches._data, variables: $gameVariables._data,
          selfSwitches: Object.keys($gameSelfSwitches._data).filter(function (k) { return $gameSelfSwitches._data[k]; }),
          items: $gameParty._items, party: $gameParty._actors, actors: actorsOut
        });
      }
      if (req.url === '/party' && req.method === 'POST') {
        var pbody = '';
        req.on('data', function (c) { pbody += c; });
        req.on('end', function () {
          try {
            if (!inGame()) return send(res, 409, { error: 'Load a save in the game first' });
            var want = JSON.parse(pbody);
            sendToHub(+want.actor, want.hub);
            send(res, 200, { ok: true, data: state() });
          } catch (err) { send(res, 409, { error: String(err && err.message || err) }); }
        });
        return;
      }
      if (req.url === '/set-flags' && req.method === 'POST') {
        // Raw flag changes worked out by the editor (e.g. wiping a ritual circle's sigil).
        var fbody = '';
        req.on('data', function (c) { fbody += c; });
        req.on('end', function () {
          try {
            if (!inGame()) return send(res, 409, { error: 'Load a save in the game first' });
            var ops = JSON.parse(fbody);
            Object.keys(ops.switches || {}).forEach(function (id) { if (/^\d+$/.test(id)) $gameSwitches.setValue(+id, !!ops.switches[id]); });
            Object.keys(ops.variables || {}).forEach(function (id) { if (/^\d+$/.test(id)) $gameVariables.setValue(+id, Math.floor(+ops.variables[id] || 0)); });
            (ops.selfOff || []).forEach(function (k) {
              var p = String(k).split(',');
              if (p.length === 3 && /^\d+$/.test(p[0]) && /^\d+$/.test(p[1]) && /^[A-D]$/.test(p[2])) $gameSelfSwitches.setValue([+p[0], +p[1], p[2]], false);
            });
            $gameMap.requestRefresh();
            if (window.SoundManager) SoundManager.playUseItem();
            send(res, 200, { ok: true });
          } catch (err) { send(res, 409, { error: String(err && err.message || err) }); }
        });
        return;
      }
      if (req.url === '/cheats' && req.method === 'POST') {
        var cbody = '';
        req.on('data', function (c) { cbody += c; });
        req.on('end', function () {
          try {
            var want = JSON.parse(cbody);
            Object.keys(cheats).forEach(function (k) { if (k in want) cheats[k] = !!want[k]; });
            saveCheats();
            send(res, 200, { ok: true, cheats: cheats });
          } catch (err) { send(res, 500, { error: String(err && err.message || err) }); }
        });
        return;
      }
      if (req.url === '/apply' && req.method === 'POST') {
        var body = '';
        req.on('data', function (c) { body += c; });
        req.on('end', function () {
          try {
            if (!inGame()) return send(res, 409, { error: 'Load a save in the game first' });
            apply(JSON.parse(body));
            send(res, 200, { ok: true, data: state() });
          } catch (err) { send(res, 500, { error: String(err && err.message || err) }); }
        });
        return;
      }
      send(res, 404, { error: 'not found' });
    } catch (err) { send(res, 500, { error: String(err && err.message || err) }); }
  });
  server.on('error', function (err) { console.warn('termina_live: ' + err.message); });
  server.listen(PORT, '127.0.0.1');
  window.addEventListener('unload', function () { try { server.close(); } catch (e) {} });
})();
