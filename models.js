const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    username: String,
    firstName: String,
    balance: { type: Number, default: 0 },
    referralCode: { type: String, unique: true },
    referredBy: String,
    isBanned: { type: Boolean, default: false },
    ip: String,
    deviceInfo: String,
    warning: { type: Number, default: 0 },
    completedTasks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task' }]
});

const taskSchema = new mongoose.Schema({
    title: String,
    description: String,
    link: String,
    reward: { type: Number, default: 5 },
    category: { type: String, default: 'Join' },
    isActive: { type: Boolean, default: true },
    isOneTime: { type: Boolean, default: true },
    dailyLimit: { type: Number, default: 0 }, // 0 means unlimited
    expiryTime: Date,
    createdAt: { type: Date, default: Date.now }
});

const withdrawSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    amount: { type: Number, required: true },
    method: { type: String, enum: ['bKash', 'Nagad', 'Crypto'], required: true },
    accountNumber: { type: String, required: true },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Task = mongoose.model('Task', taskSchema);
const Withdraw = mongoose.model('Withdraw', withdrawSchema);

module.exports = { User, Task, Withdraw };
