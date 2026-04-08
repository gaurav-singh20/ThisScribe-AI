import express from 'express';
import cors from 'cors';
import { connectDB } from './db.js';
import chatRoutes from './routes/chat.js';
import { CLIENT_ORIGIN, PORT } from './config.js';

const app = express();

app.use(
  cors({ //allow requests from frontend from allowed origin only and for allowed methods only
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST', 'DELETE'],
  })
);
app.use(express.json()); //Allows server to read JSON data from requests.
app.use('/uploads', express.static('uploads')); //Makes the uploads folder publicly accessible.

app.use('/api/chat', chatRoutes); //Mounts the chat router.

connectDB().then(() => { //connect db
  app.listen(PORT, () => { //start server
    console.log(`ThisScribe server running on port ${PORT}`);
  });
});