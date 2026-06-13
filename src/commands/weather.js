const { isRateLimited } = require('../utils/rateLimiter');
const axios = require('axios');

module.exports = async function handleWeather(client, msg, argumentsText) {
    const cooldown = !msg.fromMe && isRateLimited(msg.from);
    if (cooldown) {
        await msg.reply(`⏳ Please wait ${cooldown}s before using !weather again.`);
        return;
    }

    if (!argumentsText) {
        await msg.reply('⚠️ Please provide a city name. Example: *!weather London*');
        return;
    }

    try {
        const city = argumentsText.trim();
        
        // 1. Get coordinates from city name using Open-Meteo Geocoding API
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
        const geoResp = await axios.get(geoUrl);
        
        if (!geoResp.data.results || geoResp.data.results.length === 0) {
            await msg.reply(`⚠️ Could not find city "${city}".`);
            return;
        }

        const location = geoResp.data.results[0];
        const lat = location.latitude;
        const lon = location.longitude;
        const locName = `${location.name}, ${location.country}`;

        // 2. Get weather using coordinates
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
        const weatherResp = await axios.get(weatherUrl);

        const current = weatherResp.data.current_weather;
        if (current) {
            const temp = current.temperature;
            const wind = current.windspeed;
            // Decode weather code (WMO Weather interpretation codes)
            const wmoCodes = {
                0: 'Clear sky ☀️',
                1: 'Mainly clear 🌤️',
                2: 'Partly cloudy ⛅',
                3: 'Overcast ☁️',
                45: 'Fog 🌫️',
                48: 'Depositing rime fog 🌫️',
                51: 'Light drizzle 🌧️',
                53: 'Moderate drizzle 🌧️',
                55: 'Dense drizzle 🌧️',
                61: 'Slight rain ☔',
                63: 'Moderate rain ☔',
                65: 'Heavy rain ☔',
                71: 'Slight snow ❄️',
                73: 'Moderate snow ❄️',
                75: 'Heavy snow ❄️',
                95: 'Thunderstorm ⛈️'
            };
            const condition = wmoCodes[current.weathercode] || 'Unknown';

            await msg.reply(`🌍 *Weather in ${locName}*\n\n🌡️ Temperature: ${temp}°C\n🌬️ Wind: ${wind} km/h\n🌤️ Condition: ${condition}`);
        } else {
            await msg.reply('⚠️ Failed to fetch weather data.');
        }

    } catch (err) {
        console.error('Weather Error:', err.message);
        await msg.reply('⚠️ An error occurred while fetching the weather.');
    }
};
