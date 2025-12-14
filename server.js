const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// ✅ КРИТИЧЕСКИ ВАЖНО: Настройка CORS для Socket.IO
// Указываем конкретные адреса, с которых можно подключаться
const io = socketIO(server, {
    cors: {
        origin: [
            "https://your-game-website.onrender.com", // Адрес сайта на Render
            "http://localhost:3000" // Для локальной разработки
        ],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'] // Улучшает совместимость
});

// ✅ КРИТИЧЕСКИ ВАЖНО: Настройка CORS middleware для обычных HTTP запросов
app.use(cors({
    origin: [
        "https://your-game-website.onrender.com",
        "http://localhost:3000"
    ],
    credentials: true
}));

// ✅ Важно для Render: Используем порт из переменной окружения
const PORT = process.env.PORT || 3000;

// ✅ КРИТИЧЕСКИ ВАЖНО: Привязываем сервер к `0.0.0.0`, а не `localhost`
// Это необходимо для работы на облачном хостинге[citation:5]
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Game server is running on port ${PORT}`);
});

// --- Далее следует логика игры из вашего предыдущего кода ---
// (Здесь должен быть ваш основной код: состояние игры, обработка socket.io событий и т.д.)
// -----------------------------------------------------------------
// Пример структуры. Вставьте сюда ваш полный код из предыдущего шага,
// начиная с раздела "Состояние игры" (gameState, players, chests...)

const gameState = {
    players: {},
    chests: {
        chest1: { stones: 0, position: { x: 10, z: 10 } },
        chest2: { stones: 0, position: { x: -10, z: 10 } },
        chest3: { stones: 0, position: { x: 10, z: -10 } },
        chest4: { stones: 0, position: { x: -10, z: -10 } }
    }
};

io.on('connection', (socket) => {
    console.log('Новый игрок подключился:', socket.id);

    // ... здесь ваша логика инициализации игрока, движения, размещения камней ...

    socket.on('disconnect', () => {
        console.log('Игрок отключился:', socket.id);
        delete gameState.players[socket.id];
        socket.broadcast.emit('playerLeft', socket.id);
    });
});

// Простой эндпоинт для проверки здоровья сервера (Health Check)[citation:5]
app.get('/health', (req, res) => {
    res.json({ status: 'ok', players: Object.keys(gameState.players).length });
});
// -----------------------------------------------------------------
