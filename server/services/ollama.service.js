// server/services/ollama.service.js
// Integration with Ollama Cloud API (or local Ollama instance)

const REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.OLLAMA_TIMEOUT_MS || 20000));
const FAILURE_THRESHOLD = 3;
const FAILURE_COOLDOWN_MS = 2 * 60 * 1000;
const { generateSafetyAdvice: generateOpenRouterAdvice } = require('./openrouter.service');

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

function extractJsonObject(text) {
    if (!text) return null;
    const cleaned = text.replace(/```json|```/g, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch (err) {
            return null;
        }
    }
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
You are an expert safety assistant. Return plain text with exactly two lines:
Risk: <short reason that connects zone, time, weather, incidents>
Advice: <short actionable advice under 20 words>

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
Explain the risk and provide concise safety advice based on the current zone context.
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
            console.log('AI Logic: Raw response:', content);

            try {
                const parsed = extractJsonObject(content);
                if (parsed) {
                    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '';
                    const recommendation = typeof parsed.recommendation === 'string' ? parsed.recommendation.trim() : '';
                    if (recommendation) {
                        console.log('AI Logic: Parsed JSON response:', {
                            reasoning: reasoning || 'AI generated safety insight.',
                            recommendation
                        });
                        return {
                            reasoning: reasoning || 'AI generated safety insight.',
                            recommendation
                        };
                    }
                }

                const reasoningMatch = content.match(/Reasoning:\s*(.*)/i) || content.match(/Risk:\s*(.*)/i);
                const adviceMatch = content.match(/Advice:\s*(.*)/i);
                const reasoningText = reasoningMatch ? reasoningMatch[1].trim() : '';
                const adviceText = adviceMatch ? adviceMatch[1].trim() : '';

                if (adviceText) {
                    console.log('AI Logic: Parsed text response:', {
                        reasoning: reasoningText || 'AI generated safety insight.',
                        recommendation: adviceText
                    });
                    return {
                        reasoning: reasoningText || 'AI generated safety insight.',
                        recommendation: adviceText
                    };
                }

                console.warn('AI parse failed. Raw output:', content);
                const openRouter = await generateOpenRouterAdvice(context);
                if (openRouter && openRouter.recommendation) {
                    return openRouter;
                }
                return {
                    reasoning: 'AI generated safety insight.',
                    recommendation: content.substring(0, 120)
                };
            } catch (parseError) {
                console.warn('AI parse failed. Raw output:', content);
                const openRouter = await generateOpenRouterAdvice(context);
                if (openRouter && openRouter.recommendation) {
                    return openRouter;
                }
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
