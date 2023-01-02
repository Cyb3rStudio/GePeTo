const { app, ipcMain, shell, BrowserWindow } = require('electron');
const fs = require("fs");
const path = require("path");
const { 
  getSummary, 
  hasApiKey, 
  saveApiKey, 
  getWinSize, 
  saveWinSize, 
  getFolderPath, 
  saveFolderPath 
} = require("./api");

let win;

function createWindow() {
  const winSize = getWinSize();
  win = new BrowserWindow({
    width: winSize[0],
    height: winSize[1],
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    autoHideMenuBar: true,
  })

  win.loadURL(path.join(__dirname, "../dist/gepeto/index.html"));

  // UNCOMMENT TO OPEN DEVTOOLS IN DEV MODE
  // win.webContents.openDevTools();

  win.on('resized', () => {
    saveWinSize(win.getSize());
  })

  /**
   * Send credentials and file path to the renderer process
   */
  win.webContents.once('dom-ready', () => {
    win.webContents.send('fromCredentials', hasApiKey());
    win.webContents.send('fromFolderPath', getFolderPath(app));
  });

  win.on('closed', function () {
    win = null
  });
}

app.on('ready', createWindow)

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', function () {
  if (win === null) createWindow()
})

/**
 * POST CREDENTIALS
 * 
 * Save the API key and send a boolean to the renderer process
 */
ipcMain.on("toCredentials", async (event, apiKey) => {
  saveApiKey(apiKey);
  win?.webContents.send("fromCredentials", hasApiKey());
});

/**
 * POST FILE PATH
 * 
 * Save the file path and send it back to the renderer process if ok
 * Otherwise send the default file path
 */
ipcMain.on("toFolderPath", async (event, folderPath) => {
  // Verify that the path is valid
  try {
    fs.accessSync(folderPath, fs.constants.W_OK);
  } catch (err) {
    win?.webContents.send("fromFolderPath", getFolderPath(app));
    return;
  }
  saveFolderPath(folderPath);
  win?.webContents.send("fromFolderPath", getFolderPath(app));
});

/**
 * POST SUMMARY
 * 
 * Send the summary generated by GPT-3 to the renderer process
 * If the API key is not valid, send an error message
 * If the URL is not valid, send an error message
 * If the summary is empty, send an error message
 */
ipcMain.on("toSummary", async (event, args) => {
  const response = {
    fileName: '',
    text: '',
  }

  if (!hasApiKey()) {
    response.text = "You must provide an API key";
    win?.webContents.send("fromSummary", response);
    return;
  }

  try {
    new URL(args.url);
  } catch (err) {
    response.text = "The URL is not valid";
    win?.webContents.send("fromSummary", response);
    return;
  }
  
  const { fileName, text } = await getSummary(args.url, args.withCode);

  if (text) {
    response.fileName = fileName;
    response.text = text;
    win?.webContents.send("fromSummary", response);
  } else {
    response.text = "The summary has been returned empty";
    win?.webContents.send("fromSummary", response);
  }
});

/**
 * POST EXPORT
 * 
 * Export the summary to a markdown file in the file path
 * 
 * Extract the main title from the summary and sanitize it for the file name
 * If there is no main title, name it "draft-gepeto" with the current datetime
 * 
 * Format the summary to be exported adding lines after each heading and bold text
 */
ipcMain.on("toExport", async (event, args) => {
  // Split the summary into lines
  const summaryLines = args.text.split("\n");

  const filePath = path.join(getFolderPath(app), args.fileName + ".md");
  var logger = fs.createWriteStream(filePath, {
    flags: 'w' // 'w' means writing in a new file
  });

  // Insert a new line for each element in the array
  var writeLine = (line) => logger.write(`\n${line}`, (err) => {
    if (err) throw err;
  });

  let jumpLine = false;
  
  try {
    for (let i = 0; i < summaryLines.length; i++) {
      // Jump a line if the previous line was a title or bold
      if (jumpLine && summaryLines[i] !== "") {
        writeLine("");
      }
      // Set jumpLine for the next iteration
      jumpLine = summaryLines[i].startsWith("#") || summaryLines[i].startsWith("**");
      const line = summaryLines[i];
      writeLine(line);
    }
    win?.webContents.send("fromExport", filePath);
  } catch (err) {
    win?.webContents.send("fromExport", null);
  } finally {
    logger.end();
  }
});

ipcMain.on("toOpenFile", async (event, filePath) => {
  // Open the file with the default application, if error, open the folder
  try {
    shell.openPath(filePath);
  } catch (err) {
    shell.openPath(getFolderPath(app));
  }
});


