import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { createElement } from 'react';

/**
 * ink-testing-library's stdout is 100 columns wide but has no height, so Ink
 * falls back to the real terminal's: the views would lay out differently
 * depending on the terminal running the tests. Give it Ink's own default.
 */
export const TEST_ROWS = 24;

const probe = render(createElement(Text));
Object.defineProperty(Object.getPrototypeOf(probe.stdout), 'rows', { configurable: true, get: () => TEST_ROWS });
probe.unmount();
