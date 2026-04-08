import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.resolve(__dirname, '../uploads');

const ensureUploadsDir = () => {
  fs.mkdirSync(uploadsDir, { recursive: true });
};

const storage = multer.diskStorage({ //tell multer to “Save files to disk (not memory)”
  destination: (_req, _file, cb) => { 
    ensureUploadsDir(); //Make sure folder exists (uploads/)
    cb(null, uploadsDir); //Save file inside that folder. no error → null, save here → uploadsDir
  },
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase() || '.pdf';
    const baseName = path
      .basename(file.originalname, extension)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

    cb(null, `${baseName || 'document'}-${uniqueSuffix}${extension}`);
  },
});

const fileFilter = (_req, file, cb) => { //multer asks what files to accept
  const extension = path.extname(file.originalname).toLowerCase();
  const isPdf = extension === '.pdf' && file.mimetype === 'application/pdf';

  if (isPdf) {
    cb(null, true);
    return;
  }

  cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'pdf'));
};

const uploadPdf = multer({ //Combines everything: where to store, how to name, what to allow
  storage,
  fileFilter,
});

export { uploadPdf, uploadsDir };