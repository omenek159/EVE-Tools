# EVE Tools

Calculators for EVE Online pilots, all in one place: **https://eve.omenek.pl**

EVE Tools answers the "is it worth it?" questions that come up while you play: which ore pays best, whether to reprocess or sell your loot, how much your incursion fleet really earns, and when to stop a Rampant Drone Fabricator. Pick a tool from the menu at the top. There's nothing to install and no account to create.

## The tools

**Ore prices.** Shows how much ISK per hour each ore earns your mining fleet, raw or compressed, plus gas. Add your miners, paste what's in your cargo hold or what your mining scanner sees, and get the value of the belt and how long your fleet needs to clear it.

**Reprocessing.** Paste items from your hangar (ore, ice, modules, ships) and see what they reprocess into, what that's worth, the tax, and whether reprocessing beats selling them as they are. Set your structure, rigs, skills and implant to match your own setup.

**Incursions.** Paste your wallet journal to see what your incursion fleet really earns per hour, with the sites you ran and the LP you got.

**RDF** *(WIP)*. For the Rampant Drone Fabricator in wormholes: pick the wormhole class, enter the ships on grid, and see how much Fabricator data you'll have after each wave, what it's worth and each pilot's share. Paste your cargo to add the drones you looted. The Notes at the bottom of the page say which numbers are confirmed in game.

## How it works

- **Market prices** are kept up to date automatically; new market data arrives about every 30 minutes. Choose the market hub and the price type (for example Jita sell or buy orders) once in **Settings**, and every tool uses them. The top bar shows when prices were last updated.
- **Game data** such as what items reprocess into is updated automatically when a new version of EVE comes out.
- **Your settings** are remembered in your browser, so a tool opens the way you left it. What you paste stays in your browser: the server is only asked for the prices it needs. RDF doesn't remember anything and starts fresh every time.
- **Light and dark theme** follow your system, or you can pick one in Settings.
- When a new version of the site is available, a bar at the top offers to reload the page.

## Credits

- **Incursions:** the calculation comes from the [TLA waitlist](https://github.com/luna-duclos/tla-waitlist) (MIT licence).
- **RDF:** calculations are based on the RDF spreadsheet by **BaneOfUtric**.
- **EVE University wiki:** Rampant Drone Fabricator details (ship Rampancy, Nanoswarms and their icons) and reprocessing rules.
- **Fuzzwork:** market prices, from [market.fuzzwork.co.uk](https://market.fuzzwork.co.uk).
- **CCP Games:** game data and adjusted prices from EVE Online's public data (SDE and ESI).

EVE Online and all related names, images and data are the property of CCP hf. EVE Tools is a fan project and is not affiliated with or endorsed by CCP.
