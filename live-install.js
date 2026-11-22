// Installs or removes the live-editing plugin in the game.
// Usage: node live-install.js install|uninstall ["path\to\Fear & Hunger 2 Termina"]
const fs = require('fs');
const path = require('path');

const mode = process.argv[2];
const GAME = require('./find-game.js')(process.argv[3]);
if (!GAME || !['install', 'uninstall'].includes(mode)) {
  console.error(GAME ? 'Usage: node live-install.js install|uninstall'
    : 'Could not find the game folder. Put this tool\'s folder inside the game folder, or pass the path, e.g.:\n'
      + '  install-live.bat "D:\\Games\\Fear & Hunger 2 Termina"');
  process.exit(1);
}
const JS = path.join(GAME, 'www', 'js');
const LIST = path.join(JS, 'plugins.js');
const PLUGIN = path.join(JS, 'plugins', 'termina_live.js');
const NAME = 'termina_live';

const text = fs.readFileSync(LIST, 'utf8');
const start = text.indexOf('['), end = text.lastIndexOf(']');
const header = text.slice(0, start);
const plugins = JSON.parse(text.slice(start, end + 1));
const write = list => fs.writeFileSync(LIST, header + '[\n' + list.map(p => JSON.stringify(p)).join(',\n') + '\n];\n');

const backup = LIST + '.before-live-editor';
if (!fs.existsSync(backup)) fs.copyFileSync(LIST, backup);

const others = plugins.filter(p => p.name !== NAME);
if (mode === 'install') {
  fs.copyFileSync(path.join(__dirname, 'termina_live.js'), PLUGIN);
  write([...others, { name: NAME, status: true, description: 'Live link for the Termina Save Editor', parameters: {} }]);
  console.log('Live editing installed. Restart the game if it is running.');
} else {
  write(others);
  if (fs.existsSync(PLUGIN)) fs.unlinkSync(PLUGIN);
  console.log('Live editing removed. Restart the game if it is running.');
}
console.log('(Original plugin list kept at ' + backup + ')');
