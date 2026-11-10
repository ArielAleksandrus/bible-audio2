import { buildSearchIndex, excerpt, foldText, searchBible } from './bible-search.util';

const books = [
  { chapters: [
    ['No princípio, criou Deus os céus e a terra.', 'A terra, porém, estava sem forma e vazia.'],
    ['Assim, pois, foram acabados os céus e a terra.'],
  ] },
  { chapters: [
    ['Porque Deus amou ao mundo de tal maneira que deu o seu Filho unigênito, para que todo o que nele crê não pereça, mas tenha a vida eterna.',
     'O coração do homem pode fazer planos.'],
  ] },
];

describe('bible search', () => {
  const index = buildSearchIndex(books);

  it('ignores case and accents', () => {
    expect(foldText('Coração CÉUS Jesús')).toBe('coracao ceus jesus');
    expect(searchBible(index, 'CORACAO').hits.map(h => [h.bookIdx, h.chapter, h.verse])).toEqual([[1, 1, 2]]);
    expect(searchBible(index, 'céus').total).toBe(2);
    expect(searchBible(index, 'ceus').total).toBe(2);
  });

  it('keeps Japanese voiced kana distinct', () => {
    expect(foldText('が')).not.toBe(foldText('か'));
  });

  it('reports book, chapter and verse of each match, in Bible order', () => {
    expect(searchBible(index, 'terra').hits.map(h => `${h.bookIdx}:${h.chapter}:${h.verse}`))
      .toEqual(['0:1:1', '0:1:2', '0:2:1']);
  });

  it('limits what is shown but still counts every match', () => {
    const { hits, total } = searchBible(index, 'terra', 2);
    expect(hits.length).toBe(2);
    expect(total).toBe(3);
  });

  it('returns nothing for a query that is too short', () => {
    expect(searchBible(index, ' a ')).toEqual({ hits: [], total: 0 });
  });

  it('marks the match with its original accents inside a short excerpt', () => {
    const [hit] = searchBible(index, 'unigenito').hits;
    expect(hit.match).toBe('unigênito');
    expect(hit.before.startsWith('…')).toBe(true);
    expect(hit.before.endsWith('Filho ')).toBe(true);
    expect((hit.before + hit.match + hit.after).length).toBeLessThan(130);
  });

  it('numbers verses as the text viewer does, skipping headings', () => {
    const idx = buildSearchIndex([{ chapters: [['The Beginning Of Everything', 'In the beginning God created the heavens.']] }]);
    expect(searchBible(idx, 'heavens').hits[0].verse).toBe(1);
    expect(searchBible(idx, 'everything').total).toBe(0);
  });

  it('excerpt falls back to the start of the text when the needle is not there', () => {
    expect(excerpt('abc', 'zzz')).toEqual({ before: 'abc', match: '', after: '' });
  });
});
