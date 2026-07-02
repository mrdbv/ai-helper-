import { Scenes, Markup } from 'telegraf';
import {
  getServices,
  getServiceById,
  createBooking,
  getKnownClient,
} from '../db.js';
import { getUpcomingDays, getFreeSlots } from '../slots.js';

const step1_selectService = async (ctx) => {
  const services = await getServices();
  const buttons = services.map((s) =>
    Markup.button.callback(
      `${s.name} — ${s.price ? s.price + ' грн' : 'безкоштовно'}`,
      `svc_${s.id}`
    )
  );
  await ctx.reply(
    'Оберіть послугу:',
    Markup.inlineKeyboard(buttons, { columns: 1 })
  );
  return ctx.wizard.next();
};

const step2_selectDate = async (ctx) => {
  if (!ctx.callbackQuery?.data?.startsWith('svc_')) {
    await ctx.reply('Будь ласка, оберіть послугу кнопкою вище.');
    return;
  }
  const serviceId = ctx.callbackQuery.data.replace('svc_', '');
  ctx.wizard.state.serviceId = serviceId;
  await ctx.answerCbQuery();

  const days = getUpcomingDays(7);
  const buttons = days.map((d) => Markup.button.callback(d.label, `date_${d.date}`));
  await ctx.reply(
    'Оберіть зручну дату:',
    Markup.inlineKeyboard(buttons, { columns: 2 })
  );
  return ctx.wizard.next();
};

const step3_selectTime = async (ctx) => {
  if (!ctx.callbackQuery?.data?.startsWith('date_')) {
    await ctx.reply('Будь ласка, оберіть дату кнопкою вище.');
    return;
  }
  const date = ctx.callbackQuery.data.replace('date_', '');
  ctx.wizard.state.date = date;
  await ctx.answerCbQuery();

  const slots = await getFreeSlots(date, ctx.wizard.state.serviceId);
  if (slots.length === 0) {
    await ctx.reply('На цю дату вільних слотів немає. Оберіть іншу дату /book');
    return ctx.scene.leave();
  }

  const buttons = slots.map((t) => Markup.button.callback(t, `time_${t}`));
  await ctx.reply(
    'Оберіть час:',
    Markup.inlineKeyboard(buttons, { columns: 4 })
  );
  return ctx.wizard.next();
};

const sendConfirmationPrompt = async (ctx) => {
  const service = await getServiceById(ctx.wizard.state.serviceId);
  const { date, time, clientName, phone } = ctx.wizard.state;

  await ctx.reply(
    `Перевірте деталі запису:\n\n` +
      `Послуга: ${service.name}\n` +
      `Дата: ${date}\n` +
      `Час: ${time}\n` +
      `Ім'я: ${clientName}\n` +
      `Телефон: ${phone}\n\n` +
      `Все вірно?`,
    Markup.inlineKeyboard([
      Markup.button.callback('✅ Підтвердити', 'confirm_yes'),
      Markup.button.callback('❌ Скасувати', 'confirm_no'),
    ])
  );
};

const step4_askName = async (ctx) => {
  if (!ctx.callbackQuery?.data?.startsWith('time_')) {
    await ctx.reply('Будь ласка, оберіть час кнопкою вище.');
    return;
  }
  const time = ctx.callbackQuery.data.replace('time_', '');
  ctx.wizard.state.time = time;
  await ctx.answerCbQuery();

  const known = await getKnownClient(ctx.from.id);
  if (known) {
    ctx.wizard.state.clientName = known.name;
    ctx.wizard.state.phone = known.phone;
    await sendConfirmationPrompt(ctx);
    ctx.wizard.selectStep(6);
    return;
  }

  await ctx.reply('Як до вас звертатись? Введіть ім\'я:');
  return ctx.wizard.next();
};

const step5_askPhone = async (ctx) => {
  if (!ctx.message?.text) return;
  ctx.wizard.state.clientName = ctx.message.text.trim();

  await ctx.reply(
    'Залиште номер телефону для підтвердження запису:',
    Markup.keyboard([
      Markup.button.contactRequest('📱 Надіслати мій номер'),
    ]).resize().oneTime()
  );
  return ctx.wizard.next();
};

const step6_confirm = async (ctx) => {
  if (ctx.message?.contact) {
    ctx.wizard.state.phone = ctx.message.contact.phone_number;
  } else if (ctx.message?.text) {
    ctx.wizard.state.phone = ctx.message.text.trim();
  }

  if (!ctx.wizard.state.phone) return;

  await ctx.reply('Дякую!', Markup.removeKeyboard());
  await sendConfirmationPrompt(ctx);
  return ctx.wizard.next();
};

const step7_finish = async (ctx) => {
  await ctx.answerCbQuery();
  if (ctx.callbackQuery?.data === 'confirm_no') {
    await ctx.reply('Запис скасовано. Щоб почати заново — /book');
    return ctx.scene.leave();
  }

  const { serviceId, date, time, clientName, phone } = ctx.wizard.state;
  const booking = await createBooking({
    telegramId: ctx.from.id,
    clientName,
    phone,
    serviceId,
    date,
    time,
  });

  const service = await getServiceById(serviceId);
  await ctx.reply(
    `✅ Готово! Ви записані на "${service.name}" ${date} о ${time}.\n` +
      `Нагадаємо за день до візиту. До зустрічі!`
  );

  const adminId = process.env.ADMIN_CHAT_ID;
  if (adminId) {
    await ctx.telegram.sendMessage(
      adminId,
      `🔔 Новий запис!\n${service.name} — ${date} ${time}\n` +
        `Клієнт: ${clientName}, ${phone}`
    );
  }

  return ctx.scene.leave();
};

export const bookingWizard = new Scenes.WizardScene(
  'booking-wizard',
  step1_selectService,
  step2_selectDate,
  step3_selectTime,
  step4_askName,
  step5_askPhone,
  step6_confirm,
  step7_finish
);
