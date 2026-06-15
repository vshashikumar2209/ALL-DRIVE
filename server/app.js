import dotenv from 'dotenv'; // Server restart trigger

dotenv.config({ path: "../.env" });
import { createFileIndexes } from '../utils/fileIndexes.js';

import express from 'express';
import cors from 'cors';
import routes from '../routes/allRoutes.js';
import logger from '../middleware/logger.js';
import mongoose from 'mongoose';
// import cookieParser from 'cookie-parser'`;
import session from "express-session";
import MongoStore from "connect-mongo";
// dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI;
// import dotenv from "dotenv";

console.log("JWT_SECRET =", process.env.JWT_SECRET);
import "../middleware/authMiddleware.js";
// import authMiddleware from "../middleware/authMiddleware.js";
// Connect to MongoDB before starting the server

app.use(logger);
//Allow requests from the frontend
app.use(cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

// Trust the first proxy (Vercel/Heroku)
app.set('trust proxy', 1);

const isProduction = process.env.NODE_ENV === 'production';

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI
    }),
    cookie: {
        secure: isProduction, // true in production, false locally
        httpOnly: true,
        sameSite: isProduction ? "none" : "lax" // "none" for cross-site (prod), "lax" for local
    }
}));


// app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// app.use(cookieParser());
app.use('/api', routes);

app.get('/', (_, res) => {
    res.send('AllDrive API is running')
})
app.get('/health', (_, res) => {
    res.status(200).send('OK')
})

app.listen(PORT, () => {
    console.log(`Server is running on port : ${PORT}`);
});


if (!MONGO_URI) {
    console.error('MONGO_URI is not defined');
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('Connected to MongoDB'))
        .catch(err => console.error('MongoDB connection failed:', err.message));
    mongoose.connection.once('open', async () => {
        await createFileIndexes();
    })
}