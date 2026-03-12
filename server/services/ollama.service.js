// server/services/ollama.service.js
// Integration with Ollama Cloud API (or local Ollama instance)

const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.OLLAMA_TIMEOUT_MS || 12000));
const FAILURE_THRESHOLD = 3;
const FAILURE_COOLDOWN_MS = 2 * 60 * 1000;

let consecutiveFailures = 0;
let disabledUntilTs = 0;

function normalizeBaseUrl(url) {
    const trimmed = (url || 'http://localhost:11434').replace(/\/+$/, '');
    // Accept common misconfiguration where full endpoint path is placed in base URL.
    return trimmed
        .replace(/\/v1\/chat\/completions$/i, '')
        .replace(/\/api\/chat$/i, '');
}

function isCloudBaseUrl(baseUrl) {
    return /ollama\.(ai|com)/i.test(baseUrl);
}

function buildRequestCandidates(baseUrl, model, prompt) {
    const openAiStyle = {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
    };

    const ollamaStyle = {
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        temperature: 0.3
    };

    if (isCloudBaseUrl(baseUrl)) {
        return [
            { url: `${baseUrl}/v1/chat/completions`, body: openAiStyle },
            { url: `${baseUrl}/api/chat`, body: ollamaStyle }
        ];
    }

    return [
        { url: `${baseUrl}/api/chat`, body: ollamaStyle },
        { url: `${baseUrl}/v1/chat/completions`, body: openAiStyle }
    ];
}

function extractContent(data) {
    return data?.message?.content || data?.choices?.[0]?.message?.content || '';
}

function registerSuccess() {
    consecutiveFailures = 0;
    disabledUntilTs = 0;
}

function registerFailure(reason) {
    consecutiveFailures += 1;

    if (consecutiveFailures >= FAILURE_THRESHOLD) {
        disabledUntilTs = Date.now() + FAILURE_COOLDOWN_MS;
        consecutiveFailures = 0;
        console.warn(
            `Ollama unavailable (${reason}). AI advice disabled for ${Math.round(FAILURE_COOLDOWN_MS / 1000)}s.`
        );
        return;
    }

    console.warn(`Ollama API request failed (${consecutiveFailures}/${FAILURE_THRESHOLD}): ${reason}`);
}

async function generateSafetyAdvice(context) {
    const apiKey = process.env.OLLAMA_API_KEY;
    const baseUrl = normalizeBaseUrl(process.env.OLLAMA_BASE_URL || 'http://localhost:11434');
    const rawModel = process.env.OLLAMA_MODEL || process.env.OPENROUTER_MODEL || 'mistral';
    const model = rawModel === 'mistal' ? 'mistral' : rawModel;

    if (Date.now() < disabledUntilTs) {
        return null;
    }

    if (!apiKey && isCloudBaseUrl(baseUrl)) {
        console.warn('OLLAMA_API_KEY missing for Ollama Cloud. Using fallback advice.');
        return null;
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

    const prompt = `
You are expert in providing safety advice to tourists based on geospatial risk factors. Analyze the following context and determine if the tourist is approaching a risky area. If so, explain why and give a concise safety recommendation.

ZONE INFORMATION
- Area: ${geofenceName}
- Base danger level: ${baseDangerLevel}
- Effective danger level: ${effectiveDangerLevel}

TOURIST CONTEXT
- Distance from zone: ${touristDistance} meters
- Warning threshold: ${threshold} meters
- Tourist entered monitoring at: ${touristEnteredTime}

ENVIRONMENT
- Weather: ${weather}
- Time: ${hour}:00
- Incidents (last 24h): ${incidentCount}
- Hotspots detected: ${hotspotsOccurred ? 'YES' : 'NO'}

ADMIN RULES
- Time rules: ${timeRules || 'None'}

TASK
Explain the risk and provide safety advice BEFORE the tourist reaches the zone.

Respond ONLY in JSON:

{
  "reasoning": "Short explanation why the area is risky.",
  "recommendation": "Short safety instruction under 15 words."
}
`;

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const candidates = buildRequestCandidates(baseUrl, model, prompt);
    let lastError = 'unknown error';

    for (const candidate of candidates) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(candidate.url, {
                method: 'POST',
                headers,
                body: JSON.stringify(candidate.body),
                signal: controller.signal
            });

            clearTimeout(timeout);

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const message = data?.error?.message || data?.error || `HTTP ${response.status}`;
                lastError = `${response.status} ${message}`;
                continue;
            }

            const content = extractContent(data);
            if (!content) {
                lastError = 'empty response content';
                continue;
            }

            registerSuccess();
            console.log('AI Logic: Response received from Ollama');

            try {
                const json = content.replace(/```json|```/g, '').trim();
                return JSON.parse(json);
            } catch (parseError) {
                console.warn('AI JSON parse failed. Raw output:', content);
                return {
                    reasoning: 'AI generated safety insight.',
                    recommendation: content.substring(0, 120)
                };
            }
        } catch (err) {
            clearTimeout(timeout);
            lastError = err.name === 'AbortError' ? 'request timeout' : (err.message || 'fetch failed');
        }
    }

    registerFailure(lastError);
    return null;
}

module.exports = { generateSafetyAdvice };
