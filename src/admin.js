import {
  getAllUpcomingBookings,
  getServiceById,
  cancelBooking,
  getAllServicesForAdmin,
  setServiceActive,
} from './db.js';
import { Markup } from 'telegraf';

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

  // ── Керування списком послуг ────────────────────────
  bot.command('services', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const services = await getAllServicesForAdmin();

    if (services.length === 0) {
      await ctx.reply('Послуг ще немає.');
    } else {
      await ctx.reply('Ваші послуги:');
      for (const s of services) {
        const status = s.active ? '' : ' (вимкнена)';
        const text = `${s.name}${status}\n${s.durationMin} хв, ${
          s.price ? s.price + ' грн' : 'безкоштовно'
        }`;
        const buttons = [
          Markup.button.callback('✏️ Редагувати', `editsvc_${s.id}`),
          s.active
            ? Markup.button.callback('🚫 Вимкнути', `disablesvc_${s.id}`)
            : Markup.button.callback('✅ Увімкнути', `enablesvc_${s.id}`),
        ];
        await ctx.reply(text, Markup.inlineKeyboard(buttons));
      }
    }

    await ctx.reply(
      'Додати нову послугу:',
      Markup.inlineKeyboard([Markup.button.callback('➕ Додати послугу', 'addsvc')])
    );
  });

  bot.action('addsvc', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    await ctx.scene.enter('service-wizard', { mode: 'add' });
  });

  bot.action(/^editsvc_(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    const serviceId = ctx.match[1];
    await ctx.scene.enter('service-wizard', { mode: 'edit', serviceId });
  });

  bot.action(/^disablesvc_(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery();
    const serviceId = ctx.match[1];
    const service = await setServiceActive(serviceId, false);
    await ctx.answerCbQuery();
    await ctx.reply(
      `🚫 Послугу "${service.name}" вимкнено. Клієнти більше не бачитимуть її при записі, але старі записи лишаються.`
    );
  });

  bot.action(/^enablesvc_(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery();
    const serviceId = ctx.match[1];
    const service = await setServiceActive(serviceId, true);
    await ctx.answerCbQuery();
    await ctx.reply(`✅ Послугу "${service.name}" знову увімкнено.`);
  });
}
