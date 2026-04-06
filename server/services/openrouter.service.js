// server/services/openrouter.service.js

const { OpenRouter } = require('@openrouter/sdk');

async function generateSafetyAdvice(context) {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
        console.warn('OPENROUTER_API_KEY missing. Falling back to Ollama.');
        const { generateSafetyAdvice: generateOllamaAdvice } = require('./ollama.service');
        return generateOllamaAdvice(context);
    }

    const {
        baseDangerLevel,
        effectiveDangerLevel,
        geofenceName,
        weather,
        hour,
        incidentCount,
        hotspotsOccurred,
        touristDistance,
        threshold,
        touristEnteredTime,
        timeRules
    } = context;

    const weatherSummary = (typeof weather === 'string')
        ? weather
        : (weather && `${weather.state}${weather.temp != null ? `, ${weather.temp}°C` : ''}${weather.wind_speed != null ? `, wind ${weather.wind_speed} m/s` : ''}`) || 'Clear';

    const prompt = `You are an AI safety assistant helping tourists avoid dangerous areas.

Zone: ${geofenceName}
Base danger: ${baseDangerLevel}
Effective danger: ${effectiveDangerLevel}

Context:
- Distance: ${touristDistance} meters
- Threshold: ${threshold} meters
- Monitoring start: ${touristEnteredTime}
- Time: ${hour}:00
- Incidents (24h): ${incidentCount}
- Hotspots: ${hotspotsOccurred ? 'YES' : 'NO'}
- Weather: ${weatherSummary}
- Time rules: ${timeRules || 'None'}

Task: Provide a brief reasoning (1-2 sentences) about why this is risky and a concise recommendation (under 15 words) the tourist can follow before reaching the zone.

Respond ONLY in JSON with the exact keys: { "reasoning": string, "recommendation": string }
`;

    const client = new OpenRouter({
        apiKey,
        defaultHeaders: {
            'HTTP-Referer':'http://localhost:3000',
            'X-OpenRouter-Title': 'GeoNotify Safety AI'
        }
    });

    const model = 'openai/gpt-5.2';

    const timeoutMs = Number(process.env.OPENROUTER_TIMEOUT_MS || 5000);

    async function fetchOpenRouterDirect() {
        const url = 'https://openrouter.ai/api/v1/chat/completions';
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const resp = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': process.env.APP_ORIGIN || 'http://localhost:3000',
                    'X-Title': process.env.APP_TITLE || 'GeoNotify Safety AI'
                },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.2
                }),
                signal: controller.signal
            });
            clearTimeout(timer);
            if (!resp.ok) {
                // capture body for debugging (could be text or json)
                let bodyText = await resp.text().catch(() => '');
                let parsed = {};
                try { parsed = JSON.parse(bodyText); } catch (e) {}
                console.warn('OpenRouter REST fallback received non-OK response', { status: resp.status, body: parsed || bodyText });
                const errMsg = parsed?.error?.message || parsed?.message || bodyText || `HTTP ${resp.status}`;
                throw new Error(errMsg);
            }
            return await resp.json();
        } catch (err) {
            throw err;
        }
    }

    try {
        // Try SDK first
        let sdkResp;
        try {
            // Use chatGenerationParams object to satisfy SDK input validation
            sdkResp = await Promise.race([
                client.chat.send({
                    model,
                    chatGenerationParams: {
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.2
                    },
                    stream: false
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('OpenRouter SDK timeout')), timeoutMs))
            ]);
        } catch (sdkErr) {
            // If SDK validation error referencing chatGenerationParams, try direct REST fallback
            const msg = String(sdkErr?.message || sdkErr);
            console.warn('OpenRouter SDK error:', { message: msg, stack: sdkErr?.stack });
            if (msg.includes('chatGenerationParams') || msg.includes('Invalid input')) {
                console.warn('OpenRouter SDK validation error, using REST fallback:', msg);
                sdkResp = await fetchOpenRouterDirect();
            } else {
                throw sdkErr;
            }
        }

        const content = sdkResp?.choices?.[0]?.message?.content?.trim();
        if (!content) {
            console.warn('OpenRouter returned empty response');
            const { generateSafetyAdvice: generateOllamaAdvice } = require('./ollama.service');
            return generateOllamaAdvice(context);
        }

        const cleaned = content.replace(/```json|```/g, '').trim();
        try {
            const parsed = JSON.parse(cleaned);
            if (!parsed || !parsed.recommendation) {
                const { generateSafetyAdvice: generateOllamaAdvice } = require('./ollama.service');
                return generateOllamaAdvice(context);
            }
            return parsed;
        } catch (parseErr) {
            console.warn('AI JSON parse failed. Raw output:', cleaned);
            const { generateSafetyAdvice: generateOllamaAdvice } = require('./ollama.service');
            const fallback = await generateOllamaAdvice(context);
            return fallback || { reasoning: 'AI generated safety insight', recommendation: cleaned.substring(0, 120) };
        }

    } catch (err) {
        console.warn('OpenRouter error, attempting Ollama fallback:', err?.message || err);
        const { generateSafetyAdvice: generateOllamaAdvice } = require('./ollama.service');
        return generateOllamaAdvice(context);
    }
}

module.exports = { generateSafetyAdvice };
