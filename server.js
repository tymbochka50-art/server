const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// ==================== КРИТИЧЕСКО ВАЖНО: CORS ====================
const io = socketIO(server, {
    cors: {
        origin: "*", // Разрешаем все для тестирования
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

app.use(cors({
    origin: "*",
    credentials: true
}));

app.use(express.json());

// ==================== КОНСТАНТЫ ====================
const PORT = process.env.PORT || 10000;
const MAX_STONES = 5;
const WORLD_SIZE = 50;

// ==================== СОСТОЯНИЕ ИГРЫ ====================
const gameState = {
    players: {},
    chests: {
        chest1: { stones: 0, position: { x: 10, z: 10 } },
        chest2: { stones: 0, position: { x: -10, z: 10 } },
        chest3: { stones: 0, position: { x: 10, z: -10 } },
        chest4: { stones: 0, position: { x: -10, z: -10 } }
    },
    startedAt: new Date(),
    onlineCount: 0
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function getRandomColor() {
    const colors = [
        '#FF6B6B', '#4ECDC4', '#FFD166', '#06D6A0', 
        '#118AB2', '#EF476F', '#9B59B6', '#1ABC9C'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

function broadcastOnlineCount() {
    const count = Object.keys(gameState.players).length;
    gameState.onlineCount = count;
    io.emit('onlineCount', count);
}

function broadcastServerStatus() {
    const status = {
        online: true,
        players: gameState.onlineCount,
        uptime: Math.floor((new Date() - gameState.startedAt) / 1000),
        version: '1.0.0',
        serverTime: new Date().toISOString()
    };
    io.emit('serverStatus', status);
}

// ==================== API ЭНДПОИНТЫ ====================
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        players: gameState.onlineCount,
        uptime: Math.floor((new Date() - gameState.startedAt) / 1000),
        timestamp: new Date().toISOString()
    });
});

app.get('/status', (req, res) => {
    res.json({
        online: true,
        players: gameState.onlineCount,
        uptime: Math.floor((new Date() - gameState.startedAt) / 1000),
        version: '1.0.0',
        serverTime: new Date().toISOString()
    });
});

app.get('/players', (req, res) => {
    const playersList = Object.keys(gameState.players).map(id => ({
        id,
        username: gameState.players[id].username,
        x: gameState.players[id].x,
        z: gameState.players[id].z,
        stones: gameState.players[id].stones,
        color: gameState.players[id].color
    }));
    res.json({ players: playersList, count: playersList.length });
});

app.get('/chests', (req, res) => {
    res.json(gameState.chests);
});

// ==================== SOCKET.IO СОБЫТИЯ ====================
io.on('connection', (socket) => {
    console.log(`🔗 Новый игрок подключился: ${socket.id}`);
    
    // 📌 ИНИЦИАЛИЗАЦИЯ ИГРОКА
    socket.on('initPlayer', (data) => {
        const username = data.username || `Игрок_${socket.id.substring(0, 4)}`;
        
        // Создаем игрока
        gameState.players[socket.id] = {
            x: Math.random() * 40 - 20,
            y: 1,
            z: Math.random() * 40 - 20,
            username: username,
            color: getRandomColor(),
            stones: MAX_STONES,
            connectedAt: new Date(),
            lastUpdate: new Date()
        };
        
        const player = gameState.players[socket.id];
        console.log(`🎮 ${username} вошел в игру (${socket.id})`);
        
        // 1. Отправляем данные новому игроку
        socket.emit('initGame', {
            playerId: socket.id,
            x: player.x,
            y: player.y,
            z: player.z,
            username: player.username,
            color: player.color,
            stones: player.stones,
            chests: gameState.chests,
            otherPlayers: Object.keys(gameState.players)
                .filter(id => id !== socket.id)
                .reduce((acc, id) => {
                    acc[id] = {
                        id: id,
                        x: gameState.players[id].x,
                        y: gameState.players[id].y,
                        z: gameState.players[id].z,
                        username: gameState.players[id].username,
                        color: gameState.players[id].color,
                        stones: gameState.players[id].stones
                    };
                    return acc;
                }, {})
        });
        
        // 2. Сообщаем всем о новом игроке
        socket.broadcast.emit('playerJoined', {
            id: socket.id,
            x: player.x,
            y: player.y,
            z: player.z,
            username: player.username,
            color: player.color,
            stones: player.stones
        });
        
        // 3. Обновляем счетчики
        broadcastOnlineCount();
        broadcastServerStatus();
    });
    
    // 📌 ДВИЖЕНИЕ ИГРОКА
    socket.on('playerMove', (data) => {
        if (gameState.players[socket.id]) {
            // Обновляем позицию
            gameState.players[socket.id].x = data.x;
            gameState.players[socket.id].y = data.y;
            gameState.players[socket.id].z = data.z;
            gameState.players[socket.id].lastUpdate = new Date();
            
            // Пересылаем всем остальным
            socket.broadcast.emit('playerMoved', {
                id: socket.id,
                x: data.x,
                y: data.y,
                z: data.z
            });
        }
    });
    
    // 📌 ПОЛОЖИТЬ КАМЕНЬ В СУНДУК
    socket.on('placeStone', (data) => {
        const player = gameState.players[socket.id];
        const chest = gameState.chests[data.chestId];
        
        if (player && chest && player.stones > 0) {
            // Обновляем камни
            player.stones--;
            chest.stones++;
            
            console.log(`💎 ${player.username} положил камень в ${data.chestId}`);
            
            // Отправляем подтверждение игроку
            socket.emit('stonePlaced', {
                chestId: data.chestId,
                stonesLeft: player.stones,
                chestStones: chest.stones
            });
            
            // Сообщаем всем об обновлении сундука
            io.emit('chestUpdate', {
                id: data.chestId,
                stones: chest.stones
            });
            
            // Обновляем инвентарь для других игроков
            socket.broadcast.emit('playerInventoryUpdate', {
                id: socket.id,
                stones: player.stones
            });
        }
    });
    
    // 📌 ОБНОВЛЕНИЕ СТАТУСА
    socket.on('getStatus', () => {
        socket.emit('serverStatus', {
            online: true,
            players: gameState.onlineCount,
            uptime: Math.floor((new Date() - gameState.startedAt) / 1000)
        });
    });
    
    // 📌 ОТКЛЮЧЕНИЕ ИГРОКА
    socket.on('disconnect', () => {
        if (gameState.players[socket.id]) {
            const username = gameState.players[socket.id].username;
            console.log(`👋 ${username} покинул игру`);
            
            // Уведомляем всех
            socket.broadcast.emit('playerLeft', socket.id);
            
            // Удаляем игрока
            delete gameState.players[socket.id];
            
            // Обновляем счетчики
            broadcastOnlineCount();
            broadcastServerStatus();
        }
    });
});

// ==================== АВТООЧИСТКА НЕАКТИВНЫХ ====================
setInterval(() => {
    const now = new Date();
    const INACTIVE_LIMIT = 30 * 1000; // 30 секунд
    
    Object.keys(gameState.players).forEach(id => {
        if (now - gameState.players[id].lastUpdate > INACTIVE_LIMIT) {
            console.log(`🕐 Удаляем неактивного игрока: ${gameState.players[id].username}`);
            io.emit('playerLeft', id);
            delete gameState.players[id];
            broadcastOnlineCount();
            broadcastServerStatus();
        }
    });
}, 10 * 1000); // Проверка каждые 10 секунд

// ==================== АВТООБНОВЛЕНИЕ СТАТУСА ====================
setInterval(() => {
    broadcastServerStatus();
}, 5000); // Каждые 5 секунд

// ==================== ЗАПУСК СЕРВЕРА ====================
server.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(50));
    console.log(`✅ Game Server запущен!`);
    console.log(`📍 URL: https://server-f0a1.onrender.com`);
    console.log(`📍 Порт: ${PORT}`);
    console.log(`📊 Health: /health`);
    console.log(`📈 Status: /status`);
    console.log(`👥 Players: /players`);
    console.log(`🧰 Chests: /chests`);
    console.log('='.repeat(50));
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🔄 Получен SIGTERM, завершаем работу...');
    
    // Уведомляем игроков
    io.emit('serverShutdown', { 
        message: 'Сервер выключается для обслуживания',
        timestamp: new Date().toISOString() 
    });
    
    setTimeout(() => {
        server.close(() => {
            console.log('🔴 Сервер остановлен');
            process.exit(0);
        });
    }, 1000);
});
