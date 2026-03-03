const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

try { require('dotenv').config(); } catch {}

const app = express();
const server = http.createServer(app);

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const PORT = process.env.PORT || 3001;
const IS_PROD = !!(process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production');

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
});

app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── Serve built React frontend ───────────────────────────────────────────────
const FRONTEND_DIST = path.join(__dirname, 'frontend', 'dist');
app.use(express.static(FRONTEND_DIST));

// ─── In-Memory Database ───────────────────────────────────────────────────────
const db = {
  users: [],
  events: [],
  tasks: [],
  notifications: [],
};

const userSockets = new Map();

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.userId = jwt.verify(auth.split(' ')[1], JWT_SECRET).userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function pushNotification(userId, notification) {
  db.notifications.push(notification);
  const socketId = userSockets.get(userId);
  if (socketId) io.to(socketId).emit('new-notification', notification);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username || !password || !displayName)
    return res.status(400).json({ error: 'All fields required' });
  if (db.users.find((u) => u.username === username.toLowerCase()))
    return res.status(409).json({ error: 'Username already taken' });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = { id: uuidv4(), username: username.toLowerCase(), passwordHash, displayName, createdAt: new Date().toISOString() };
  db.users.push(user);
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({ token, user: { id: user.id, username: user.username, displayName: user.displayName } });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.users.find((u) => u.username === username?.toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username: user.username, displayName: user.displayName } });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = db.users.find((u) => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ id: user.id, username: user.username, displayName: user.displayName });
});

// ─── Public Profile ───────────────────────────────────────────────────────────
app.get('/api/public/:username', (req, res) => {
  const user = db.users.find((u) => u.username === req.params.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });

  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const publicEvents = db.events.filter(
    (e) => e.userId === user.id && e.isPublic && new Date(e.start) <= weekOut && new Date(e.end) >= now
  );
  const currentEvent = publicEvents.find((e) => new Date(e.start) <= now && new Date(e.end) >= now) || null;

  res.json({
    user: { id: user.id, username: user.username, displayName: user.displayName },
    status: currentEvent ? currentEvent.type : 'available',
    currentEvent,
    upcomingEvents: publicEvents.sort((a, b) => new Date(a.start) - new Date(b.start)),
  });
});

// ─── Calendar Events ──────────────────────────────────────────────────────────
app.get('/api/calendar/:userId', (req, res) => {
  const isOwner = (() => {
    try {
      const auth = req.headers.authorization;
      if (!auth) return false;
      return jwt.verify(auth.split(' ')[1], JWT_SECRET).userId === req.params.userId;
    } catch { return false; }
  })();
  res.json(db.events.filter((e) => e.userId === req.params.userId && (isOwner || e.isPublic)));
});

app.post('/api/events', authMiddleware, (req, res) => {
  const { title, start, end, type, isPublic } = req.body;
  if (!title || !start || !end) return res.status(400).json({ error: 'title, start, end required' });
  const colorMap = { busy: '#ef4444', meeting: '#f97316', focus: '#8b5cf6', break: '#22c55e' };
  const event = { id: uuidv4(), userId: req.userId, title, start, end, type: type || 'busy', isPublic: isPublic !== false, color: colorMap[type] || '#64748b', createdAt: new Date().toISOString() };
  db.events.push(event);
  res.status(201).json(event);
});

app.delete('/api/events/:eventId', authMiddleware, (req, res) => {
  const idx = db.events.findIndex((e) => e.id === req.params.eventId && e.userId === req.userId);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.events.splice(idx, 1);
  res.json({ success: true });
});

// ─── Tasks ────────────────────────────────────────────────────────────────────
app.post('/api/tasks/assign', (req, res) => {
  const { targetUsername, title, description, dueDate, priority, assignerName, urgent } = req.body;
  if (!targetUsername || !title || !assignerName)
    return res.status(400).json({ error: 'targetUsername, title, assignerName required' });
  const user = db.users.find((u) => u.username === targetUsername.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });

  const task = { id: uuidv4(), userId: user.id, title, description: description || '', dueDate: dueDate || null, priority: priority || 'medium', assignerName, urgent: !!urgent, completed: false, createdAt: new Date().toISOString() };
  db.tasks.push(task);

  pushNotification(user.id, {
    id: uuidv4(), userId: user.id,
    message: urgent ? `🚨 URGENT task from ${assignerName}: "${title}"` : `📋 New task from ${assignerName}: "${title}"`,
    type: urgent ? 'urgent' : 'task',
    taskId: task.id, read: false,
    createdAt: new Date().toISOString(),
  });

  const socketId = userSockets.get(user.id);
  if (socketId) io.to(socketId).emit('new-task', task);

  res.status(201).json({ task, message: 'Task assigned successfully' });
});

app.get('/api/tasks/:userId', authMiddleware, (req, res) => {
  if (req.userId !== req.params.userId) return res.status(403).json({ error: 'Forbidden' });
  res.json(db.tasks.filter((t) => t.userId === req.params.userId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.patch('/api/tasks/:taskId', authMiddleware, (req, res) => {
  const task = db.tasks.find((t) => t.id === req.params.taskId && t.userId === req.userId);
  if (!task) return res.status(404).json({ error: 'Not found' });
  Object.assign(task, req.body);
  res.json(task);
});

// ─── Notifications ────────────────────────────────────────────────────────────
app.get('/api/notifications/:userId', authMiddleware, (req, res) => {
  if (req.userId !== req.params.userId) return res.status(403).json({ error: 'Forbidden' });
  res.json(db.notifications.filter((n) => n.userId === req.params.userId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.patch('/api/notifications/:id/read', authMiddleware, (req, res) => {
  const notif = db.notifications.find((n) => n.id === req.params.id && n.userId === req.userId);
  if (!notif) return res.status(404).json({ error: 'Not found' });
  notif.read = true;
  res.json(notif);
});

app.patch('/api/notifications/read-all/:userId', authMiddleware, (req, res) => {
  if (req.userId !== req.params.userId) return res.status(403).json({ error: 'Forbidden' });
  db.notifications.filter((n) => n.userId === req.params.userId).forEach((n) => (n.read = true));
  res.json({ success: true });
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ─── SPA Fallback — serve index.html for all non-API routes ──────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('register', (userId) => userSockets.set(userId, socket.id));
  socket.on('urgent-request', ({ targetUserId, fromName, message }) => {
    pushNotification(targetUserId, {
      id: uuidv4(), userId: targetUserId,
      message: `🚨 Urgent from ${fromName}: ${message}`,
      type: 'urgent', read: false,
      createdAt: new Date().toISOString(),
    });
  });
  socket.on('disconnect', () => {
    for (const [uid, sid] of userSockets.entries()) {
      if (sid === socket.id) { userSockets.delete(uid); break; }
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Availability Manager running on port ${PORT}`);
});
