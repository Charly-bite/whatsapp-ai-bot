const fs = require('fs');
const path = require('path');

let personalityPrompt = '';

function loadPersonality() {
    try {
        const profile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'personality_profile.json'), 'utf-8'));
        personalityPrompt = profile.systemPrompt;
        console.log('✅ Personality profile loaded successfully!');
    } catch (e) {
        console.log('⚠️ No personality profile found. Run "node personality.js" first.');
    }
}

function getPersonalityPrompt() {
    return personalityPrompt;
}
function setPersonalityProfile(newPrompt) {
    personalityPrompt = newPrompt;
}

module.exports = {
    loadPersonality,
    getPersonalityPrompt,
    setPersonalityProfile
};
