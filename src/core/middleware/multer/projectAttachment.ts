import multer from "multer";
import path from "path";
import fs from "fs";

const BASE_STORAGE_PATH = path.join(__dirname, "../../../storage/projectAttachment");

const projectAttachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Extract extension without dot (e.g. "pdf", "txt", "png")
    const ext = path.extname(file.originalname).replace(".", "").toLowerCase() || "other";
    const folder = path.join(BASE_STORAGE_PATH, ext);

    try {
      fs.mkdirSync(folder, { recursive: true });
      cb(null, folder);
    } catch (err: any) {
      cb(err, "");
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).replace(".", "").toLowerCase() || "other";
    const folder = path.join(BASE_STORAGE_PATH, ext);
    const originalName = file.originalname;

    // Check if file already exists in folder; if so, append timestamp before extension
    const fullPath = path.join(folder, originalName);
    if (fs.existsSync(fullPath)) {
      const extName = path.extname(originalName);
      const baseName = path.basename(originalName, extName);
      const uniqueName = `${baseName}-${Date.now()}${extName}`;
      cb(null, uniqueName);
    } else {
      cb(null, originalName);
    }
  },
});

export const projectAttachmentUpload = multer({
  storage: projectAttachmentStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});
