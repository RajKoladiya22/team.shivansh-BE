// src/core/utils/fileCleanup.ts
import fs from "fs";
import path from "path";

export function safeUnlink(filePath?: string) {
  if (!filePath) return;

  try {
    console.log("\nAttempting to delete file:", filePath);
    console.log("\n\nFile exists:", fs.existsSync(filePath));
    
    
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log("File deleted:", filePath);
    } else {
      console.warn("File not found for deletion:", filePath);
    }
    
  } catch (err) {
    console.error("File delete failed:", filePath, err);
  }
}
