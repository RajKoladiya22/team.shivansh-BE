import multer from "multer";
import path from "path";
import fs from "fs";

const UPLOAD_PATH = path.join(__dirname, "../../../storage");

// configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return cb(new Error("Unauthorized upload"), "");
    }
    const folder = path.join(UPLOAD_PATH, userId);

    fs.mkdirSync(folder, { recursive: true });
    cb(null, folder);
  },
  filename: (req, file, cb) => {
    const fileExt = path.extname(file.originalname);
    const name = file.fieldname + "-" + Date.now() + fileExt;
    cb(null, name);
  },
});

export default multer({ storage });
