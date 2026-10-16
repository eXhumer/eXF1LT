import { accessSync, constants, readdirSync } from 'node:fs';
import { posix, win32 } from 'node:path';

function listDirectory(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/**
 * Chromium-family browsers that speak the DevTools Protocol, in order of
 * preference: Chrome, Edge, Brave (including Brave Origin), Chromium.
 */
export function browserCandidates(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  list: (path: string) => string[] = listDirectory,
): string[] {
  if (platform === 'darwin') {
    const apps = [
      'Google Chrome.app/Contents/MacOS/Google Chrome',
      'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      'Brave Browser.app/Contents/MacOS/Brave Browser',
      'Brave Origin.app/Contents/MacOS/Brave Origin',
      'Brave Origin Nightly.app/Contents/MacOS/Brave Origin Nightly',
      'Chromium.app/Contents/MacOS/Chromium',
    ];
    const home = env['HOME'];
    return apps.flatMap((app) => [
      posix.join('/Applications', app),
      ...(home ? [posix.join(home, 'Applications', app)] : []),
    ]);
  }
  if (platform === 'win32') {
    const roots = [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']].filter(
      (root): root is string => Boolean(root),
    );
    // Brave names its folder after the edition (Brave-Browser, Brave-Browser-Nightly,
    // Brave-Origin, ...), so besides the known ones every folder under BraveSoftware counts.
    const braveEditions = (root: string): string[] => {
      const known = ['Brave-Browser', 'Brave-Origin', 'Brave-Origin-Nightly'];
      const found = list(win32.join(root, 'BraveSoftware')).filter((name) => name.startsWith('Brave-'));
      return [...new Set([...known, ...found])];
    };
    const groups = (root: string): string[][][] => [
      [['Google', 'Chrome', 'Application', 'chrome.exe']],
      [['Microsoft', 'Edge', 'Application', 'msedge.exe']],
      braveEditions(root).map((edition) => ['BraveSoftware', edition, 'Application', 'brave.exe']),
      [['Chromium', 'Application', 'chrome.exe']],
    ];
    return [0, 1, 2, 3].flatMap((rank) =>
      roots.flatMap((root) => (groups(root)[rank] ?? []).map((exe) => win32.join(root, ...exe))),
    );
  }
  const names = ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'brave-browser', 'brave-origin', 'brave-origin-nightly', 'chromium', 'chromium-browser'];
  const dirs = (env['PATH'] ?? '').split(':').filter(Boolean);
  return names.flatMap((name) => dirs.map((dir) => posix.join(dir, name)));
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The browser to drive: `explicit` (`--browser` or `F1_BROWSER`) as given,
 * otherwise the first installed Chromium-family browser.
 */
export function findBrowser(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = isExecutable,
): string | undefined {
  if (explicit) return explicit;
  return browserCandidates(env, platform).find(exists);
}

/**
 * Brave Origin is a paid edition that asks for its purchase ID in every new
 * profile (and each activation counts against a monthly limit), so the login
 * cannot use a throwaway profile with it.
 */
export function isBraveOrigin(browser: string): boolean {
  return /brave[ _-]?origin/i.test(browser);
}
