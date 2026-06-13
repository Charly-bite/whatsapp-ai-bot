const { isRateLimited } = require('../utils/rateLimiter');
const Parser = require('rss-parser');
const parser = new Parser();

module.exports = async function handleNews(client, msg, argumentsText) {
    const cooldown = !msg.fromMe && isRateLimited(msg.from);
    if (cooldown) {
        await msg.reply(`⏳ Please wait ${cooldown}s before using !news again.`);
        return;
    }

    try {
        let feedUrl = 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en';
        let topic = 'Top News';

        if (argumentsText) {
            topic = argumentsText.trim();
            feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`;
        }

        await msg.reply(`📰 Fetching news for: *${topic}*...`);

        const feed = await parser.parseURL(feedUrl);
        
        if (feed.items && feed.items.length > 0) {
            let replyMsg = `📰 *Latest News: ${topic}*\n\n`;
            
            // Get top 5 articles
            for (let i = 0; i < Math.min(5, feed.items.length); i++) {
                const item = feed.items[i];
                replyMsg += `*${i+1}. ${item.title}*\n🔗 ${item.link}\n\n`;
            }
            
            await msg.reply(replyMsg);
        } else {
            await msg.reply('⚠️ No news articles found for this topic.');
        }
    } catch (err) {
        console.error('News Error:', err.message);
        await msg.reply('⚠️ An error occurred while fetching news.');
    }
};
