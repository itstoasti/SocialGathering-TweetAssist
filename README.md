<p align="center">
  <img src="./src/images/XReplyGPT.png" alt="Tweet Assist Logo" width="128" height="128">
</p>

<h1 align="center">Tweet Assist</h1>

<p align="center">
  <strong>The fastest way to reply to tweets with AI and boost your engagement</strong>
</p>

<p align="center">
  <a href="https://github.com/itstoasti/SocialGathering-TweetAssist/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/itstoasti/SocialGathering-TweetAssist">
  </a>
  <img alt="Version" src="https://img.shields.io/badge/version-6.2-blue">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Chrome-green">
</p>

---

## 🚀 Features

### 🤖 AI-Powered Replies
Generate intelligent, context-aware replies to tweets using your choice of AI provider:
- **Google Gemini**
- **OpenAI (GPT)**
- **xAI (Grok)**

### 🔍 Scout Mode
Automatically find high-value tweets to engage with:
- Filter by tweet age and minimum views
- Auto-scroll through your timeline
- Highlight matching tweets
- Pause on match or skip to next
- Track matches found

### 📅 Content Calendar
Plan and schedule your posts:
- Compose tweets with character count
- Schedule posts for specific dates/times
- Media upload support (images)
- View upcoming scheduled posts
- Missed post detection with reschedule option
- Post history tracking

### 📊 Dashboard
Central hub for all features:
- View Scout matches
- Filter tweets by reply status
- Quick AI provider switching
- Custom system prompts with save/load
- Reply statistics tracking

### ⚙️ Customizable Settings
- Multiple AI model selection
- Configurable daily stats reset time
- Auto-send on redirect
- Close window after reply
- Sound notifications
- Scroll speed control

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+L` | Generate AI reply for current tweet |
| `Ctrl+Shift+K` | Toggle Scout On/Off |
| `Ctrl+Shift+N` | Skip to next Scout match |
| `Ctrl+Shift+E` | Move to next generated reply |
| `Ctrl+Shift+S` | Move to previous generated reply |

---

## 📦 Installation

### From Source
1. Clone this repository:
   ```bash
   git clone https://github.com/itstoasti/SocialGathering-TweetAssist.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked** and select the cloned folder
5. The extension icon will appear in your toolbar

---

## 🔧 Setup

1. **Get an API Key** from your preferred AI provider:
   - [Google AI Studio](https://aistudio.google.com/apikey) (Gemini)
   - [OpenAI Platform](https://platform.openai.com/account/api-keys) (GPT)
   - [xAI Console](https://console.x.ai/) (Grok)

2. **Configure the Extension:**
   - Click the extension icon to open the Dashboard
   - Go to **Settings**
   - Select your AI provider and paste your API key
   - Click **Validate** to confirm it works

3. **Start Using:**
   - Open [x.com](https://x.com/home)
   - Use `Ctrl+Shift+L` on any tweet to generate a reply
   - Or enable Scout mode to find high-engagement tweets

---

## 📖 How to Use

### Generating Replies
1. Navigate to any tweet on X.com
2. Press `Ctrl+Shift+L` or click the reply button with the AI icon
3. Choose from the generated reply suggestions
4. Click to copy and paste into the reply box

### Using Scout Mode
1. Open the Dashboard and configure your system prompt
2. Go to X.com and find the floating Scout panel
3. Set your filters (tweet age, minimum views)
4. Click **Start** to begin auto-scrolling
5. Scout will pause on matching tweets for you to engage

### Scheduling Posts
1. Open the Dashboard and go to **Calendar**
2. Click **New Post** or select a date
3. Compose your tweet and optionally add an image
4. Set the schedule date and time
5. Click **Schedule Post**

---

## 🏗️ Project Structure

```
TweetAssist/
├── manifest.json          # Extension manifest (MV3)
├── src/
│   ├── content.js         # Main content script for X.com
│   ├── scout-content.js   # Scout mode functionality
│   ├── service-worker.js  # Background service worker
│   ├── dashboard.html/js  # Main dashboard interface
│   ├── settings.html/js   # Settings page
│   └── images/            # Extension icons
├── docs/                  # Website/documentation
└── releases/              # Release packages
```

---

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs via [GitHub Issues](https://github.com/itstoasti/SocialGathering-TweetAssist/issues)
- Submit feature requests
- Open pull requests

---

## 📜 License

This project is proprietary software. All rights reserved. See the [LICENSE](LICENSE) file for details.

**You may NOT:**
- Copy, modify, or distribute this software
- Use this software for commercial purposes
- Create derivative works

---

## ⚠️ Disclaimer

Tweet Assist is an unofficial tool and is not affiliated with X (Twitter). Use responsibly and ensure generated content aligns with X's community guidelines and policies. AI-generated replies should be reviewed before posting.

---

<p align="center">
  Made with ❤️ for the X community
</p>
