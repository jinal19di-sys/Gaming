import { chromium } from 'playwright';

const config = {
  // Run in the background by default. Set HEADLESS=false to show the browser.
  headless: process.env.HEADLESS !== 'false',
  slowMo: positiveNumber(process.env.SLOW_MO_MS, 50),
  adTimeoutMs: positiveNumber(process.env.AD_TIMEOUT_MS, 30_000),
  noAdHeadlessRestartCount: Math.max(1, Math.floor(
    positiveNumber(process.env.NO_AD_HEADLESS_RESTART_COUNT, 5),
  )),
  adWatchMs: positiveNumber(process.env.AD_WATCH_SECONDS, 5) * 1000,
  gameCount: Math.floor(positiveNumber(process.env.GAME_COUNT, 0)),
  betweenGamesMs: positiveNumber(process.env.BETWEEN_GAMES_MS, 2_000),
};

const targetGameUrls = [
  // 'http://94.136.185.237/react_project/game/v2/game/dd-bubble-up',
  // 'http://94.136.185.237/react_project/game/v2/game/burger-game-burger-shop',
  'http://94.136.185.237/react_project/game/v2/game/water-flow-happy-glass',
  // 'http://94.136.185.237/react_project/game/v2/game/bridge-builder',
  // 'http://94.136.185.237/react_project/game/v2/game/bridge-dash',
  'http://94.136.185.237/react_project/game/v2/game/draw-bridge--brain-game',
  // 'http://94.136.185.237/react_project/game/v2/game/bounce-td',
  'http://94.136.185.237/react_project/game/v2/game/hipsters-vs-rockers',
];

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startGame(page) {
  const playButton = page.getByRole('button', { name: /play now/i });
  await playButton.waitFor({ state: 'visible', timeout: 30_000 });
  await playButton.click();

  const iframe = page.locator('iframe').first();
  await iframe.waitFor({ state: 'visible', timeout: 45_000 });
  const iframeHandle = await iframe.elementHandle();
  const frame = await iframeHandle?.contentFrame();
  if (!frame) throw new Error('The game iframe was found, but its content did not load.');
  await frame.waitForLoadState('domcontentloaded', { timeout: 45_000 }).catch(() => {});
  return { iframe, frame };
}

async function launchEmbeddedGame(page, iframe, frame) {
  const launchButton = frame.getByRole('button', {
    name: /let['’]?s play|play game|start game|start/i,
  }).first();

  try {
    await launchButton.waitFor({ state: 'visible', timeout: 15_000 });
    await launchButton.click();
    console.log('Clicked the game launch button.');
  } catch {
    // Some providers use a canvas instead of an accessible launch button.
    const box = await iframe.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      console.log('Clicked the game area to launch it.');
    }
  }
}

async function closeAdvertisement(page) {
  const deadline = Date.now() + config.adTimeoutMs;
  let adSeen = false;
  let adSeenAt;

  while (Date.now() < deadline) {
    // Ads are rendered in a nested third-party iframe. Exclude the main frame
    // so this cannot accidentally click the site's "Exit Game" control.
    for (const candidateFrame of page.frames().filter((item) => item !== page.mainFrame())) {
      const closeButton = candidateFrame.getByRole('button', {
        name: /close ad|skip ad|close advertisement/i,
      }).first();

      try {
        if (await closeButton.isVisible()) {
          if (!adSeen) {
            adSeen = true;
            adSeenAt = Date.now();
            console.log(`Advertisement detected. Watching for at least ${config.adWatchMs / 1000} seconds...`);
          }
          const label = `${await closeButton.getAttribute('aria-label') || ''} ${await closeButton.textContent() || ''}`;

          if (Date.now() - adSeenAt < config.adWatchMs) continue;

          // Some ads expose the close button during the countdown but do not
          // accept a click yet. Wait until "Skip in Ns" has finished.
          if (/\b(?:skip|close)\s+in\s+\d+/i.test(label)) continue;
          if (!await closeButton.isEnabled()) continue;

          await closeButton.click();
          await closeButton.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
          if (!await closeButton.isVisible().catch(() => false)) {
            console.log('Advertisement watched and closed.');
            return 'closed';
          }
        }
      } catch {
        // Ad frames are frequently replaced during their countdown.
      }
    }
    await sleep(500);
  }

  console.warn(adSeen
    ? 'The advertisement appeared but has not finished yet; continuing to wait.'
    : `No advertisement appeared within ${config.adTimeoutMs / 1000} seconds; staying in this game.`);
  return adSeen ? 'seen' : 'not-seen';
}

class HeadlessRestartRequired extends Error {}

async function waitForCompletedAdvertisement(page, headless) {
  let consecutiveNoAdTimeouts = 0;

  while (true) {
    const result = await closeAdvertisement(page);
    if (result === 'closed') return;

    if (result === 'not-seen') {
      consecutiveNoAdTimeouts += 1;
      if (!headless && consecutiveNoAdTimeouts >= config.noAdHeadlessRestartCount) {
        throw new HeadlessRestartRequired();
      }
    } else {
      // An advertisement is present, so the missing-ad streak is over.
      consecutiveNoAdTimeouts = 0;
    }

    // Never leave the current game until an advertisement was really shown
    // and its close action succeeded.
    await sleep(1_000);
  }
}

async function exitGame(page) {
  const exitButton = page.getByRole('button', { name: /exit game/i });
  if (await exitButton.isVisible().catch(() => false)) {
    await exitButton.click();
    console.log('Game closed.');
  }
}

async function runAutomation(headless) {
  const browser = await chromium.launch({
    headless,
    slowMo: config.slowMo,
    // Keep game/ad timers active in all tabs, including tabs that are not the
    // foreground tab in a visible browser window.
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const gameTabs = new Set();

  // Keep the tabs created for configured games, but close ad/provider popups.
  context.on('page', (openedPage) => {
    setTimeout(() => {
      if (gameTabs.has(openedPage) || openedPage.isClosed()) return;
      console.log('Blocked an extra game/ad tab.');
      void openedPage.close().catch(() => {});
    }, 0);
  });

  try {
    let completedRounds = 0;
    const games = targetGameUrls.map((href) => ({
      href,
      title: decodeURIComponent(new URL(href).pathname.split('/').pop())
        .replaceAll('-', ' '),
    }));

    // Open every configured game once and reuse its tab in every round.
    for (const game of games) {
      const page = await context.newPage();
      gameTabs.add(page);
      game.page = page;
    }

    await Promise.all(games.map(async (game) => {
      console.log(`Opening tab: ${game.title}`);
      await game.page.goto(game.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    }));

    while (config.gameCount === 0 || completedRounds < config.gameCount) {
      const round = completedRounds + 1;
      console.log(`Starting synchronized ad round ${round} in ${games.length} tabs.`);

      // Run the complete flow independently in every tab. Promise.all starts
      // the games together, so their advertisements can be visible at once.
      await Promise.all(games.map(async (game) => {
        const { page } = game;
        console.log(`[${game.title}] Starting game.`);

        if (page.url() !== game.href) {
          await page.goto(game.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        }

        const { iframe, frame } = await startGame(page);
        await launchEmbeddedGame(page, iframe, frame);
        console.log(`[${game.title}] Waiting for the advertisement...`);
        await waitForCompletedAdvertisement(page, headless);
        console.log(`[${game.title}] Advertisement completed. Exiting game.`);
        await exitGame(page);

        // Restore this tab for the next synchronized round.
        if (page.url() !== game.href) {
          await page.goto(game.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        }
      }));

      completedRounds += 1;
      console.log(`Completed synchronized ad round ${completedRounds}.`);
      if (config.gameCount === 0 || completedRounds < config.gameCount) {
        await sleep(config.betweenGamesMs);
      }
    }

    console.log('Automation finished.');
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  let headless = config.headless;

  while (true) {
    try {
      await runAutomation(headless);
      return;
    } catch (error) {
      if (!(error instanceof HeadlessRestartRequired) || headless) throw error;

      headless = true;
      console.warn(
        `No advertisement appeared ${config.noAdHeadlessRestartCount} times in a row. `
        + 'Restarting the browser with HEADLESS=true...',
      );
    }
  }
}

main().catch((error) => {
  console.error(`Automation failed: ${error.message}`);
  process.exitCode = 1;
});
