const { isRateLimited } = require('../utils/rateLimiter');
const fetch = require('node-fetch') || global.fetch;

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

module.exports = async function handleChat(client, msg, argumentsText) {
    const chatCooldown = !msg.fromMe && isRateLimited(msg.from);
    if (chatCooldown) {
        await msg.reply(`⏳ Please wait ${chatCooldown}s before using !chat again.`);
        return;
    }
    if (argumentsText) {
        // Send a temporary "Thinking..." message
        await msg.reply('🤔 Thinking...');
        try {
            const response = await fetch(`${OLLAMA_URL}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: process.env.OLLAMA_MODEL_REPLY || 'mistral-nemo:latest',
                    prompt: argumentsText,
                    stream: false
                })
            });
            const data = await response.json();
            // Reply with the AI's response
            await msg.reply(data.response);
        } catch (error) {
            console.error('Error talking to Ollama:', error);
            await msg.reply('⚠️ Sorry, could not connect to local Ollama AI. Make sure Ollama is running.');
        }
    } else {
        await msg.reply('Please provide a message! Example: *!chat Tell me a short story*');
    }
};
