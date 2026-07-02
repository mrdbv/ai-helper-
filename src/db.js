import pg from 'pg';
import { nanoid } from 'nanoid';

const { Pool } = pg;

// Railway автоматично підставляє DATABASE_URL, коли база й бот
// живуть в одному проєкті. Локально для розробки теж можна задати
// DATABASE_URL у .env, якщо піднімеш Postgres на своєму комп'ютері —
// або просто працювати з попередньою JSON-версією для локальних тестів.
if (!process.env.DATABASE_URL) {
  console.error(
    'Помилка: не задано DATABASE_URL. Додай PostgreSQL у Railway ' +
      'або встав рядок підключення в .env для локальної розробки.'
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway вимагає SSL, але з self-signed сертифікатом —
  // rejectUnauthorized: false дозволяє підключитись без зайвих налаштувань
  ssl: { rejectUnauthorized: false },
});

const DEFAULT_SERVICES = [
  { id: 'srv1', name: 'Стрижка', durationMin: 60, price: 400 },
  { id: 'srv2', name: 'Манікюр', durationMin: 90, price: 600 },
  { id: 'srv3', name: 'Консультація', durationMin: 30, price: 0 },
];

// Створює таблиці, якщо їх ще немає, і заповнює послугами за замовчуванням.
// Викликається один раз при старті бота — безпечно викликати повторно,
// IF NOT EXISTS не дасть нічого зламати при передеплої.
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      duration_min INTEGER NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true
    );
  `);
  // ALTER ... IF NOT EXISTS — безпечно на випадок, якщо таблиця вже
  // існувала з попередньої версії бота, до появи поля active
  await pool.query(`
    ALTER TABLE services ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      telegram_id BIGINT PRIMARY KEY,
      name TEXT,
      phone TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      telegram_id BIGINT NOT NULL,
      client_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      service_id TEXT NOT NULL REFERENCES services(id),
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM services');
  if (rows[0].count === 0) {
    for (const s of DEFAULT_SERVICES) {
      await pool.query(
        'INSERT INTO services (id, name, duration_min, price) VALUES ($1, $2, $3, $4)',
        [s.id, s.name, s.durationMin, s.price]
      );
    }
    console.log('Базові послуги додано до бази ✅');
  }
}

await initDb();

// ── Далі — той самий публічний інтерфейс, що був у JSON-версії ──

function mapService(row) {
  return {
    id: row.id,
    name: row.name,
    durationMin: row.duration_min,
    price: row.price,
    active: row.active,
  };
}

function mapBooking(row) {
  return {
    id: row.id,
    telegramId: Number(row.telegram_id),
    clientName: row.client_name,
    phone: row.phone,
    serviceId: row.service_id,
    date: row.date,
    time: row.time,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function getServices() {
  // Тільки активні — це бачить клієнт при записі
  const { rows } = await pool.query(
    'SELECT * FROM services WHERE active = true ORDER BY name'
  );
  return rows.map(mapService);
}

export async function getAllServicesForAdmin() {
  // Активні й вимкнені — це бачить власник у /services
  const { rows } = await pool.query('SELECT * FROM services ORDER BY active DESC, name');
  return rows.map(mapService);
}

export async function getServiceById(id) {
  const { rows } = await pool.query('SELECT * FROM services WHERE id = $1', [id]);
  return rows[0] ? mapService(rows[0]) : null;
}

export async function getBookingsForDate(date) {
  const { rows } = await pool.query(
    "SELECT * FROM bookings WHERE date = $1 AND status != 'cancelled'",
    [date]
  );
  return rows.map(mapBooking);
}

export async function getBookingsForClient(telegramId) {
  const { rows } = await pool.query(
    'SELECT * FROM bookings WHERE telegram_id = $1 ORDER BY date, time',
    [telegramId]
  );
  return rows.map(mapBooking);
}

export async function createBooking({ telegramId, clientName, phone, serviceId, date, time }) {
  const id = nanoid(8);
  const { rows } = await pool.query(
    `INSERT INTO bookings (id, telegram_id, client_name, phone, service_id, date, time, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed')
     RETURNING *`,
    [id, telegramId, clientName, phone, serviceId, date, time]
  );

  // upsert клієнта — оновлюємо ім'я/телефон, якщо вже існував
  await pool.query(
    `INSERT INTO clients (telegram_id, name, phone) VALUES ($1, $2, $3)
     ON CONFLICT (telegram_id) DO UPDATE SET name = $2, phone = $3`,
    [telegramId, clientName, phone]
  );

  return mapBooking(rows[0]);
}

export async function cancelBooking(id) {
  const { rows } = await pool.query(
    "UPDATE bookings SET status = 'cancelled' WHERE id = $1 RETURNING *",
    [id]
  );
  return rows[0] ? mapBooking(rows[0]) : null;
}

export async function getKnownClient(telegramId) {
  const { rows } = await pool.query(
    'SELECT * FROM clients WHERE telegram_id = $1',
    [telegramId]
  );
  return rows[0] ? { name: rows[0].name, phone: rows[0].phone } : null;
}

export async function getAllUpcomingBookings() {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    "SELECT * FROM bookings WHERE date >= $1 AND status = 'confirmed' ORDER BY date, time",
    [today]
  );
  return rows.map(mapBooking);
}

export async function createService({ name, durationMin, price }) {
  const id = nanoid(8);
  const { rows } = await pool.query(
    `INSERT INTO services (id, name, duration_min, price, active)
     VALUES ($1, $2, $3, $4, true) RETURNING *`,
    [id, name, durationMin, price]
  );
  return mapService(rows[0]);
}

export async function updateService(id, { name, durationMin, price }) {
  const { rows } = await pool.query(
    `UPDATE services SET name = $2, duration_min = $3, price = $4
     WHERE id = $1 RETURNING *`,
    [id, name, durationMin, price]
  );
  return rows[0] ? mapService(rows[0]) : null;
}

export async function setServiceActive(id, active) {
  const { rows } = await pool.query(
    'UPDATE services SET active = $2 WHERE id = $1 RETURNING *',
    [id, active]
  );
  return rows[0] ? mapService(rows[0]) : null;
}

export default pool;
