// Lost limbs in Termina are not status effects: each playable character has game switches like
// "mercenary_leg1" / "mercenary_leg2" / "mercenary_arm1" / "mercenary_arm2" (first / second limb lost).
// This works out which character owns which switches from the game's own "Legs_off" events, where
// each "<CHARACTER> SELECT" branch damages that character and turns on their leg switches.
// (termina_live.js contains the same logic for the running game.)

const LEG_EVENTS = [541, 545];

function buildLimbs(commonEvents, switchNames) {
  const byActor = {};
  for (const id of LEG_EVENTS) {
    const ev = commonEvents[id];
    if (!ev) continue;
    let select = null;
    for (const c of ev.list) {
      const p = c.parameters;
      if (c.code === 111 && p[0] === 0 && /SELECT/i.test(switchNames[p[1]] || '')) select = p[1];
      if (!select) continue;
      if (c.code === 311 && p[0] === 0 && !byActor[p[1]]) byActor[p[1]] = { select };
      const owner = Object.keys(byActor).find(a => byActor[a].select === select);
      const m = c.code === 121 && (switchNames[p[0]] || '').match(/^(.*)_leg\d$/i);
      if (m && owner) byActor[owner].prefix = m[1];
    }
  }
  const find = name => switchNames.findIndex(n => n && n.toLowerCase() === name.toLowerCase());
  const out = {};
  for (const [actor, { prefix }] of Object.entries(byActor)) {
    if (!prefix) continue;
    out[actor] = {
      select: byActor[actor].select, // the "<CHARACTER> SELECT" switch: on = this is your main character
      leg: [find(prefix + '_leg1'), find(prefix + '_leg2')].filter(i => i > 0),
      arm: [find(prefix + '_arm1'), find(prefix + '_arm2')].filter(i => i > 0),
    };
  }
  return out;
}

// Turns switch values into status-like entries, e.g. "Lost a leg" / "Lost both legs".
function limbStatus(limbs, isOn) {
  const res = [];
  for (const part of ['leg', 'arm']) {
    const sw = limbs[part] || [];
    const lost = sw.filter(isOn).length;
    if (!lost) continue;
    const name = lost >= 2 ? `Lost both ${part}s` : `Lost ${part === 'arm' ? 'an' : 'a'} ${part}`;
    res.push({ part, name, switches: sw });
  }
  return res;
}

module.exports = { buildLimbs, limbStatus };
