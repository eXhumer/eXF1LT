/**
 * Runs a telemetry report's page script against a minimal stand-in for the
 * DOM and canvas, so tests can drive it (switch views, hover, pick laps) and
 * read what it shows, without a browser.
 */
export interface StubPage {
  /** Element by id, as the page sees it. */
  el(id: string): StubElement;
  /** The first element the page created whose text or title is `text`. */
  byText(text: string): StubElement;
  /** Created elements of a tag, in creation order (removed ones included). */
  created(tag: string): StubElement[];
  /** Fire `type` on the element with `id` (`doc` for the document). */
  fire(id: string, type: string, event?: Record<string, unknown>): void;
  /** Run the pending animation frame (the page draws in one). */
  flush(): void;
  /** Canvas calls so far, by method name. */
  readonly calls: Record<string, number>;
}

export interface StubElement {
  id: string;
  tagName: string;
  value: string;
  innerHTML: string;
  textContent: string;
  hidden: boolean;
  disabled: boolean;
  title: string;
  style: Record<string, string>;
  children: StubElement[];
  getAttribute(name: string): string | undefined;
  setAttribute(name: string, value: string): void;
}

const CHART_WIDTH = 900;

export function runPage(html: string): StubPage {
  const json = /<script id="data" type="application\/json">(.*?)<\/script>/s.exec(html)?.[1];
  const script = /<script>(.*?)<\/script>/s.exec(html)?.[1];
  if (!json || !script) throw new Error('Not a telemetry report.');

  const calls: Record<string, number> = {};
  const context = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) =>
      key in target
        ? target[key]
        : () => {
            calls[String(key)] = (calls[String(key)] ?? 0) + 1;
          },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
  const listeners = new Map<string, ((event: Record<string, unknown>) => void)[]>();
  const listen = (key: string, fn: (event: Record<string, unknown>) => void) => listeners.set(key, [...(listeners.get(key) ?? []), fn]);

  const make = (id: string, attributes: Record<string, string> = {}, tag = id) => {
    const element = {
      id,
      value: '',
      innerHTML: '',
      textContent: id === 'data' ? json : '',
      hidden: false,
      disabled: false,
      title: '',
      tagName: tag.toUpperCase(),
      style: {},
      children: [] as unknown[],
      clientWidth: CHART_WIDTH,
      parentElement: { style: {} },
      classList: { add() {}, remove() {} },
      getAttribute: (name: string) => attributes[name],
      setAttribute: (name: string, value: string) => {
        attributes[name] = value;
      },
      appendChild(child: unknown) {
        this.children.push(child);
      },
      getContext: () => context,
      setPointerCapture() {},
      getBoundingClientRect: () => ({ left: 0, width: CHART_WIDTH }),
      addEventListener: (type: string, fn: (event: Record<string, unknown>) => void) => listen(`${id}:${type}`, fn),
    };
    return element;
  };
  const elements = new Map<string, ReturnType<typeof make>>();
  const byId = (id: string) => {
    let element = elements.get(id);
    if (!element) elements.set(id, (element = make(id)));
    return element;
  };
  const tabs = ['time', 'compare'].map((mode) => {
    const tab = make(`tab-${mode}`, { 'data-mode': mode });
    elements.set(tab.id, tab);
    return tab;
  });

  const created: ReturnType<typeof make>[] = [];
  let count = 0;
  let frames: (() => void)[] = [];
  const globals = {
    document: {
      title: 'report',
      getElementById: byId,
      createElement: (tag: string) => {
        const element = make(`${tag}-${++count}`, {}, tag);
        elements.set(element.id, element);
        created.push(element);
        return element;
      },
      querySelectorAll: () => tabs,
      addEventListener: (type: string, fn: (event: Record<string, unknown>) => void) => listen(`doc:${type}`, fn),
    },
    getComputedStyle: () => ({ getPropertyValue: () => '#888888' }),
    window: { devicePixelRatio: 2 },
    requestAnimationFrame: (fn: () => void) => {
      frames.push(fn);
      return 1;
    },
    ResizeObserver: class {
      observe() {}
    },
  };
  new Function(...Object.keys(globals), script)(...Object.values(globals));

  const page: StubPage = {
    el: (id) => byId(id) as unknown as StubElement,
    byText(text) {
      const element = [...created].reverse().find((item) => item.textContent === text || item.title === text);
      if (!element) throw new Error(`No element "${text}".`);
      return element as unknown as StubElement;
    },
    created: (tag) => created.filter((item) => item.tagName === tag.toUpperCase()) as unknown as StubElement[],
    fire(id, type, event = {}) {
      for (const fn of listeners.get(`${id}:${type}`) ?? []) fn({ preventDefault() {}, target: {}, ...event });
    },
    flush() {
      const pending = frames;
      frames = [];
      for (const fn of pending) fn();
    },
    calls,
  };
  page.flush();
  return page;
}

/** The values table beside the map, as rows of cell text (header first). */
export function valuesTable(page: StubPage): string[][] {
  return [...page.el('values').innerHTML.matchAll(/<tr>(.*?)<\/tr>/g)].map((row) =>
    [...row[1]!.matchAll(/<t[hd]>(.*?)<\/t[hd]>/g)].map((cell) => cell[1]!.replace(/<[^>]+>/g, '').trim()),
  );
}

/** The readout's text without markup. */
export function readoutText(page: StubPage): string {
  return page
    .el('readout')
    .innerHTML.replace(/<\/div><div>/g, ' | ')
    .replace(/<[^>]+>/g, '')
    .trim();
}
