# Availability Manager

Collaborative scheduling — share your calendar, receive tasks, get real-time notifications.

## 🚀 Deploy to Railway (5 minutes)

Everything runs on a single Railway service. No Vercel, no separate servers.

### 1. Push to GitHub

Create a new GitHub repository and push this entire folder as the root.

Your repo should look like:
```
/
├── server.js
├── package.json
├── railway.toml
├── frontend/
│   ├── src/
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
└── ...
```

### 2. Create a Railway project

1. Go to [railway.app](https://railway.app) → **Sign up with GitHub** (free)
2. Click **"New Project" → "Deploy from GitHub repo"**
3. Select your repository
4. Railway auto-detects Node.js and uses `railway.toml`

### 3. Set environment variables

In Railway → your service → **Variables** tab, add:

| Variable | Value |
|----------|-------|
| `JWT_SECRET` | Any long random string (e.g. `xK9#mP2$qL7nR4wZ`) |

That's it. `PORT` is set automatically by Railway.

### 4. Deploy

Railway builds and deploys automatically. Once done, click **"View Deployment"** to get your live URL:

```
https://availability-manager-production.railway.app
```

**Your app is live.** Share `https://your-url.railway.app?user=yourusername` with anyone.

---

## 🖥️ Local Development

Run the backend and frontend separately:

**Terminal 1 — Backend:**
```bash
npm install
node server.js
# Runs on http://localhost:3001
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:5173
# API calls are proxied to :3001 automatically
```

---

## How it works (Railway)

Railway runs ONE service:
1. `npm install` installs backend dependencies
2. `npm run build` → goes into `frontend/`, installs, runs `vite build` → outputs to `frontend/dist/`
3. `npm start` → starts Express, which serves `frontend/dist/` as static files AND handles all `/api/*` routes

No separate frontend hosting needed.

---

## Features

- 🔐 Register / login with JWT sessions
- 📅 Interactive calendar (month/week/day) — click to create events
- 🔗 Shareable public profile: `?user=yourusername`
- 📋 Anyone with your link can assign tasks to you
- 🔔 Real-time notifications via Socket.io
- 🚨 Urgent task alerts

---

## ⚠️ Data Persistence

The backend uses **in-memory storage** — data resets when Railway restarts the service.

For persistent data, add a Railway PostgreSQL database:
1. In Railway: **New → Database → PostgreSQL**
2. Replace the `db` object in `server.js` with `pg` queries

---

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/register` | — | Create account |
| POST | `/api/login` | — | Sign in |
| GET | `/api/me` | ✅ | Current user |
| GET | `/api/public/:username` | — | Public profile |
| GET | `/api/calendar/:userId` | ✅ | Events |
| POST | `/api/events` | ✅ | Create event |
| DELETE | `/api/events/:id` | ✅ | Delete event |
| POST | `/api/tasks/assign` | — | Assign task |
| GET | `/api/tasks/:userId` | ✅ | Get tasks |
| PATCH | `/api/tasks/:taskId` | ✅ | Update task |
| GET | `/api/notifications/:userId` | ✅ | Notifications |
| PATCH | `/api/notifications/:id/read` | ✅ | Mark read |
| GET | `/api/health` | — | Health check |
