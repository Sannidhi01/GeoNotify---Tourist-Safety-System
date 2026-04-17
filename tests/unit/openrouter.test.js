const { generateSafetyAdvice } = require('../../server/services/openrouter.service');

describe('openrouter.service', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns fallback if context is minimal', async () => {
    const result = await generateSafetyAdvice({});
    expect(result).toBeTruthy();
    expect(typeof result.recommendation).toBe('string');
  });

  test('sends a capped max_tokens value to OpenRouter', async () => {
    const origKey = process.env.OPENROUTER_API_KEY;
    const origMaxTokens = process.env.OPENROUTER_MAX_TOKENS;
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_MAX_TOKENS = '120';

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reasoning: 'Short explanation',
                recommendation: 'Stay on main roads'
              })
            }
          }
        ]
      })
    });

    const result = await generateSafetyAdvice({
      geofenceName: 'Test',
      baseDangerLevel: 'warning',
      effectiveDangerLevel: 'danger'
    });

    expect(result.recommendation).toBe('Stay on main roads');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [, options] = fetchSpy.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.max_tokens).toBe(120);

    process.env.OPENROUTER_API_KEY = origKey;
    process.env.OPENROUTER_MAX_TOKENS = origMaxTokens;
  });
});
