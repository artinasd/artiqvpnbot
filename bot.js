const { Telegraf, Markup } = require('telegraf');
const http = require('http');

// --- CONFIGURATION ---
// These variables should ideally be set as Environment Variables on your host.
// If testing locally, you can temporarily replace the process.env values with strings.
const BOT_TOKEN = '8683186346:AAHqc5jA4xaiC8qHmdbPHWadCSVi1OzPBqY';
const ADMIN_ID = '415981138'; // Your numeric Telegram ID (e.g., 123456789)
const BANK_DETAILS = process.env.BANK_DETAILS || "Bank: ExampleBank\nAccount Number: 1234-5678-9012\nCard Holder: John Doe";
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || "fdsawrcfvg"; // Without the '@'

if (!BOT_TOKEN || !ADMIN_ID) {
    console.error("CRITICAL ERROR: BOT_TOKEN and ADMIN_ID environment variables must be set!");
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// In-memory state tracking
const userStates = {};
const adminStates = {};

// Available VPN Plans
const plans = [
    { id: 'plan_1m', name: '1 Month High-Speed VPN', price: '$5' },
    { id: 'plan_3m', name: '3 Months High-Speed VPN', price: '$12' },
    { id: 'plan_6m', name: '6 Months High-Speed VPN', price: '$22' }
];

// --- MAIN MENU KEYBOARD ---
const mainMenu = Markup.keyboard([
    ['🎁 Get Test Account'],
    ['🛒 Buy VPN Plan'],
    ['🎯 Support']
]).resize();

// --- USER ACTIONS ---

// Start Command
bot.start((ctx) => {
    delete userStates[ctx.from.id];
    ctx.reply(`👋 Welcome to our premium VPN service! Protect your privacy with blazing-fast speeds.\n\nPlease choose an option below:`, mainMenu);
});

// Main Menu Text Handlers
bot.hears('🎁 Get Test Account', async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username ? `@${ctx.from.username}` : 'No Username';

    ctx.reply('⏳ Your request for a test account has been sent to the admin. Please wait for approval.');

    // Notify Admin
    await bot.telegram.sendMessage(ADMIN_ID, `⚠️ *New Test Account Request*\n\nUser: ${ctx.from.first_name}\nUsername: ${username}\nID: \`${userId}\``, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Approve & Send Test Config', `approve_test_${userId}`)]
        ])
    });
});

bot.hears('🛒 Buy VPN Plan', (ctx) => {
    const buttons = plans.map(plan => [Markup.button.callback(`${plan.name} - ${plan.price}`, `select_${plan.id}`)]);
    ctx.reply('📋 Please select your desired VPN plan:', Markup.inlineKeyboard(buttons));
});

bot.hears('🎯 Support', (ctx) => {
    ctx.reply(`ℹ️ For any issues, setup assistance, or inquiries, please contact our support team directly:\n\n💬 @${SUPPORT_USERNAME}`);
});

// Inline Keyboard Callback Handlers
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const adminId = ctx.from.id;

    // User selects a subscription plan
    if (data.startsWith('select_')) {
        const planId = data.replace('select_', '');
        const selectedPlan = plans.find(p => p.id === planId);

        userStates[ctx.from.id] = { stage: 'AWAITING_RECEIPT', plan: selectedPlan.name };

        await ctx.answerCbQuery();
        await ctx.reply(`💳 *Payment Information*\n\nYou selected: *${selectedPlan.name}*\n\nPlease transfer the corresponding amount to the following account:\n\n\`${BANK_DETAILS}\`\n\n📸 *Important:* After paying, upload a screenshot of your payment receipt/invoice directly in this chat.`, { parse_mode: 'Markdown' });
    }

    // Admin approves a Test request
    if (data.startsWith('approve_test_')) {
        const targetUserId = data.replace('approve_test_', '');
        adminStates[adminId] = { action: 'SEND_TEST', targetUser: targetUserId };

        await ctx.answerCbQuery();
        await ctx.reply(`📝 Please paste or type the *Test VPN Config* for user \`${targetUserId}\`. The next message you send will be delivered to them directly.`, { parse_mode: 'Markdown' });
    }

    // Admin approves a Buy request
    if (data.startsWith('approve_buy_')) {
        const targetUserId = data.replace('approve_buy_', '');
        adminStates[adminId] = { action: 'SEND_BUY', targetUser: targetUserId };

        await ctx.answerCbQuery();
        await ctx.reply(`📝 Order Approved! Please paste or type the *Premium VPN Config* for user \`${targetUserId}\`. The next message you send will be delivered to them directly.`, { parse_mode: 'Markdown' });
    }

    // Admin rejects a Buy request
    if (data.startsWith('reject_buy_')) {
        const targetUserId = data.replace('reject_buy_', '');

        await ctx.answerCbQuery();
        await bot.telegram.sendMessage(targetUserId, '❌ Your payment receipt was rejected by the admin. If you believe this is a mistake, please contact support.');
        await ctx.reply(`❌ Order for user \`${targetUserId}\` has been rejected and they have been notified.`);
    }
});

// --- MESSAGE HANDLING (Receipts & Config Delivery) ---

bot.on('message', async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username ? `@${ctx.from.username}` : 'No Username';

    // 1. Handle Admin States (Delivering VPN configs to users)
    if (Number(userId) === Number(ADMIN_ID) && adminStates[userId]) {
        const state = adminStates[userId];
        const configMessage = ctx.message.text || (ctx.message.document ? `Document: ${ctx.message.document.file_id}` : null);

        if (!configMessage) {
            return ctx.reply('❌ Please send the configuration as text or a valid file.');
        }

        try {
            if (state.action === 'SEND_TEST') {
                await bot.telegram.sendMessage(state.targetUser, `🎁 *Your Test VPN Account is Ready!*\n\n\`\`\`\n${ctx.message.text || 'See attached file'}\n\`\`\`\n_Valid for a limited time._`, { parse_mode: 'Markdown' });
                if (ctx.message.document) {
                    await bot.telegram.sendDocument(state.targetUser, ctx.message.document.file_id);
                }
                await ctx.reply('✅ Test account configuration successfully sent to the user.');
            }

            else if (state.action === 'SEND_BUY') {
                await bot.telegram.sendMessage(state.targetUser, `🚀 *Your Premium VPN Account is Ready!*\n\nThank you for your purchase. Here is your configuration access:\n\n\`\`\`\n${ctx.message.text || 'See attached file'}\n\`\`\`\nEnjoy your high-speed secure connection!`, { parse_mode: 'Markdown' });
                if (ctx.message.document) {
                    await bot.telegram.sendDocument(state.targetUser, ctx.message.document.file_id);
                }
                await ctx.reply('✅ Premium account configuration successfully sent to the user.');
            }
        } catch (err) {
            console.error(err);
            await ctx.reply('❌ Failed to send message to the user. They may have blocked the bot.');
        }

        delete adminStates[userId];
        return;
    }

    // 2. Handle User States (Uploading receipts)
    if (userStates[userId] && userStates[userId].stage === 'AWAITING_RECEIPT') {
        if (ctx.message.photo || ctx.message.document) {
            const planName = userStates[userId].plan;

            ctx.reply('✅ Receipt received! It has been forwarded to the administration team for verification. You will receive your configuration as soon as it is approved.');

            // Forward receipt details to Admin
            const adminCaption = `💰 *New Purchase Order Received!*\n\nUser: ${ctx.from.first_name}\nUsername: ${username}\nID: \`${userId}\`\nPlan Ordered: *${planName}*`;
            const adminButtons = Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Approve Order', `approve_buy_${userId}`),
                    Markup.button.callback('❌ Reject Order', `reject_buy_${userId}`)
                ]
            ]);

            if (ctx.message.photo) {
                // Send highest resolution photo option
                const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                await bot.telegram.sendPhoto(ADMIN_ID, photoId, { caption: adminCaption, parse_mode: 'Markdown', ...adminButtons });
            } else {
                await bot.telegram.sendDocument(ADMIN_ID, ctx.message.document.file_id, { caption: adminCaption, parse_mode: 'Markdown', ...adminButtons });
            }

            delete userStates[userId];
        } else {
            ctx.reply('❌ Invalid input. Please upload an image receipt file or a screenshot document.');
        }
        return;
    }
});

// --- KEEP ALIVE HTTP SERVER ---
// Free hosting services require a web server running on an allocated port to prevent deployment failures.
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('VPN Telegram Bot Is Active And Running!\n');
});

server.listen(PORT, () => {
    console.log(`Keep-alive web server is running on port ${PORT}`);
});

// Launch Bot via Long Polling
bot.launch().then(() => {
    console.log('Telegram Bot successfully initiated and polling updates...');
});

// Graceful stop configurations
process.once('SIGINT', () => { bot.stop('SIGINT'); server.close(); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); server.close(); });
