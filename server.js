const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');

const app    = express();
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
            videoId:         null,
            currentTime:     0,
            isPlaying:       false,
            playbackVersion: 1,
            hostSocketId:    null,
            members:         new Set()
        };
    }
    return rooms[roomCode];
}

function broadcastRoomCount(roomCode) {
    const state = rooms[roomCode];
    if (!state) return;
    io.to(roomCode).emit('room-count', {
        roomCode,
        count: state.members.size
    });
}

io.on('connection', (socket) => {

    socket.on('join-room', (data) => {
        const { roomCode, userId, isHost, videoId, currentTime, isPlaying, playbackVersion } = data;
        if (!roomCode || !userId) return;

        socket.join(roomCode);
        socket.data.roomCode = roomCode;
        socket.data.userId   = userId;
        socket.data.isHost   = isHost;

        const state = getRoomState(roomCode);
        state.members.add(userId);

        if (isHost) {
            state.hostSocketId = socket.id;
            if (videoId        !== undefined) state.videoId         = videoId;
            if (currentTime    !== undefined) state.currentTime     = Number(currentTime);
            if (isPlaying      !== undefined) state.isPlaying       = Boolean(isPlaying);
            if (playbackVersion !== undefined) state.playbackVersion = Number(playbackVersion);
        }

        // Send current room state back to whoever just joined
        socket.emit('room-state', {
            videoId:         state.videoId,
            currentTime:     state.currentTime,
            isPlaying:       state.isPlaying,
            playbackVersion: state.playbackVersion
        });

        // Broadcast updated count to everyone in room
        broadcastRoomCount(roomCode);
    });

    // ── Host events ──────────────────────────────────────────────────

    socket.on('host-play', (data) => {
        if (!socket.data.isHost) return;
        const { roomCode, currentTime } = data;
        const state = getRoomState(roomCode);
        state.isPlaying    = true;
        state.currentTime  = Number(currentTime) || 0;
        state.playbackVersion++;
        socket.to(roomCode).emit('viewer-play', {
            currentTime:     state.currentTime,
            playbackVersion: state.playbackVersion
        });
    });

    socket.on('host-pause', (data) => {
        if (!socket.data.isHost) return;
        const { roomCode, currentTime } = data;
        const state = getRoomState(roomCode);
        state.isPlaying    = false;
        state.currentTime  = Number(currentTime) || 0;
        state.playbackVersion++;
        socket.to(roomCode).emit('viewer-pause', {
            currentTime:     state.currentTime,
            playbackVersion: state.playbackVersion
        });
    });

    socket.on('host-seek', (data) => {
        if (!socket.data.isHost) return;
        const { roomCode, currentTime } = data;
        const state = getRoomState(roomCode);
        state.currentTime = Number(currentTime) || 0;
        state.playbackVersion++;
        socket.to(roomCode).emit('viewer-seek', {
            currentTime:     state.currentTime,
            playbackVersion: state.playbackVersion
        });
    });

    socket.on('host-change-video', (data) => {
        if (!socket.data.isHost) return;
        const { roomCode, videoId } = data;
        const state = getRoomState(roomCode);
        state.videoId         = videoId;
        state.currentTime     = 0;
        state.isPlaying       = false;
        state.playbackVersion++;
        socket.to(roomCode).emit('viewer-change-video', {
            videoId:         state.videoId,
            playbackVersion: state.playbackVersion
        });
    });

    // ── Disconnect ───────────────────────────────────────────────────

    socket.on('disconnect', () => {
        const { roomCode, userId, isHost } = socket.data;
        if (!roomCode) return;

        const state = rooms[roomCode];
        if (state) {
            state.members.delete(userId);
            if (isHost && state.hostSocketId === socket.id) {
                state.hostSocketId = null;
            }
            broadcastRoomCount(roomCode);

            // Clean up empty rooms
            if (state.members.size === 0) {
                delete rooms[roomCode];
            }
        }
    });
});

app.get('/', (req, res) => {
    res.json({
        status: 'WatchTogether socket server running',
        rooms:  Object.keys(rooms).length
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
