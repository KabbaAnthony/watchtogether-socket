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
            currentTime:     0,     // playback position at the moment isPlaying last changed
            playedAt:        null,  // Date.now() when play was pressed — used to drift-correct
            isPlaying:       false,
            playbackVersion: 1,
            hostSocketId:    null,
            members:         new Set()
        };
    }
    return rooms[roomCode];
}

// Return the best-estimate current playback time for a room.
// If the host is playing, add the seconds elapsed since they pressed play.
function getLiveCurrentTime(state) {
    if (!state.isPlaying || !state.playedAt) return state.currentTime;
    const elapsed = (Date.now() - state.playedAt) / 1000;
    return state.currentTime + elapsed;
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
        const { roomCode, userId, isHost } = data;
        if (!roomCode || !userId) return;

        socket.join(roomCode);
        socket.data.roomCode = roomCode;
        socket.data.userId   = userId;
        socket.data.isHost   = isHost;

        const state = getRoomState(roomCode);
        state.members.add(userId);

        if (isHost) {
            state.hostSocketId = socket.id;
            // Always update videoId from the host so viewers get the right video
            if (data.videoId) state.videoId = data.videoId;
        }

        // Send current room state back to the joining client.
        // currentTime is live-corrected if the host is mid-play.
        socket.emit('room-state', {
            videoId:         state.videoId,
            currentTime:     getLiveCurrentTime(state),
            isPlaying:       state.isPlaying,
            playbackVersion: state.playbackVersion
        });

        broadcastRoomCount(roomCode);
    });

    // ── Host events ──────────────────────────────────────────────────

    socket.on('host-play', (data) => {
        if (!socket.data.isHost) return;
        const { roomCode, currentTime } = data;
        const state = getRoomState(roomCode);

        state.isPlaying    = true;
        state.currentTime  = Number(currentTime) || 0;
        state.playedAt     = Date.now(); // record when play was pressed
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
        state.playedAt     = null; // clear — no longer playing
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
        // If playing, reset the playedAt clock from the new position
        if (state.isPlaying) state.playedAt = Date.now();
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
        state.playedAt        = null;
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
