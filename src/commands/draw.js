const { isRateLimited } = require('../utils/rateLimiter');
const { MessageMedia } = require('whatsapp-web.js');

module.exports = async function handleDraw(client, msg, argumentsText) {
    const cooldown = !msg.fromMe && isRateLimited(msg.from);
    if (cooldown) {
        await msg.reply(`⏳ Please wait ${cooldown}s before using !draw again.`);
        return;
    }

    if (!argumentsText) {
        await msg.reply('⚠️ Please provide a prompt to draw. Example: *!draw a futuristic city at sunset*');
        return;
    }

    try {
        await msg.reply('🎨 Drawing your request... this might take a few seconds.');
        const prompt = encodeURIComponent(argumentsText.trim());
        // Pollinations AI returns an image directly based on the prompt in the URL.
        const seed = Math.floor(Math.random() * 1000000);
        const imageUrl = `https://image.pollinations.ai/prompt/${prompt}?width=1024&height=1024&nologo=true&seed=${seed}`;
        
        const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
        if (media) {
            await msg.reply(media, undefined, { caption: `🎨 Here is your drawing: _${argumentsText}_` });
        } else {
            await msg.reply('⚠️ Failed to generate image.');
        }
    } catch (err) {
        console.error('Draw Error:', err.message);
        await msg.reply('⚠️ An error occurred while generating the drawing.');
    }
};
