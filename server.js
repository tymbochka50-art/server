const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// ✅ КРИТИЧЕСКИ ВАЖНО: Настройка CORS для Socket.IO
// После деплоя замените адреса на ваши реальные URL с Render
const io = socketIO(server, {
    cors: {
        origin: [
            "https://your-game-website.onrender.com", // Адрес вашего сайта на Render
            "http://localhost:3000" // Для локальной разработки
        ],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'] // Улучшает совместимость
});

// ✅ Настройка CORS middleware для обычных HTTP запросов
app.use(cors({
    origin: [
        "https://your-game-website.onrender.com",
        "http://localhost:3000"
    ],
    credentials: true
}));

app.use(express.json());

// ✅ Важно для Render: Используем порт из переменной окружения
const PORT = process.env.PORT || 3000;

// Состояние игры
const gameState = {
    players: {}, // { socketId: { x, y, z, rotation, username, color, stones: 5 } }
    chests: {
        chest1: { stones: 0, position: { x: 10, z: 10 } },
        chest2: { stones: 0, position: { x: -10, z: 10 } },
        chest3: { stones: 0, position: { x: 10, z: -10 } },
        chest4: { stones: 0, position: { x: -10, z: -10 } }
    },
    startedAt: new Date(),
    maxStonesPerPlayer: 5
};

// Генерация случайного цвета для игрока
function getRandomColor() {
    const colors = [
        '#3498db', '#e74c3c', '#2ecc71', '#f1c40f',
        '#9b59b6', '#1abc9c', '#d35400', '#34495e'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// API эндпоинты
app.get('/status', (req, res) => {
    res.json({
        online: true,
        players: Object.keys(gameState.players).length,
        uptime: Math.floor((new Date() - gameState.startedAt) / 1000),
        version: '1.0.0',
        serverTime: new Date().toISOString()
    });
});

app.get('/players', (req, res) => {
    // Возвращаем только публичные данные об игроках
    const publicPlayers = {};
    Object.keys(gameState.players).forEach(id => {
        const player = gameState.players[id];
        publicPlayers[id] = {
            x: player.x,
            y: player.y,
            z: player.z,
            rotation: player.rotation,
            username: player.username,
            color: player.color,
            stones: player.stones
        };
    });
    res.json(publicPlayers);
});

app.get('/chests', (req, res) => {
    res.json(gameState.chests);
});

// Health check для Render
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        players: Object.keys(gameState.players).length,
        uptime: Math.floor((new Date() - gameState.startedAt) / 1000)
    });
});

// Socket.io события
io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);
    
    // Инициализация игрока
    socket.on('initPlayer', (data) => {
        const { username } = data;
        
        // Создаем нового игрока
        gameState.players[socket.id] = {
            x: Math.random() * 20 - 10, // Случайная позиция на карте
            y: 1,
            z: Math.random() * 20 - 10,
            rotation: 0,
            username: username || `Игрок_${socket.id.substring(0, 4)}`,
            color: getRandomColor(),
            stones: gameState.maxStonesPerPlayer,
            connectedAt: new Date(),
            lastUpdate: new Date()
        };
        
        const player = gameState.players[socket.id];
        
        console.log(`Игрок ${player.username} присоединился к игре`);
        
        // Отправляем текущее состояние новому игроку
        socket.emit('initGame', {
            playerId: socket.id,
            x: player.x,
            y: player.y,
            z: player.z,
            rotation: player.rotation,
            username: player.username,
            color: player.color,
            stones: player.stones,
            chests: gameState.chests,
            otherPlayers: Object.keys(gameState.players)
                .filter(id => id !== socket.id)
                .reduce((obj, id) => {
                    obj[id] = {
                        x: gameState.players[id].x,
                        y: gameState.players[id].y,
                        z: gameState.players[id].z,
                        rotation: gameState.players[id].rotation,
                        username: gameState.players[id].username,
                        color: gameState.players[id].color,
                        stones: gameState.players[id].stones
                    };
                    return obj;
                }, {})
        });
        
        // Сообщаем всем остальным игрокам о новом игроке
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
        
        // Обновляем счетчик онлайн для всех
        updateOnlineCount();
    });
    
    // Движение игрока
    socket.on('playerMove', (data) => {
        if (gameState.players[socket.id]) {
            // Обновляем позицию игрока
            gameState.players[socket.id].x = data.x;
            gameState.players[socket.id].y = data.y;
            gameState.players[socket.id].z = data.z;
            gameState.players[socket.id].rotation = data.rotation;
            gameState.players[socket.id].lastUpdate = new Date();
            
            // Пересылаем движение всем остальным игрокам
            socket.broadcast.emit('playerMoved', {
                id: socket.id,
                x: data.x,
                y: data.y,
                z: data.z,
                rotation: data.rotation
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
            
            console.log(`Игрок ${player.username} положил камень в ${data.chestId}. Осталось камней: ${player.stones}`);
            
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
            
            // Сообщаем всем об обновлении инвентаря игрока
            socket.broadcast.emit('playerInventoryUpdate', {
                id: socket.id,
                stones: player.stones
            });
        }
    });
    
    // Запрос количества онлайн игроков
    socket.on('getOnlineCount', () => {
        socket.emit('onlineCount', Object.keys(gameState.players).length);
    });
    
    // Запрос на возобновление камней (для тестирования)
    socket.on('refillStones', () => {
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].stones = gameState.maxStonesPerPlayer;
            
            socket.emit('stonesRefilled', {
                stones: gameState.players[socket.id].stones
            });
            
            console.log(`Игроку ${gameState.players[socket.id].username} восстановлены камни`);
        }
    });
    
    // Отключение игрока
    socket.on('disconnect', () => {
        console.log('Отключился:', socket.id);
        
        if (gameState.players[socket.id]) {
            const username = gameState.players[socket.id].username;
            
            // Сообщаем всем об отключении
            socket.broadcast.emit('playerLeft', socket.id);
            
            // Удаляем игрока из состояния
            delete gameState.players[socket.id];
            
            console.log(`Игрок ${username} покинул игру`);
            
            // Обновляем счетчик онлайн
            updateOnlineCount();
        }
    });
    
    // Обработка ошибок
    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });
});

// Функция обновления счетчика онлайн для всех клиентов
function updateOnlineCount() {
    const count = Object.keys(gameState.players).length;
    io.emit('onlineCount', count);
}

// Очистка неактивных игроков (каждые 5 минут)
setInterval(() => {
    const now = new Date();
    const inactiveTime = 5 * 60 * 1000; // 5 минут
    
    Object.keys(gameState.players).forEach(id => {
        const player = gameState.players[id];
        if (now - player.lastUpdate > inactiveTime) {
            console.log(`Удаляем неактивного игрока: ${player.username}`);
            delete gameState.players[id];
            io.emit('playerLeft', id);
            updateOnlineCount();
        }
    });
}, 5 * 60 * 1000); // Проверка каждые 5 минут

// ✅ КРИТИЧЕСКИ ВАЖНО: Привязываем сервер к `0.0.0.0`, а не `localhost`
// Это необходимо для работы на облачном хостинге
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Game server is running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Status API: http://localhost:${PORT}/status`);
    console.log(`📊 Players API: http://localhost:${PORT}/players`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Получен SIGTERM, завершаем работу...');
    
    // Уведомляем всех игроков о выключении сервера
    io.emit('serverShutdown', {
        message: 'Сервер выключается для обслуживания',
        timestamp: new Date().toISOString()
    });
    
    // Даем время на отправку сообщений
    setTimeout(() => {
        server.close(() => {
            console.log('Сервер остановлен');
            process.exit(0);
        });
    }, 1000);
});
