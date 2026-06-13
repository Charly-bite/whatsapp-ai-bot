const { isRateLimited } = require('../utils/rateLimiter');
const axios = require('axios');

module.exports = async function handleDefine(client, msg, argumentsText) {
    const cooldown = !msg.fromMe && isRateLimited(msg.from);
    if (cooldown) {
        await msg.reply(`⏳ Please wait ${cooldown}s before using !define again.`);
        return;
    }

    if (!argumentsText) {
        await msg.reply('⚠️ Please provide a word to define. Example: *!define serenditpity*');
        return;
    }

    try {
        const word = argumentsText.trim().split(' ')[0]; // Only take the first word
        const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
        
        try {
            const resp = await axios.get(url);
            if (resp.data && resp.data.length > 0) {
                const entry = resp.data[0];
                let replyMsg = `📖 *${entry.word}*\n`;
                if (entry.phonetics && entry.phonetics.length > 0 && entry.phonetics[0].text) {
                    replyMsg += `_Pronunciation: ${entry.phonetics[0].text}_\n\n`;
                } else {
                    replyMsg += '\n';
                }

                for (let i = 0; i < Math.min(3, entry.meanings.length); i++) {
                    const meaning = entry.meanings[i];
                    replyMsg += `*${meaning.partOfSpeech}*\n`;
                    for (let j = 0; j < Math.min(2, meaning.definitions.length); j++) {
                        const def = meaning.definitions[j];
                        replyMsg += `- ${def.definition}\n`;
                        if (def.example) {
                            replyMsg += `  _"${def.example}"_\n`;
                        }
                    }
                    replyMsg += '\n';
                }
                
                await msg.reply(replyMsg.trim());
            }
        } catch (err) {
            if (err.response && err.response.status === 404) {
                await msg.reply(`⚠️ Could not find a definition for "${word}".`);
            } else {
                throw err;
            }
        }
    } catch (err) {
        console.error('Define Error:', err.message);
        await msg.reply('⚠️ An error occurred while fetching the definition.');
    }
};
