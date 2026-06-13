const { isRateLimited } = require('../utils/rateLimiter');

// Simple in-memory reminder list. If bot restarts, reminders are lost.
// For persistence, this should be saved to DB/file.
const activeReminders = new Map();

module.exports = async function handleRemind(client, msg, argumentsText) {
    const cooldown = !msg.fromMe && isRateLimited(msg.from);
    if (cooldown) {
        await msg.reply(`⏳ Please wait ${cooldown}s before using !remind again.`);
        return;
    }

    if (!argumentsText) {
        await msg.reply('⚠️ Please provide a time and message. Example: *!remind 10m Call mom* or *!remind 2h Check oven*');
        return;
    }

    try {
        const match = argumentsText.match(/^(\d+)([smhd])\s+(.+)$/i);
        if (!match) {
            await msg.reply('⚠️ Invalid format. Example: *!remind 10m Check the oven*\nSupported units: s (seconds), m (minutes), h (hours), d (days).');
            return;
        }

        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        const reminderText = match[3].trim();
        
        let ms = 0;
        if (unit === 's') ms = value * 1000;
        else if (unit === 'm') ms = value * 60 * 1000;
        else if (unit === 'h') ms = value * 60 * 60 * 1000;
        else if (unit === 'd') ms = value * 24 * 60 * 60 * 1000;

        // Cap to 30 days
        if (ms > 30 * 24 * 60 * 60 * 1000) {
            await msg.reply('⚠️ Reminder time is too far in the future. Maximum is 30 days.');
            return;
        }
        
        const targetChat = msg.from;
        
        const timerId = setTimeout(async () => {
            try {
                await client.sendMessage(targetChat, `⏰ *REMINDER:* ${reminderText}`);
            } catch (e) {
                console.error('Failed to send reminder:', e.message);
            }
            activeReminders.delete(timerId);
        }, ms);
        
        activeReminders.set(timerId, { chat: targetChat, text: reminderText, time: Date.now() + ms });

        await msg.reply(`✅ I will remind you: "${reminderText}" in ${value}${unit}.`);

    } catch (err) {
        console.error('Remind Error:', err.message);
        await msg.reply('⚠️ An error occurred while setting the reminder.');
    }
};
