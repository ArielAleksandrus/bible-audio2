import { AudioPlaylistService, AudioTrack } from './audio-playlist.service';

const t = (title: string): AudioTrack => ({ title, url: `https://cdn/${title}.mp3` });

describe('AudioPlaylistService', () => {
  let playlist: AudioPlaylistService;

  beforeEach(() => {
    playlist = new AudioPlaylistService();
    playlist.setTracks([t('Gn 1'), t('Gn 2'), t('Gn 3')]);
  });

  it('starts at the first track', () => {
    expect(playlist.getCurrentTrack()?.title).toBe('Gn 1');
    expect(playlist.hasPrevious()).toBe(false);
    expect(playlist.hasNext()).toBe(true);
  });

  it('walks forward to the last track and then stops', () => {
    expect(playlist.next()?.title).toBe('Gn 2');
    expect(playlist.next()?.title).toBe('Gn 3');
    expect(playlist.hasNext()).toBe(false);
    expect(playlist.next()).toBeNull();
    expect(playlist.getCurrentTrack()?.title).toBe('Gn 3');
  });

  it('walks back to the first track and then stops', () => {
    playlist.selectTrack(2);
    expect(playlist.previous()?.title).toBe('Gn 2');
    expect(playlist.previous()?.title).toBe('Gn 1');
    expect(playlist.previous()).toBeNull();
    expect(playlist.getCurrentIndex()).toBe(0);
  });

  it('jumps to a track and ignores out-of-range selections', () => {
    expect(playlist.selectTrack(1)?.title).toBe('Gn 2');
    expect(playlist.selectTrack(5)).toBeNull();
    expect(playlist.selectTrack(-1)).toBeNull();
    expect(playlist.getCurrentIndex()).toBe(1);
  });

  it('restarts from the top when a new list is set', () => {
    playlist.selectTrack(2);
    playlist.setTracks([t('Ex 1'), t('Ex 2')]);
    expect(playlist.getCurrentTrack()?.title).toBe('Ex 1');
    expect(playlist.getTracks().length).toBe(2);
  });

  it('has no current track when empty', () => {
    playlist.setTracks([]);
    expect(playlist.getCurrentTrack()).toBeNull();
    expect(playlist.hasNext()).toBe(false);
    expect(playlist.next()).toBeNull();
  });
});
