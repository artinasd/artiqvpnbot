const { Telegraf, Markup } = require('telegraf');

// --- CONFIGURATION ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // Optional security secret
const BANK_DETAILS = "شماره کارت: <code>6219861947080387</code>\nبنام: آرتین اسعدی";
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || "Your_Personal_ID";

if (!BOT_TOKEN || !ADMIN_ID) {
    console.warn("CRITICAL WARNING: BOT_TOKEN and ADMIN_ID environment variables should be set!");
}

const bot = new Telegraf(BOT_TOKEN || "PLACEHOLDER_TOKEN");

// --- HELPER FUNCTIONS ---
// Escapes HTML characters in user inputs to prevent parser errors
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// --- STATE & DATA MANAGEMENT (Upstash Free Tier or In-Memory) ---
const memoryUserStates = {};
const memoryAdminStates = {};

// Automatically remove any trailing slashes from the URL if accidentally copied from Upstash
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL ? process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '') : undefined;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function getState(store, key) {
    if (UPSTASH_URL && UPSTASH_TOKEN) {
        try {
            const res = await fetch(`${UPSTASH_URL}/get/${store}:${key}`, {
                headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
            });
            const data = await res.json();
            return data.result ? JSON.parse(data.result) : null;
        } catch (e) {
            console.error("State GET error:", e);
        }
    }
    return store === 'user' ? memoryUserStates[key] : memoryAdminStates[key];
}

async function setState(store, key, value) {
    if (UPSTASH_URL && UPSTASH_TOKEN) {
        try {
            await fetch(`${UPSTASH_URL}/set/${store}:${key}/${encodeURIComponent(JSON.stringify(value))}`, {
                headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
            });
            return;
        } catch (e) {
            console.error("State SET error:", e);
        }
    }
    if (store === 'user') memoryUserStates[key] = value;
    else memoryAdminStates[key] = value;
}

async function deleteState(store, key) {
    if (UPSTASH_URL && UPSTASH_TOKEN) {
        try {
            await fetch(`${UPSTASH_URL}/del/${store}:${key}`, {
                headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
            });
            return;
        } catch (e) {
            console.error("State DEL error:", e);
        }
    }
    if (store === 'user') delete memoryUserStates[key];
    else delete memoryAdminStates[key];
}

// User Tracking Logic
async function trackUser(userId, isActive) {
    if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
    try {
        const endpoint = isActive ? 'sadd' : 'srem';
        await fetch(`${UPSTASH_URL}/${endpoint}/bot_users/${userId}`, {
            headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
        });
    } catch (e) {
        console.error("Tracking error:", e);
    }
}

async function getActiveUsers() {
    if (!UPSTASH_URL || !UPSTASH_TOKEN) return [];
    try {
        const res = await fetch(`${UPSTASH_URL}/smembers/bot_users`, {
            headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
        });
        const data = await res.json();
        return data.result || [];
    } catch (e) {
        console.error("Get users error:", e);
        return [];
    }
}

// Available VPN Plans (ArtiQ Packages)
const plans = [
    { id: 'plan_10g', name: 'اشتراک نامحدود (۱ ماهه)', price: '٣۰۰,۰۰۰ تومان' },
    { id: 'plan_10g', name: 'اشتراک ۱۰ گیگابایت (۱ ماهه)', price: '٤۰,۰۰۰ تومان' },
    { id: 'plan_20g', name: 'اشتراک ۲۰ گیگابایت (۱ ماهه)', price: '۷۰,۰۰۰ تومان' },
    { id: 'plan_50g', name: 'اشتراک ۵۰ گیگابایت (٢ ماهه)', price: '۱۵۰,۰۰۰ تومان' }
];

// --- MAIN MENU KEYBOARD ---
const mainMenu = Markup.keyboard([
    ['🎁 دریافت اکانت تست'],
    ['🛒 خرید اشتراک'],
    ['🎯 پشتیبانی']
]).resize();

// --- GLOBAL ERROR HANDLER ---
bot.catch(async (err, ctx) => {
    console.error(`Error for ${ctx.updateType}`, err);

    // If the error happened because the user blocked the bot, remove them from the active list
    if (err.description && err.description.includes('bot was blocked by the user')) {
        if (ctx.from && ctx.from.id) {
            await trackUser(ctx.from.id, false);
        }
    }
});

// --- USER ACTIONS & TRACKING ---

// Detect if a user blocks or unblocks the bot
bot.on('my_chat_member', async (ctx) => {
    const status = ctx.myChatMember.new_chat_member.status;
    if (status === 'kicked' || status === 'left') {
        await trackUser(ctx.chat.id, false);
    } else if (status === 'member') {
        await trackUser(ctx.chat.id, true);
    }
});

// Start Command
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    await deleteState('user', userId);
    await trackUser(userId, true); // Mark user as active
    await ctx.reply(`👋 به ربات آرتیک خوش آمدید! با یک اتصال امن، پایدار و پرسرعت از حریم خصوصی خود در اینترنت آزاد محافظت کنید.\n\nلطفاً برای شروع، یکی از گزینه‌های زیر را انتخاب کنید:`, mainMenu);
});

// --- ADMIN COMMANDS ---

bot.command('pingdb', async (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;

    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
        return await ctx.reply("❌ متغیرهای Upstash در Vercel یافت نشدند! مطمئن شوید نام آن‌ها دقیقاً درست است.");
    }

    try {
        const res = await fetch(`${UPSTASH_URL}/ping`, {
            headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
        });

        const text = await res.text();

        if (res.ok) {
            await ctx.reply(`✅ اتصال به دیتابیس برقرار است!\nپاسخ: ${text}`);
        } else {
            await ctx.reply(`⚠️ اتصال به سرور دیتابیس انجام شد اما با خطا مواجه شد:\nوضعیت: ${res.status}\nمتن خطا: ${text}`);
        }
    } catch (e) {
        await ctx.reply(`❌ خطای بحرانی در اتصال (شاید مشکل از Fetch یا اینترنت سرور باشد):\n${e.message}`);
    }
});

bot.command('users', async (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;
    const users = await getActiveUsers();
    await ctx.reply(`📊 تعداد کاربران فعال ربات: ${users.length} نفر`);
});

bot.command('broadcast', async (ctx) => {
    if (String(ctx.from.id) !== String(ADMIN_ID)) return;

    const messageText = ctx.message.text.replace('/broadcast', '').trim();

    if (!messageText && !ctx.message.reply_to_message) {
        return await ctx.reply('❌ نحوه استفاده:\n/broadcast متن پیام\nیا این دستور را روی پیام مورد نظر ریپلای (Reply) کنید.');
    }

    const users = await getActiveUsers();
    if (users.length === 0) return await ctx.reply('❌ هیچ کاربری یافت نشد (آیا دیتابیس متصل است؟).');

    await ctx.reply(`⏳ در حال ارسال پیام به ${users.length} کاربر...\nلطفاً تا دریافت پیام پایان صبر کنید.`);

    let success = 0;
    let failed = 0;

    for (const targetId of users) {
        try {
            if (ctx.message.reply_to_message) {
                await ctx.telegram.copyMessage(targetId, ctx.chat.id, ctx.message.reply_to_message.message_id);
            } else {
                await ctx.telegram.sendMessage(targetId, messageText);
            }
            success++;
            await new Promise(res => setTimeout(res, 50)); // Prevent Telegram spam limits
        } catch (e) {
            failed++;
            if (e.description && e.description.includes('bot was blocked by the user')) {
                await trackUser(targetId, false);
            }
        }
    }

    await ctx.reply(`✅ عملیات ارسال پایان یافت.\n\nتعداد موفق: ${success}\nتعداد ناموفق (بلاک شده و حذف از لیست): ${failed}`);
});

// --- MENU HANDLERS ---

bot.hears('🎁 دریافت اکانت تست', async (ctx) => {
    const userId = ctx.from.id;
    const firstName = escapeHtml(ctx.from.first_name);
    const username = ctx.from.username ? `@${escapeHtml(ctx.from.username)}` : 'بدون آیدی';

    await ctx.reply('⏳ درخواست اکانت تست شما برای مدیریت ارسال شد. لطفاً تا زمان تایید منتظر بمانید.');

    try {
        await bot.telegram.sendMessage(
            ADMIN_ID,
            `⚠️ <b>درخواست اکانت تست جدید</b>\n\nکاربر: ${firstName}\nآیدی: ${username}\nشناسه: <code>${userId}</code>`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ تایید و ارسال کانفیگ تست', `approve_test_${userId}`)]
                ])
            }
        );
    } catch (err) {
        console.error("Failed to notify admin:", err);
    }
});

bot.hears('🛒 خرید اشتراک', async (ctx) => {
    const buttons = plans.map(plan => [Markup.button.callback(`${plan.name} - ${plan.price}`, `select_plan_${plan.id}`)]);
    buttons.push([Markup.button.callback('🛠 ساخت بسته دلخواه (حجم و زمان)', 'select_custom')]);

    await ctx.reply('📋 لطفاً بسته مورد نظر خود را انتخاب کنید:', Markup.inlineKeyboard(buttons));

    const firstName = escapeHtml(ctx.from.first_name);
    const username = ctx.from.username ? `@${escapeHtml(ctx.from.username)}` : 'بدون آیدی';

    try {
        await bot.telegram.sendMessage(
            ADMIN_ID,
            `👁‍🗨 <b>اقدام به خرید</b>\nکاربر ${firstName} (${username}) در حال مشاهده لیست قیمت‌ها برای خرید است.`,
            { parse_mode: 'HTML' }
        );
    } catch (err) {
        console.error("Failed to send admin notification:", err);
    }
});

bot.hears('🎯 پشتیبانی', async (ctx) => {
    await ctx.reply(`ℹ️ برای هرگونه سوال، راهنمایی در اتصال یا پشتیبانی، مستقیماً با ما در ارتباط باشید:\n\n💬 @${SUPPORT_USERNAME}`);
});

// --- CALLBACK QUERY HANDLERS ---
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const adminId = ctx.from.id;
    const userId = ctx.from.id;

    await ctx.answerCbQuery().catch(() => {});

    if (data.startsWith('select_plan_')) {
        const planId = data.replace('select_plan_', '');
        const selectedPlan = plans.find(p => p.id === planId);

        if (selectedPlan) {
            await setState('user', userId, { stage: 'AWAITING_RECEIPT', plan: selectedPlan.name });
            await ctx.reply(
                `💳 <b>اطلاعات پرداخت</b>\n\nشما <b>${escapeHtml(selectedPlan.name)}</b> را انتخاب کردید.\n\nلطفاً مبلغ مورد نظر را به حساب زیر انتقال دهید:\n\n${BANK_DETAILS}\n\n📸 <b>مهم:</b> پس از پرداخت، لطفاً عکس رسید یا اسکرین‌شات واریزی خود را مستقیماً در همین چت ارسال کنید.`,
                { parse_mode: 'HTML' }
            );
        }
    } else if (data === 'select_custom') {
        await setState('user', userId, { stage: 'AWAITING_CUSTOM_TRAFFIC' });
        await ctx.reply(
            '🛠 شما ساخت بسته دلخواه را انتخاب کردید.\n\nلطفاً حجم مورد نیاز خود را <b>فقط به صورت عدد و به گیگابایت</b> وارد کنید (مثلاً: 15):',
            { parse_mode: 'HTML' }
        );
    } else if (data.startsWith('approve_test_')) {
        const targetUserId = data.replace('approve_test_', '');
        await setState('admin', adminId, { action: 'SEND_TEST', targetUser: targetUserId });
        await ctx.reply(
            `📝 لطفاً <b>کانفیگ تست</b> (متن، عکس، لینک یا فایل) برای کاربر <code>${targetUserId}</code> را ارسال کنید. پیام بعدی شما دقیقاً به همان شکلی که هست برای او ارسال می‌شود.`,
            { parse_mode: 'HTML' }
        );
    } else if (data.startsWith('approve_buy_')) {
        const targetUserId = data.replace('approve_buy_', '');
        await setState('admin', adminId, { action: 'SEND_BUY', targetUser: targetUserId });
        await ctx.reply(
            `📝 سفارش تایید شد! لطفاً <b>کانفیگ اصلی</b> (متن، عکس QR، لینک یا فایل) برای کاربر <code>${targetUserId}</code> را ارسال کنید. پیام بعدی شما دقیقاً به همان شکلی که هست برای او ارسال می‌شود.`,
            { parse_mode: 'HTML' }
        );
    } else if (data.startsWith('reject_buy_')) {
        const targetUserId = data.replace('reject_buy_', '');
        try {
            await bot.telegram.sendMessage(
                targetUserId,
                '❌ رسید پرداختی شما توسط مدیریت تایید نشد. اگر فکر می‌کنید اشتباهی رخ داده است، لطفاً با پشتیبانی تماس بگیرید.'
            );
            await ctx.reply(`❌ سفارش کاربر <code>${targetUserId}</code> رد شد و به او اطلاع داده شد.`, { parse_mode: 'HTML' });
        } catch (err) {
            await ctx.reply(`❌ ارسال پیام به کاربر ناموفق بود (ممکن است ربات را بلاک کرده باشد).`);
        }
    }
});

// --- MESSAGE HANDLING ---
bot.on('message', async (ctx) => {
    const userId = ctx.from.id;
    const firstName = escapeHtml(ctx.from.first_name);
    const username = ctx.from.username ? `@${escapeHtml(ctx.from.username)}` : 'بدون آیدی';

    // 1. Admin States
    if (Number(userId) === Number(ADMIN_ID)) {
        const adminState = await getState('admin', userId);
        if (adminState) {
            try {
                await ctx.telegram.copyMessage(adminState.targetUser, ctx.chat.id, ctx.message.message_id);

                if (adminState.action === 'SEND_TEST') {
                    await ctx.reply('✅ کانفیگ تست دقیقاً همان‌طور که ارسال کردید، به کاربر تحویل داده شد.');
                } else if (adminState.action === 'SEND_BUY') {
                    await ctx.reply('✅ کانفیگ اصلی دقیقاً همان‌طور که ارسال کردید، به کاربر تحویل داده شد.');
                }
            } catch (err) {
                console.error(err);
                await ctx.reply('❌ ارسال پیام به کاربر ناموفق بود. ممکن است ربات را بلاک کرده باشد.');
            }

            await deleteState('admin', userId);
            return;
        }
    }

    // 2. User States
    const userState = await getState('user', userId);
    if (userState) {
        if (userState.stage === 'AWAITING_CUSTOM_TRAFFIC') {
            if (!ctx.message.text) {
                return await ctx.reply('❌ لطفاً فقط یک عدد به عنوان حجم وارد کنید.');
            }

            const traffic = parseInt(ctx.message.text);
            if (isNaN(traffic) || traffic <= 0) {
                return await ctx.reply('❌ مقدار نامعتبر. لطفاً فقط یک عدد به عنوان حجم وارد کنید (مثلاً: 10):');
            }

            const calculatedPrice = traffic * 4000;
            await setState('user', userId, {
                stage: 'AWAITING_CUSTOM_DURATION',
                traffic: traffic,
                price: calculatedPrice
            });

            return await ctx.reply(
                `✅ حجم ${traffic} گیگابایت با موفقیت ثبت شد.\n💳 هزینه محاسبه شده: ${calculatedPrice.toLocaleString('en-US')} تومان\n\nلطفاً مدت زمان اعتبار بسته را به صورت متنی وارد کنید (مثلاً: ۱ ماهه، ۴۵ روزه):`
            );
        }

        if (userState.stage === 'AWAITING_CUSTOM_DURATION') {
            const duration = ctx.message.text;
            if (!duration) {
                return await ctx.reply('❌ لطفاً مدت زمان را به صورت متنی ارسال کنید.');
            }

            const planName = `بسته سفارشی (${userState.traffic} گیگابایت | ${duration})`;
            const priceFormatted = `${userState.price.toLocaleString('en-US')} تومان`;

            await setState('user', userId, { stage: 'AWAITING_RECEIPT', plan: planName });

            return await ctx.reply(
                `💳 <b>اطلاعات پرداخت</b>\n\nشما <b>${escapeHtml(planName)}</b> را انتخاب کردید.\n\nمبلغ <b>${priceFormatted}</b> را به حساب زیر انتقال دهید:\n\n${BANK_DETAILS}\n\n📸 <b>مهم:</b> پس از پرداخت، لطفاً عکس رسید یا اسکرین‌شات واریزی خود را مستقیماً در همین چت ارسال کنید.`,
                { parse_mode: 'HTML' }
            );
        }

        if (userState.stage === 'AWAITING_RECEIPT') {
            if (ctx.message.photo || ctx.message.document) {
                const planName = userState.plan;
                await ctx.reply('✅ رسید شما دریافت شد! سیستم آن را برای مدیریت ارسال کرد. به محض تایید، کانفیگ شما به صورت خودکار همینجا ارسال خواهد شد.');

                const adminCaption = `💰 <b>رسید پرداخت جدید!</b>\n\nکاربر: ${firstName}\nآیدی: ${username}\nشناسه: <code>${userId}</code>\nبسته انتخابی: <b>${escapeHtml(planName)}</b>`;
                const adminButtons = Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✅ تایید سفارش', `approve_buy_${userId}`),
                        Markup.button.callback('❌ رد سفارش', `reject_buy_${userId}`)
                    ]
                ]);

                try {
                    if (ctx.message.photo) {
                        const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                        await bot.telegram.sendPhoto(ADMIN_ID, photoId, { caption: adminCaption, parse_mode: 'HTML', ...adminButtons });
                    } else {
                        await bot.telegram.sendDocument(ADMIN_ID, ctx.message.document.file_id, { caption: adminCaption, parse_mode: 'HTML', ...adminButtons });
                    }
                } catch (err) {
                    console.error("Failed to forward receipt to admin:", err);
                }

                await deleteState('user', userId);
            } else {
                await ctx.reply('❌ فرمت نامعتبر. لطفاً فقط تصویر رسید یا فایل اسکرین‌شات واریزی را ارسال کنید.');
            }
            return;
        }
    }
});

// --- VERCEL WEBHOOK HANDLER ---
module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
                return res.status(403).send('Unauthorized');
            }

            await bot.handleUpdate(req.body);
            return res.status(200).send('OK');
        } else {
            return res.status(200).send('ArtiQ Vercel Bot is active and running.');
        }
    } catch (e) {
        console.error('Webhook Error:', e);
        // CRITICAL FIX: Always return 200 so Telegram stops the infinite retry loop!
        return res.status(200).send('OK');
    }
};