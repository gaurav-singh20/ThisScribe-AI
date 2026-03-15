import express from 'express';
import cors from 'cors';
import { connectDB } from './db.js';
import chatRoutes from './routes/chat.js';

const PORT = Number(process.env.PORT || 5001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST', 'DELETE'],
  })
);
app.use(express.json());
app.use('/uploads', express.static('uploads'));

app.use('/api/chat', chatRoutes);

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`ThisScribe server running on port ${PORT}`);
  });
});