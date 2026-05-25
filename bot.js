require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { User, Task, Withdraw } = require('./models');

// Initialize Express for Web Dashboard (Will serve HTML later)
const app = express();
app.use(express.json());
app.use(express.static('public')); 

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS.split(',').map(id => id.toString());
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB Connected!'))
    .catch(err => console.log(err));

// ================= ANTI-FRAUD & SECURITY SYSTEM =================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Device & IP Tracking (Basic)
    // Note: Real IP tracking requires a webhook setup instead of polling. 
    // For polling, we track user agent via deep linking if sent.
    
    let user = await User.findOne({ telegramId: chatId.toString() });
    
    if (!user) {
        // Referral System Check
        let referrer = null;
        if (text.includes('ref_')) {
            referrer = text.split('ref_')[1];
            // Anti-Fraud: Check if referrer is creating fake accounts
            const refUser = await User.findOne({ referralCode: referrer });
            if (refUser) {
                const sameIPUsers = await User.find({ ip: msg.from?.ip }); // Placeholder
                if (sameIPUsers.length > 2) {
                    // Suspicious activity detected
                    bot.sendMessage(chatId, "⚠️ সন্দেহজনক কার্যকলাপ শনাক্ত হয়েছে। আপনার অ্যাকাউন্ট সীমাবদ্ধ।");
                    return;
                }
            }
        }

        const refCode = crypto.randomBytes(4).toString('hex');
        user = new User({
            telegramId: chatId.toString(),
            username: msg.from.username,
            firstName: msg.from.first_name,
            referralCode: refCode,
            referredBy: referrer
        });
        
        if (referrer) {
            const inviter = await User.findOne({ referralCode: referrer });
            if (inviter) {
                inviter.balance += 2; // Referral Bonus
                await inviter.save();
                bot.sendMessage(inviter.telegramId, `🎉 আপনার রেফারেল থেকে ২ কয়েন পেয়েছেন!`);
            }
        }
        await user.save();
    }

    if (user.isBanned) {
        return bot.sendMessage(chatId, "🚫 আপনার অ্যাকাউন্ট ব্যান করা হয়েছে। অ্যাডমিনের সাথে যোগাযোগ করুন।");
    }

    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "💼 টাস্ক করুন", callback_data: 'show_tasks' }],
                [{ text: "💰 ব্যালেন্স দেখুন", callback_data: 'check_balance' }, { text: "👥 রেফার করুন", callback_data: 'refer_menu' }],
                [{ text: "💸 উইথড্র", callback_data: 'withdraw_menu' }, { text: "🌐 ওয়েব ড্যাশবোর্ড", url: `https://your-domain.com/user?uid=${chatId}` }]
            ]
        }
    };
    bot.sendMessage(chatId, `স্বাগতম ${user.firstName}!\nআজকে টাস্ক করে আয় করুন।`, opts);
});

// ================= TASK SYSTEM =================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    const user = await User.findOne({ telegramId: chatId.toString() });

    if (!user || user.isBanned) return;

    if (data === 'show_tasks') {
        const tasks = await Task.find({ isActive: true, expiryTime: { $gt: new Date() } });
        if (tasks.length === 0) return bot.answerCallbackQuery(query.id, { text: "এখন কোনো টাস্ক নেই।" });

        let keyboard = [];
        tasks.forEach(task => {
            keyboard.push([{ text: `${task.title} (পুরস্কার: ${task.reward}৳)`, callback_data: `task_${task._id}` }]);
        });
        keyboard.push([{ text: "« মেইন মেনু", callback_data: 'back_home' }]);

        bot.editMessageText("নিচের টাস্কগুলো থেকে একটি বেছে নিন:", {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    else if (data.startsWith('task_')) {
        const taskId = data.split('_')[1];
        const task = await Task.findById(taskId);
        
        if (!task) return bot.answerCallbackQuery(query.id, { text: "টাস্ক পাওয়া যায়নি।" });

        // Anti-Fraud: One-time task check
        if (task.isOneTime && user.completedTasks.includes(task._id)) {
            return bot.answerCallbackQuery(query.id, { text: "❌ আপনি এই টাস্কটি আগেই করেছেন।" });
        }

        // Generate Secure Temporary Link (Protected Link System)
        const token = crypto.randomBytes(16).toString('hex');
        
        let keyboard = [
            [{ text: "🔗 লিংকে যান", url: task.link }],
            [{ text: "📸 স্ক্রিনশট পাঠান", callback_data: `req_ss_${taskId}_${token}` }],
            [{ text: "« টাস্ক লিস্টে ফিরে যান", callback_data: 'show_tasks' }]
        ];

        bot.editMessageText(`টাস্ক: ${task.title}\nবিবরণ: ${task.description}\n\nলিংকে প্রবেশ করে জয়েন করুন। তারপর নিচের 'স্ক্রিনশট পাঠান' বাটনে ক্লিক করে প্রুফ পাঠান।`, {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    else if (data.startsWith('req_ss_')) {
        const parts = data.split('_');
        const taskId = parts[2];
        // const token = parts[3]; // In real app, verify token expiry from DB

        bot.sendMessage(chatId, "এখন জয়েন করার স্ক্রিনশটটি এখানে পাঠান। (শুধুমাত্র ছবি পাঠাবেন)");
        bot.once('photo', async (msg) => {
            const photoId = msg.photo[msg.photo.length - 1].file_id;
            
            // Forward Screenshot to Admin Log Channel with User Info
            bot.forwardPhoto(LOG_CHANNEL_ID, chatId, msg.message_id);
            bot.sendMessage(LOG_CHANNEL_ID, 
                `👤 ইউজার: ${user.firstName} (@${user.username})\n` +
                `🆔 আইডি: <code>${chatId}</code>\n` +
                `📊 টাস্ক আইডি: <code>${taskId}</code>\n\n` +
                `বাটন চাপুন একশন নিতে:`, 
                {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Approve (দেওয়া)", callback_data: `admin_approve_${chatId}_${taskId}` }],
                            [{ text: "❌ Reject (ফেরত)", callback_data: `admin_reject_${chatId}` }]
                        ]
                    }
                }
            );
            bot.sendMessage(chatId, "আপনার স্ক্রিনশট অ্যাডমিনের কাছে পাঠানো হয়েছে। রিভিউ হওয়ার জন্য অপেক্ষা করুন।");
        });
    }

    // ================= BALANCE & WITHDRAW =================
    else if (data === 'check_balance') {
        bot.answerCallbackQuery(query.id, { text: `আপনার ব্যালেন্স: ${user.balance} টাকা` });
    }
    else if (data === 'withdraw_menu') {
        bot.sendMessage(chatId, "উইথড্র মেনু (অ্যাডমিন এপ্রুভাল ছাড়া পেমেন্ট হবে না)\nফরম্যাট: /withdraw পরিমাণ bKash/Nagad নম্বর\nউদাহরণ: /withdraw 100 bKash 017XXXXXX");
    }
    else if (data === 'refer_menu') {
        bot.editMessageText(`আপনার রেফারেল লিংক:\nhttps://t.me/${bot.options.username}?start=ref_${user.referralCode}\n\nপ্রতি রেফারেলে ২ টাকা পাবেন!`, {
            chat_id: chatId, message_id: query.message.message_id,
            reply_markup: { inline_keyboard: [[{ text: "« মেইন মেনু", callback_data: 'back_home' }]] }
        });
    }
    else if (data === 'back_home') {
        bot.onText(/\/start/, (msg) => {}); // Trigger start again workaround
        bot.sendMessage(chatId, "/start কমান্ডটি আবার দিন।");
    }
});

// Withdraw Command
bot.onText(/\/withdraw (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const args = match[1].split(' ');
    const amount = parseFloat(args[0]);
    const method = args[1];
    const account = args[2];

    if (amount < 50) return bot.sendMessage(chatId, "❌ মিনিমাম উইথড্র ৫০ টাকা।");
    
    const user = await User.findOne({ telegramId: chatId.toString() });
    if (user.balance < amount) return bot.sendMessage(chatId, "❌ আপনার পর্যাপ্ত ব্যালেন্স নেই।");

    user.balance -= amount;
    await user.save();

    await new Withdraw({ userId: chatId.toString(), amount, method, accountNumber: account }).save();
    bot.sendMessage(chatId, "✅ আপনার উইথড্র রিকোয়েস্ট জমা হয়েছে। অ্যাডমিন অ্যাপ্রুভ করলে পেমেন্ট চলে যাবে।");
});

// ================= ADMIN PANEL (BOT COMMANDS) =================
// Admin: Approve Screenshot
bot.on('callback_query', async (query) => {
    const data = query.data;
    if (!ADMIN_IDS.includes(query.from.id.toString())) return;

    if (data.startsWith('admin_approve_')) {
        const parts = data.split('_');
        const userId = parts[2];
        const taskId = parts[3];

        const user = await User.findOne({ telegramId: userId });
        const task = await Task.findById(taskId);

        if (user && task) {
            if (!user.completedTasks.includes(task._id)) {
                user.balance += task.reward;
                user.completedTasks.push(task._id);
                await user.save();
                bot.sendMessage(userId, `🎉 অভিনন্দন! "${task.title}" টাস্ক অ্যাপ্রুভ হয়েছে। আপনি ${task.reward} টাকা পেয়েছেন।`);
            }
        }
        bot.answerCallbackQuery(query.id, { text: "অ্যাপ্রুভ করা হয়েছে!" });
    }
    else if (data.startsWith('admin_reject_')) {
        const userId = data.split('_')[2];
        bot.sendMessage(userId, "❌ আপনার স্ক্রিনশট রিজেক্ট করা হয়েছে। সঠিক স্ক্রিনশট পাঠান।");
        bot.answerCallbackQuery(query.id, { text: "রিজেক্ট করা হয়েছে!" });
    }
    else if (data === 'admin_ban_user') {
        // Implementation for banning
    }
});

// Admin Task Creation Command
bot.onText(/\/addtask (.+)/, async (msg, match) => {
    if (!ADMIN_IDS.includes(msg.from.id.toString())) return;
    const args = match[1].split('|');
    // Format: /addtask Title | Description | Link | Reward
    const newTask = new Task({
        title: args[0].trim(),
        description: args[1].trim(),
        link: args[2].trim(),
        reward: parseFloat(args[3].trim())
    });
    await newTask.save();
    bot.sendMessage(msg.chat.id, "✅ নতুন টাস্ক যোগ করা হয়েছে।");
});


// ================= WEB DASHBOARD API (For VPS) =================
app.get('/api/stats', async (req, res) => {
    // In real app, add admin auth middleware here
    const totalUsers = await User.countDocuments();
    const pendingWithdraws = await Withdraw.countDocuments({ status: 'Pending' });
    res.json({ totalUsers, pendingWithdraws });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Web Dashboard running on port ${PORT}`);
});
