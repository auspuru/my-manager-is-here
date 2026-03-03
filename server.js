const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// In-memory data store (simulating MongoDB)
const db = {
  users: new Map(),
  tasks: new Map(),
  events: new Map(),
  notifications: new Map()
};

// ID generators
let userIdCounter = 1;
let taskIdCounter = 1;
let eventIdCounter = 1;
let notificationIdCounter = 1;

// Socket.io user mapping
const userSockets = new Map();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register', (userId) => {
    userSockets.set(userId, socket.id);
    console.log(`User ${userId} registered to socket ${socket.id}`);
  });

  socket.on('urgent-request', async (data) => {
    const { targetUserId, fromName, message } = data;
    const notification = {
      _id: String(notificationIdCounter++),
      userId: targetUserId,
      type: 'urgent',
      from: fromName,
      message,
      read: false,
      createdAt: new Date()
    };
    db.notifications.set(notification._id, notification);

    const targetSocket = userSockets.get(targetUserId);
    if (targetSocket) {
      io.to(targetSocket).emit('new-notification', notification);
    }
  });

  socket.on('disconnect', () => {
    for (let [userId, socketId] of userSockets.entries()) {
      if (socketId === socket.id) {
        userSockets.delete(userId);
        break;
      }
    }
  });
});

// ============ AUTH ROUTES ============

app.post('/api/register', (req, res) => {
  const { username, password, displayName } = req.body;
  
  for (let user of db.users.values()) {
    if (user.username === username) {
      return res.status(400).json({ error: 'Username exists' });
    }
  }

  const user = {
    _id: String(userIdCounter++),
    username,
    password,
    displayName: displayName || username,
    allowExternalTasks: true,
    allowUrgentContact: true,
    calendarColor: '#3b82f6',
    createdAt: new Date()
  };
  
  db.users.set(user._id, user);
  res.json({ userId: user._id, username, displayName: user.displayName });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  for (let user of db.users.values()) {
    if (user.username === username && user.password === password) {
      return res.json({ userId: user._id, username, displayName: user.displayName });
    }
  }
  
  res.status(401).json({ error: 'Invalid credentials' });
});

// ============ CALENDAR ROUTES ============

app.get('/api/calendar/:userId', (req, res) => {
  const { userId } = req.params;
  const { start, end } = req.query;

  const userEvents = [];
  for (let event of db.events.values()) {
    if (event.userId === userId && event.isPublic) {
      const eventStart = new Date(event.startTime);
      const queryStart = start ? new Date(start) : new Date(0);
      const queryEnd = end ? new Date(end) : new Date(8640000000000000);
      
      if (eventStart >= queryStart && eventStart <= queryEnd) {
        userEvents.push(event);
      }
    }
  }

  const busySlots = userEvents.map(e => ({
    start: e.startTime,
    end: e.endTime,
    title: e.title,
    status: e.status
  }));

  res.json({
    userId,
    availability: busySlots,
    timezone: 'UTC'
  });
});

app.post('/api/events', (req, res) => {
  const { userId, title, startTime, endTime, status, isPublic } = req.body;
  
  const event = {
    _id: String(eventIdCounter++),
    userId,
    title,
    startTime: new Date(startTime),
    endTime: new Date(endTime),
    status: status || 'busy',
    isPublic: isPublic !== false,
    createdAt: new Date()
  };
  
  db.events.set(event._id, event);
  res.json(event);
});

app.get('/api/events/:userId', (req, res) => {
  const { userId } = req.params;
  const userEvents = [];
  
  for (let event of db.events.values()) {
    if (event.userId === userId) {
      userEvents.push(event);
    }
  }
  
  res.json(userEvents.sort((a, b) => new Date(a.startTime) - new Date(b.startTime)));
});

// ============ TASK ROUTES ============

app.post('/api/tasks/assign', (req, res) => {
  const { targetUserId, title, description, dueDate, priority, assignedBy } = req.body;

  const task = {
    _id: String(taskIdCounter++),
    userId: targetUserId,
    title,
    description: description || '',
    dueDate: new Date(dueDate),
    priority: priority || 'medium',
    status: 'pending',
    assignedBy: assignedBy || 'Anonymous',
    source: 'external',
    createdAt: new Date()
  };

  db.tasks.set(task._id, task);

  const targetSocket = userSockets.get(targetUserId);
  if (targetSocket) {
    io.to(targetSocket).emit('new-task', {
      message: `New task assigned by ${task.assignedBy}`,
      task
    });
  }

  const notification = {
    _id: String(notificationIdCounter++),
    userId: targetUserId,
    type: 'task-assigned',
    message: `${task.assignedBy} assigned you: ${title}`,
    metadata: { taskId: task._id },
    read: false,
    createdAt: new Date()
  };
  db.notifications.set(notification._id, notification);

  res.json({ success: true, taskId: task._id });
});

app.get('/api/tasks/:userId', (req, res) => {
  const { userId } = req.params;
  const userTasks = [];
  
  for (let task of db.tasks.values()) {
    if (task.userId === userId) {
      userTasks.push(task);
    }
  }
  
  res.json(userTasks.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)));
});

app.patch('/api/tasks/:taskId', (req, res) => {
  const { taskId } = req.params;
  const updates = req.body;
  
  const task = db.tasks.get(taskId);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  Object.assign(task, updates);
  res.json(task);
});

// ============ NOTIFICATION ROUTES ============

app.get('/api/notifications/:userId', (req, res) => {
  const { userId } = req.params;
  const userNotifs = [];
  
  for (let notif of db.notifications.values()) {
    if (notif.userId === userId) {
      userNotifs.push(notif);
    }
  }
  
  res.json(userNotifs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50));
});

app.patch('/api/notifications/:id/read', (req, res) => {
  const { id } = req.params;
  const notif = db.notifications.get(id);
  
  if (notif) {
    notif.read = true;
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Notification not found' });
  }
});

// ============ PUBLIC PROFILE ROUTES ============

app.get('/api/public/:username', (req, res) => {
  const { username } = req.params;
  
  let user = null;
  for (let u of db.users.values()) {
    if (u.username === username) {
      user = u;
      break;
    }
  }
  
  if (!user) return res.status(404).json({ error: 'User not found' });

  const today = new Date();
  const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  const upcomingEvents = [];
  for (let event of db.events.values()) {
    if (event.userId === user._id && event.isPublic) {
      const eventStart = new Date(event.startTime);
      if (eventStart >= today && eventStart <= nextWeek) {
        upcomingEvents.push(event);
      }
    }
  }

  const currentEvent = upcomingEvents.find(e => {
    const start = new Date(e.startTime);
    const end = new Date(e.endTime);
    return start <= today && end >= today;
  });
  
  const currentStatus = currentEvent?.status || 'available';

  res.json({
    _id: user._id,
    username: user.username,
    displayName: user.displayName,
    currentStatus,
    upcomingAvailability: upcomingEvents.sort((a, b) => 
      new Date(a.startTime) - new Date(b.startTime)
    ),
    allowExternalTasks: user.allowExternalTasks,
    allowUrgentContact: user.allowUrgentContact
  });
});

// ============ HEALTH CHECK ============

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
