import { getAllUpcomingBookings, getServiceById, cancelBooking } from './db.js';

function isAdmin(ctx) {
  return String(ctx.from.id) === String(process.env.ADMIN_CHAT_ID);
}

export function registerAdminCommands(bot) {
  // Список найближчих записів
  bot.command('today', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const today = new Date().toISOString().slice(0, 10);
    const bookings = (await getAllUpcomingBookings()).filter(
      (b) => b.date === today
    );

    if (bookings.length === 0) {
      return ctx.reply('На сьогодні записів немає.');
    }

    let text = `📅 Записи на сьогодні:\n\n`;
    for (const b of bookings) {
      const service = await getServiceById(b.serviceId);
      text += `${b.time} — ${service.name}\nКлієнт: ${b.clientName}, ${b.phone}\n(id: ${b.id})\n\n`;
    }
    await ctx.reply(text);
  });

  bot.command('week', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const bookings = await getAllUpcomingBookings();
    if (bookings.length === 0) {
      return ctx.reply('Найближчим часом записів немає.');
    }
    let text = `📅 Усі майбутні записи:\n\n`;
    for (const b of bookings) {
      const service = await getServiceById(b.serviceId);
      text += `${b.date} ${b.time} — ${service.name} — ${b.clientName}, ${b.phone} (id: ${b.id})\n`;
    }
    await ctx.reply(text);
  });

  // Скасування запису адміном: /cancel <id>
  bot.command('cancel', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const id = ctx.message.text.split(' ')[1];
    if (!id) return ctx.reply('Використання: /cancel <id_запису>');
    const booking = await cancelBooking(id);
    if (!booking) return ctx.reply('Запис не знайдено.');
    await ctx.reply(`Скасовано запис ${id}.`);

    // Повідомити клієнта
    try {
      await ctx.telegram.sendMessage(
        booking.telegramId,
        `На жаль, ваш запис на ${booking.date} ${booking.time} скасовано. Зв'яжіться з нами для перезапису.`
      );
    } catch (e) {
      // клієнт міг заблокувати бота — ігноруємо
    }
  });
}
