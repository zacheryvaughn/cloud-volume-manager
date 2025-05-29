import express from "express";
import { Server, EVENTS } from "@tus/server";
import { FileStore } from "@tus/file-store";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

// Load environment variables from .env file
dotenv.config();

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 1080;

// Trust proxy headers (required for RunPod HTTPS proxy)
app.set('trust proxy', true);

// No need for protocol middleware - TUS server handles this with generateUrl

// Serve static files from the public directory
app.use(express.static("public"));

// Parse JSON request bodies
app.use(express.json());

// Get upload directory from environment variable or use default
const uploadsDir = process.env.MOUNT_PATH || "/workspace";
console.log(`Upload directory set to: ${uploadsDir}`);

// Create uploads directory if it doesn't exist
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Create upload staging directory for staging uploads
const initUploadDir = path.join(uploadsDir, "UPLOAD_STAGING_DIR");
if (!fs.existsSync(initUploadDir)) {
  fs.mkdirSync(initUploadDir, { recursive: true });
  console.log(`Created upload staging directory: ${initUploadDir}`);
}

// Initialize the tus server with FileStore pointing to the staging directory
const fileStore = new FileStore({ directory: initUploadDir });

// Create TUS server
const tusServer = new Server({
  path: "/files",
  datastore: fileStore,
  respectForwardedHeaders: true,
  generateUrl: (req, { proto, host, path, id }) => {
    // Force HTTPS if we detect RunPod proxy headers
    const protocol = req.headers["x-forwarded-proto"] ||
                    (req.headers["x-forwarded-host"] ? "https" : proto) ||
                    "https";
    
    const hostname = req.headers["x-forwarded-host"] || req.headers.host || host;
    const cleanPath = path.endsWith("/") ? path.slice(0, -1) : path;
    
    const url = `${protocol}://${hostname}${cleanPath}/${id}`;
    console.log(`Generated TUS URL: ${url} (from headers: proto=${req.headers["x-forwarded-proto"]}, host=${req.headers["x-forwarded-host"]})`);
    return url;
  }
});

// Custom middleware to check for duplicate files before the upload starts
app.use("/files", (req, res, next) => {
  // Only check POST requests (new uploads)
  if (req.method === "POST") {
    console.log("Checking for duplicate files before upload starts");
    
    try {
      // Get the metadata from the Upload-Metadata header
      const metadataHeader = req.headers["upload-metadata"];
      if (!metadataHeader) {
        return next();
      }
      
      // Parse the metadata
      const metadata = {};
      metadataHeader.split(",").forEach(item => {
        const [key, value] = item.split(" ");
        if (key && value) {
          metadata[key] = Buffer.from(value, "base64").toString("utf8");
        }
      });
      
      console.log("Metadata:", metadata);
      
      // Only check for duplicates if useOriginalFilename is true and onDuplicateFiles is prevent
      if (metadata.useOriginalFilename === "true" && metadata.filename && metadata.onDuplicateFiles === "prevent") {
        const originalFilename = metadata.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        
        // Determine the target directory based on the path metadata
        let targetDir = uploadsDir;
        if (metadata.path) {
          // Ensure the path is relative to the uploads directory and doesn't contain ".."
          console.log(`Received path metadata: "${metadata.path}"`);
          const relativePath = metadata.path.replace(/\.\./g, "").replace(/^\/+/, "");
          targetDir = path.join(uploadsDir, relativePath);
          console.log(`Resolved target directory: "${targetDir}"`);
          
          // Create the target directory if it doesn't exist
          if (!fs.existsSync(targetDir)) {
            console.log(`Creating directory: ${targetDir}`);
            fs.mkdirSync(targetDir, { recursive: true });
          }
        }
        
        const filePath = path.join(targetDir, originalFilename);
        
        // Check if file already exists
        if (fs.existsSync(filePath)) {
          console.log(`File ${originalFilename} already exists in ${targetDir}, preventing upload`);
          
          // Return a 409 Conflict status code
          return res.status(409).json({
            error: {
              message: `File "${metadata.filename}" already exists in the target directory and duplicates are not allowed`
            }
          });
        }
      }
      
      // Allow the upload to proceed
      next();
    } catch (error) {
      console.error(`Error in duplicate file check middleware: ${error.message}`);
      next(); // Allow the upload to proceed in case of error
    }
  } else {
    next();
  }
});

// Store for tracking multi-part uploads
const partedUploads = new Map(); // Map of originalFilename -> { parts: Set, metadata: object, targetDir: string, timestamp: number }

// Cleanup orphaned parts every 30 minutes
const CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes
const PART_TIMEOUT = 60 * 60 * 1000; // 1 hour timeout for incomplete uploads

setInterval(() => {
  cleanupOrphanedParts();
}, CLEANUP_INTERVAL);

/**
 * Clean up orphaned parts that haven't been completed within the timeout period
 */
function cleanupOrphanedParts() {
  const now = Date.now();
  const orphanedFiles = [];
  
  partedUploads.forEach((uploadInfo, originalFilename) => {
    if (now - uploadInfo.timestamp > PART_TIMEOUT) {
      console.log(`Cleaning up orphaned parts for: ${originalFilename}`);
      orphanedFiles.push(originalFilename);
      
      // Clean up the part files
      uploadInfo.uploadIds.forEach((uploadId, partNumber) => {
        const partPath = path.join(initUploadDir, uploadId);
        const jsonPath = path.join(initUploadDir, `${uploadId}.json`);
        
        if (fs.existsSync(partPath)) {
          fs.unlinkSync(partPath);
          console.log(`Cleaned up orphaned part: ${partPath}`);
        }
        
        if (fs.existsSync(jsonPath)) {
          fs.unlinkSync(jsonPath);
          console.log(`Cleaned up orphaned JSON: ${jsonPath}`);
        }
      });
    }
  });
  
  // Remove orphaned entries from tracking
  orphanedFiles.forEach(filename => {
    partedUploads.delete(filename);
  });
  
  if (orphanedFiles.length > 0) {
    console.log(`Cleaned up ${orphanedFiles.length} orphaned multi-part uploads`);
  }
}

// Listen for the POST_FINISH event which is emitted after an upload is completed
// and a response has been sent to the client
tusServer.on(EVENTS.POST_FINISH, async (req, res, upload) => {
  console.log(`Upload complete (POST_FINISH event): ${upload.id}`);
  
  try {
    // Get the metadata
    const meta = upload.metadata || {};
    console.log(`Metadata: ${JSON.stringify(meta)}`);
    
    // Only process if useOriginalFilename is true
    if (meta.useOriginalFilename === "true" && meta.filename) {
      
      // Check if this is a parted upload
      if (meta.isPartedUpload === "true") {
        await handlePartedUpload(upload, meta);
      } else {
        await handleSingleFileUpload(upload, meta);
      }
    }
  } catch (error) {
    console.error(`Error in POST_FINISH event handler: ${error.message}`);
  }
});

/**
 * Handle single file upload (existing logic)
 */
async function handleSingleFileUpload(upload, meta) {
  const originalFilename = meta.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  let finalFilename = originalFilename;
  
  // Determine the target directory based on the path metadata
  let targetDir = uploadsDir;
  if (meta.path) {
    // Ensure the path is relative to the uploads directory and doesn't contain ".."
    console.log(`POST_FINISH: Received path metadata: "${meta.path}"`);
    const relativePath = meta.path.replace(/\.\./g, "").replace(/^\/+/, "");
    targetDir = path.join(uploadsDir, relativePath);
    console.log(`POST_FINISH: Resolved target directory: "${targetDir}"`);
    
    // Create the target directory if it doesn't exist
    if (!fs.existsSync(targetDir)) {
      console.log(`Creating directory: ${targetDir}`);
      fs.mkdirSync(targetDir, { recursive: true });
    }
  }
  
  const originalFilePath = path.join(targetDir, originalFilename);
  const uuidFilePath = path.join(initUploadDir, upload.id);
  const jsonFilePath = path.join(initUploadDir, `${upload.id}.json`);
  
  console.log(`Target directory: ${targetDir}`);
  console.log(`Original filename: ${originalFilename}`);
  console.log(`UUID file path: ${uuidFilePath}`);
  
  // Handle duplicate filenames for "number" option
  if (fs.existsSync(originalFilePath) && meta.onDuplicateFiles === "number") {
    const ext = path.extname(originalFilename);
    const base = path.basename(originalFilename, ext);
    let i = 1;
    let candidate = `${base}${ext}`;
    while (fs.existsSync(path.join(targetDir, candidate))) {
      candidate = `${base}(${i})${ext}`;
      i++;
    }
    finalFilename = candidate;
    console.log(`File ${originalFilename} already exists, using numbered filename: ${finalFilename}`);
  }
  
  const newFilePath = path.join(targetDir, finalFilename);
  
  // Wait a moment to ensure file is fully written
  await new Promise(resolve => {
    setTimeout(() => {
      try {
        // Make sure the file exists before attempting to rename
        if (fs.existsSync(uuidFilePath)) {
          // Rename file
          console.log(`Renaming ${uuidFilePath} to ${newFilePath}`);
          fs.renameSync(uuidFilePath, newFilePath);
          
          // Delete JSON metadata file
          if (fs.existsSync(jsonFilePath)) {
            console.log(`Deleting JSON file: ${jsonFilePath}`);
            fs.unlinkSync(jsonFilePath);
          }
          
          console.log(`Successfully processed file: ${finalFilename} to ${targetDir}`);
        } else {
          console.error(`File not found at ${uuidFilePath}`);
        }
        resolve();
      } catch (err) {
        console.error(`Error during rename/delete: ${err.message}`);
        resolve();
      }
    }, 2000);
  });
}

/**
 * Handle parted upload
 */
async function handlePartedUpload(upload, meta) {
  const originalFilename = meta.originalFilename;
  const partNumber = parseInt(meta.partNumber);
  const totalParts = parseInt(meta.totalParts);
  const partId = meta.partId;
  
  console.log(`Processing part ${partNumber}/${totalParts} for file: ${originalFilename}`);
  
  // Determine the target directory
  let targetDir = uploadsDir;
  if (meta.path) {
    const relativePath = meta.path.replace(/\.\./g, "").replace(/^\/+/, "");
    targetDir = path.join(uploadsDir, relativePath);
    
    if (!fs.existsSync(targetDir)) {
      console.log(`Creating directory: ${targetDir}`);
      fs.mkdirSync(targetDir, { recursive: true });
    }
  }
  
  // Initialize tracking for this file if not exists
  if (!partedUploads.has(originalFilename)) {
    partedUploads.set(originalFilename, {
      parts: new Set(),
      metadata: meta,
      targetDir: targetDir,
      uploadIds: new Map(), // Map part number to upload ID
      timestamp: Date.now() // Track when first part was received
    });
  }
  
  const uploadInfo = partedUploads.get(originalFilename);
  uploadInfo.parts.add(partNumber);
  uploadInfo.uploadIds.set(partNumber, upload.id);
  
  console.log(`Part ${partNumber} registered. Total parts received: ${uploadInfo.parts.size}/${totalParts}`);
  
  // Check if all parts are complete
  if (uploadInfo.parts.size === totalParts) {
    console.log(`All parts received for ${originalFilename}. Starting concatenation...`);
    await concatenateAndCleanup(originalFilename, totalParts, uploadInfo);
    
    // Remove from tracking
    partedUploads.delete(originalFilename);
  }
}

/**
 * Concatenate parts and cleanup
 */
async function concatenateAndCleanup(originalFilename, totalParts, uploadInfo) {
  let finalFilename = originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
  let finalFilePath = null;
  
  try {
    const { targetDir, metadata, uploadIds } = uploadInfo;
    
    // Handle duplicate filenames
    const originalFilePath = path.join(targetDir, finalFilename);
    
    if (fs.existsSync(originalFilePath) && metadata.onDuplicateFiles === "number") {
      const ext = path.extname(finalFilename);
      const base = path.basename(finalFilename, ext);
      let i = 1;
      let candidate = `${base}${ext}`;
      while (fs.existsSync(path.join(targetDir, candidate))) {
        candidate = `${base}(${i})${ext}`;
        i++;
      }
      finalFilename = candidate;
      console.log(`File ${originalFilename} already exists, using numbered filename: ${finalFilename}`);
    }
    
    finalFilePath = path.join(targetDir, finalFilename);
    
    console.log(`Concatenating ${totalParts} parts into: ${finalFilePath}`);
    
    // Use file descriptor approach for large files to avoid memory limits
    const tempFilePath = `${finalFilePath}.tmp`;
    
    // Open temp file for writing
    const fd = fs.openSync(tempFilePath, 'w');
    let totalSize = 0;
    
    try {
      // Concatenate parts using file descriptors to handle large files
      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        const uploadId = uploadIds.get(partNumber);
        const partPath = path.join(initUploadDir, uploadId);
        
        if (!fs.existsSync(partPath)) {
          throw new Error(`Part file not found: ${partPath}`);
        }
        
        console.log(`Concatenating part ${partNumber}: ${partPath}`);
        
        // Get part file stats
        const partStats = fs.statSync(partPath);
        console.log(`Part ${partNumber} size: ${partStats.size} bytes`);
        
        // Open part file for reading
        const partFd = fs.openSync(partPath, 'r');
        
        try {
          // Copy part file to temp file in chunks to handle large files
          const bufferSize = 64 * 1024 * 1024; // 64MB buffer
          const buffer = Buffer.allocUnsafe(bufferSize);
          let bytesRead = 0;
          let position = 0;
          
          while (position < partStats.size) {
            bytesRead = fs.readSync(partFd, buffer, 0, bufferSize, position);
            if (bytesRead === 0) break;
            
            fs.writeSync(fd, buffer, 0, bytesRead);
            position += bytesRead;
            totalSize += bytesRead;
          }
        } finally {
          fs.closeSync(partFd);
        }
      }
    } finally {
      fs.closeSync(fd);
    }
    
    console.log(`Total concatenated size: ${totalSize} bytes`);
    
    // Move temp file to final location
    fs.renameSync(tempFilePath, finalFilePath);
    
    console.log(`Successfully concatenated file: ${finalFilename}`);
    
    // Verify file size
    const finalStats = fs.statSync(finalFilePath);
    console.log(`Final file size: ${finalStats.size} bytes`);
    
    // Clean up part files and JSON metadata
    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      const uploadId = uploadIds.get(partNumber);
      const partPath = path.join(initUploadDir, uploadId);
      const jsonPath = path.join(initUploadDir, `${uploadId}.json`);
      
      // Delete part file
      if (fs.existsSync(partPath)) {
        fs.unlinkSync(partPath);
        console.log(`Deleted part file: ${partPath}`);
      }
      
      // Delete JSON metadata file
      if (fs.existsSync(jsonPath)) {
        fs.unlinkSync(jsonPath);
        console.log(`Deleted JSON file: ${jsonPath}`);
      }
    }
    
    console.log(`Successfully processed parted file: ${finalFilename} to ${uploadInfo.targetDir}`);
    
  } catch (error) {
    console.error(`Error during concatenation: ${error.message}`);
    
    // Clean up partial files on error
    try {
      if (finalFilePath && fs.existsSync(finalFilePath)) {
        fs.unlinkSync(finalFilePath);
        console.log(`Cleaned up partial file: ${finalFilePath}`);
      }
      
      // Also clean up temp file if it exists
      const tempFilePath = `${finalFilePath}.tmp`;
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        console.log(`Cleaned up temp file: ${tempFilePath}`);
      }
    } catch (cleanupError) {
      console.error(`Error during cleanup: ${cleanupError.message}`);
    }
    
    throw error;
  }
}

// Use a middleware to handle all requests to /files
app.use("/files", (req, res) => {
  tusServer.handle(req, res);
});

// API endpoint to get directory contents
app.get("/api/files", async (req, res) => {
  try {
    // Get the directory path from the query parameters
    const dirPath = req.query.path || "/";
    
    // Validate that the path doesn't contain ".."
    if (dirPath.includes("..")) {
      return res.status(403).json({
        error: "Access denied: Path cannot contain '..'"
      });
    }
    
    // Resolve the full path
    const fullPath = path.resolve(uploadsDir, dirPath === "/" ? "" : dirPath);
    
    // Validate that the path is within the uploads directory
    if (!fullPath.startsWith(path.resolve(uploadsDir))) {
      return res.status(403).json({
        error: "Access denied: Path must be within the uploads directory"
      });
    }
    
    // Check if the directory exists
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        error: "Directory not found"
      });
    }
    
    // Read the directory contents
    const items = await fs.promises.readdir(fullPath, { withFileTypes: true });
    
    // Map directory entries to file items, excluding the staging directory
    const fileItems = items
      .filter(item => item.name)
      .map(item => ({
        name: item.name,
        path: path.join(dirPath === "/" ? "" : dirPath, item.name).replace(/\\/g, "/"),
        isDirectory: item.isDirectory()
      }));
    
    // Return the directory contents as JSON
    return res.json(fileItems);
  } catch (error) {
    console.error("Error reading directory:", error);
    return res.status(500).json({
      error: `Failed to read directory: ${error.message}`
    });
  }
});

// API endpoint to delete a file or directory
app.delete("/api/files", async (req, res) => {
  try {
    // Get the file/directory path from the query parameters
    const filePath = req.query.path;
    
    if (!filePath) {
      return res.status(400).json({
        error: "Path parameter is required"
      });
    }
    
    // Validate that the path doesn't contain ".."
    if (filePath.includes("..")) {
      return res.status(403).json({
        error: "Access denied: Path cannot contain '..'"
      });
    }
    
    // Resolve the full path
    const fullPath = path.resolve(uploadsDir, filePath);
    
    // Validate that the path is within the uploads directory
    if (!fullPath.startsWith(path.resolve(uploadsDir))) {
      return res.status(403).json({
        error: "Access denied: Path must be within the uploads directory"
      });
    }
    
    // Check if the file/directory exists
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        error: "File or directory not found"
      });
    }
    
    // Delete the file or directory
    await fs.promises.rm(fullPath, { recursive: true, force: true });
    
    return res.json({ success: true });
  } catch (error) {
    console.error("Error deleting file/directory:", error);
    return res.status(500).json({
      error: `Failed to delete: ${error.message}`
    });
  }
});

// API endpoint to move a file or directory
app.patch("/api/files", async (req, res) => {
  try {
    // Get the source and destination paths from the request body
    const { sourcePath, destinationPath } = req.body;
    
    if (!sourcePath || !destinationPath) {
      return res.status(400).json({
        error: "Source and destination paths are required"
      });
    }
    
    // Validate that the paths don't contain ".."
    if (sourcePath.includes("..") || destinationPath.includes("..")) {
      return res.status(403).json({
        error: "Access denied: Paths cannot contain '..'"
      });
    }
    
    // Resolve the full paths
    const fullSourcePath = path.resolve(uploadsDir, sourcePath);
    const fullDestinationPath = path.resolve(uploadsDir, destinationPath);
    
    // Validate that the paths are within the uploads directory
    if (!fullSourcePath.startsWith(path.resolve(uploadsDir)) || 
        !fullDestinationPath.startsWith(path.resolve(uploadsDir))) {
      return res.status(403).json({
        error: "Access denied: Paths must be within the uploads directory"
      });
    }
    
    // Check if the source file/directory exists
    if (!fs.existsSync(fullSourcePath)) {
      return res.status(404).json({
        error: "Source file or directory not found"
      });
    }
    
    // Create the destination directory if it doesn't exist
    const destinationDir = path.dirname(fullDestinationPath);
    if (!fs.existsSync(destinationDir)) {
      await fs.promises.mkdir(destinationDir, { recursive: true });
    }
    
    // Move the file or directory
    await fs.promises.rename(fullSourcePath, fullDestinationPath);
    
    return res.json({ success: true });
  } catch (error) {
    console.error("Error moving file/directory:", error);
    return res.status(500).json({
      error: `Failed to move: ${error.message}`
    });
  }
});

// API endpoint to create a new folder
app.post("/api/folders", async (req, res) => {
  try {
    // Get the folder path and name from the request body
    const { path: folderPath, name: folderName } = req.body;
    
    if (!folderPath || !folderName) {
      return res.status(400).json({
        error: "Path and name are required"
      });
    }
    
    // Validate folder name (no special characters that could cause issues)
    if (!/^[a-zA-Z0-9._\-\s]+$/.test(folderName)) {
      return res.status(400).json({
        error: "Folder name contains invalid characters"
      });
    }
    
    // Validate that the path doesn't contain ".."
    if (folderPath.includes("..") || folderName.includes("..")) {
      return res.status(403).json({
        error: "Access denied: Path cannot contain '..'"
      });
    }
    
    // Resolve the full path
    const parentDir = path.resolve(uploadsDir, folderPath === "/" ? "" : folderPath);
    const fullFolderPath = path.join(parentDir, folderName);
    
    // Validate that the path is within the uploads directory
    if (!fullFolderPath.startsWith(path.resolve(uploadsDir))) {
      return res.status(403).json({
        error: "Access denied: Path must be within the uploads directory"
      });
    }
    
    // Check if the parent directory exists
    if (!fs.existsSync(parentDir)) {
      return res.status(404).json({
        error: "Parent directory not found"
      });
    }
    
    // Check if folder already exists
    if (fs.existsSync(fullFolderPath)) {
      return res.status(409).json({
        error: "Folder already exists"
      });
    }
    
    // Create the folder
    await fs.promises.mkdir(fullFolderPath);
    
    return res.json({
      success: true,
      path: path.join(folderPath === "/" ? "" : folderPath, folderName).replace(/\\/g, "/")
    });
  } catch (error) {
    console.error("Error creating folder:", error);
    return res.status(500).json({
      error: `Failed to create folder: ${error.message}`
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
  console.log(`TUS server is running at http://localhost:${port}/files`);
  console.log(`File manager is available at http://localhost:${port}`);
});
