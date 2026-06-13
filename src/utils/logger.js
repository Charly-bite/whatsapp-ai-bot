let messagesSentToday = 0;
let totalTokensUsed = 0;
const activityLogs = [];  // [{timestamp, type, message}]

function addLog(type, message) {
    activityLogs.unshift({ timestamp: new Date().toISOString(), type, message });
    if (activityLogs.length > 200) activityLogs.pop();
    console.log(`[${type}] ${message}`);
}

function getLogs() {
    return activityLogs;
}

function incrementMessagesSent() {
    messagesSentToday++;
}

function getMessagesSent() {
    return messagesSentToday;
}

function addTokensUsed(amount) {
    totalTokensUsed += amount;
}

function getTokensUsed() {
    return totalTokensUsed;
}

module.exports = {
    addLog,
    getLogs,
    incrementMessagesSent,
    getMessagesSent,
    addTokensUsed,
    getTokensUsed
};
