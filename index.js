require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
const fs = require('fs'); // Added for file operations

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Config

// Hardcoded users
const users = [
  {
    id: 1,
    username: 'admin',
    password: bcrypt.hashSync('adminpass', 8),
    role: 'admin'
  },
  {
    id: 2,
    username: 'user',
    password: bcrypt.hashSync('userpass', 8),
    role: 'user'
  }
];

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || '7056a419cc81a2212b15d8f28d35cc26';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync('uploads')) {
      fs.mkdirSync('uploads');
    }
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Store video metadata (in memory for now)
let videos = [];


// Middleware to verify JWT
function verifyToken(req, res, next) {
  const token = req.headers['x-access-token'];
  if (!token) return res.status(403).send('No token provided');

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(500).send('Failed to authenticate token');

    req.userId = decoded.id;
    req.userRole = decoded.role;
    next();
  });
}

// Auth

// Login endpoint
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  const user = users.find(u => u.username === username);
  if (!user) return res.status(404).send('User not found');

  const passwordIsValid = bcrypt.compareSync(password, user.password);
  if (!passwordIsValid) return res.status(401).send('Invalid password');

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, {
    expiresIn: 86400 // 24 hours
  });

  res.status(200).send({
    id: user.id,
    username: user.username,
    role: user.role,
    accessToken: token
  });
});

// Video Processing

// upload video
app.post('/api/videos/upload', verifyToken, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded');

  const videoData = {
    id: videos.length + 1,
    userId: req.userId,
    originalName: req.file.originalname,
    storedName: req.file.filename,
    path: req.file.path,
    status: 'uploaded',
    createdAt: new Date(),
    formats: []
  };

  videos.push(videoData);
  res.status(201).send(videoData);
});

// Transcode video
app.post('/api/videos/transcode/:videoId', verifyToken, (req, res) => {
  const videoId = parseInt(req.params.videoId);
  const video = videos.find(v => v.id === videoId);

  if (!video) return res.status(404).send('Video not found');
  if (video.userId !== req.userId && req.userRole !== 'admin') {
    return res.status(403).send('Not authorized');
  }

  video.status = 'processing';

  if (!fs.existsSync('transcoded')) {
    fs.mkdirSync('transcoded');
  }

  // formats of the video
  const formats = [
    { name: '360p', size: '640x360' },
    { name: '720p', size: '1280x720' },
    { name: '1080p', size: '1920x1080' }
  ];

  // Process each format
  formats.forEach(format => {
    const outputPath = `transcoded/${video.id}-${format.name}.mp4`;

    ffmpeg(video.path)
      .size(format.size)
      .output(outputPath)
      .on('end', () => {
        video.formats.push({
          name: format.name,
          path: outputPath,
          status: 'completed'
        });

        if (video.formats.length === formats.length) {
          video.status = 'completed';
        }
      })
      .on('error', (err) => {
        console.error(`Error transcoding to ${format.name}:`, err);
        video.formats.push({
          name: format.name,
          status: 'failed',
          error: err.message
        });
      })
      .run();
  });

  res.status(202).send({
    message: 'Transcoding started',
    videoId: video.id
  });
});

// Get video info
app.get('/api/videos/:videoId', verifyToken, (req, res) => {
  const videoId = parseInt(req.params.videoId);
  const video = videos.find(v => v.id === videoId);

  if (!video) return res.status(404).send('Video not found');
  if (video.userId !== req.userId && req.userRole !== 'admin') {
    return res.status(403).send('Not authorized');
  }

  res.status(200).send(video);
});

// List all videos (admin only)
app.get('/api/videos', verifyToken, (req, res) => {
  if (req.userRole !== 'admin') {
    return res.status(403).send('Not authorized');
  }

  res.status(200).send(videos);
});

app.get('/', (req, res) => {
  res.send('Server is running!');
});

// start server

const PORT = process.env.PORT || 8080; // Changed from 3000 to 8080
app.listen(PORT, '0.0.0.0', () => {    // Added '0.0.0.0' to listen on all interfaces
  console.log(`Server running on port ${PORT}`);
});