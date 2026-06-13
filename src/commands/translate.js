const { isRateLimited } = require('../utils/rateLimiter');
const fetch = require('node-fetch') || global.fetch;

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

module.exports = async function handleTranslate(client, msg, argumentsText) {
    const cooldown = !msg.fromMe && isRateLimited(msg.from);
    if (cooldown) {
        await msg.reply(`⏳ Please wait ${cooldown}s before using !translate again.`);
        return;
    }

    try {
        let textToTranslate = argumentsText;
        let targetLanguage = 'English'; // default

        // Check if there is a language flag like -es, -fr
        const langMatch = argumentsText.match(/(.*?)\s+-([a-z]{2,3})$/i);
        if (langMatch) {
            textToTranslate = langMatch[1].trim();
            const langMap = {
                'es': 'Spanish', 'en': 'English', 'fr': 'French', 'de': 'German',
                'it': 'Italian', 'pt': 'Portuguese', 'zh': 'Chinese', 'ja': 'Japanese',
                'ru': 'Russian', 'ar': 'Arabic', 'ko': 'Korean', 'hi': 'Hindi'
            };
            targetLanguage = langMap[langMatch[2].toLowerCase()] || langMatch[2];
        }

        if (msg.hasQuotedMsg) {
            const quoted = await msg.getQuotedMessage();
            if (quoted.body) {
                textToTranslate = quoted.body;
            }
        }

        if (!textToTranslate) {
            await msg.reply('⚠️ Please provide text to translate or reply to a message with *!translate -es*.');
            return;
        }

        await msg.reply(`🌐 Translating to ${targetLanguage}...`);

        const prompt = `Translate the following text to ${targetLanguage}. ONLY output the translated text, nothing else.\n\n"${textToTranslate}"`;

        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: process.env.OLLAMA_MODEL_REPLY || 'mistral-nemo:latest',
                prompt: prompt,
                stream: false
            })
        });

        const data = await response.json();
        await msg.reply(`🌐 *Translation (${targetLanguage}):*\n${data.response.trim()}`);

    } catch (err) {
        console.error('Translate Error:', err.message);
        await msg.reply('⚠️ An error occurred while translating the text.');
    }
};
