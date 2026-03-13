// server/services/openrouter.js

// Node 18+ has global fetch

async function generateSafetyAdvice(context) {

    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
        console.warn("OPENROUTER_API_KEY missing. Falling back to Ollama.");
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
Weather: ${weather}
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
                model: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct",
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.3
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const message = data?.error?.message || `HTTP ${response.status}`;
            console.warn("OpenRouter API error:", message);
            const { generateSafetyAdvice: generateOllamaAdvice } = require('./ollama.service');
            return generateOllamaAdvice(context);
        }

        const content = data?.choices?.[0]?.message?.content?.trim();

        if (!content) {
            console.warn("OpenRouter returned empty response");
            const { generateSafetyAdvice: generateOllamaAdvice } = require('./ollama.service');
            return generateOllamaAdvice(context);
        }

        console.log("AI Logic: OpenRouter response received");

        try {

            const json = content.replace(/```json|```/g, "").trim();
            const parsed = JSON.parse(json);
            if (!parsed || !parsed.recommendation) {
                const { generateSafetyAdvice: generateOllamaAdvice } = require('./ollama.service');
                return generateOllamaAdvice(context);
            }
            return parsed;

        } catch (parseError) {

            console.warn("AI JSON parse failed. Raw output:", content);

            const { generateSafetyAdvice: generateOllamaAdvice } = require('./ollama.service');
            const fallback = await generateOllamaAdvice(context);
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

        const { generateSafetyAdvice: generateOllamaAdvice } = require('./ollama.service');
        return generateOllamaAdvice(context);
    }
}

module.exports = { generateSafetyAdvice };
