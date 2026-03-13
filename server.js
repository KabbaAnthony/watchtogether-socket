const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "https://kodelight.com",
        methods: ["GET", "POST"],
        credentials: true
    }
});

const rooms = {};

function getRoomState(roomCode) {
    if (!rooms[roomCode]) {
        rooms[roomCode] = {
            videoId: null,
            currentTime: 0,
            isPlaying: false,
            playbackVersion: 1,
            hostSocketId: null
        };
    }
    return rooms[roomCode];
}

io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    socket.on('join-room', (data) => {
        const { roomCode, userId, isHost, videoId, currentTime, isPlaying, playbackVersion } = data;
        if (!roomCode || !userId) return;

        socket.join(roomCode);
        socket.data.roomCode = roomCode;
        socket.data.userId = userId;
        socket.data.isHost = isHost;

        const state = getRoomState(roomCode);

        if (isHost) {
            state.hostSocketId = socket.id;
            if (videoId) state.videoId = videoId;
            if (currentTime !== undefined) state.currentTime = Number(currentTime);
            if (isPlaying !== undefined) state.isPlaying = Boolean(isPlaying);
            if (playbackVersion !== undefined) state.playbackVersion = Number(playbackVersion);
        }

        socket.emit('room-state', {
            videoId: state.videoId,
            currentTime: state.currentTime,
            isPlaying: state.isPlaying,
            playbackVersion: state.playbackVersion
        });

        console.log(`User ${userId} joined room ${roomCode} as ${isHost ? 'HOST' : 'VIEWER'}`);
    });

    socket.on('host-play', (data) => {
        if (!socket.data.isHost) return;
        const { roomCode, currentTime } = data;
        const state = getRoomState(roomCode);
        state.isPlaying = true;
        state.currentTime = Number(currentTime) || 0;
        state.playbackVersion++;
        socket.to(roomCode).emit('viewer-play', {
            currentTime: state.currentTime,
            playbackVersion: state.playbackVersion
        });
        console.log(`[${roomCode}] HOST PLAY at ${state.currentTime}s`);
    });

    socket.on('host-pause', (data) => {
        if (!socket.data.isHost) return;
        const { roomCode, currentTime } = data;
        const state = getRoomState(roomCode);
        state.isPlaying = false;
        state.currentTime = Number(currentTime) || 0;
        state.playbackVersion++;
        socket.to(roomCode).emit('viewer-pause', {
            currentTime: state.currentTime,
            playbackVersion: state.playbackVersion
        });
        console.log(`[${roomCode}] HOST PAUSE at ${state.currentTime}s`);
    });

    socket.on('host-seek', (data) => {
        if (!socket.data.isHost) return;
        const { roomCode, currentTime } = data;
        const state = getRoomState(roomCode);
        state.currentTime = Number(currentTime) || 0;
        state.playbackVersion++;
        socket.to(roomCode).emit('viewer-seek', {
            currentTime: state.currentTime,
            playbackVersion: state.playbackVersion
        });
        console.log(`[${roomCode}] HOST SEEK to ${state.currentTime}s`);
    });

    socket.on('host-change-video', (data) => {
        if (!socket.data.isHost) return;
        const { roomCode, videoId } = data;
        const state = getRoomState(roomCode);
        state.videoId = videoId;
        state.currentTime = 0;
        state.isPlaying = false;
        state.playbackVersion++;
        socket.to(roomCode).emit('viewer-change-video', {
            videoId: state.videoId,
            playbackVersion: state.playbackVersion
        });
        console.log(`[${roomCode}] HOST CHANGED VIDEO to ${videoId}`);
    });

    socket.on('disconnect', () => {
        const { roomCode, isHost } = socket.data;
        if (roomCode && isHost) {
            const state = getRoomState(roomCode);
            if (state.hostSocketId === socket.id) {
                state.hostSocketId = null;
            }
        }
        console.log('Socket disconnected:', socket.id);
    });
});

app.get('/', (req, res) => {
    res.json({
        status: 'WatchTogether socket server running',
        rooms: Object.keys(rooms).length
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});