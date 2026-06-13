const fs = require('fs');
const path = require('path');
const { getPersonalityPrompt, setPersonalityProfile } = require('../autoReply/personality');

module.exports = async function handlePersonality(client, msg, argumentsText) {
    // Only allow from me (admin command)
    if (!msg.fromMe) return;

    if (!argumentsText) {
        await msg.reply('⚠️ Usage: *!personality [profile]*\nAvailable profiles: default, professional, sarcastic');
        return;
    }

    const profileName = argumentsText.trim().toLowerCase();
    
    try {
        if (profileName === 'default') {
            // Re-load the main profile
            const profilePath = path.join(__dirname, '..', '..', 'data', 'personality_profile.json');
            if (fs.existsSync(profilePath)) {
                const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
                setPersonalityProfile(profile.systemPrompt);
                await msg.reply('✅ Switched to *default* personality profile.');
            } else {
                await msg.reply('⚠️ No default profile found.');
            }
        } else if (profileName === 'professional') {
            const profPrompt = `You are a professional assistant. You must reply in a polite, formal, and helpful manner. Do not use slang. Do not use emojis. Keep it concise. ALWAYS reply in the SAME LANGUAGE as the user.`;
            setPersonalityProfile(profPrompt);
            await msg.reply('✅ Switched to *professional* personality profile.');
        } else if (profileName === 'sarcastic') {
            const sarcPrompt = `You are a highly sarcastic, dry-witted assistant. You begrudgingly help the user while making sarcastic remarks. No emojis. Short sentences. ALWAYS reply in the SAME LANGUAGE as the user.`;
            setPersonalityProfile(sarcPrompt);
            await msg.reply('✅ Switched to *sarcastic* personality profile.');
        } else {
            await msg.reply('⚠️ Unknown profile. Available: default, professional, sarcastic');
        }
    } catch (err) {
        console.error('Personality error:', err.message);
        await msg.reply('⚠️ Failed to switch personality.');
    }
};
