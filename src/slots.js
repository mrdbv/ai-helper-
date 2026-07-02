import { getBookingsForDate, getServiceById } from './db.js';

const DAYS_OFF = (process.env.DAYS_OFF || '0')
  .split(',')
  .map((d) => parseInt(d.trim(), 10));

const [WORK_START_H, WORK_START_M] = (process.env.WORK_START || '09:00')
  .split(':')
  .map(Number);
const [WORK_END_H, WORK_END_M] = (process.env.WORK_END || '18:00')
  .split(':')
  .map(Number);

// Повертає масив { date: 'YYYY-MM-DD', label: 'Пн, 3 лип' } на найближчі N днів,
// без вихідних
export function getUpcomingDays(count = 7) {
  const days = [];
  const d = new Date();
  while (days.length < count) {
    d.setDate(d.getDate() + 1);
    if (!DAYS_OFF.includes(d.getDay())) {
      days.push({
        date: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString('uk-UA', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }),
      });
    }
  }
  return days;
}

// Генерує вільні часові слоти для конкретної дати й послуги,
// враховуючи вже існуючі записи цього дня
export async function getFreeSlots(date, serviceId) {
  const service = await getServiceById(serviceId);
  const duration = service.durationMin;
  const existing = await getBookingsForDate(date);

  // Заздалегідь рахуємо реальний інтервал [початок, кінець] у хвилинах
  // для кожного вже існуючого запису, підтягуючи тривалість ЙОГО
  // власної послуги — а не фіксовані 60 хв, як було раніше.
  // Це важливо: якщо перед вільним слотом стоїть запис на 90-хвилинну
  // послугу, старий код вважав би її 60-хвилинною і показав би слот,
  // який насправді перетинається з чужим записом.
  const existingIntervals = await Promise.all(
    existing.map(async (b) => {
      const bookedService = await getServiceById(b.serviceId);
      const [bh, bm] = b.time.split(':').map(Number);
      const bStart = bh * 60 + bm;
      const bEnd = bStart + bookedService.durationMin;
      return { start: bStart, end: bEnd };
    })
  );

  const slots = [];
  let cursor = WORK_START_H * 60 + WORK_START_M;
  const endMin = WORK_END_H * 60 + WORK_END_M;

  while (cursor + duration <= endMin) {
    const slotStart = cursor;
    const slotEnd = cursor + duration;

    const overlaps = existingIntervals.some(
      ({ start, end }) => slotStart < end && start < slotEnd
    );

    if (!overlaps) {
      const h = String(Math.floor(slotStart / 60)).padStart(2, '0');
      const m = String(slotStart % 60).padStart(2, '0');
      slots.push(`${h}:${m}`);
    }
    cursor += 30; // крок сітки — кожні 30 хв
  }

  return slots;
}
