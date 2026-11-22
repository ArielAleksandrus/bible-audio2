import { onWifi, watchWifi } from './network.util';

describe('onWifi', () => {
  afterEach(() => vi.unstubAllGlobals());

  const nav = (type: string | undefined, onLine = true) =>
    vi.stubGlobal('navigator', { onLine, connection: type === undefined ? {} : { type } });

  it('accepts wifi and ethernet, and refuses cellular, offline, and an unreported type', async () => {
    nav('wifi');
    expect(await onWifi()).toBe(true);
    nav('ethernet');
    expect(await onWifi()).toBe(true);
    nav('cellular');
    expect(await onWifi()).toBe(false);
    nav(undefined);
    expect(await onWifi()).toBe(false);
    nav('wifi', false);
    expect(await onWifi()).toBe(false);
  });

  it('notifies when the browser reports a connection change', () => {
    const connection = new EventTarget();
    vi.stubGlobal('navigator', { onLine: true, connection });
    let calls = 0;
    watchWifi(() => calls++);
    connection.dispatchEvent(new Event('change'));
    expect(calls).toBe(1);
  });
});
