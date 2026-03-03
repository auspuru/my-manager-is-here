# Availability Manager - Collaborative Scheduling Platform

A full-stack collaborative scheduling platform with shared calendar views, external task assignment, urgency notifications, and real-time updates.

## 🚀 Live Demo

**Frontend**: https://3ck4sz5qbeiug.ok.kimi.link

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Shared Calendar View** | Others can see when you're free/busy via a public profile link |
| **External Task Assignment** | Anyone with your link can add tasks to your calendar |
| **Urgency Notifications** | Real-time alerts for high-priority requests via Socket.io |
| **Cross-Device Access** | Session persistence with localStorage |
| **Real-Time Updates** | Instant notifications when tasks are assigned |

## 📁 Project Structure

```
/mnt/okcomputer/output/
├── app/                    # React frontend (built)
│   ├── dist/              # Production build
│   ├── src/
│   │   ├── App.tsx        # Main application
│   │   ├── App.css        # Styles
│   │   └── types/
│   └── server/            # Backend server
│       ├── server.js      # Express + Socket.io server
│       ├── package.json
│       └── .env
└── server/                # Copy of backend (for convenience)
```

## 🛠️ Tech Stack

**Frontend:**
- React + TypeScript + Vite
- Tailwind CSS
- react-big-calendar
- date-fns
- Socket.io-client

**Backend:**
- Node.js + Express
- Socket.io (real-time notifications)
- In-memory data store (easily switch to MongoDB)
- CORS enabled

## 🚀 Running Locally

### 1. Start the Backend Server

```bash
cd /mnt/okcomputer/output/server
npm install
npm start
```

The server will run on `http://localhost:3001`

### 2. Start the Frontend (Development)

```bash
cd /mnt/okcomputer/output/app
npm install
npm run dev
```

The frontend will run on `http://localhost:5173`

### 3. Configure Environment

Update `/mnt/okcomputer/output/app/.env`:
```
VITE_API_URL=http://localhost:3001
```

## 📡 API Endpoints

### Authentication
- `POST /api/register` - Create new account
- `POST /api/login` - Sign in

### Calendar
- `GET /api/calendar/:userId` - Get user's public availability
- `POST /api/events` - Create calendar event
- `GET /api/events/:userId` - Get all user events

### Tasks
- `POST /api/tasks/assign` - Assign task to user (external)
- `GET /api/tasks/:userId` - Get user's tasks
- `PATCH /api/tasks/:taskId` - Update task status

### Notifications
- `GET /api/notifications/:userId` - Get notifications
- `PATCH /api/notifications/:id/read` - Mark as read

### Public Profile
- `GET /api/public/:username` - Get public profile data

## 🔌 Socket.io Events

**Client → Server:**
- `register` - Register user ID with socket
- `urgent-request` - Send urgent notification

**Server → Client:**
- `new-notification` - New notification received
- `new-task` - New task assigned

## 🎯 Usage Flow

1. **Register/Login** - Create an account or sign in
2. **View Calendar** - See your schedule and add events
3. **Share Your Link** - Copy your shareable link from Settings
4. **Others Can:**
   - View your public availability
   - Add tasks to your calendar
   - Send urgent notifications (if enabled)
5. **Receive Tasks** - Get real-time notifications when tasks are assigned

## 📝 Switching to MongoDB

To use MongoDB instead of in-memory storage:

1. Install dependencies:
```bash
npm install mongoose
```

2. Update `server.js`:
```javascript
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI);
```

3. Create models (see original specification for schema)

## 🚀 Deployment

### Frontend (Static)
The frontend is already deployed at: https://3ck4sz5qbeiug.ok.kimi.link

### Backend (Node.js)
Deploy to Railway, Render, or Heroku:

```bash
# Railway
railway login
railway init
railway up

# Set environment variables:
# PORT=3001
# MONGODB_URI=your_mongodb_uri (optional)
```

## 🔮 Future Enhancements

- [ ] Email notifications for offline users
- [ ] Recurring events support
- [ ] Google/Outlook calendar sync
- [ ] Time zone handling
- [ ] Team/group calendars
- [ ] Mobile app (React Native)

## 📄 License

MIT
