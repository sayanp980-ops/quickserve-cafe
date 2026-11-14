
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');

async function migrateData() {
    try {
        // Read existing JSON database
        const databasePath = path.join(__dirname, 'mock', 'db.json');
        const database = JSON.parse(
            fs.readFileSync(databasePath, 'utf8')
        );

        // Connect to MongoDB Atlas
        await mongoose.connect(process.env.MONGO_URI);

        console.log('MongoDB Connected!');

        // Store the complete database in MongoDB
        const collection = mongoose.connection.collection('quickserve_data');

        const { _id, ...data } = database;

        await collection.replaceOne(
            { _id: 'quickserve' },
            { ...data, _id: 'quickserve' },
            { upsert: true }
        );

        console.log('QuickServe Data Migrated Successfully!');
        console.log('Collections: quickserve_data');
    } catch (error) {
        console.error('Migration Failed:', error.message);
    } finally {
        await mongoose.disconnect();
    }
}

migrateData();
