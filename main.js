const token = '7533939766:AAE7nhfRlTnaZmdCzkMIflTl4yAJ1gDDswE'
import { Telegraf, Markup } from 'telegraf';
const webAppUrl = 'https://shelter-mini-app.web.app';
const bot = new Telegraf(token);
import { scheduleJob, cancelJob, RecurrenceRule } from 'node-schedule';

// Хранилище ID сообщений
const messageStorage = {
  startMessages: {},
  infoMessages: {},
  mediaMessages: {}
};

const ADMIN_ID = 1316112504;
const ADMIN_PANEL_URL = 'https://shelter-mini-app.web.app/admin-panel'; // Ссылка на админ-панель

// База данных в памяти
const db = {
  users: {},
  notifications: [
    {
      id: 1,
      title: "Открытые двери",
      description: "Каждую субботу с 10:00 до 12:00 мы ждем вас на день открытых дверей познакомиться с нашими хвостиками!",
      date: "weekly-saturday",
      isActive: true
    }
  ]
};

const reminders = {
  jobs: {}, // Хранит активные задания планировщика
  list: []  // Список всех напоминаний
};

const userStates = {}; // Хранит состояние пользователей

// Инициализация пользователя
function initUser(userId) {
  if (!db.users[userId]) {
    db.users[userId] = {
      notificationsEnabled: true,
      subscribed: true
    };
  }
  return db.users[userId];
}

// Функция для создания клавиатуры уведомлений
function notificationsKeyboard(userId) {
  const user = initUser(userId);
  const notificationsEnabled = user.notificationsEnabled !== false;
  
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        notificationsEnabled ? '🔔 Рассылки: ВКЛ' : '🔕 Рассылки: ВЫКЛ', 
        'toggle_notifications'
      )
    ],
    [Markup.button.callback('◀️ Назад', 'back_to_start')]
  ]);
}

const cancelKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('❌ Отменить', 'cancel_report')]
]);

// Клавиатуры
const getMainKeyboard = (userId) => {
  const buttons = [
    [Markup.button.webApp('🐶 Каталог питомцев 🐱', `${webAppUrl}/shelter`)],
    [Markup.button.callback('🐕 Сообщить о животном 🐈', 'report_animal')],
    [Markup.button.callback('🐾 О приюте', 'shelter_info')],
    /*[Markup.button.callback('📝 Забрать питомца', 'adoption_info')],*/
    [Markup.button.callback('💬 Волонтеры', 'contact_curator')],
    [Markup.button.callback('🔔 Рассылки', 'notifications_settings')],
    [Markup.button.callback('❤️ Помощь приюту', 'donate')]
  ];

  if (userId === ADMIN_ID) {
    buttons.unshift([Markup.button.callback('👑 Админ', 'admin_menu')]);
  }

  return Markup.inlineKeyboard(buttons);
};

const adminKeyboard = Markup.inlineKeyboard([
  [Markup.button.webApp('📊 Админ-панель', ADMIN_PANEL_URL)],
  [Markup.button.callback('➕ Добавить напоминание', 'add_reminder')],
  [Markup.button.callback('🗑 Удалить напоминание', 'remove_reminder')],
  [Markup.button.callback('📢 Тестовая рассылка', 'test_broadcast')],
  [Markup.button.callback('◀️ Назад', 'back_to_start')]
]);

// Функция отправки стартового меню
async function sendStartMenu(ctx) {
  const text = `🐾 Добро пожаловать в Первоуральское Городское Общество Защиты Животных!\n\n` +
    `Этот бот поможет вам:\n\n` +
    `✅ Найти питомца по душе\n` +
    `✅ Узнать, как забрать животное или помочь приюту\n` +
    `✅ Связаться с волонтерами и получить советы\n\n` +
    `Наш приют находится в Первоуральске. Каждый питомец ищет свою семью — может, это именно вы?\n\n` +
    `👇 Выберите, что вас интересует:`;

  try {
    const sentMessage = await ctx.reply(text, getMainKeyboard(ctx.from.id));
    messageStorage.startMessages[ctx.chat.id] = sentMessage.message_id;
    
    if (messageStorage.infoMessages[ctx.chat.id]) {
      await ctx.deleteMessage(messageStorage.infoMessages[ctx.chat.id]).catch(() => {});
      delete messageStorage.infoMessages[ctx.chat.id];
    }
  } catch (e) {
    console.error('Ошибка при отправке стартового меню:', e);
  }
}

// Команда /start
bot.command('start', async (ctx) => {
  initUser(ctx.from.id);
  await sendStartMenu(ctx);
});

// Команда /notifications
bot.command('notifications', async (ctx) => {
  initUser(ctx.from.id);
  const sentMessage = await ctx.reply(
    '🔔 Настройки уведомлений:\n\nВы можете включить/выключить рассылку уведомлений о событиях приюта.',
    notificationsKeyboard(ctx.from.id)
  );
  
  if (messageStorage.infoMessages[ctx.chat.id]) {
    await ctx.deleteMessage(messageStorage.infoMessages[ctx.chat.id]).catch(() => {});
  }
  messageStorage.infoMessages[ctx.chat.id] = sentMessage.message_id;
});

// Обработчик админ-меню
bot.action('admin_menu', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) {
    await ctx.answerCbQuery('❌ Доступ запрещен');
    return;
  }

  await ctx.editMessageText('👑 Админ-панель управления:', adminKeyboard);
});

// Обработчик добавления напоминания
bot.action('add_reminder', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  userStates[ctx.from.id] = { step: 'awaiting_reminder_title' };
  await ctx.reply('Введите название события:');
});

bot.action(['reminder_once', 'reminder_weekly'], async (ctx) => {
  const userId = ctx.from.id;
  if (!userStates[userId]?.date) return;

  const isWeekly = ctx.callbackQuery.data === 'reminder_weekly';
  const date = userStates[userId].date;
  
  const newReminder = {
    id: Date.now(),
    title: userStates[userId].title,
    description: userStates[userId].description,
    date: date,
    isWeekly: isWeekly
  };

  // Создаем cron-выражение
  if (isWeekly) {
    const rule = new RecurrenceRule();
    rule.dayOfWeek = date.getDay(); // День недели 0-6 (вс-сб)
    rule.hour = date.getHours();
    rule.minute = date.getMinutes();
    newReminder.cron = rule;
  } else {
    newReminder.cron = `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;
  }

  // Добавляем напоминание
  reminders.list.push(newReminder);
  reminders.jobs[newReminder.id] = scheduleJob(newReminder.cron, () => {
    sendReminderNotification(newReminder);
  });

  delete userStates[userId];
  await ctx.editMessageText(
    `✅ Напоминание "${newReminder.title}" создано!\n` +
    `Тип: ${isWeekly ? 'еженедельное' : 'разовое'}\n` +
    `Дата: ${date.toLocaleString()}`,
    { reply_markup: { inline_keyboard: [[Markup.button.callback('◀️ В меню', 'admin_menu')]] }}
  );
});

// Обработчик текстовых сообщений для админа
bot.on('text', async (ctx) => {
  // Сначала проверяем, не админ ли это и не находится ли он в процессе создания напоминания
  if (ctx.from.id === ADMIN_ID && userStates[ctx.from.id] && userStates[ctx.from.id].step) {
    // Обработка для админа (создание напоминаний)
    const state = userStates[ctx.from.id];
    
    if (state.step === 'awaiting_reminder_title') {
      state.title = ctx.message.text;
      state.step = 'awaiting_reminder_description';
      await ctx.reply('Введите описание напоминания:');
    } 
    else if (state.step === 'awaiting_reminder_description') {
      state.description = ctx.message.text;
      state.step = 'awaiting_reminder_date';
      await ctx.reply('Введите дату и время в формате ДД.ММ.ГГГГ ЧЧ:ММ (например 25.12.2023 15:30):');
    }
    else if (state.step === 'awaiting_reminder_date') {
      try {
        const [datePart, timePart] = ctx.message.text.split(' ');
        const [day, month, year] = datePart.split('.').map(Number);
        const [hours, minutes] = timePart.split(':').map(Number);
        
        const reminderDate = new Date(year, month - 1, day, hours, minutes);
        
        if (isNaN(reminderDate.getTime())) {
          throw new Error('Некорректная дата');
        }

        if (reminderDate < new Date()) {
          await ctx.reply('❌ Нельзя установить напоминание на прошедшую дату');
          return;
        }

        state.date = reminderDate;
        state.step = 'awaiting_reminder_type';
        
        await ctx.reply(
          'Выберите тип напоминания:',
          Markup.inlineKeyboard([
            [Markup.button.callback('⏰ Разовое', 'reminder_once')],
            [Markup.button.callback('🔄 Еженедельное', 'reminder_weekly')],
            [Markup.button.callback('❌ Отмена', 'cancel_reminder')]
          ])
        );
        
      } catch (e) {
        await ctx.reply('❌ Ошибка формата даты. Используйте формат ДД.ММ.ГГГГ ЧЧ:ММ');
        console.error('Ошибка создания напоминания:', e);
      }
    }
  } else {
    // Обработка для обычных пользователей (заявки о животных)
    await handleAnimalReport(ctx);
  }
});

// Обработчик отмены создания напоминания
bot.action('cancel_reminder', async (ctx) => {
  const userId = ctx.from.id;
  if (userStates[userId]) {
    delete userStates[userId];
    await ctx.editMessageText('Создание напоминания отменено');
    await sendStartMenu(ctx);
  }
});

// Функция рассылки уведомлений
async function sendReminderNotification(reminder) {
  for (const userId in db.users) {
    if (db.users[userId].notificationsEnabled !== false) {
      try {
        await bot.telegram.sendMessage(
          userId,
          `🔔 Напоминание: ${reminder.title}\n\n` +
          `${reminder.description}\n\n` +
          `⏰ Запланировано на: ${reminder.date.toLocaleString()}\n\n` +
          `Вы можете отключить уведомления в настройках /notifications`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        console.error(`Ошибка отправки напоминания пользователю ${userId}:`, e);
      }
    }
  }
}

// Тестовая рассылка
bot.action('test_broadcast', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  
  await ctx.reply('Тестовая рассылка начата...');
  const testEvent = {
    title: "Тестовое уведомление",
    description: "Это тестовая рассылка от администратора",
    date: new Date().toLocaleDateString()
  };
  await sendNotificationToAll(testEvent);
  await ctx.reply('✅ Тестовая рассылка завершена');
});

// Функция для рассылки уведомлений всем пользователям
async function sendNotificationToAll(notification) {
  for (const userId in db.users) {
    if (db.users[userId].notificationsEnabled !== false) {
      try {
        await bot.telegram.sendMessage(
          userId,
          `🔔 ${notification.title}\n\n${notification.description}\n\n${notification.date}`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        console.error(`Ошибка отправки уведомления пользователю ${userId}:`, e);
      }
    }
  }
}

// Обработчик настроек уведомлений
bot.action('notifications_settings', async (ctx) => {
  initUser(ctx.from.id);
  await ctx.editMessageText(
    '🔔 Настройки уведомлений:\n\nВы можете включить/выключить рассылку уведомлений о событиях приюта.',
    notificationsKeyboard(ctx.from.id)
  );
});

// Включение/выключение уведомлений
bot.action('toggle_notifications', async (ctx) => {
  const userId = ctx.from.id;
  const user = initUser(userId);
  user.notificationsEnabled = !user.notificationsEnabled;
  
  await ctx.answerCbQuery(`Уведомления ${user.notificationsEnabled ? 'включены' : 'выключены'}`);
  await ctx.editMessageReplyMarkup(notificationsKeyboard(userId).reply_markup);
});

// Удаление напоминания
bot.action('remove_reminder', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  if (reminders.list.length === 0) {
    await ctx.answerCbQuery('❌ Нет активных напоминаний');
    return;
  }

  const buttons = reminders.list.map(reminder => 
    [Markup.button.callback(
      `${reminder.title} (${reminder.date.toLocaleString()})`, 
      `remove_reminder_${reminder.id}`
    )]
  );

  await ctx.editMessageText(
    'Выберите напоминание для удаления:',
    Markup.inlineKeyboard([...buttons, [Markup.button.callback('◀️ Назад', 'admin_menu')]])
  );
});

// Обработчик удаления напоминания
bot.action(/remove_reminder_(\d+)/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const reminderId = parseInt(ctx.match[1]);
  const index = reminders.list.findIndex(r => r.id === reminderId);
  
  if (index !== -1) {
    // Отменяем задание планировщика
    if (reminders.jobs[reminderId]) {
      cancelJob(reminders.jobs[reminderId]);
      delete reminders.jobs[reminderId];
    }
    
    // Удаляем из списка
    reminders.list.splice(index, 1);
    
    await ctx.answerCbQuery('Напоминание удалено');
    await ctx.editMessageText('✅ Напоминание удалено!', adminKeyboard);
  } else {
    await ctx.answerCbQuery('Напоминание не найдено');
  }
});

// Настройка расписания для еженедельного уведомления
function sendWeeklyNotification() {
  const notification = {
    title: "Напоминание о приюте",
    description: "Завтра суббота - день открытых дверей в нашем приюте! С 10:00 до 12:00 вы можете посетить нас и познакомиться с нашими питомцами.",
    date: new Date().toLocaleDateString()
  };
  sendNotificationToAll(notification);
}

scheduleJob('0 9 * * 5', sendWeeklyNotification); // Каждую пятницу в 9:00

// Обработчик кнопки "Назад"
bot.action('back_to_start', async (ctx) => {
  try {
    // Удаляем все связанные сообщения
    if (messageStorage.mediaMessages[ctx.chat.id]) {
      const [photoId, textId] = messageStorage.mediaMessages[ctx.chat.id];
      await ctx.deleteMessage(photoId).catch(() => {});
      await ctx.deleteMessage(textId).catch(() => {});
      delete messageStorage.mediaMessages[ctx.chat.id];
    }
    
    // Всегда отправляем новое стартовое меню
    await sendStartMenu(ctx);
    
  } catch (e) {
    console.error('Ошибка при обработке "Назад":', e);
    // Если что-то пошло не так, просто отправляем новое меню
    await sendStartMenu(ctx);
  }
});

// Обработчик кнопки "Сообщить о животном"
bot.action('report_animal', async (ctx) => {
  // Удаляем предыдущее сообщение с кнопками
  try {
    await ctx.deleteMessage();
  } catch (e) {
    console.log('Не удалось удалить сообщение:', e);
  }

  // Устанавливаем состояние пользователя
  userStates[ctx.from.id] = {
    state: 'AWAITING_ANIMAL_REPORT',
    messageId: ctx.update.callback_query.message.message_id
  };

  // Отправляем запрос на описание животного
  const sentMessage = await ctx.reply(
    'Пожалуйста, опишите животное и укажите место, где вы его видели.\n\n' +
    'Пример:\n' +
    '• Местоположение: ул. Ленина, 15 (около магазина "Пятёрочка")\n' +
    '• Описание: чёрный пёс среднего размера, в ошейнике\n' +
    '• Состояние: выглядит здоровым, но голодным',
    cancelKeyboard
  );

  // Сохраняем ID сообщения для последующего удаления
  userStates[ctx.from.id].requestMessageId = sentMessage.message_id;
});

// Обработчик текстовых сообщений (заявки о животных)
const handleAnimalReport = async (ctx) => {
  const userId = ctx.from.id;
  
  // Проверяем, находится ли пользователь в режиме отправки отчета
  if (userStates[userId] && userStates[userId].state === 'AWAITING_ANIMAL_REPORT') {
    try {
      // Удаляем предыдущее сообщение с инструкциями
      if (userStates[userId].requestMessageId) {
        await ctx.deleteMessage(userStates[userId].requestMessageId).catch(() => {});
      }

      const report = ctx.message.text;
      const userInfo = `👤 Пользователь: @${ctx.from.username || 'нет username'} (ID: ${userId})`;
      const reportText = `🚨 Новая заявка о бродячем животном:\n\n${report}\n\n${userInfo}`;

      // Отправляем админу
      await bot.telegram.sendMessage(
        ADMIN_ID,
        reportText,
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Принять', `approve_${userId}`)],
          [Markup.button.callback('❌ Отклонить', `reject_${userId}`)]
        ])
      );

      // Отправляем подтверждение пользователю
      await ctx.reply('Ваше сообщение отправлено администратору. Спасибо за заботу! ❤️\n\nМы свяжемся с вами в ближайшее время.');

      // Удаляем состояние
      delete userStates[userId];

    } catch (e) {
      console.error('Ошибка при обработке заявки:', e);
      await ctx.reply('Произошла ошибка при обработке вашей заявки. Пожалуйста, попробуйте ещё раз.');
      delete userStates[userId];
    }
  }
};

// Обработчик ответов админа
bot.action(/approve_(\d+)/, async (ctx) => {
  const userId = ctx.match[1];
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); // Удаляем кнопки
  await ctx.reply('✅ Заявка одобрена. Я уведомлю пользователя.');
  
  try {
    await bot.telegram.sendMessage(
      userId,
      'Ваша заявка о бродячем животном была одобрена! 🎉\n\n' +
      'Наши волонтёры уже выехали на место. Спасибо, что помогаете животным! ❤️'
    );
  } catch (e) {
    console.error('Ошибка при уведомлении пользователя:', e);
    await ctx.reply('Не удалось уведомить пользователя. Возможно, он заблокировал бота.');
  }
});

bot.action(/reject_(\d+)/, async (ctx) => {
  const userId = ctx.match[1];
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); // Удаляем кнопки
  await ctx.reply('❌ Заявка отклонена.');
  
  try {
    await bot.telegram.sendMessage(
      userId,
      'К сожалению, ваша заявка была отклонена.\n\n' +
      'Возможно, животное уже забрали или информация была недостаточно полной.'
    );
  } catch (e) {
    console.error('Ошибка при уведомлении пользователя:', e);
    await ctx.reply('Не удалось уведомить пользователя. Возможно, он заблокировал бота.');
  }
});

// Обработчик отмены
bot.action('cancel_report', async (ctx) => {
  const userId = ctx.from.id;
  
  if (userStates[userId] && userStates[userId].state === 'AWAITING_ANIMAL_REPORT') {
    try {
      // Удаляем сообщение с инструкциями
      if (userStates[userId].requestMessageId) {
        await ctx.deleteMessage(userStates[userId].requestMessageId).catch(() => {});
      }
      
      // Удаляем сообщение с кнопкой отмены
      await ctx.deleteMessage();
      
      // Отправляем подтверждение отмены
      await ctx.reply('Отправка отчёта отменена.');
      
      // Восстанавливаем главное меню
      await sendStartMenu(ctx);
    } catch (e) {
      console.error('Ошибка при отмене отчета:', e);
      await ctx.reply('Не удалось отменить отправку отчёта. Пожалуйста, попробуйте ещё раз.');
    } finally {
      delete userStates[userId];
    }
  }
});

// Общий обработчик callback-кнопок
bot.on('callback_query', async (ctx) => {
  try {
    // Удаляем стартовое сообщение
    if (messageStorage.startMessages[ctx.chat.id]) {
      await ctx.deleteMessage(messageStorage.startMessages[ctx.chat.id]).catch(() => {});
      delete messageStorage.startMessages[ctx.chat.id];
    }

    // Кнопка "Назад" для всех ответов
    const backButton = Markup.inlineKeyboard([
      [Markup.button.callback('◀️ Назад', 'back_to_start')]
    ]);

    // Отправляем новый ответ и сохраняем его ID
    let replyMessage;
    switch (ctx.callbackQuery.data) {
      case 'adoption_info':
        replyMessage = await ctx.reply('Чтобы забрать питомца, заполните анкету: [ссылка на Google Forms]', backButton);
        break;
      case 'contact_curator':
        replyMessage = await ctx.reply('Напишите нашему волонтеру: @PriutPervoVolonter', backButton);
        break;
      case 'donate':
        try {
          const photoMessage = await ctx.replyWithPhoto(
            { source: './assets/sbp-qr.jpeg' },
            { caption: '📲 Отсканируйте QR-код для перевода через СБП' }
          );

          const textMessage = await ctx.replyWithHTML(
            `<b>Реквизиты для помощи:</b>\n\n` +
            `💳 <code>4817 7601 6292 2623</code>\n` +
            `Ирина Юрьевна О.\n\n` +
            `📞 +7-904-16-43-660\n\n` +
            `🟠 Qiwi-кошелек:\n<code>8-902-272-06-95</code>\n\n` +
            `🟡 Яндекс.Деньги:\n<code>4100 1508 0324 790</code>`,
            backButton
          );

          messageStorage.mediaMessages[ctx.chat.id] = [
            photoMessage.message_id,
            textMessage.message_id
          ];
        } catch (e) {
          console.error('Ошибка при отправке доната:', e);
          await ctx.reply('Не удалось загрузить изображение. Вот реквизиты:', backButton);
        }
        break;
      case 'shelter_info':
        replyMessage = await ctx.replyWithHTML(
          `Местная общественная организация "Первоуральское городское общество ` +
          `защиты животных" основана группой волонтёров, которым не безразлична судьба бездомных животных.\n\n` +
          `В нашем приюте для бездомных животных проживают более 170 собак и 60 кошек.\n\n` +
          `Все животные получают необходимое лечение, вакцинацию, стерилизацию, клеймение и чипирование.\n\n` +
          `Мы помогли обрести дом уже более 8 тыс. животным!\n\n` +
          `Основная миссия нашего общества - формирование у населения культуры ответственного и бережного отношения к животным.\n\n` +
          `<b>Контакты:</b>\n\n` +
          `<b>📞 Телефон:</b> +7 (950) 649-44-62\n\n` +
          `<b>🏠 Адрес:</b> г. Первоуральск, Динасовское шоссе, 1/2\n\n` +
          `<b>🕰 Время работы:</b> Ежедневно с 09:00 - 19:00\n`,
          backButton
        );
        break;
    }

    // Сохраняем ID информационного сообщения
    if (replyMessage) {
      messageStorage.infoMessages[ctx.chat.id] = replyMessage.message_id;
    }

    await ctx.answerCbQuery();
  } catch (e) {
    console.error('Ошибка:', e);
  }
});

// Обработка ошибок
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

bot.launch();