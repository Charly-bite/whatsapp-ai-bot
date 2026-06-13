# 🤖 WhatsApp AI Bot

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/Charly-bite/whatsapp-ai-bot)
[![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A highly advanced, multi-cloud, intelligent WhatsApp Bot designed to handle automated conversations, perform various utility tasks, and act as a personal assistant right inside your WhatsApp chats.

## ✨ Features

* **🧠 Multi-Cloud AI Brain:** A highly robust "Waterfall" AI cascade utilizing **Gemini 2.5 Flash**, **Groq Llama-3.1-8B-Instant**, and local **Ollama** fallbacks to guarantee 100% uptime, even during rate limits.
* **🎛️ Live Dashboard:** A beautifully designed, real-time web dashboard to monitor incoming messages, manually intervene in chats, and toggle the AI on/off for specific contacts.
* **📥 Advanced Media Downloader (`!download`):** Instantly download audio and video from YouTube, Spotify, TikTok, Instagram, Twitter, and more using an integrated `yt-dlp` system.
* **📚 E-Book Finder (`!read`):** Search and instantly download books or PDFs directly into WhatsApp.
* **⛈️ Live Weather (`!weather`):** Real-time weather updates utilizing the Open-Meteo API.
* **🎨 AI Image Generation (`!draw` / `!image`):** Generate images from text prompts.
* **🎙️ Text-to-Speech (`!speak` / `!tts`):** Convert text into audio voice messages.
* **🧩 And much more:** News, Dictionary, Translation, Reminders, Personality swapping, and Stickers.

## 🚀 Setup & Installation

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or newer recommended)
- [FFmpeg](https://ffmpeg.org/) installed and added to your system PATH
- A secondary WhatsApp number (to act as the bot)

### 1. Clone the repository
```bash
git clone https://github.com/Charly-bite/whatsapp-ai-bot.git
cd whatsapp-ai-bot
```

### 2. Install dependencies
```bash
npm install
```

### 3. Environment Variables
Create a `.env` file in the root directory and add your API keys:
```env
GEMINI_API_KEY=your_gemini_key_here
GROQ_API_KEY=your_groq_key_here
# Optional:
OLLAMA_URL=http://localhost:11434
```

### 4. Start the Bot
```bash
npm start
```
*Alternatively, you can run the bot in the background using PM2:*
```bash
pm2 start ecosystem.config.js
```

### 5. Scan the QR Code
On the first run, the bot will generate a QR code in your terminal. Open your WhatsApp app (the account you want to act as the bot), go to **Linked Devices**, and scan the QR code.

## 💻 Web Dashboard
Once the bot is running, you can access the stunning real-time Dashboard by navigating to:
`http://localhost:3000`

The dashboard allows you to:
- Read active chats in real-time.
- View which AI model (`✨ Gemini` or `✨ Groq`) drafted the auto-replies.
- Disable/Enable the bot auto-reply per specific contact.
- Trigger a Master Switch that dynamically broadcasts an "Offline" message to all active users.

## 🤝 Contributing
Contributions, issues, and feature requests are welcome!

## 📝 License
This project is licensed under the MIT License.
