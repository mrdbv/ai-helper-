import { JSONFilePreset } from 'lowdb/node';
import { nanoid } from 'nanoid';

// Проста файлова база на старті. Коли бізнес виросте — легко
// перенести на Postgres/Supabase, не змінюючи логіку сцен,
// бо весь доступ до даних йде через ці функції.

const defaultData = {
  services: [
    { id: 'srv1', name: 'Стрижка', durationMin: 60, price: 400 },
    { id: 'srv2', name: 'Манікюр', durationMin: 90, price: 600 },
    { id: 'srv3', name: 'Консультація', durationMin: 30, price: 0 },
  ],
  bookings: [], // { id, telegramId, clientName, phone, serviceId, date, time, status, createdAt }
  clients: {},  // telegramId -> { name, phone }
};

const db = await JSONFilePreset('db.json', defaultData);

export async function getServices() {
  return db.data.services;
}

export async function getServiceById(id) {
  return db.data.services.find((s) => s.id === id);
}

export async function getBookingsForDate(date) {
  return db.data.bookings.filter(
    (b) => b.date === date && b.status !== 'cancelled'
  );
}

export async function getBookingsForClient(telegramId) {
  return db.data.bookings.filter((b) => b.telegramId === telegramId);
}

export async function createBooking({
  telegramId,
  clientName,
  phone,
  serviceId,
  date,
  time,
}) {
  const booking = {
    id: nanoid(8),
    telegramId,
    clientName,
    phone,
    serviceId,
    date,
    time,
    status: 'confirmed',
    createdAt: new Date().toISOString(),
  };
  db.data.bookings.push(booking);
  db.data.clients[telegramId] = { name: clientName, phone };
  await db.write();
  return booking;
}

export async function cancelBooking(id) {
  const booking = db.data.bookings.find((b) => b.id === id);
  if (booking) {
    booking.status = 'cancelled';
    await db.write();
  }
  return booking;
}

export async function getKnownClient(telegramId) {
  return db.data.clients[telegramId] || null;
}

export async function getBookingsForDay(date) {
  return db.data.bookings.filter(
    (b) => b.date === date && b.status === 'confirmed'
  );
}

export async function getAllUpcomingBookings() {
  const today = new Date().toISOString().slice(0, 10);
  return db.data.bookings.filter(
    (b) => b.date >= today && b.status === 'confirmed'
  );
}

export default db;
