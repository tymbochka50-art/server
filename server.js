const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// ==================== КРИТИЧЕСКИ ВАЖНО: НАСТРОЙКА CORS ====================
// ✅ Разрешаем подключения с вашего GitHub Pages сайта
const io = socketIO(server, {
    cors: {
        origin: [
            "https://tymbochka50-art.github.io",  // ⬅️ Ваш сайт на GitHub Pages
            "https://server-f0a1.onrender.com",   // ⬅️ Ваш сервер
            "http://localhost:3000",              // ⬅️ Локальная разработка
            "http://127.0.0.1:5500",              // ⬅️ Live Server (VS Code)
            "http://localhost:8080"               // ⬅️ Альтернативный порт
        ],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

// ✅ Настройка CORS для обычных HTTP запросов
app.use(cors({
    origin: [
        "https://tymbochka50-art.github.io",
        "https://server-f0a1.onrender.com",
        "http://localhost:3000",
        "http://127.0.0.1:5500",
        "http://localhost:8080"
    ],
    credentials: true
}));

app.use(express.json());

// ==================== КОНСТАНТЫ ====================
const PORT = process.env.PORT || 3000;
const MAX_STONES = 5;

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
    const colors = ['#FF6B6B', '#4ECDC4', '#FFD166', '#06D6A0', '#118AB2', '#EF476F'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function updateOnlineCount() {
    gameState.onlineCount = Object.keys(gameState.players).length;
    io.emit('onlineCount', gameState.onlineCount);
    console.log(`👥 Онлайн игроков: ${gameState.onlineCount}`);
}

// ==================== API ЭНДПОИНТЫ ====================
// ✅ Health Check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        players: gameState.onlineCount,
        uptime: Math.floor((new Date() - gameState.startedAt) / 1000),
        timestamp: new Date().toISOString()
    });
});

// ✅ Статус сервера
app.get('/status', (req, res) => {
    res.json({
        online: true,
        players: gameState.onlineCount,
        uptime: Math.floor((new Date() - gameState.startedAt) / 1000),
        version: '1.0.0',
        serverTime: new Date().toISOString(),
        allowedOrigins: [
            "https://tymbochka50-art.github.io",
            "https://server-f0a1.onrender.com"
        ]
    });
});

// ✅ Список игроков
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

// ✅ Сброс сундуков
app.post('/reset-chests', (req, res) => {
    Object.keys(gameState.chests).forEach(key => {
        gameState.chests[key].stones = 0;
    });
    io.emit('chestsReset', gameState.chests);
    res.json({ message: 'Сундуки сброшены', chests: gameState.chests });
});

// ✅ Корневой эндпоинт
app.get('/', (req, res) => {
    res.json({
        message: '🎮 Game Server is running!',
        endpoints: {
            health: '/health',
            status: '/status',
            players: '/players',
            docs: 'Check console for Socket.io events'
        },
        server: 'https://server-f0a1.onrender.com',
        client: 'https://tymbochka50-art.github.io'
    });
});

// ==================== SOCKET.IO СОБЫТИЯ ====================
io.on('connection', (socket) => {
    console.log(`🔗 Новое подключение: ${socket.id}`);
    
    // 📌 1. ИНИЦИАЛИЗАЦИЯ ИГРОКА
    socket.on('initPlayer', (data) => {
        const username = data.username || `Игрок_${socket.id.substring(0, 5)}`;
        
        gameState.players[socket.id] = {
            x: Math.random() * 30 - 15,
            y: 1,
            z: Math.random() * 30 - 15,
            rotation: Math.random() * Math.PI * 2,
            username: username,
            color: getRandomColor(),
            stones: MAX_STONES,
            connectedAt: new Date(),
            lastActive: new Date()
        };
        
        const player = gameState.players[socket.id];
        console.log(`🎮 ${username} присоединился к игре (${socket.id})`);
        
        // 1. Отправляем данные новому игроку
        socket.emit('initGame', {
            playerId: socket.id,
            ...player,
            chests: gameState.chests,
            otherPlayers: Object.keys(gameState.players)
                .filter(id => id !== socket.id)
                .reduce((acc, id) => {
                    acc[id] = {
                        x: gameState.players[id].x,
                        y: gameState.players[id].y,
                        z: gameState.players[id].z,
                        rotation: gameState.players[id].rotation,
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
            rotation: player.rotation,
            username: player.username,
            color: player.color,
            stones: player.stones
        });
        
        // 3. Обновляем счетчик
        updateOnlineCount();
    });
    
    // 📌 2. ДВИЖЕНИЕ ИГРОКА
    socket.on('playerMove', (data) => {
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].x = data.x;
            gameState.players[socket.id].y = data.y;
            gameState.players[socket.id].z = data.z;
            gameState.players[socket.id].rotation = data.rotation;
            gameState.players[socket.id].lastActive = new Date();
            
            socket.broadcast.emit('playerMoved', {
                id: socket.id,
                ...data
            });
        }
    });
    
    // 📌 3. ПОЛОЖИТЬ КАМЕНЬ В СУНДУК
    socket.on('placeStone', (data) => {
        const player = gameState.players[socket.id];
        const chest = gameState.chests[data.chestId];
        
        if (player && chest && player.stones > 0) {
            player.stones--;
            chest.stones++;
            
            console.log(`💎 ${player.username} положил камень в ${data.chestId}`);
            
            socket.emit('stonePlaced', {
                chestId: data.chestId,
                stonesLeft: player.stones,
                chestStones: chest.stones
            });
            
            io.emit('chestUpdate', {
                id: data.chestId,
                stones: chest.stones
            });
            
            socket.broadcast.emit('playerInventoryUpdate', {
                id: socket.id,
                stones: player.stones
            });
        }
    });
    
    // 📌 4. ЗАПРОС ОНЛАЙН СЧЕТЧИКА
    socket.on('getOnlineCount', () => {
        socket.emit('onlineCount', gameState.onlineCount);
    });
    
    // 📌 5. ВОССТАНОВЛЕНИЕ КАМНЕЙ
    socket.on('refillStones', () => {
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].stones = MAX_STONES;
            socket.emit('stonesRefilled', { stones: MAX_STONES });
        }
    });
    
    // 📌 6. ОТКЛЮЧЕНИЕ ИГРОКА
    socket.on('disconnect', () => {
        if (gameState.players[socket.id]) {
            const username = gameState.players[socket.id].username;
            console.log(`👋 ${username} покинул игру`);
            
            socket.broadcast.emit('playerLeft', socket.id);
            delete gameState.players[socket.id];
            updateOnlineCount();
        }
    });
});

// ==================== АВТООЧИСТКА НЕАКТИВНЫХ ====================
setInterval(() => {
    const now = new Date();
    const INACTIVE_LIMIT = 10 * 60 * 1000;
    
    Object.keys(gameState.players).forEach(id => {
        if (now - gameState.players[id].lastActive > INACTIVE_LIMIT) {
            console.log(`🕐 Удаляем неактивного игрока: ${gameState.players[id].username}`);
            io.emit('playerLeft', id);
            delete gameState.players[id];
            updateOnlineCount();
        }
    });
}, 5 * 60 * 1000);

// ==================== ЗАПУСК СЕРВЕРА ====================
server.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(50));
    console.log(`✅ Game Server запущен!`);
    console.log(`📍 URL: https://server-f0a1.onrender.com`);
    console.log(`📍 Порт: ${PORT}`);
    console.log(`📍 GitHub Pages: https://tymbochka50-art.github.io`);
    console.log(`📊 Health: /health`);
    console.log(`📈 Status: /status`);
    console.log('='.repeat(50));
});

// ==================== GRACEFUL SHUTDOWN ====================
process.on('SIGTERM', () => {
    console.log('🔄 Получен SIGTERM, завершаем работу...');
    io.emit('serverShutdown', { 
        message: 'Сервер выключается',
        timestamp: new Date().toISOString() 
    });
    
    setTimeout(() => {
        server.close(() => {
            console.log('🔴 Сервер остановлен');
            process.exit(0);
        });
    }, 1000);
});
