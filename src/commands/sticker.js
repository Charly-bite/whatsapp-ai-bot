const { isRateLimited } = require('../utils/rateLimiter');

module.exports = async function handleSticker(client, msg) {
    const cooldown = !msg.fromMe && isRateLimited(msg.from);
    if (cooldown) {
        await msg.reply(`⏳ Please wait ${cooldown}s before using !sticker again.`);
        return;
    }

    try {
        let targetMsg = msg;
        
        // If the user replied to a message, target that message instead
        if (msg.hasQuotedMsg) {
            targetMsg = await msg.getQuotedMessage();
        }

        if (targetMsg.hasMedia) {
            await msg.reply('⏳ Converting to sticker...');
            const media = await targetMsg.downloadMedia();
            if (media) {
                await msg.reply(media, undefined, { sendMediaAsSticker: true, stickerName: 'Antigravity Bot', stickerAuthor: 'Created by Bot' });
            } else {
                await msg.reply('⚠️ Could not download media. It might be too old or unavailable.');
            }
        } else {
            await msg.reply('⚠️ Please reply to an image or video with *!sticker*, or send an image with the caption *!sticker*.');
        }
    } catch (err) {
        console.error('Sticker Error:', err.message);
        await msg.reply('⚠️ An error occurred while creating the sticker.');
    }
};
