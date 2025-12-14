const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*", // В продакшене замените на ваш домен
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// Состояние игры
const gameState = {
    players: {},        // { socketId: { x, y, z, rotation, username, color, stones: 5 } }
    chests: {          // { chest1: { stones: 0, position: {x, z} }, ... }
        chest1: { stones: 0, position: { x: 10, z: 10 } },
        chest2: { stones: 0, position: { x: -10, z: 10 } },
        chest3: { stones: 0, position: { x: 10, z: -10 } },
        chest4: { stones: 0, position: { x: -10, z: -10 } }
    },
    startedAt: new Date()
};

// Рандомный цвет для игрока
function getRandomColor() {
    const colors = [
        '#3498db', '#e74c3c', '#2ecc71', '#f1c40f',
        '#9b59b6', '#1abc9c', '#d35400', '#34495e'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// API Endpoints
app.get('/status', (req, res) => {
    res.json({
        online: true,
        players: Object.keys(gameState.players).length,
        uptime: Math.floor((new Date() - gameState.startedAt) / 1000),
        version: '1.0.0'
    });
});

app.get('/players', (req, res) => {
    res.json(gameState.players);
});

// Socket.io события
io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);
    
    // Инициализация игрока
    socket.on('initPlayer', (data) => {
        const { username } = data;
        
        gameState.players[socket.id] = {
            x: Math.random() * 20 - 10,
            y: 1,
            z: Math.random() * 20 - 10,
            rotation: 0,
            username: username || `Игрок_${socket.id.substring(0, 4)}`,
            color: getRandomColor(),
            stones: 5,
            connectedAt: new Date()
        };
        
        // Отправляем текущее состояние новому игроку
        socket.emit('initGame', {
            playerId: socket.id,
            ...gameState.players[socket.id],
            chests: gameState.chests,
            otherPlayers: Object.keys(gameState.players)
                .filter(id => id !== socket.id)
                .reduce((obj, id) => {
                    obj[id] = gameState.players[id];
                    return obj;
                }, {})
        });
        
        // Сообщаем всем о новом игроке
        socket.broadcast.emit('playerJoined', {
            id: socket.id,
            ...gameState.players[socket.id]
        });
        
        // Обновляем счетчик онлайн
        updateOnlineCount();
    });
    
    // Движение игрока
    socket.on('playerMove', (data) => {
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].x = data.x;
            gameState.players[socket.id].y = data.y;
            gameState.players[socket.id].z = data.z;
            gameState.players[socket.id].rotation = data.rotation;
            
            // Пересылаем всем, кроме отправителя
            socket.broadcast.emit('playerMoved', {
                id: socket.id,
                ...data
            });
        }
    });
    
    // Положить камень в сундук
    socket.on('placeStone', (data) => {
        const player = gameState.players[socket.id];
        const chest = gameState.chests[data.chestId];
        
        if (player && chest && player.stones > 0) {
            // Уменьшаем камни у игрока
            player.stones--;
            
            // Увеличиваем камни в сундуке
            chest.stones++;
            
            // Отправляем обновление всем
            io.emit('stonePlaced', {
                playerId: socket.id,
                chestId: data.chestId,
                stonesLeft: player.stones,
                chestStones: chest.stones
            });
            
            // Обновляем состояние сундука
            io.emit('chestUpdate', {
                id: data.chestId,
                stones: chest.stones
            });
            
            console.log(`Игрок ${player
