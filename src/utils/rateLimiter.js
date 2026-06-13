const commandCooldowns = {}; // { 'userId': lastCommandTimestamp }
const COMMAND_COOLDOWN_MS = 15000; // 15 seconds between heavy commands per user

function isRateLimited(userId) {
    const now = Date.now();
    const last = commandCooldowns[userId] || 0;
    if (now - last < COMMAND_COOLDOWN_MS) {
        const remaining = Math.ceil((COMMAND_COOLDOWN_MS - (now - last)) / 1000);
        return remaining; // Returns seconds remaining, truthy = limited
    }
    commandCooldowns[userId] = now;
    return 0; // Not limited
}

module.exports = {
    isRateLimited
};
