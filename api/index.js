const { Telegraf, Markup } = require('telegraf');

// --- CONFIGURATION ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const BANK_DETAILS = process.env.BANK_DETAILS || "شماره کارت: `6219861947080387`\nبه نام: آرتین اسعدی";
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || "Your_Personal_ID";

if (!BOT_TOKEN || !ADMIN_ID) {
    throw new Error("CRITICAL ERROR: BOT_TOKEN and ADMIN_ID environment variables must be set!");
}

const bot = new Telegraf(BOT_TOKEN);

// ⚠️ SERVERLESS NOTE: Vercel functions are stateless and sleep between requests.
// In-memory objects (like these) might reset if there is a long gap between user messages.
// For a flawless production environment on Vercel, consider replacing these with a free Redis database (like Upstash).
const userStates = {};
const adminStates = {};

// Available VPN Plans (ArtiQ Packages)
const plans = [
    { id: 'plan_10g', name: 'اشتراک ۱۰ گیگابایت (۱ ماهه)', price: '۳۰,۰۰۰ تومان' },
    { id: 'plan_20g', name: 'اشتراک ۲۰ گیگابایت (۱ ماهه)', price: '۷۰,۰۰۰ تومان' },
    { id: 'plan_50g', name: 'اشتراک ۵۰ گیگابایت (۱ ماهه)', price: '۱۵۰,۰۰۰ تومان' }
];

// --- MAIN MENU KEYBOARD ---
const mainMenu = Markup.keyboard([
    ['🎁 دریافت اکانت تست'],
    ['🛒 خرید اشتراک'],
    ['🎯 پشتیبانی']
]).resize();

// --- USER ACTIONS ---

// Start Command
bot.start((ctx) => {
    delete userStates[ctx.from.id];
    ctx.reply(`👋 به ربات آرتیک خوش آمدید! با یک اتصال امن، پایدار و پرسرعت از حریم خصوصی خود در اینترنت آزاد محافظت کنید.\n\nلطفاً برای شروع، یکی از گزینه‌های زیر را انتخاب کنید:`, mainMenu);
});

// Main Menu Text Handlers
bot.hears('🎁 دریافت اکانت تست', async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username ? `@${ctx.from.username}` : 'بدون آیدی';

    ctx.reply('⏳ درخواست اکانت تست شما برای مدیریت ارسال شد. لطفاً تا زمان تایید منتظر بمانید.');

    await bot.telegram.sendMessage(ADMIN_ID, `⚠️ *درخواست اکانت تست جدید*\n\nکاربر: ${ctx.from.first_name}\nآیدی: ${username}\nشناسه: \`${userId}\``, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ تایید و ارسال کانفیگ تست', `approve_test_${userId}`)]
        ])
    });
});

bot.hears('🛒 خرید اشتراک', async (ctx) => {
    const buttons = plans.map(plan => [Markup.button.callback(`${plan.name} -${plan.price}`, `select_${plan.id}`)]);
    buttons.push([Markup.button.callback('🛠 ساخت بسته دلخواه (حجم و زمان)', 'select_custom')]);

    ctx.reply('📋 لطفاً بسته مورد نظر خود را انتخاب کنید:', Markup.inlineKeyboard(buttons));

    const username = ctx.from.username ? `@${ctx.from.username}` : 'بدون آیدی';
    await bot.telegram.sendMessage(ADMIN_ID, `👁‍🗨 *اقدام به خرید*\nکاربر ${ctx.from.first_name} (${username}) در حال مشاهده لیست قیمت‌ها برای خرید است.`, { parse_mode: 'Markdown' }).catch(() => {});
});

bot.hears('🎯 پشتیبانی', (ctx) => {
    ctx.reply(`ℹ️ برای هرگونه سوال، راهنمایی در اتصال یا پشتیبانی، مستقیماً با ما در ارتباط باشید:\n\n💬 @${SUPPORT_USERNAME}`);
});

// Inline Keyboard Callback Handlers
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const adminId = ctx.from.id;

    if (data.startsWith('select_plan_')) {
        const planId = data.replace('select_', '');
        const selectedPlan = plans.find(p => p.id === planId);

        userStates[ctx.from.id] = { stage: 'AWAITING_RECEIPT', plan: selectedPlan.name };

        await ctx.answerCbQuery();
        await ctx.reply(`💳 *اطلاعات پرداخت*\n\nشما *${selectedPlan.name}* را انتخاب کردید.\n\nمبلغ *${selectedPlan.price}* را به حساب زیر انتقال دهید:\n\n${BANK_DETAILS}\n\n📸 *مهم:* پس از پرداخت، لطفاً عکس رسید یا اسکرین‌شات واریزی خود را مستقیماً در همین چت ارسال کنید.`, { parse_mode: 'Markdown' });
    }

    if (data === 'select_custom') {
        userStates[ctx.from.id] = { stage: 'AWAITING_CUSTOM_TRAFFIC' };

        await ctx.answerCbQuery();
        await ctx.reply('🛠 شما ساخت بسته دلخواه را انتخاب کردید.\n\nلطفاً حجم مورد نیاز خود را **فقط به صورت عدد و به گیگابایت** وارد کنید (مثلاً: 15):', { parse_mode: 'Markdown' });
    }

    if (data.startsWith('approve_test_')) {
        const targetUserId = data.replace('approve_test_', '');
        adminStates[adminId] = { action: 'SEND_TEST', targetUser: targetUserId };

        await ctx.answerCbQuery();
        await ctx.reply(`📝 لطفاً *کانفیگ تست* کاربر \`${targetUserId}\` را تایپ یا پیست کنید. پیام بعدی شما مستقیماً برای او ارسال می‌شود.`, { parse_mode: 'Markdown' });
    }

    if (data.startsWith('approve_buy_')) {
        const targetUserId = data.replace('approve_buy_', '');
        adminStates[adminId] = { action: 'SEND_BUY', targetUser: targetUserId };

        await ctx.answerCbQuery();
        await ctx.reply(`📝 سفارش تایید شد! لطفاً *کانفیگ اصلی* کاربر \`${targetUserId}\` را تایپ یا پیست کنید. پیام بعدی شما مستقیماً برای او ارسال می‌شود.`, { parse_mode: 'Markdown' });
    }

    if (data.startsWith('reject_buy_')) {
        const targetUserId = data.replace('reject_buy_', '');

        await ctx.answerCbQuery();
        await bot.telegram.sendMessage(targetUserId, '❌ رسید پرداختی شما توسط مدیریت تایید نشد. اگر فکر می‌کنید اشتباهی رخ داده است، لطفاً با پشتیبانی تماس بگیرید.');
        await ctx.reply(`❌ سفارش کاربر \`${targetUserId}\` رد شد و به او اطلاع داده شد.`);
    }
});

// --- MESSAGE HANDLING ---
bot.on('message', async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username ? `@${ctx.from.username}` : 'بدون آیدی';

    // 1. Admin States
    if (Number(userId) === Number(ADMIN_ID) && adminStates[userId]) {
        const state = adminStates[userId];
        const configMessage = ctx.message.text || (ctx.message.document ? `فایل: ${ctx.message.document.file_id}` : null);

        if (!configMessage) {
            return ctx.reply('❌ لطفاً کانفیگ را به صورت متن یا یک فایل معتبر ارسال کنید.');
        }

        try {
            if (state.action === 'SEND_TEST') {
                await bot.telegram.sendMessage(state.targetUser, `🎁 *اکانت تست شما آماده است!*\n\n\`\`\`\n${ctx.message.text || 'فایل ضمیمه را ذخیره کنید'}\n\`\`\`\n_این اکانت دارای محدودیت زمانی و حجمی است._`, { parse_mode: 'Markdown' });
                if (ctx.message.document) await bot.telegram.sendDocument(state.targetUser, ctx.message.document.file_id);
                await ctx.reply('✅ کانفیگ تست با موفقیت برای کاربر ارسال شد.');
            } else if (state.action === 'SEND_BUY') {
                await bot.telegram.sendMessage(state.targetUser, `🚀 *سرویس شما فعال شد!*\n\nاز اینکه آرتیک را انتخاب کردید سپاسگزاریم. اطلاعات اتصال شما:\n\n\`\`\`\n${ctx.message.text || 'فایل ضمیمه را ذخیره کنید'}\n\`\`\`\nاز اینترنت آزاد و پایدار خود لذت ببرید!`, { parse_mode: 'Markdown' });
                if (ctx.message.document) await bot.telegram.sendDocument(state.targetUser, ctx.message.document.file_id);
                await ctx.reply('✅ کانفیگ اصلی با موفقیت برای کاربر ارسال شد.');
            }
        } catch (err) {
            console.error(err);
            await ctx.reply('❌ ارسال پیام به کاربر ناموفق بود. ممکن است ربات را بلاک کرده باشد.');
        }

        delete adminStates[userId];
        return;
    }

    // 2. User States
    if (userStates[userId]) {
        const state = userStates[userId];

        if (state.stage === 'AWAITING_CUSTOM_TRAFFIC') {
            const traffic = parseInt(ctx.message.text);
            if (isNaN(traffic) || traffic <= 0) return ctx.reply('❌ مقدار نامعتبر. لطفاً فقط یک عدد به عنوان حجم وارد کنید (مثلاً: 10):');

            const calculatedPrice = traffic * 5000;
            userStates[userId] = { stage: 'AWAITING_CUSTOM_DURATION', traffic: traffic, price: calculatedPrice };

            return ctx.reply(`✅ حجم ${traffic} گیگابایت با موفقیت ثبت شد.\n💳 هزینه محاسبه شده: ${calculatedPrice.toLocaleString('en-US')} تومان\n\nلطفاً مدت زمان اعتبار بسته را به صورت متنی وارد کنید (مثلاً: ۱ ماهه، ۴۵ روزه):`);
        }

        if (state.stage === 'AWAITING_CUSTOM_DURATION') {
            const duration = ctx.message.text;
            if (!duration) return ctx.reply('❌ لطفاً مدت زمان را به صورت متنی ارسال کنید.');

            const planName = `بسته سفارشی (${state.traffic} گیگابایت \vert{} ${duration})`;
            const priceFormatted = `${state.price.toLocaleString('en-US')} تومان`;

            userStates[userId] = { stage: 'AWAITING_RECEIPT', plan: planName };
            return ctx.reply(`💳 *اطلاعات پرداخت*\n\nشما *${planName}* را انتخاب کردید.\n\nمبلغ *${priceFormatted}* را به حساب زیر انتقال دهید:\n\n${BANK_DETAILS}\n\n📸 *مهم:* پس از پرداخت، لطفاً عکس رسید یا اسکرین‌شات واریزی خود را مستقیماً در همین چت ارسال کنید.`, { parse_mode: 'Markdown' });
        }

        if (state.stage === 'AWAITING_RECEIPT') {
            if (ctx.message.photo || ctx.message.document) {
                const planName = state.plan;
                ctx.reply('✅ رسید شما دریافت شد! سیستم آن را برای مدیریت ارسال کرد. به محض تایید، کانفیگ شما به صورت خودکار همینجا ارسال خواهد شد.');

                const adminCaption = `💰 *رسید پرداخت جدید!*\n\nکاربر: ${ctx.from.first_name}\nآیدی: ${username}\nشناسه: \`${userId}\`\nبسته انتخابی: *${planName}*`;
                const adminButtons = Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✅ تایید سفارش', `approve_buy_${userId}`),
                        Markup.button.callback('❌ رد سفارش', `reject_buy_${userId}`)
                    ]
                ]);

                if (ctx.message.photo) {
                    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                    await bot.telegram.sendPhoto(ADMIN_ID, photoId, { caption: adminCaption, parse_mode: 'Markdown', ...adminButtons });
                } else {
                    await bot.telegram.sendDocument(ADMIN_ID, ctx.message.document.file_id, { caption: adminCaption, parse_mode: 'Markdown', ...adminButtons });
                }

                delete userStates[userId];
            } else {
                ctx.reply('❌ فرمت نامعتبر. لطفاً فقط تصویر رسید یا فایل اسکرین‌شات واریزی را ارسال کنید.');
            }
            return;
        }
    }
});

// --- VERCEL WEBHOOK HANDLER ---
module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            // Process the incoming update from Telegram
            await bot.handleUpdate(req.body, res);
        } else {
            // Ping to check if the server is active
            res.status(200).send('ArtiQ Vercel Bot is active and running.');
        }
    } catch (e) {
        console.error('Webhook Error:', e);
        res.status(500).send('Server Error');
    }
};