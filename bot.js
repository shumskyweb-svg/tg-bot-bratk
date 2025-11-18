const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());


const TOKEN = '8574660959:AAFTDSspkRCwBQhNdqL96tzhW9IICHsOQPA';
// ID канала, на который нужно подписаться
const CHANNEL_ID = '@bratikpiratik';
// ID администратора
const ADMIN_ID = 549383359; // Ваш Telegram ID

// Инициализация бота
const bot = new TelegramBot(TOKEN, { polling: true });

// Инициализация базы данных
const db = new sqlite3.Database('./loyalty.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id INTEGER UNIQUE,
        phone TEXT UNIQUE,
        loyalty_code TEXT UNIQUE,
        registration_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
}

// Генерация случайного кода
function generateLoyaltyCode() {
    let code = '';
    for (let i = 0; i < 5; i++) {
        code += Math.floor(Math.random() * 10);
    }
    return code;
}

// Проверка подписки на канал
async function checkChannelSubscription(userId) {
    try {
        const chatMember = await bot.getChatMember(CHANNEL_ID, userId);
        console.log(chatMember, 'chatMember')
        return ['member', 'administrator', 'creator'].includes(chatMember.status);
    } catch (error) {
        console.error('Error checking subscription:', error);
        return false;
    }
}

// Основной обработчик бота
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Проверяем подписку на канал
    const isSubscribed = await checkChannelSubscription(userId);
    // const isSubscribed = true;
    if (!isSubscribed) {
        bot.sendMessage(chatId,
            `📢 Для участия в программе лояльности необходимо подписаться на наш канал: ${CHANNEL_ID}\n\n` +
            `После подписки отправьте команду /start снова.`
        );
        return;
    }

    // Проверяем, зарегистрирован ли пользователь
    db.get('SELECT * FROM users WHERE telegram_id = ?', [userId], async (err, row) => {
        if (err) {
            bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
            return;
        }

        if (!row) {
            // Пользователь не зарегистрирован - запрашиваем номер телефона
            const opts = {
                reply_markup: {
                    keyboard: [
                        [{
                            text: '📱 Отправить номер телефона',
                            request_contact: true
                        }]
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            };

            bot.sendMessage(chatId,
                `🏴‍☠️ *Добро пожаловать на борт, Братик Пиратик!* 🍻\n\n` +
                `НАЖМИ ОТПРАВИТЬ НОМЕР ТЕЛЕФОНА ⬇️⬇️⬇️ \n\n под клавиатурой и получи код лояльности ⬇️⬇️⬇️\n\n` +
                `*Что умеет этот бот:*\n` +
                `🚀 /start - Главное меню\n` +
                `🎯 /mycode - Мой код лояльности\n` +
                `❓ /help - Помощь и инструкции\n\n` ,
                opts
            );
        } else {
            // Пользователь уже зарегистрирован - показываем существующий код
            bot.sendMessage(chatId,
                `✅ Вы уже зарегистрированы в программе лояльности!\n\n` +
                `📱 Ваш номер: ${row.phone}\n` +
                `🎯 Ваш постоянный код: **${row.loyalty_code}**\n\n` +
                `⚠️ Этот код постоянный и не меняется!\n` +
                `Показывайте его на кассе при каждой покупке.`
            );
        }
    });
});

// Обработчик получения контакта
bot.on('contact', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    let phone = msg.contact.phone_number;

    // Нормализуем номер телефона (удаляем все нецифровые символы)
    phone = phone.replace(/\D/g, '');

    // Проверяем длину номера (должно быть 11 цифр, начиная с 7 или 8)
    if (phone.length !== 11) {
        bot.sendMessage(chatId, '❌ Неверный формат номера. Номер должен содержать 11 цифр (например, 79617712900)');
        return;
    }

    // Если номер начинается с 8, меняем на 7
    if (phone.startsWith('8')) {
        phone = '7' + phone.substring(1);
    } else if (!phone.startsWith('7')) {
        phone = '7' + phone;
    }

    // Проверяем подписку
    const isSubscribed = await checkChannelSubscription(userId);
    // const isSubscribed = true;
    if (!isSubscribed) {
        bot.sendMessage(chatId,
            `❌ Для регистрации необходимо быть подписанным на канал: ${CHANNEL_ID}`
        );
        return;
    }

    // Проверяем, что контакт принадлежит пользователю
    if (msg.contact.user_id !== userId) {
        bot.sendMessage(chatId, '❌ Пожалуйста, поделитесь своим номером телефона.');
        return;
    }

    // Проверяем, не зарегистрирован ли уже этот номер
    db.get('SELECT * FROM users WHERE phone = ?', [phone], (err, existingUser) => {
        if (err) {
            bot.sendMessage(chatId, '❌ Ошибка при регистрации. Попробуйте позже.');
            return;
        }

        if (existingUser) {
            bot.sendMessage(chatId,
                '❌ Этот номер телефона уже зарегистрирован в системе.\n\n' +
                'Если это ваш номер, но вы не получали код, обратитесь к администратору.'
            );
            return;
        }

        // Генерируем уникальный код
        let code;
        let isUnique = false;

        const generateUniqueCode = () => {
            return new Promise((resolve, reject) => {
                const generateCode = () => {
                    code = generateLoyaltyCode();

                    // Проверяем уникальность кода
                    db.get('SELECT * FROM users WHERE loyalty_code = ?', [code], (err, row) => {
                        if (err) {
                            reject(err);
                            return;
                        }

                        if (!row) {
                            resolve(code);
                        } else {
                            // Если код не уникален, генерируем снова
                            generateCode();
                        }
                    });
                };

                generateCode();
            });
        };

        // Сохраняем пользователя с кодом
        generateUniqueCode().then(uniqueCode => {
            db.run('INSERT INTO users (telegram_id, phone, loyalty_code) VALUES (?, ?, ?)',
                [userId, phone, uniqueCode],
                function(err) {
                    if (err) {
                        bot.sendMessage(chatId, '❌ Ошибка при регистрации. Попробуйте позже.');
                        return;
                    }

                    bot.sendMessage(chatId,
                        '✅ Регистрация успешно завершена!\n\n' +
                        `📱 Ваш номер: ${phone}\n` +
                        `🎯 Ваш постоянный код: **${uniqueCode}**\n\n` +
                        `⚠️ Код больше не изменится.\n` +
                        `Показывайте его на кассе при каждой покупке для получения бонусов.\n\n` +
                        `Для просмотра кода отправьте /start`
                    );
                }
            );
        }).catch(error => {
            bot.sendMessage(chatId, '❌ Ошибка при генерации кода. Попробуйте позже.');
        });
    });
});

// Команда для поиска пользователя по коду (для кассы)
bot.onText(/\/code (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const code = match[1].toUpperCase();

    // Ищем пользователя по коду
    db.get('SELECT * FROM users WHERE loyalty_code = ?', [code], (err, user) => {
        if (err) {
            bot.sendMessage(chatId, '❌ Ошибка при поиске кода.');
            return;
        }

        if (!user) {
            bot.sendMessage(chatId, '❌ Код не найден.');
            return;
        }

        bot.sendMessage(chatId,
            `✅ Код найден!\n\n` +
            `📱 Телефон: ${user.phone}\n` +
            `🎯 Код: ${user.loyalty_code}\n` +
            `📅 Дата регистрации: ${new Date(user.registration_date).toLocaleDateString('ru-RU')}\n` +
            `👤 ID: ${user.telegram_id}`
        );
    });
});
bot.onText(/\/mycode/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Проверяем, зарегистрирован ли пользователь
    db.get('SELECT * FROM users WHERE telegram_id = ?', [userId], (err, row) => {
        if (err) {
            bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
            return;
        }

        if (!row) {
            bot.sendMessage(chatId,
                '❌ Вы еще не зарегистрированы в программе лояльности.\n\n' +
                'Для регистрации отправьте команду /start'
            );
            return;
        }

        // Показываем код пользователя
        bot.sendMessage(chatId,
            `🎯 **Ваш код лояльности:**\n\n` +
            `📱 Номер: ${row.phone}\n` +
            `🔢 Код: **${row.loyalty_code}**\n\n` +
            `⚠️ Показывайте этот код на кассе при каждой покупке для накопления бонусов!`
        );
    });
});
// Команда для поиска пользователя по телефону (для кассы)
bot.onText(/\/tel (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const phone = match[1];

    // Ищем пользователя по телефону
    db.get('SELECT * FROM users WHERE phone = ?', [phone], (err, user) => {
        if (err) {
            bot.sendMessage(chatId, '❌ Ошибка при поиске телефона.');
            return;
        }

        if (!user) {
            bot.sendMessage(chatId, '❌ Телефон не найден.');
            return;
        }

        bot.sendMessage(chatId,
            `✅ Пользователь найден!\n\n` +
            `📱 Телефон: ${user.phone}\n` +
            `🎯 Код: ${user.loyalty_code}\n` +
            `📅 Дата регистрации: ${new Date(user.registration_date).toLocaleDateString('ru-RU')}\n` +
            `👤 ID: ${user.telegram_id}`
        );
    });
});

// Команда для просмотра всех пользователей (только для админов)
bot.onText(/\/users/, (msg) => {
    const chatId = msg.chat.id;

    // Здесь можно добавить проверку на администратора
    // if (msg.from.id !== ADMIN_ID) return;

    db.all('SELECT phone, loyalty_code, registration_date FROM users ORDER BY registration_date DESC', (err, rows) => {
        if (err) {
            bot.sendMessage(chatId, '❌ Ошибка при получении списка пользователей.');
            return;
        }

        if (rows.length === 0) {
            bot.sendMessage(chatId, '📝 Пользователей пока нет.');
            return;
        }

        let message = `📊 Всего пользователей: ${rows.length}\n\n`;

        rows.forEach((user, index) => {
            message += `${index + 1}. ${user.phone} - ${user.loyalty_code}\n`;
        });

        bot.sendMessage(chatId, message);
    });
});

// Команда помощи
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(chatId,
        `🍻 **Пивной Бар - Программа лояльности**\n\n` +
        `📌 Доступные команды:\n` +
        `/start - Начать регистрацию или посмотреть свой код\n` +
        `/help - Показать это сообщение\n\n` +
        `⚠️ **Важно:**\n` +
        `• Код создается один раз и не меняется\n` +
        `• Подписка на канал обязательна\n` +
        `• Один номер = один код`
    );
});
bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
    if (msg.from.id !== ADMIN_ID) {
        bot.sendMessage(msg.chat.id, '❌ Нет прав.').catch(console.error);
        return;
    }
    bot.sendMessage(chatId,
        `🎯 **Для кассы:**\n` +
        `/code CODE - Найти пользователя по коду\n` +
        `/phone PHONE - Найти пользователя по телефону\n` +
        `/users - Показать всех пользователей (админ)\n\n`
    );
});

// Веб-сервер для здоровья приложения
app.get('/', (req, res) => {
    res.json({ status: 'Bot is running', timestamp: new Date() });
});

// API endpoint для проверки кода (для интеграции с кассой)
app.get('/api/check-code/:code', (req, res) => {
    const code = req.params.code.toUpperCase();

    db.get('SELECT phone, loyalty_code, registration_date FROM users WHERE loyalty_code = ?', [code], (err, user) => {
        if (err) {
            res.json({ success: false, error: 'Database error' });
            return;
        }

        if (!user) {
            res.json({ success: false, error: 'Code not found' });
            return;
        }

        res.json({
            success: true,
            phone: user.phone,
            code: user.loyalty_code,
            registration_date: user.registration_date
        });
    });
});

// Запуск веб-сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Web server running on port ${PORT}`);
});

console.log('🍻 Beer Bar Loyalty Bot started!');