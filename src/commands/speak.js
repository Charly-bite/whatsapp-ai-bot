const { isRateLimited } = require('../utils/rateLimiter');
const { MessageMedia } = require('whatsapp-web.js');
const googleTTS = require('google-tts-api');

module.exports = async function handleSpeak(client, msg, argumentsText) {
    const cooldown = !msg.fromMe && isRateLimited(msg.from);
    if (cooldown) {
        await msg.reply(`⏳ Please wait ${cooldown}s before using !speak again.`);
        return;
    }

    if (!argumentsText) {
        await msg.reply('⚠️ Please provide some text to speak. Example: *!speak Hello world* or *!speak -es Hola mundo*');
        return;
    }

    try {
        let text = argumentsText.trim();
        let lang = 'en';

        // Check for language flag
        const langMatch = text.match(/^-([a-z]{2,3})\s+(.+)/i);
        if (langMatch) {
            lang = langMatch[1].toLowerCase();
            text = langMatch[2].trim();
        }

        if (text.length > 500) {
            await msg.reply('⚠️ Text is too long. Please keep it under 500 characters.');
            return;
        }

        // Generate audio URL from google-tts-api
        // Since getAudioUrl limits to 200 characters, we should use getAllAudioBase64 for longer text
        // But for simplicity, we'll try to get the base64 string
        const base64DataList = await googleTTS.getAllAudioBase64(text, {
            lang: lang,
            slow: false,
            host: 'https://translate.google.com',
        });

        if (base64DataList && base64DataList.length > 0) {
            // Concatenate if necessary, or just send the first block. 
            // In a real scenario you'd merge the buffers. For simplicity, we just use the first block for now.
            // If they want long TTS, we should merge the base64 buffers.
            // But let's just merge them properly:
            
            let combinedBuffer = Buffer.from('');
            for (const item of base64DataList) {
                const buffer = Buffer.from(item.base64, 'base64');
                combinedBuffer = Buffer.concat([combinedBuffer, buffer]);
            }
            
            const media = new MessageMedia('audio/mp3', combinedBuffer.toString('base64'), 'tts.mp3');
            // Send as an audio file (ptt = push to talk/voice note)
            await msg.reply(media, undefined, { sendAudioAsVoice: true });
        } else {
            await msg.reply('⚠️ Failed to generate speech.');
        }

    } catch (err) {
        console.error('Speak Error:', err.message);
        await msg.reply('⚠️ An error occurred while generating speech.');
    }
};
