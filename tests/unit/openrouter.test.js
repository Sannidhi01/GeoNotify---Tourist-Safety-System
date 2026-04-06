const { generateSafetyAdvice } = require('../../server/services/openrouter.service');

describe('openrouter.service', () => {
  test('falls back to Ollama if no API key', async () => {
    const orig = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = '';
    const result = await generateSafetyAdvice({ geofenceName: 'Test', baseDangerLevel: 'safe', effectiveDangerLevel: 'safe' });
    expect(result).toBeTruthy();
    expect(typeof result.recommendation).toBe('string');
    process.env.OPENROUTER_API_KEY = orig;
  });

  test('returns fallback if context is minimal', async () => {
    const result = await generateSafetyAdvice({});
    expect(result).toBeTruthy();
    expect(typeof result.recommendation).toBe('string');
  });
});