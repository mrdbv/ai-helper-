import cron from 'node-cron';
import { getAllUpcomingBookings, getServiceById } from './db.js';

export function scheduleReminders(bot) {
  // Щодня о 18:00 надсилаємо нагадування про завтрашні записи
  cron.schedule('0 18 * * *', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    const bookings = (await getAllUpcomingBookings()).filter(
      (b) => b.date === tomorrowStr
    );

    for (const b of bookings) {
      const service = await getServiceById(b.serviceId);
      try {
        await bot.telegram.sendMessage(
          b.telegramId,
          `⏰ Нагадування: завтра ${b.date} о ${b.time} у вас "${service.name}". Чекаємо на вас!`
        );
      } catch (e) {
        // клієнт заблокував бота — пропускаємо
      }
    }
  });
}
