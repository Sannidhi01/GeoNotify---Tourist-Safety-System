// Node 22 has global fetch support, no require needed.

async function generateSafetyAdvice(context) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        console.warn('OPENROUTER_API_KEY missing. Falling back to default advice.');
        return null;
    }

    const {
        baseDangerLevel,
        effectiveDangerLevel,
        geofenceName,
        weather,
        hour,
        incidentCount,
        recentTrends,
        hotspotsOccurred,
        timeRules
    } = context;

    // Safety Prompt for the LLM
    const prompt = `
    You are an AI Safety Assistant for GeoNotify. Analyze the potential risk for the following area:
    - Area Name: ${geofenceName}
    - Baseline Danger Level: ${baseDangerLevel}
    - CURRENT SYSTEM CALCULATED LEVEL: ${effectiveDangerLevel}
    - Current Weather: ${weather}
    - Time of Day: ${hour}:00
    - Admin-Set Time Rules: ${timeRules || 'None'}
    - Recent Incidents: ${incidentCount}
    - Hotspots Detected: ${hotspotsOccurred ? 'YES' : 'NO'}

    YOUR TASK:
    Provide structured safety analysis. You MUST consider the "CURRENT SYSTEM CALCULATED LEVEL" as the final authority on risk, but explain WHY it differs from the baseline if applicable (e.g., due to specific time rules or weather).
    
    RESPONSE FORMAT (JSON ONLY):
    {
      "reasoning": "A concise explanation of how the Baseline level, weather, time rules, and incidents result in the CURRENT level.",
      "recommendation": "A short, authoritative instruction (max 15 words)."
    }

    RULES:
    1. If CURRENT LEVEL is CRITICAL or DANGER, recommendations MUST be urgent (Stop/Evacuate).
    2. Cite specific time rules or weather if they are driving the current risk.
    3. Respond ONLY with valid JSON.
    `;

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "HTTP-Referer": "https://geonotify.app", // Optional for OpenRouter
                "X-Title": "GeoNotify Safety AI",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": "google/gemini-2.0-pro-exp-02-05:free", // Using a capable free model
                "messages": [
                    { "role": "user", "content": prompt }
                ]
            })
        });

        const data = await response.json();
        if (data.choices && data.choices[0]) {
            const content = data.choices[0].message.content.trim();
            console.log('AI Logic: Reasoning generated via OpenRouter.');
            try {
                // Remove potential markdown blocks if LLM adds them
                const jsonStr = content.replace(/```json|```/g, '').trim();
                return JSON.parse(jsonStr);
            } catch (e) {
                console.warn('AI Parsing Error - Full Content:', content);
                return { reasoning: "Standard safety check.", recommendation: content.substring(0, 100) };
            }
        }
        console.warn('OpenRouter API returned no choices:', data);
        return null;
    } catch (err) {
        console.error('OpenRouter API error:', err.message);
        return null;
    }
}

module.exports = { generateSafetyAdvice };
