import { AudioFormat, setFormatSupport } from '../data/bible-catalog';

/**
 * Finds out which audio formats this device really plays, by playing them,
 * not by asking: Safari answers canPlayType('audio/mp4; codecs="opus"') with
 * "" on iPhones that play Opus fine, which would send them the mp3 at about
 * 1.5× the size for nothing.
 *
 * Each probe is a fraction of a second of silence, embedded here (no request,
 * works offline), opened in a media element through a blob: URL, like the
 * chapters downloaded on the web. On iOS the WebView's media element is
 * AVFoundation, the engine the native player uses; on Android, ExoPlayer
 * plays all of them from Android 5 on.
 *
 * The answer is kept on the device and is what the app uses from the next
 * start on (the URLs of a whole download depend on it, so it must be known
 * synchronously). Probing again on every start catches a system update that
 * adds a format. An unclear result (timeout) changes nothing.
 */
const PROBES: Partial<Record<AudioFormat, { mime: string; base64: string }>> = {
  // 0.3 s of silence, Opus 32 kbps mono in MP4: ffmpeg -f lavfi -i anullsrc=r=48000:cl=mono -t 0.3
  //   -c:a libopus -b:a 32k -application voip -map_metadata -1 -f mp4 opus.m4a
  opus: { mime: 'audio/mp4', base64: 'AAAAHGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAAAhmcmVlAAACNG1kYXR4C+TBNuzFjYxJRpjgk8QAKnfkAAEcAAAAAD2U0/ckAHgHyXIn4UTqVfHwwNXd/QRTACxCWAAAPQAAAABIS0aaAQB4B8l5yMlXwKISI/rvZ/MbyfgAFiPWeAAsAAAAADQkHZrlAHgHyXnIyVfAohIj+u9n8xvJ+AAWI9Z4ACgAAAAAS+dAmuUAeAfJecjJV8CiEiP672fzG8n4ABYj1ngAKAAAAABL50Ca5QB4B8l5yMlXwKISI/rvZ/MbyfgAFiPWeAAoAAAAAEvnQJrlAHgHyXnIyVfAohIj+u9n8xvJ+AAWI9Z4ACgAAAAAS+dAmuUAeAfJecjJV8CiEiP672fzG8n4ABYj1ngAKAAAAABL50Ca5QB4B8l5yMlXwKISI/rvZ/MbyfgAFiPWeAAoAAAAAEvnQJrlAHgHyXnIyVfAohIj+u9n8xvJ+AAWI9Z4ACgAAAAAS+dAmuUAeAfJecjJV8CiEiP672fzG8n4ABYj1ngAKAAAAABL50Ca5QB4B8l5yMlXwKISI/rvZ/MbyfgAFiPWeAAoAAAAAEvnQJrlAHgHyXnIyVfAohIj+u9n8xvJ+AAWI9Z4ACgAAAAAS+dAmuUAeAfJecjJV8CiEiP672fzG8n4ABYj1ngAKAAAAABL50Ca5QB4B8l5yMlXwKISI/rvZ/MbyfgAFiPWeAAoAAAAAEvnQJrlAHgHyXnIyVfAohIj+u9n8xvJ+AAWI9Z4ACgAAAAAS+dAmuUAAAADM21vb3YAAABsbXZoZAAAAAAAAAAAAAAAAAAAA+gAAAEsAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAJedHJhawAAAFx0a2hkAAAAAwAAAAAAAAAAAAAAAQAAAAAAAAEsAAAAAAAAAAAAAAABAQAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAJGVkdHMAAAAcZWxzdAAAAAAAAAABAAABLAAAATgAAQAAAAAB1m1kaWEAAAAgbWRoZAAAAAAAAAAAAAAAAAAAu4AAADl4VcQAAAAAAC1oZGxyAAAAAAAAAABzb3VuAAAAAAAAAAAAAAAAU291bmRIYW5kbGVyAAAAAYFtaW5mAAAAEHNtaGQAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUVzdGJsAAAAW3N0c2QAAAAAAAAAAQAAAEtPcHVzAAAAAAAAAAEAAAAAAAAAAAABABAAAAAAu4AAAAAAABNkT3BzAAEBOAAAu4AAAAAAAAAUYnRydAAAAAAAAH0AAAA4sAAAACBzdHRzAAAAAAAAAAIAAAAPAAADwAAAAAEAAAE4AAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAQAAAAAQAAAFRzdHN6AAAAAAAAAAAAAAAQAAAAIAAAACIAAAAjAAAAIwAAACMAAAAjAAAAIwAAACMAAAAjAAAAIwAAACMAAAAjAAAAIwAAACMAAAAjAAAAIwAAABRzdGNvAAAAAAAAAAEAAAAsAAAAGnNncGQBAAAAcm9sbAAAAAIAAAAB//wAAAAkc2JncAAAAAByb2xsAAAAAgAAAAQAAAAAAAAADAAAAAEAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYyLjMuMTAw' },
};

const STORAGE_KEY = 'audioFormatSupport';
const TIMEOUT_MS = 5000;

/** What earlier starts found out, applied before anything builds an audio URL. */
export function loadFormatSupport(): void {
  for (const [format, supported] of Object.entries(saved())) {
    if (format in PROBES) setFormatSupport(format as AudioFormat, supported);
  }
}

/** Probes every format again and keeps what it finds. Resolves when done. */
export async function probeFormats(play: (blob: Blob) => Promise<boolean | undefined> = playsInMediaElement): Promise<void> {
  const found = saved();
  for (const [format, probe] of Object.entries(PROBES) as [AudioFormat, { mime: string; base64: string }][]) {
    const bytes = Uint8Array.from(atob(probe.base64), c => c.charCodeAt(0));
    const result = await play(new Blob([bytes], { type: probe.mime })).catch(() => undefined);
    if (result === undefined) continue;
    found[format] = result;
    setFormatSupport(format, result);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(found));
  } catch {
    // No storage: the answer still holds for this session.
  }
}

function saved(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return raw && typeof raw === 'object' ? Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

/** true: it opened and has a duration; false: the element refused it; undefined: no answer in time. */
function playsInMediaElement(blob: Blob): Promise<boolean | undefined> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    let timer: ReturnType<typeof setTimeout>;
    const done = (result: boolean | undefined) => {
      clearTimeout(timer);
      audio.onloadedmetadata = audio.onloadeddata = audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      resolve(result);
    };
    audio.muted = true;
    audio.preload = 'auto';
    audio.onloadeddata = () => done(true);
    audio.onloadedmetadata = () => { if (Number.isFinite(audio.duration) && audio.duration > 0) done(true); };
    audio.onerror = () => done(false);
    timer = setTimeout(() => done(undefined), TIMEOUT_MS);
    audio.src = url;
    audio.load();
  });
}
