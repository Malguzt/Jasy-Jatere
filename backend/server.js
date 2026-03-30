const express = require('express');
const cors = require('cors');
const cameraRoutes = require('./routes/camera');
const savedCamerasRoutes = require('./routes/saved-cameras');
const streamRoutes = require('./routes/stream');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api', cameraRoutes);
app.use('/api/saved-cameras', savedCamerasRoutes);
app.use('/api/stream', streamRoutes);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
});
