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

// Serve static files from the public directory
app.use(express.static("public"));

// Parse JSON request bodies
app.use(express.json());

// Get upload directory from environment variable or use default
const uploadsDir = process.env.UPLOAD_BASE_DIR || "./uploads";
console.log(`Upload directory set to: ${uploadsDir}`);

// Create uploads directory if it doesn't exist
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Initialize the tus server with FileStore
const fileStore = new FileStore({ directory: uploadsDir });

// Create the tus server
const tusServer = new Server({
  path: "/files",
  datastore: fileStore
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
      const uuidFilePath = path.join(uploadsDir, upload.id);
      const jsonFilePath = path.join(uploadsDir, `${upload.id}.json`);
      
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
      // We need to use setTimeout with a Promise to make this work with async/await
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
  } catch (error) {
    console.error(`Error in POST_FINISH event handler: ${error.message}`);
  }
});

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
    
    // Map directory entries to file items
    const fileItems = items.map(item => ({
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
