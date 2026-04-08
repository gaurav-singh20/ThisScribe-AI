import { Router } from 'express';
import fs from 'fs/promises';
import multer from 'multer';
import { fileURLToPath } from 'url';
import Chat from '../models/Chat.js';
import { uploadPdf } from '../middleware/upload.js';
import { AI_SERVICE_URL } from '../config.js';

const router = Router();

class AIServiceError extends Error {
  constructor(message, statusCode = 503, payload = null) {
    super(message);
    this.name = 'AIServiceError';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

const AI_UNAVAILABLE_MESSAGE =
  'The AI response service is currently unavailable because this application relies on a locally hosted language model (Ollama), which is not accessible in the deployed environment. Please run the application locally to enable full functionality.';

const AI_UNAVAILABLE_PAYLOAD = {
  success: false,
  message: AI_UNAVAILABLE_MESSAGE,
};

const isAIUnavailablePayload = (payload) =>
  Boolean(
    payload &&
      payload.success === false &&
      typeof payload.message === 'string' &&
      payload.message === AI_UNAVAILABLE_MESSAGE
  );

//Promise ka matlab hota hai “result baad me milega”, aur `await` ka matlab hota hai “yahin ruk jao (sirf iss function me) 
// jab tak result na aa jaye”. Callback ka matlab hota hai “jab kaam khatam ho jaye tab mujhe call kar dena”, lekin usme code aage 
// turant badh jata hai (wait nahi karta). Multer callback-based hai, isliye wo file upload start karke turant next line pe chala 
// jata hai bina yeh confirm kiye ki PDF save hui ya nahi — yahin problem aa sakti hai agar hume `req.file` turant chahiye ho. Isliye 
// hum callback ko Promise me wrap karte hain, taki Promise `resolve` tab ho jab upload complete ho jaye. Phir `await` use karke hum bolte 
// hain: “ruk jao yahin jab tak upload complete nahi hota”. Simple analogy: Callback = “kaam ho jaye toh batana”, Promise = “result baad 
// me milega”, Await = “main yahin wait karunga jab tak kaam complete nahi hota”.


const handleUpload = (req, res) =>
  new Promise((resolve, reject) => {
    uploadPdf.single('pdf')(req, res, (err) => { //Expect ONE file from the request, with field name 'pdf'. source-> middleware/uploads
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });

//JSON → simple stream → parsed by express.json()
//FormData → complex multipart stream → parsed by multer. just by using .single function, it parses and 
//if file → save to disk → req.file
//if text → add to req.body
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

//this part sends the pdf location and it's collection-name-to-be to the ai_Services to process it and make a collection of it in vector db.
//called in /:chatId/upload after the pdf is retrieved using multer and stored in a fixed dir.
const processDocumentWithAI = async ({ chatId, filePath, vectorCollection }) => {
  const fileBuffer = await fs.readFile(filePath);
  const formData = new FormData();
  formData.append('chatId', chatId);
  formData.append('vectorCollection', vectorCollection);
  formData.append(
    'pdf',
    new Blob([fileBuffer], { type: 'application/pdf' }),
    reqSafeFilenameFromPath(filePath)
  );

  let response;
  try {
    response = await fetch(`${AI_SERVICE_URL}/process-document-file`, {
      method: 'POST',
      body: formData,
    });
  } catch (err) {
    throw new AIServiceError(
      `AI service is unreachable at ${AI_SERVICE_URL}. Start FastAPI service and try again.`
    );
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 503 && isAIUnavailablePayload(data)) {
      throw new AIServiceError(AI_UNAVAILABLE_MESSAGE, 503, AI_UNAVAILABLE_PAYLOAD);
    }

    throw new AIServiceError(
      data.message || data.detail || data.error || 'Failed to process document',
      response.status >= 500 ? 503 : 400
    );
  }
};

const reqSafeFilenameFromPath = (filePath) => {
  const name = filePath.split('/').pop() || 'document.pdf';
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
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
    if (response.status === 503 && isAIUnavailablePayload(data)) {
      throw new AIServiceError(AI_UNAVAILABLE_MESSAGE, 503, AI_UNAVAILABLE_PAYLOAD);
    }

    throw new AIServiceError(
      data.message || data.detail || data.error || 'Failed to query AI service',
      response.status >= 500 ? 503 : 400
    );
  }

  if (!data.answer) {
    throw new Error('AI service returned an empty answer');
  }

  return data.answer;
};

//sends query to the ai_services after gathering evry info like msg,chatid,history,vectorcollectio-to-search-in etc
//all done by /:chatId/message
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
    if (response.status === 503 && isAIUnavailablePayload(data)) {
      throw new AIServiceError(AI_UNAVAILABLE_MESSAGE, 503, AI_UNAVAILABLE_PAYLOAD);
    }

    throw new AIServiceError(
      data.message || data.detail || data.error || 'Failed to query AI service',
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
    const chats = await Chat.find({}, { messages: 0 }).sort({ updatedAt: -1 }); //only send the sidebar content, not the chat messages, in decreasing order of updatedAt
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

    await handleUpload(req, res); //calls multer middleware that gathers pdf's binary chunks from req body and combine it to validate, 
    // and store that pdf inside the uploads directory.
    //also before this, req.file was null, now multer added file info into it. like original name, saved name, path, size etc.

    if (!req.file) {
      return res.status(400).json({ error: 'PDF file is required' });
    }

    const nextPdfFile = `/uploads/${req.file.filename}`;
    const nextVectorCollection = `chat_${chat._id}`;

    //Converts: /uploads/abc123.pdf into something like: /Users/gaurav/project/server/uploads/abc123.pdf since //AI service needs actual disk path, not URL
    const nextAbsoluteFilePath = fileURLToPath(   
      new URL(`..${nextPdfFile}`, import.meta.url)
    ); 

    await processDocumentWithAI({  //Send PDF to AI service, core AI step
      chatId: String(chat._id), // 69b70455b5987f1b3d0cdad2
      filePath: nextAbsoluteFilePath, ///Users/gaurav/project/server/uploads/abc123.pdf
      vectorCollection: nextVectorCollection, //chat_69b70455b5987f1b3d0cdad2, 
    });

    if (chat.pdfFile?.startsWith('/uploads/')) {
      const existingFilePath = new URL(`..${chat.pdfFile}`, import.meta.url);
      await fs.unlink(existingFilePath).catch(() => null);
    }

    chat.pdfFile = nextPdfFile; 
    chat.vectorCollection = nextVectorCollection;
    await chat.save(); //updating database

    res.json({
      success: true,
      message: 'PDF uploaded successfully',
      pdfFile: chat.pdfFile, ///uploads/react-4-1773601882041-480948763.pdf
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
      console.error('AI service error in upload endpoint:', err);
      if (err.statusCode === 503) {
        return res.status(503).json(err.payload || AI_UNAVAILABLE_PAYLOAD);
      }

      return res.status(err.statusCode).json({ error: err.message });
    }

    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/:chatId/message — add a user message, return placeholder bot reply
// TODO: replace the placeholder reply with a call to the AI service (FastAPI / RAG)
router.post('/:chatId/message', async (req, res) => {
  const wantsStream = req.headers.accept?.includes('text/event-stream');

  try {
    //since the content type is not application/json but a multipart/form-data, we have to convert it into json to read message
    //so we will have to pass it though a middleware to attach that json to the req body
    await handleMessagePayload(req, res);

    const content = req.body.message?.trim() || '';
    const hasFile = Boolean(req.file);

    if (!content && !hasFile) {
      //res.json() → sends once and closes connection ❌ res.write() → sends chunks continuously ✅
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

    if (content) { //take last 12 msgs and convert them into role:msg format
      const conversationHistory = chat.messages.slice(-12).map((message) => ({
        role: message.role,
        content: message.content,
      }));

      // Auto-title the chat from the first user message
      if (chat.messages.length === 0) {
        chat.title = content.slice(0, 50);
      }

      chat.messages.push({ role: 'user', content }); //entering recent msg into chat, not the db here

      let botReply;
      if (!chat.vectorCollection) {
        botReply = 'Please upload and scan a document before asking questions.';
      } else {
        try {
          if (wantsStream) {
            const streamResult = await queryAIServiceStream({ //let the whole streaming finish and show on ui, then will save it in the db
              chatId: String(chat._id),
              question: content,
              vectorCollection: chat.vectorCollection,
              conversationHistory,
              onToken: (token) => {
                if (!res.headersSent) {
                  res.setHeader('Content-Type', 'text/event-stream');
                  res.setHeader('Cache-Control', 'no-cache, no-transform');
                  res.setHeader('Connection', 'keep-alive');
                  res.flushHeaders?.();
                }
                res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
              },
            });
            //For each token: onToken("H") onToken("He") ...
            //🔹 Which triggers this res.write(...)
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
          if (aiErr instanceof AIServiceError && aiErr.statusCode === 503) {
            if (wantsStream && !res.headersSent) {
              return res.status(503).json(aiErr.payload || AI_UNAVAILABLE_PAYLOAD);
            }

            if (!wantsStream) {
              return res.status(503).json(aiErr.payload || AI_UNAVAILABLE_PAYLOAD);
            }
          }

          botReply =
            'I could not reach the AI service right now. Please make sure the AI service is running and try again.';
        }
      }

      chat.messages.push({ role: 'assistant', content: botReply });
    }

    await chat.save(); //now saving both user and bot replies in the db.

    if (content) {
      const saved = chat.messages;
      userMessage = saved[saved.length - 2];
      botMessage = saved[saved.length - 1];
    }

    if (wantsStream) {
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
      }
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
      console.error('AI service error in message endpoint:', err);
      if (wantsStream) {
        if (!res.headersSent && err.statusCode === 503) {
          return res.status(503).json(err.payload || AI_UNAVAILABLE_PAYLOAD);
        }

        res.write(
          `data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`
        );
        return res.end();
      }
      if (err.statusCode === 503) {
        return res.status(503).json(err.payload || AI_UNAVAILABLE_PAYLOAD);
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
