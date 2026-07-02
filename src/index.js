import 'dotenv/config';
import { Telegraf, Scenes, session } from 'telegraf';
import { bookingWizard } from './scenes/bookingScene.js';
import { serviceWizard } from './scenes/serviceScene.js';
import { registerAdminCommands } from './admin.js';
import { scheduleReminders } from './reminders.js';
import { getBookingsForClient, getServiceById } from './db.js';

if (!process.env.BOT_TOKEN) {
  console.error('Помилка: не заданий BOT_TOKEN у .env файлі');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

const stage = new Scenes.Stage([bookingWizard, serviceWizard]);
bot.use(session());
bot.use(stage.middleware());

const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Ваш бізнес';

bot.start((ctx) =>
  ctx.reply(
    `Вітаємо у боті запису "${BUSINESS_NAME}"! 👋\n\n` +
      `/book — записатись\n` +
      `/my — мої записи\n` +
      `/help — допомога`
  )
);

bot.command('book', (ctx) => ctx.scene.enter('booking-wizard'));

bot.command('my', async (ctx) => {
  const bookings = await getBookingsForClient(ctx.from.id);
  const active = bookings.filter((b) => b.status === 'confirmed');
  if (active.length === 0) {
    return ctx.reply('У вас немає активних записів. Скористайтесь /book');
  }
  let text = 'Ваші записи:\n\n';
  for (const b of active) {
    const service = await getServiceById(b.serviceId);
    text += `${b.date} ${b.time} — ${service.name}\n`;
  }
  await ctx.reply(text);
});

bot.help((ctx) =>
  ctx.reply(
    'Цей бот допомагає записатись на послугу.\n/book — почати запис\n/my — переглянути свої записи'
  )
);

registerAdminCommands(bot);
scheduleReminders(bot);

bot.launch();
console.log('Бот запущено ✅');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
