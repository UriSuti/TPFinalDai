import multer from 'multer';
import { config } from '../config.js';
import { badRequest } from '../utils/errors.js';

// Los JSON del export de Spotify se procesan en memoria (pesan ~10 MB cada uno).
export const uploadJson = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith('.json')) cb(null, true);
    else cb(badRequest(`"${file.originalname}" no es un .json`));
  },
}).array('archivos', 20);
