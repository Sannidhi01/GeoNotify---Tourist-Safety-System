// server/services/openrouter.js

// Node 18+ already has global fetch

async function generateSafetyAdvice(context) {

    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
        console.warn("OPENROUTER_API_KEY missing. Using fallback advice.");
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
You are an AI safety assistant for GeoNotify.

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
- Hotspots detected: ${hotspotsOccurred ? "YES" : "NO"}

ADMIN RULES
- Time rules: ${timeRules || "None"}

TASK
Explain the risk and provide safety advice BEFORE the tourist reaches the zone.

Respond ONLY in JSON:

{
  "reasoning": "Short explanation why the area is risky.",
  "recommendation": "Short safety instruction under 15 words."
}
`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

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
                model: "openrouter/auto",
                messages: [
                    { role: "user", content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 200
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        const data = await response.json();

        if (!data.choices || !data.choices[0]) {
            console.warn("OpenRouter returned no choices:", data);
            return null;
        }

        const content = data.choices[0].message.content.trim();

        console.log("AI Logic: Response received");

        try {

            const json = content.replace(/```json|```/g, "").trim();
            return JSON.parse(json);

        } catch (parseError) {

            console.warn("AI JSON parse failed. Raw output:", content);

            return {
                reasoning: "AI generated safety insight.",
                recommendation: content.substring(0, 120)
            };

        }

    } catch (err) {

        if (err.name === "AbortError") {
            console.log("AI request timed out. Using fallback.");
        } else {
            console.error("OpenRouter API error:", err.message);
        }

        return null;

    }
}

module.exports = { generateSafetyAdvice };