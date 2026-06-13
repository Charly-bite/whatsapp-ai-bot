const { isRateLimited } = require('../utils/rateLimiter');
const fetch = require('node-fetch') || global.fetch;

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

module.exports = async function handleSummarize(client, msg, argumentsText) {
    const cooldown = !msg.fromMe && isRateLimited(msg.from);
    if (cooldown) {
        await msg.reply(`⏳ Please wait ${cooldown}s before using !summarize again.`);
        return;
    }

    try {
        let textToSummarize = argumentsText;

        if (msg.hasQuotedMsg) {
            const quoted = await msg.getQuotedMessage();
            if (quoted.body) {
                textToSummarize = quoted.body;
            }
        }

        if (!textToSummarize) {
            await msg.reply('⚠️ Please provide text to summarize or reply to a message with *!summarize*.');
            return;
        }

        await msg.reply('📝 Summarizing...');

        const prompt = `Please provide a concise summary of the following text:\n\n"${textToSummarize}"\n\nSummary:`;

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
        await msg.reply(`📝 *Summary:*\n${data.response.trim()}`);

    } catch (err) {
        console.error('Summarize Error:', err.message);
        await msg.reply('⚠️ An error occurred while summarizing the text.');
    }
};
