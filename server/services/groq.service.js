// server/services/groq.service.js
// Groq Chat Completions API integration with fallback to existing AI services

const REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.GROQ_TIMEOUT_MS || 15000));
const { generateSafetyAdvice: generateOllamaAdvice } = require('./ollama.service');

function extractContent(data) {
    return data?.choices?.[0]?.message?.content || '';
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

async function generateSafetyAdvice(context) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
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
`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: process.env.GROQ_MODEL || 'llama3-8b-8192',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 200
            }),
            signal: controller.signal
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            return generateOllamaAdvice(context);
        }

        const content = extractContent(data);
        if (!content) {
            return generateOllamaAdvice(context);
        }

        const parsed = extractJsonObject(content);
        if (parsed) {
            const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '';
            const recommendation = typeof parsed.recommendation === 'string' ? parsed.recommendation.trim() : '';
            if (recommendation) {
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
            return {
                reasoning: reasoningText || 'AI generated safety insight.',
                recommendation: adviceText
            };
        }

        return generateOllamaAdvice(context);
    } catch (err) {
        return generateOllamaAdvice(context);
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = { generateSafetyAdvice };
