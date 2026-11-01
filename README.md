# Cooking-App

Minimalist personal **CookBook** PC application and local SQLite database server with automatic ingredient proportion scaling and embedded YouTube / TikTok / web recipe links.

## Features
- **Start from Scratch**: Clean, empty personal database with step-by-step input guides.
- **Automatic Proportion Scaling**: Change any ingredient's amount (for example, `1 kg` Pork → `2 kg` Pork) and every other ingredient (`1 tbsp` Soy Sauce → `2 tbsp` Soy Sauce) adjusts automatically.
- **YouTube, TikTok & Website Links**: Watch attached YouTube or TikTok recipe videos inside the app or open the original link in your browser.
- **Local PC Database (Android-Ready)**: Runs a local Node.js + SQLite database server (`http://127.0.0.1:3847`) on your PC that can also be accessed over Wi-Fi from your Android phone.

## How to Run on Windows
Double-click **`CookBook.exe`** (or **`Start-CookBook.bat`**), or run:
```bash
node server.js
```
