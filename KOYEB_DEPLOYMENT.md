# 🚀 Deploying to Koyeb (24/7 Continuous Execution Guide)

Follow these simple steps to deploy your **NIFTY & BANKNIFTY Quant Trading Bot** on **Koyeb** so it runs **24 hours a day, 7 days a week** without turning off.

---

## 📋 Prerequisites
1. A free **Koyeb Account**: Sign up at [koyeb.com](https://www.koyeb.com)
2. A **GitHub Account**: To host your project code.
3. Your **Upstox API Access Token** (and optional Gemini API key).

---

## 🛠️ Step 1: Push Code to GitHub
1. Export or download this project code (via AI Studio Export/GitHub workflow).
2. Create a new repository on GitHub (e.g. `nifty-quant-trading-bot`).
3. Commit and push all files to your main branch:
   ```bash
   git init
   git add .
   git commit -m "Initial commit for Koyeb 24/7 deployment"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   git push -u origin main
   ```

---

## ⚡ Step 2: Deploy on Koyeb

1. Log in to your [Koyeb Control Panel](https://app.koyeb.com/).
2. Click **Create Service** (or **+ Create**).
3. Select **GitHub** as the source and connect your GitHub repository.
4. Select your repository (`nifty-quant-trading-bot`) and the `main` branch.
5. In **Builder**:
   - Choose **Dockerfile** (Koyeb will automatically detect the included multi-stage `Dockerfile`).
6. In **Environment Variables**:
   - Add `NODE_ENV` = `production`
   - Add `PORT` = `8000`
   - Add `UPSTOX_ACCESS_TOKEN` = `your_upstox_token_here` (Optional - can also be updated directly in the UI settings later)
   - Add `GEMINI_API_KEY` = `your_gemini_api_key_here` (Optional for market news AI)
7. In **Ports & Health Checks**:
   - HTTP Port: `8000`
   - Health check path: `/api/health`
8. Click **Deploy**.

---

## 🔄 24/7 Strategy Execution & Token Refresh
- **Persistent Engine**: Once deployed, the background strategy engine running inside Express will automatically connect to Upstox and stream real-time options data, evaluate strategy triggers (Breakout, Trap, Continuation, OI Wall Rejection), and manage trailing stop losses 24/7.
- **Updating Upstox Token**: Upstox access tokens expire daily around 3:30 AM IST. When you log into your trading dashboard on Koyeb, simply paste your fresh token in **Settings → Upstox Access Token** and click **Save Settings**. The running bot instantly applies the new token without needing a service restart!

---

## 📊 Verification & Logs
- Once deployed, Koyeb provides a live public URL (e.g., `https://your-app-name.koyeb.app`).
- View continuous real-time execution logs under the **Logs** tab in your Koyeb dashboard.
- The `/api/health` route is used by Koyeb's internal watchdog to automatically restart the container if network connectivity or server issues ever occur.
