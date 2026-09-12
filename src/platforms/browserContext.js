const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());

const DEFAULT_CHROME_PATH = process.env.CHROME_PATH || '/opt/google/chrome/chrome';
const DEFAULT_VIEWPORT = { width: 1365, height: 900 };

function createLaunchContext(options = {}) {
  const chromePath = options.chromePath || DEFAULT_CHROME_PATH;
  const headed = options.headed !== false;
  const launchPersistentContext = options.launchPersistentContext
    || ((profileDir, launchOptions) => chromium.launchPersistentContext(profileDir, launchOptions));

  return async function launchContext(store, headless = !headed) {
    return launchPersistentContext(store.profileDir, {
      headless,
      executablePath: chromePath,
      viewport: DEFAULT_VIEWPORT,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
  };
}

module.exports = { createLaunchContext };
