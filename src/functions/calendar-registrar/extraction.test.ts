import {
  EVENTS_RESPONSE_SCHEMA,
  extractEventsWithGemini,
  resolveEventDate,
} from './extraction';

const mockGenerateContent = jest.fn();

jest.mock('@google-cloud/vertexai', () => ({
  ...jest.requireActual('@google-cloud/vertexai'),
  VertexAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
}));

describe('extractEventsWithGemini', () => {
  const referenceDate = new Date('2026-08-31T00:00:00Z');

  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"events":[{"title":"中間考査","date":"09-24","confidence":0.9}]}',
                },
              ],
            },
          },
        ],
      },
    });
  });

  const sentParts = () =>
    mockGenerateContent.mock.calls[0][0].contents[0].parts;

  const respondWith = (events: unknown[]) => {
    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [
          { content: { parts: [{ text: JSON.stringify({ events }) }] } },
        ],
      },
    });
  };

  const extract = () =>
    extractEventsWithGemini(
      'project',
      '献立表',
      referenceDate,
      'Asia/Tokyo',
      null
    );

  it('should send the source file ahead of the prompt so dates come from its layout', async () => {
    const pdf = { mimeType: 'application/pdf', data: 'JVBERi0=' };

    const result = await extractEventsWithGemini(
      'project',
      '20 21 22 23 24 25 26\n中間考査',
      referenceDate,
      'Asia/Tokyo',
      pdf
    );

    const parts = sentParts();
    expect(parts[0]).toEqual({ inlineData: pdf });
    expect(parts[1].text).toContain('【原本】');
    expect(parts[1].text).toContain('中間考査');
    expect(result.events[0].date).toBe('2026-09-24');
  });

  it('should turn sampling off and pin the response shape', async () => {
    await extractEventsWithGemini(
      'project',
      '中間考査',
      referenceDate,
      'Asia/Tokyo',
      null
    );

    const { generationConfig } = mockGenerateContent.mock.calls[0][0];
    expect(generationConfig.temperature).toBe(0);
    expect(generationConfig.responseMimeType).toBe('application/json');
    expect(generationConfig.responseSchema).toBe(EVENTS_RESPONSE_SCHEMA);
    expect(EVENTS_RESPONSE_SCHEMA.required).toEqual(['events']);
    expect(EVENTS_RESPONSE_SCHEMA.properties?.events.items?.required).toEqual([
      'title',
      'date',
      'confidence',
    ]);
  });

  it('should treat an entry without a kind as a regular event', async () => {
    const { events } = await extract();
    expect(events[0].kind).toBe('event');
    expect(events[0].items).toBeUndefined();
  });

  it('should treat an unknown kind as a regular event', async () => {
    respondWith([
      { kind: 'holiday', title: '休校', date: '09-24', confidence: 0.9 },
    ]);
    const { events } = await extract();
    expect(events[0].kind).toBe('event');
  });

  it('should keep a lunch menu with its items in document order', async () => {
    respondWith([
      {
        kind: 'lunch_menu',
        title: 'ドライカレー、みかん',
        date: '09-24',
        items: [' ドライカレー ', '', null, 'みかん'],
        confidence: 0.9,
      },
    ]);
    const { events } = await extract();
    expect(events[0]).toEqual({
      kind: 'lunch_menu',
      title: 'ドライカレー、みかん',
      date: '2026-09-24',
      items: ['ドライカレー', 'みかん'],
      confidence: 0.9,
    });
  });

  it('should split a lunch menu from its title when no items were listed', async () => {
    respondWith([
      {
        kind: 'lunch_menu',
        title: 'ドライカレー、サラダ／みかん',
        date: '09-24',
        items: null,
        confidence: 0.9,
      },
    ]);
    const { events } = await extract();
    expect(events[0].items).toEqual(['ドライカレー', 'サラダ', 'みかん']);
  });

  it('should ignore items on a regular event', async () => {
    respondWith([
      {
        kind: 'event',
        title: '遠足',
        date: '09-24',
        items: ['弁当'],
        confidence: 0.9,
      },
    ]);
    const { events } = await extract();
    expect(events[0].items).toBeUndefined();
  });

  it('should send the text alone when there is no source file', async () => {
    await extractEventsWithGemini(
      'project',
      '中間考査',
      referenceDate,
      'Asia/Tokyo',
      null
    );

    const parts = sentParts();
    expect(parts).toHaveLength(1);
    expect(parts[0].text).not.toContain('【原本】');
  });
});

describe('resolveEventDate', () => {
  it('should keep a date that already carries a year', () => {
    expect(
      resolveEventDate('2026-01-15', new Date('2026-03-01T00:00:00Z'))
    ).toBe('2026-01-15');
  });

  it('should resolve a year-less date to the reference year', () => {
    expect(resolveEventDate('03-15', new Date('2026-03-01T00:00:00Z'))).toBe(
      '2026-03-15'
    );
  });

  it('should roll a year-less date into the next year when the month precedes the reference month', () => {
    expect(resolveEventDate('01-10', new Date('2026-03-01T00:00:00Z'))).toBe(
      '2027-01-10'
    );
  });

  it('should keep a later month in the reference year', () => {
    expect(resolveEventDate('12-24', new Date('2026-03-01T00:00:00Z'))).toBe(
      '2026-12-24'
    );
  });

  it('should reject an unsupported date format', () => {
    expect(() =>
      resolveEventDate('15日', new Date('2026-03-01T00:00:00Z'))
    ).toThrow(/Unsupported date format/);
  });
});
