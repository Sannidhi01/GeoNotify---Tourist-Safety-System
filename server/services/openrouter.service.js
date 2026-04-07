// server/services/openrouter.js

// Node 18+ has global fetch

const DEFAULT_OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct";
const DEFAULT_OPENROUTER_MAX_TOKENS = 120;

function getOpenRouterMaxTokens() {
    const raw = Number(process.env.OPENROUTER_MAX_TOKENS || DEFAULT_OPENROUTER_MAX_TOKENS);

    if (!Number.isFinite(raw)) {
        return DEFAULT_OPENROUTER_MAX_TOKENS;
    }

    return Math.min(Math.max(Math.floor(raw), 32), 400);
}

function buildFallbackAdvice(context = {}) {
    const zoneName = context.geofenceName || "this area";
    const effectiveLevel = (context.effectiveDangerLevel || context.baseDangerLevel || "unknown").toString().toUpperCase();
    const distance = Number(context.touristDistance);
    const hasDistance = Number.isFinite(distance);
    const weather = typeof context.weather === "string"
        ? context.weather
        : context.weather?.state || "current conditions";

    return {
        reasoning: `${zoneName} is being monitored as ${effectiveLevel} risk under ${weather}.`,
        recommendation: hasDistance && distance <= Number(context.threshold || 0)
            ? "Avoid entering and move to a safer nearby route."
            : "Stay alert and avoid approaching the marked zone."
    };
}

async function getOllamaFallback(context) {
    const { generateSafetyAdvice: generateOllamaAdvice } = require('./ollama.service');
    return await generateOllamaAdvice(context) || buildFallbackAdvice(context);
}

async function generateSafetyAdvice(context) {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
        console.warn("OPENROUTER_API_KEY missing. Falling back to Ollama.");
        return getOllamaFallback(context);
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

    const prompt = `
You are an AI safety assistant helping tourists avoid dangerous areas.

ZONE INFORMATION
Area: ${geofenceName}
Base danger level: ${baseDangerLevel}
Effective danger level: ${effectiveDangerLevel}

TOURIST CONTEXT
Distance from zone: ${touristDistance} meters
Warning threshold: ${threshold} meters
Monitoring started: ${touristEnteredTime}

ENVIRONMENT
Weather: ${weatherSummary}
Time: ${hour}:00
Incidents last 24h: ${incidentCount}
Hotspots detected: ${hotspotsOccurred ? "YES" : "NO"}

ADMIN RULES
Time rules: ${timeRules || "None"}

TASK
Explain the risk and give short safety advice BEFORE the tourist reaches the zone.

Respond ONLY in JSON:

{
 "reasoning": "Short explanation why the area is risky",
 "recommendation": "Short safety instruction under 15 words"
}
`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "GeoNotify Safety AI"
            },
            body: JSON.stringify({
                model: DEFAULT_OPENROUTER_MODEL,
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: getOpenRouterMaxTokens()
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        const data = await response.json().catch(() => ({}));
        console.log("OpenRouter raw response:", data);

        if (!response.ok) {
            const message = data?.error?.message || `HTTP ${response.status}`;
            console.warn("OpenRouter API error:", message);
            return getOllamaFallback(context);
        }

        const content = data?.choices?.[0]?.message?.content?.trim();

        if (!content) {
            console.warn("OpenRouter returned empty response");
            return getOllamaFallback(context);
        }

        console.log("AI Logic: OpenRouter response received");

        try {

            const json = content.replace(/```json|```/g, "").trim();
            const parsed = JSON.parse(json);
            if (!parsed || !parsed.recommendation) {
                return getOllamaFallback(context);
            }
            return parsed;

        } catch (parseError) {

            console.warn("AI JSON parse failed. Raw output:", content);

            const fallback = await getOllamaFallback(context);
            return fallback || {
                reasoning: "AI generated safety insight",
                recommendation: content.substring(0, 120)
            };

        }

    } catch (err) {

        if (err.name === "AbortError") {
            console.log("OpenRouter request timed out. Falling back.");
        } else {
            console.error("OpenRouter API error:", err.message);
        }

        return getOllamaFallback(context);
    }
}

module.exports = { generateSafetyAdvice };
