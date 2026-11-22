# Termina Save Editor

An unofficial save editor and live editor for **Fear & Hunger 2: Termina**, for when you want to experience the game without the stress and cause I can't find a proper cheat for this game for some reason

It runs as a small page in your browser. It can edit your save files, or, with the optional live plugin, change things in the running game instantly.

> Unofficial fan tool. It isn't affiliated with or endorsed by the game's developer, and it contains no game files: it reads the data from your own installed copy.

## Features

- **Inventory.** Add or remove any item, weapon, armor or accessory with one search box, plus quick buttons for ammo and shillings.
- **Party.** Body/Mind, fullness, bonus stats, removing injuries and status effects, restoring lost limbs, and adding or removing **skills** (shrine skills also count as learned at the shrine).
- **Companions.** Everyone you've recruited, with portraits, showing who's in the party, waiting at the train or club, or dead. In live mode you can send a party member to wait at the train or the club.
- **Map and fast travel.** Click a place you've explored on the Prehevil map to teleport there. Street and sewer spots have their own markers.
- **Ritual circle legend.** All perfection, asymmetric and imperfect circles on the map, with hover text saying exactly where each one is and how to reach it.
- **Ritual circles.** See what's drawn on each circle, and **reset** one if you drew the wrong sigil.
- **God affinity.** Raise or lower each god's affinity, with a list of the skills each level unlocks.
- **Sigils.** Mark sigils as learned.
- **Unlimited stamina** toggle (live mode).

Every save-file change makes a backup first, in `www/save/editor-backups`.

## Requirements

- Fear & Hunger 2: Termina (the Steam version; other copies work if you point the tool at the folder, see below).
- [Node.js](https://nodejs.org) 18 or newer. The LTS download is fine. Nothing else needs installing.

## Getting started (Windows)

1. Download this repository (**Code → Download ZIP**) and unzip it anywhere.
2. Double-click **`start.bat`**. Your browser opens the editor at <http://127.0.0.1:7777>.
3. Keep the black window open while you use the editor. Close it to stop.

The game folder is found automatically from your Steam libraries. If it isn't found, either put the editor's folder inside the game folder, or drag the game folder onto `start.bat` (or run `start.bat "D:\Games\Fear & Hunger 2 Termina"`).

### Live editing (optional, recommended)

Live editing is what enables fast travel, unlimited stamina, sending companions to a hub and instant changes.

1. Close the game.
2. Double-click **`install-live.bat`** once.
3. Start the game and load a save. The editor switches to **LIVE** mode by itself, and **Apply to game now** changes the game straight away. Save in-game to keep the changes.

`uninstall-live.bat` removes it again. The installer keeps a copy of the game's original `www/js/plugins.js` as `plugins.js.before-live-editor`.

> After a game update, or after Steam's "Verify integrity of game files", run `install-live.bat` again. Steam may restore the game's own plugin list.

### Editing save files (game closed)

Without the game running, the editor works on the save files directly. Pick a slot, make changes and press **Save changes to file**. Don't edit a slot while the game has it loaded, because the game will overwrite your changes when it saves.

## Linux / Steam Deck

The game runs through Proton, and the editor should work the same way, though this hasn't been tested. Install Node.js, then run `sh start.sh` (and `sh install-live.sh` for live editing) from the editor's folder.

## Troubleshooting

- **"Node.js is not installed"**: install it from <https://nodejs.org> and run the `.bat` again.
- **"The editor already seems to be running"**: it's already open. Go to <http://127.0.0.1:7777>.
- **The editor never switches to LIVE**: make sure you ran `install-live.bat` with the game closed, restarted the game and loaded a save.
- **"Restart the game to load the updated live plugin"**: you updated the editor. Run `install-live.bat` again and restart the game.
- **Something went wrong with a save**: every save-file edit leaves a backup in `www/save/editor-backups`. Copy one back over `fileN.rpgsave` (and rename it) to undo.

## Good to know

- Everything stays on your PC. The editor and the live plugin only listen on `127.0.0.1`, and the plugin only accepts requests from the editor page.
- The tool works out most things (map spots, circles, skills, companions) from the game's own data files. Some IDs (ammo, stamina, sigils) are fixed values from the current Steam version, so a big game update could break parts of it.

## Files

| File | What it is |
|---|---|
| `start.bat` / `start.sh` | Starts the editor |
| `install-live.bat` / `uninstall-live.bat` (and `.sh`) | Adds or removes the live plugin in the game |
| `editor.js` | The local web server, which reads and writes saves |
| `index.html` | The editor page |
| `termina_live.js` | The in-game plugin for live mode |
| `zones.js`, `pois.js`, `circles.js`, `roster.js`, `limbs.js`, `skills.js`, `affinity.js` | Work out map spots, ritual circles, companions, limbs, skills and affinity from the game data |
| `find-game.js` | Finds the game folder |
