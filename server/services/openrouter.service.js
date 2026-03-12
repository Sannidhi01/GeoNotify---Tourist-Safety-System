// server/services/openrouter.js

// Node 18+ has global fetch

async function generateSafetyAdvice(context) {

    const apiKey = process.env.OLLAMA_API_KEY;

    if (!apiKey) {
        console.warn("OLLAMA_API_KEY missing. Using fallback advice.");
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

        const response = await fetch("https://api.ollama.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: process.env.OLLAMA_MODEL || "mistral",
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
            console.warn("Ollama API error:", data);
            return null;
        }

        const content = data?.choices?.[0]?.message?.content?.trim();

        if (!content) {
            console.warn("Ollama returned empty response");
            return null;
        }

        console.log("AI Logic: Ollama response received");

        try {

            const json = content.replace(/```json|```/g, "").trim();
            return JSON.parse(json);

        } catch (parseError) {

            console.warn("AI JSON parse failed. Raw output:", content);

            return {
                reasoning: "AI generated safety insight",
                recommendation: content.substring(0, 120)
            };

        }

    } catch (err) {

        if (err.name === "AbortError") {
            console.log("AI request timed out. Using fallback.");
        } else {
            console.error("Ollama API error:", err.message);
        }

        return null;
    }
}

module.exports = { generateSafetyAdvice };