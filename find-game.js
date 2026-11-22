// Locates the Fear & Hunger 2 Termina install folder.
//
// Order: a path given on the command line, the TERMINA_GAME_DIR environment variable, this tool's
// own folder (if it was unpacked inside the game folder), then every Steam library on the PC
// (Steam's location comes from the registry on Windows; the usual places on Linux/Steam Deck/macOS).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const NAME = 'Fear & Hunger 2 Termina';
const isGame = dir => !!dir && fs.existsSync(path.join(dir, 'www', 'data', 'Items.json'));

function steamRoots() {
  const roots = [];
  if (process.platform === 'win32') {
    for (const key of ['HKCU\\Software\\Valve\\Steam', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'HKLM\\SOFTWARE\\Valve\\Steam']) {
      try {
        const out = execSync(`reg query "${key}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const m = out.match(/\s(?:SteamPath|InstallPath)\s+REG_SZ\s+(.+)/i);
        if (m) roots.push(path.normalize(m[1].trim()));
      } catch { /* key not there */ }
    }
    roots.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
  } else {
    const home = os.homedir();
    roots.push(
      path.join(home, '.steam', 'steam'),
      path.join(home, '.local', 'share', 'Steam'),
      path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'), // Flatpak
      path.join(home, 'Library', 'Application Support', 'Steam'), // macOS
    );
  }
  return [...new Set(roots)];
}

module.exports = function findGameDir(arg) {
  const given = arg || process.env.TERMINA_GAME_DIR;
  if (given) {
    // accept the game folder itself, or something inside it (e.g. its www folder or Game.exe)
    for (let dir = path.resolve(given), i = 0; i < 3; i++, dir = path.dirname(dir)) if (isGame(dir)) return dir;
    console.error(`"${given}" doesn't look like the Fear & Hunger 2 Termina folder (no www/data inside).`);
    return null;
  }
  // unpacked inside the game folder (or a subfolder of it)?
  for (let dir = __dirname, i = 0; i < 3; i++, dir = path.dirname(dir)) if (isGame(dir)) return dir;

  const candidates = [];
  for (const root of steamRoots()) {
    candidates.push(path.join(root, 'steamapps', 'common', NAME));
    for (const vdf of [path.join(root, 'steamapps', 'libraryfolders.vdf'), path.join(root, 'config', 'libraryfolders.vdf')]) {
      if (!fs.existsSync(vdf)) continue;
      for (const m of fs.readFileSync(vdf, 'utf8').matchAll(/"path"\s+"([^"]+)"/g)) {
        candidates.push(path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps', 'common', NAME));
      }
    }
  }
  if (process.platform === 'win32') {
    for (const d of 'CDEFGHIJ') candidates.push(`${d}:\\SteamLibrary\\steamapps\\common\\${NAME}`);
  }
  return candidates.find(isGame);
};
