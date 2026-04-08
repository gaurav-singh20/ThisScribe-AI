import 'dotenv/config';

const isProduction = process.env.NODE_ENV === 'production';

const getEnv = (name, devFallback) => {
  const value = process.env[name];
  if (value) return value;

  if (!isProduction && typeof devFallback !== 'undefined') {
    return devFallback;
  }

  throw new Error(`Missing required environment variable: ${name}`);
};

const parsedPort = Number(getEnv('PORT', '5001'));
if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
  throw new Error('PORT must be a valid positive number');
}

export const PORT = parsedPort;
export const CLIENT_ORIGIN = getEnv('CLIENT_ORIGIN', 'http://localhost:5173');
export const MONGO_URI = getEnv('MONGO_URI', 'mongodb://localhost:27017/thisscribe');
export const AI_SERVICE_URL = getEnv('AI_SERVICE_URL', 'http://127.0.0.1:8000');
