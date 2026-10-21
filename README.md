# PlayRush advertisement automation

The script opens every configured game in its own browser tab. In each round it
runs all tabs at the same time: each tab clicks **Play Now** and **Let's Play**,
waits for its advertisement, watches and closes it, then exits the game. A new
round starts only after every tab has completed its ad flow. It does not spend
two minutes playing the game. The browser window is hidden by default and
unwanted popup game/ad tabs are closed automatically.

## Setup

```bash
npm install
npm run install-browser
```

## Run in the background

```bash
npm start
```

No browser window opens, and the process continues until stopped with `Ctrl+C`.
If no advertisement appears for five consecutive ad timeouts, the current
browser session is automatically closed and restarted in headless mode in the
same terminal.

Run one cycle as a test:

```bash
npm run test:cycle
```

To show the browser window for debugging:

```bash
npm run start:visible
```

Optional settings:

```bash
GAME_COUNT=8 npm start
```

- `GAME_COUNT`: number of synchronized rounds across all tabs; `0` means
  continuous (default `0`)
- `AD_WATCH_SECONDS`: minimum ad viewing time (default `5`)
- `AD_TIMEOUT_MS`: ad detection timeout before retrying (default `30000`)
- `NO_AD_HEADLESS_RESTART_COUNT`: consecutive no-ad timeouts before restarting
  in headless mode (default `5`)
- `BETWEEN_GAMES_MS`: pause between synchronized rounds (default `2000`)
- `HEADLESS`: set to `false` to show the browser (hidden by default)
