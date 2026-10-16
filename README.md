# eXF1LT

F1 live timing in your terminal, built with [Ink](https://github.com/vadimdemedes/ink) on
[`@exhumer/f1-live-timing`](https://github.com/eXhumer/f1-live-timing).

## Usage

```sh
exf1lt                                   # pick a session from the archive (or the live one)
exf1lt --live                            # follow the live session
exf1lt --live --record ./recordings/sgp  # follow and record it
exf1lt --replay 2026/2026-10-11_Singapore_Grand_Prix/2026-10-11_Race/
exf1lt --recording ./recordings/sgp      # play back a recording
exf1lt --race-control bottom             # race control under the timing (side | bottom | off)
```

### Screens

The layout follows the official live timing page:

- **1 Leaderboard**, with the tabs **Laps** (lap time, gap, interval, sectors, places
  gained since the start, tyre, pit stops), **Sectors** (each sector with the driver's
  best and the speed trap), **Segments** (mini-sector bars, with the fastest driver of
  each sector in the header) and **Tyres** (current tyre, stint and tyre age, pit stops,
  earlier stints).
- **2 Driver Tracker**: the track map beside a compact tower with the tabs **Laps**,
  **Sectors**, **Head to Head** (pin a driver with `h`, select another) and
  **Telemetry** (speed, RPM, gear, throttle and brake of both). Lapped cars are labelled
  with their deficit, e.g. `ALO 1L`.

Race control messages sit in a side panel by default. `r` moves them under the timing
and then hides them, and `--race-control` picks where they start. With the panel hidden,
the latest message shows on the map. A side panel that does not fit beside the
leaderboard drops to the bottom.

### Archived seasons

`[` and `]` in the session picker go through every season since 2018. The archive's
season indexes are incomplete (2022 has none, 2024 lists only rounds 10–24, and some
list placeholder sessions), so eXF1LT combines two sources:

1. the season's `Index.json` from the live timing archive, and
2. F1TV's schedule (through [`@exhumer/f1tv-api`](https://www.npmjs.com/package/@exhumer/f1tv-api),
   as eXViewer reads it, without a login) for the meetings the index leaves out. F1TV
   shares the archive's meeting keys and gives each session's local time, which the
   archive's folder names are built from.

Pre-season testing days are filed as `Practice_N` up to 2024 and `Day_N` since 2025,
so both folders are tried. The 2020 tests are in neither source; they are listed in
`ARCHIVE_EXTRAS` in `src/archive/seasonCatalog.ts`, found by probing the archive.

Each session is then checked against the archive, since F1 no longer serves many
sessions it lists (most of 2018 and almost all of 2022). Missing sessions are struck
through and cannot be opened.

The official site draws the track from a 3D model made for each circuit. eXF1LT draws
the outline from one clean lap of position data instead, so it works for every circuit
without extra downloads.

### F1 tokens

The quickest way to set both tokens up is to log in once in a browser window:

```sh
exf1lt login
```

It opens Chrome, Edge, Brave (including Brave Origin) or Chromium (found automatically on macOS and Windows;
`--browser <path>` or `F1_BROWSER` picks another) on the F1 account page with a
throwaway profile. Log in as usual; once the login completes the window closes and both
tokens are cached. Nothing is typed or pasted, and nothing of the browser profile is
kept. F1 only allows its own redirect address for this login, so the command reads the
token response through the browser's DevTools connection instead of running a local
callback.

Brave Origin asks for its purchase ID in every new profile (and each activation counts
against Brave's monthly limit), so for it alone the command keeps one profile of its own in
the config directory (`brave-origin-profile`): enter the purchase ID the first time only.
The F1 session is wiped from that profile before and after each login.

The tokens last about four days. Run `exf1lt login` again when
`exf1lt token status` says they expired. To set them by hand instead:

F1 takes two tokens. Today both are the same JWT, the `subscriptionToken` of your F1 login
(`exf1lt login` saves it as both), so a missing authorization token falls back to the
subscription token. They are kept apart in case F1 splits them:

**Subscription (ascendon) token**: live `CarData` and `Position` need it. Give it once:

```sh
exf1lt --live --token-file ./token.txt
```

The file may hold the raw `subscriptionToken` or the `login-session` cookie value
(URL-encoded or JSON). The token is cached in `%APPDATA%\eXF1LT\auth.json` on Windows
or `~/.config/exf1lt/auth.json` elsewhere (`EXF1LT_CONFIG_DIR` overrides), and reused
on later runs. `F1_TOKEN` takes precedence over the cache and is never written to it.
An expired cached token is ignored: live timing still works, without telemetry.

**Authorization token**: the F1 static archive (`livetiming.formula1.com/static/...`,
used by the session picker and `--replay`) answers 401 without an `Authorization`
header. Give it once:

```sh
exf1lt --auth-token-file ./authorization.txt
```

The file holds the token, optionally as `Bearer <token>` or a pasted
`Authorization: Bearer <token>` line. It is cached next to the other token in
`authorization.json`, and `F1_AUTH_TOKEN` overrides the cache without being written to it.

The two tokens are independent and can be combined, e.g.
`exf1lt --live --token-file ./token.txt --auth-token-file ./authorization.txt`.

```sh
exf1lt token status   # both tokens
exf1lt token clear    # both tokens
```

### Keys

| Key | Action |
| --- | --- |
| `1` / `2` | Leaderboard / Driver Tracker |
| `tab` / `⇧tab` | next / previous tab of the screen |
| `↑` `↓` | select driver (highlighted in the tables and on the map) |
| `h` | pin the selected driver for Head to Head and Telemetry (again to unpin) |
| `space` | play / pause (pausing live freezes the feed) |
| `←` `→` | seek ±5 s |
| `⇧←` `⇧→` / `p` `n` | previous / next lap |
| `[` `]` | playback speed ½× – 16× |
| `j` | jump to a lap |
| `L` | back to live |
| `r` | race control: side panel → bottom strip → hidden |
| `<` `>` | narrow / widen the race control side panel (4 columns at a time) |
| `esc` | back to the session picker |
| `q` | quit |

## Development

Requires Node.js ≥ 22.19.

```sh
npm install
npm run typecheck
npm test
npm run build && node dist/cli.mjs
```

### Single executable

`npm run build:sea` builds `dist-sea/exf1lt.exe` (`dist-sea/exf1lt` on Linux and
macOS): one file with Node.js and eXF1LT inside it, which runs on machines without Node.

```sh
npm run build:sea
./dist-sea/exf1lt --replay 2026/2026-10-11_Singapore_Grand_Prix/2026-10-11_Race/
```

It uses Node's [single executable applications](https://nodejs.org/api/single-executable-applications.html):

1. `tsdown.sea.config.ts` bundles `src/cli.tsx` and every dependency into one ESM file,
   `dist-sea/exf1lt.mjs`. An executable's main script can only import Node built-ins,
   and it stays ESM because Ink's layout engine uses top-level `await`.
2. `scripts/build-sea.mjs` writes `dist-sea/sea-config.json` (`mainFormat: "module"`)
   and runs `node --build-sea`, which copies the running Node binary with the bundle
   injected. On macOS the binary is then signed ad hoc with `codesign`.

The executable is built for the platform and architecture of the Node that runs the
script, and needs a Node release with `--build-sea` (it was built with Node 26). It is
about 100 MB, almost all of it the Node runtime. Builds for other systems have to be
made on those systems (or in CI). The executable is not code-signed, so Windows
SmartScreen and macOS Gatekeeper may warn the first time it runs.

### Release builds

The **Binaries** workflow (`.github/workflows/binaries.yml`) builds the executable on
each platform's own GitHub runner:

| Archive | Runner |
| --- | --- |
| `exf1lt-linux-x64.tar.gz` | `ubuntu-24.04` |
| `exf1lt-linux-arm64.tar.gz` | `ubuntu-24.04-arm` |
| `exf1lt-macos-arm64.tar.gz` | `macos-26` (Apple silicon) |
| `exf1lt-macos-x64.tar.gz` | `macos-26-intel` |
| `exf1lt-macos-universal.tar.gz` | both macOS builds merged with `lipo` |
| `exf1lt-windows-x64.zip` | `windows-2025` |
| `exf1lt-windows-arm64.zip` | `windows-11-arm` |

Each build runs the tests, checks that the binary matches its target, and runs
`--help` and `token status` with it. Run the workflow by hand from the Actions tab to
get the archives as workflow artifacts, or push a tag to publish them as a GitHub
release with a `SHA256SUMS` file:

```sh
git tag -a v0.1.0 -m "v0.1.0 Release"
git push origin v0.1.0
```

The Linux builds need glibc 2.28 or newer, like the official Node.js binaries they
are made from.
