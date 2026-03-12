const fs = require('fs');
const path = require('path');

let dotenvCache = null;

function readRawDotenv() {
    if (dotenvCache) return dotenvCache;

    dotenvCache = {};

    try {
        const envPath = path.resolve(__dirname, '../../.env');
        const text = fs.readFileSync(envPath, 'utf8');
        const lines = text.split(/\r?\n/);

        for (const rawLine of lines) {
            if (!rawLine || rawLine.trim().startsWith('#')) continue;

            const equalsIndex = rawLine.indexOf('=');
            if (equalsIndex === -1) continue;

            const key = rawLine.slice(0, equalsIndex).trim();
            let value = rawLine.slice(equalsIndex + 1).trim();

            if (!key) continue;

            if (
                (value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))
            ) {
                value = value.slice(1, -1);
            }

            if (!(key in dotenvCache)) {
                dotenvCache[key] = value;
            }
        }
    } catch (err) {
        // .env may not exist in some deployments; process.env remains primary.
    }

    return dotenvCache;
}

function getEnvValue(...keys) {
    for (const key of keys) {
        if (!key) continue;
        const value = process.env[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    const rawEnv = readRawDotenv();
    for (const key of keys) {
        if (!key) continue;
        const value = rawEnv[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return '';
}

function getGeminiApiKey() {
    return getEnvValue('GEMINI_API_KEY');
}

function getGeminiModel() {
    return getEnvValue('GEMINI_MODEL') || 'gemini-2.5-flash';
}

function getVapidPublicKey() {
    return getEnvValue('VAPID_PUBLIC_KEY', 'PUBLIC_KEY', 'Public Key');
}

function getVapidPrivateKey() {
    return getEnvValue('VAPID_PRIVATE_KEY', 'PRIVATE_KEY', 'Private Key');
}

module.exports = {
    getEnvValue,
    getGeminiApiKey,
    getGeminiModel,
    getVapidPublicKey,
    getVapidPrivateKey
};
