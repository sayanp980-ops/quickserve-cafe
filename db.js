
require('dotenv').config();
const mongoose = require('mongoose');

async function connectDatabase() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Database Connected!');
}

async function getDatabase() {
    const collection = mongoose.connection.collection('quickserve_data');

    const data = await collection.findOne({ _id: 'quickserve' });

    if (!data) {
        throw new Error('QuickServe database data not found!');
    }

    const { _id, ...database } = data;
    return database;
}

async function saveDatabase(database) {
    const collection = mongoose.connection.collection('quickserve_data');

    await collection.replaceOne(
        { _id: 'quickserve' },
        { ...database, _id: 'quickserve' },
        { upsert: true }
    );
}

module.exports = {
    connectDatabase,
    getDatabase,
    saveDatabase
};
