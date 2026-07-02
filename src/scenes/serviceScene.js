import { Scenes, Markup } from 'telegraf';
import { createService, updateService, getServiceById } from '../db.js';

// Ця сцена працює у двох режимах, переданих через ctx.scene.enter('service-wizard', { mode, serviceId }):
//  - mode: 'add'  — створення нової послуги
//  - mode: 'edit' — редагування існуючої (serviceId обов'язковий)

const step1_askName = async (ctx) => {
  const mode = ctx.scene.state.mode;
  ctx.wizard.state.mode = mode;
  ctx.wizard.state.serviceId = ctx.scene.state.serviceId;

  await ctx.reply(
    mode === 'edit'
      ? 'Введіть нову назву послуги:'
      : 'Введіть назву нової послуги:'
  );
  return ctx.wizard.next();
};

const step2_askDuration = async (ctx) => {
  if (!ctx.message?.text) return;
  ctx.wizard.state.name = ctx.message.text.trim();
  await ctx.reply('Скільки хвилин триває послуга? (введіть число, наприклад 60)');
  return ctx.wizard.next();
};

const step3_askPrice = async (ctx) => {
  const duration = parseInt(ctx.message?.text?.trim(), 10);
  if (!duration || duration <= 0) {
    await ctx.reply('Введіть коректне число хвилин, наприклад 60:');
    return;
  }
  ctx.wizard.state.durationMin = duration;
  await ctx.reply('Яка ціна в грн? (введіть 0, якщо послуга безкоштовна)');
  return ctx.wizard.next();
};

const step4_confirm = async (ctx) => {
  const price = parseInt(ctx.message?.text?.trim(), 10);
  if (Number.isNaN(price) || price < 0) {
    await ctx.reply('Введіть коректну ціну, наприклад 400 або 0:');
    return;
  }
  ctx.wizard.state.price = price;

  const { name, durationMin } = ctx.wizard.state;
  await ctx.reply(
    `Перевірте:\n\nНазва: ${name}\nТривалість: ${durationMin} хв\nЦіна: ${
      price ? price + ' грн' : 'безкоштовно'
    }\n\nЗберегти?`,
    Markup.inlineKeyboard([
      Markup.button.callback('✅ Зберегти', 'svc_save'),
      Markup.button.callback('❌ Скасувати', 'svc_cancel'),
    ])
  );
  return ctx.wizard.next();
};

const step5_save = async (ctx) => {
  await ctx.answerCbQuery();
  if (ctx.callbackQuery?.data === 'svc_cancel') {
    await ctx.reply('Скасовано.');
    return ctx.scene.leave();
  }

  const { mode, serviceId, name, durationMin, price } = ctx.wizard.state;

  if (mode === 'edit') {
    await updateService(serviceId, { name, durationMin, price });
    await ctx.reply(`✅ Послугу "${name}" оновлено.`);
  } else {
    await createService({ name, durationMin, price });
    await ctx.reply(`✅ Послугу "${name}" додано.`);
  }

  await ctx.reply('Щоб побачити повний список послуг — /services');
  return ctx.scene.leave();
};

export const serviceWizard = new Scenes.WizardScene(
  'service-wizard',
  step1_askName,
  step2_askDuration,
  step3_askPrice,
  step4_confirm,
  step5_save
);
