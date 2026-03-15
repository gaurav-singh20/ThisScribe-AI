import { Router } from 'express';
import fs from 'fs/promises';
import multer from 'multer';
import { fileURLToPath } from 'url';
import Chat from '../models/Chat.js';
import { uploadPdf } from '../middleware/upload.js';

const router = Router();
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';

class AIServiceError extends Error {
  constructor(message, statusCode = 503) {
    super(message);
    this.name = 'AIServiceError';
    this.statusCode = statusCode;
  }
}

const handleUpload = (req, res) =>
  new Promise((resolve, reject) => {
    uploadPdf.single('pdf')(req, res, (err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });

const handleMessagePayload = (req, res) =>
  new Promise((resolve, reject) => {
    uploadPdf.single('file')(req, res, (err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });

const processDocumentWithAI = async ({ chatId, filePath, vectorCollection }) => {
  let response;
  try {
    response = await fetch(`${AI_SERVICE_URL}/process-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, filePath, vectorCollection }),
    });
  } catch (err) {
    throw new AIServiceError(
      `AI service is unreachable at ${AI_SERVICE_URL}. Start FastAPI service and try again.`
    );
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AIServiceError(
      data.detail || data.error || 'Failed to process document',
      response.status >= 500 ? 503 : 400
    );
  }
};

const queryAIService = async ({
  chatId,
  question,
  vectorCollection,
  conversationHistory,
}) => {
  let response;
  try {
    response = await fetch(`${AI_SERVICE_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId,
        question,
        vectorCollection,
        conversationHistory,
      }),
    });
  } catch (err) {
    throw new AIServiceError(
      `AI service is unreachable at ${AI_SERVICE_URL}. Start FastAPI service and try again.`
    );
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AIServiceError(
      data.detail || data.error || 'Failed to query AI service',
      response.status >= 500 ? 503 : 400
    );
  }

  if (!data.answer) {
    throw new Error('AI service returned an empty answer');
  }

  return data.answer;
};

const queryAIServiceStream = async ({
  chatId,
  question,
  vectorCollection,
  conversationHistory,
  onToken,
}) => {
  let response;
  try {
    response = await fetch(`${AI_SERVICE_URL}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        chatId,
        question,
        vectorCollection,
        conversationHistory,
      }),
    });
  } catch (_err) {
    throw new AIServiceError(
      `AI service is unreachable at ${AI_SERVICE_URL}. Start FastAPI service and try again.`
    );
  }

  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new AIServiceError(
      data.detail || data.error || 'Failed to query AI service',
      response.status >= 500 ? 503 : 400
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload = {
    answer: '',
    chunksRetrieved: 0,
    sources: [],
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const eventBlock of events) {
      const line = eventBlock
        .split('\n')
        .find((candidate) => candidate.startsWith('data:'));
      if (!line) continue;

      const raw = line.slice(5).trim();
      if (!raw) continue;

      let event;
      try {
        event = JSON.parse(raw);
      } catch {
        continue;
      }

      if (event.type === 'token') {
        const token = event.token || '';
        if (token) {
          finalPayload.answer += token;
          onToken(token);
        }
      }

      if (event.type === 'done') {
        finalPayload = {
          answer: event.answer || finalPayload.answer,
          chunksRetrieved: event.chunksRetrieved || 0,
          sources: event.sources || [],
        };
      }

      if (event.type === 'error') {
        throw new AIServiceError(event.error || 'AI streaming failed');
      }
    }
  }

  return finalPayload;
};

// POST /api/chat/new — create a new empty chat session
router.post('/new', async (req, res) => {
  try {
    const chat = await Chat.create({});
    res.status(201).json(chat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat — list all chats (metadata only, messages excluded for performance)
router.get('/', async (req, res) => {
  try {
    const chats = await Chat.find({}, { messages: 0 }).sort({ updatedAt: -1 });
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/:chatId — fetch a specific chat with all messages
router.get('/:chatId', async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json(chat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/:chatId/upload — upload a PDF and associate it with a chat
router.post('/:chatId/upload', async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    await handleUpload(req, res);

    if (!req.file) {
      return res.status(400).json({ error: 'PDF file is required' });
    }

    const nextPdfFile = `/uploads/${req.file.filename}`;
    const nextVectorCollection = `chat_${chat._id}`;
    const nextAbsoluteFilePath = fileURLToPath(
      new URL(`..${nextPdfFile}`, import.meta.url)
    );

    await processDocumentWithAI({
      chatId: String(chat._id),
      filePath: nextAbsoluteFilePath,
      vectorCollection: nextVectorCollection,
    });

    if (chat.pdfFile?.startsWith('/uploads/')) {
      const existingFilePath = new URL(`..${chat.pdfFile}`, import.meta.url);
      await fs.unlink(existingFilePath).catch(() => null);
    }

    chat.pdfFile = nextPdfFile;
    chat.vectorCollection = nextVectorCollection;
    await chat.save();

    res.json({
      success: true,
      message: 'PDF uploaded successfully',
      pdfFile: chat.pdfFile,
    });
  } catch (err) {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Only PDF files are allowed'
          : err.message;
      return res.status(400).json({ error: message });
    }

    if (err instanceof AIServiceError) {
      return res.status(err.statusCode).json({ error: err.message });
    }

    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/:chatId/message — add a user message, return placeholder bot reply
// TODO: replace the placeholder reply with a call to the AI service (FastAPI / RAG)
router.post('/:chatId/message', async (req, res) => {
  const wantsStream = req.headers.accept?.includes('text/event-stream');

  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
  }

  try {
    await handleMessagePayload(req, res);

    const content = req.body.message?.trim() || '';
    const hasFile = Boolean(req.file);

    if (!content && !hasFile) {
      if (wantsStream) {
        res.write(
          `data: ${JSON.stringify({
            type: 'error',
            error: 'Message text or PDF attachment is required',
          })}\n\n`
        );
        return res.end();
      }
      return res
        .status(400)
        .json({ error: 'Message text or PDF attachment is required' });
    }

    const chat = await Chat.findById(req.params.chatId);
    if (!chat) {
      if (wantsStream) {
        res.write(
          `data: ${JSON.stringify({ type: 'error', error: 'Chat not found' })}\n\n`
        );
        return res.end();
      }
      return res.status(404).json({ error: 'Chat not found' });
    }

    if (hasFile) {
      if (chat.pdfFile?.startsWith('/uploads/')) {
        const existingFilePath = new URL(`..${chat.pdfFile}`, import.meta.url);
        await fs.unlink(existingFilePath).catch(() => null);
      }

      chat.pdfFile = `/uploads/${req.file.filename}`;
      chat.vectorCollection = `chat_${chat._id}`;

      const absoluteFilePath = fileURLToPath(
        new URL(`..${chat.pdfFile}`, import.meta.url)
      );
      await processDocumentWithAI({
        chatId: String(chat._id),
        filePath: absoluteFilePath,
        vectorCollection: chat.vectorCollection,
      });
    }

    let userMessage = null;
    let botMessage = null;

    if (content) {
      const conversationHistory = chat.messages.slice(-12).map((message) => ({
        role: message.role,
        content: message.content,
      }));

      // Auto-title the chat from the first user message
      if (chat.messages.length === 0) {
        chat.title = content.slice(0, 50);
      }

      chat.messages.push({ role: 'user', content });

      let botReply;
      if (!chat.vectorCollection) {
        botReply = 'Please upload and scan a document before asking questions.';
      } else {
        try {
          if (wantsStream) {
            const streamResult = await queryAIServiceStream({
              chatId: String(chat._id),
              question: content,
              vectorCollection: chat.vectorCollection,
              conversationHistory,
              onToken: (token) => {
                res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
              },
            });
            botReply = streamResult.answer;
          } else {
            botReply = await queryAIService({
              chatId: String(chat._id),
              question: content,
              vectorCollection: chat.vectorCollection,
              conversationHistory,
            });
          }
        } catch (aiErr) {
          console.error('AI query failed:', aiErr);
          botReply =
            'I could not reach the AI service right now. Please make sure the AI service is running and try again.';
        }
      }

      chat.messages.push({ role: 'assistant', content: botReply });
    }

    await chat.save();

    if (content) {
      const saved = chat.messages;
      userMessage = saved[saved.length - 2];
      botMessage = saved[saved.length - 1];
    }

    if (wantsStream) {
      res.write(
        `data: ${JSON.stringify({
          type: 'done',
          userMessage,
          botMessage,
          chatTitle: chat.title,
          pdfFile: chat.pdfFile,
        })}\n\n`
      );
      return res.end();
    }

    res.json({
      success: true,
      userMessage,
      botMessage,
      chatTitle: chat.title,
      pdfFile: chat.pdfFile,
      message: 'Chat input processed successfully',
    });
  } catch (err) {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Only PDF files are allowed'
          : err.message;
      if (wantsStream) {
        res.write(
          `data: ${JSON.stringify({ type: 'error', error: message })}\n\n`
        );
        return res.end();
      }
      return res.status(400).json({ error: message });
    }

    if (err instanceof AIServiceError) {
      if (wantsStream) {
        res.write(
          `data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`
        );
        return res.end();
      }
      return res.status(err.statusCode).json({ error: err.message });
    }

    if (wantsStream) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      return res.end();
    }

    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chat/:chatId — permanently delete a chat session
router.delete('/:chatId', async (req, res) => {
  try {
    const chat = await Chat.findByIdAndDelete(req.params.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json({ message: 'Chat deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
