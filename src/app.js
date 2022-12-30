const { app, ipcMain, BrowserWindow } = require('electron');
const fs = require("fs");
const path = require("path");
const { getSummary, hasApiKey, saveApiKey, getWinSize, saveWinSize, getFilePath, saveFilePath } = require("./api");

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

  win.webContents.openDevTools();

  win.on('resized', () => {
    saveWinSize(win.getSize());
  })

  /**
   * Send credentials and file path to the renderer process
   */
  win.webContents.once('dom-ready', () => {
    win.webContents.send('fromCredentials', hasApiKey());
    win.webContents.send('fromFilePath', getFilePath(app));
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
 */
ipcMain.on("toCredentials", async (event, apiKey) => {
  saveApiKey(apiKey);
  win?.webContents.send("fromCredentials", hasApiKey());
});

/**
 * POST FILE PATH
 */
ipcMain.on("toFilePath", async (event, filePath) => {
  // Verify that the path is valid
  try {
    fs.accessSync(filePath, fs.constants.W_OK);
  } catch (err) {
    win?.webContents.send("fromFilePath", getFilePath(app));
    return;
  }
  saveFilePath(filePath);
  console.log("filePath", getFilePath(app));
  win?.webContents.send("fromFilePath", getFilePath(app));
});

/**
 * POST SUMMARY
 */
ipcMain.on("toSummary", async (event, args) => {
  if (!hasApiKey()) {
    win?.webContents.send("fromSummary", "You must provide an API key");
    return;
  }

  try {
    new URL(args.url);
  } catch (err) {
    win?.webContents.send("fromSummary", "The URL is not valid");
    return;
  }

  const text = await getSummary(args.url, args.withCode);

  if (text) {
    win?.webContents.send("fromSummary", text);
  }
});

/**
 * POST EXPORT
 */
ipcMain.on("toExport", async (event, args) => {
  // Split the summary into lines
  const summaryLines = args.summary.split("\n");
  // Set the file name to the main title
  let fileTitle;
  const mainTitle = summaryLines.find(line => line.startsWith("# "));
  if (mainTitle) {
    // Remove the "#" and replace spaces and special characters with "-"
    fileTitle = mainTitle.replace("# ", "").replace(/ /g, " ").replace(/[^a-zA-Z0-9-]/g, " ");
  } else {
    // If there is no main title, name it "draft-gepeto" with the current datetime
    const date = new Date();
    fileTitle = `draft-gepeto-${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`;
  }

  const filePath = path.join(getFilePath(app), fileTitle + ".md");
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
      jumpLine = summaryLines[i].startsWith("#") || summaryLines[i].startsWith("*");
      const line = summaryLines[i];
      writeLine(line);
    }
    win?.webContents.send("fromExport", filePath);
  } catch (err) {
    win?.webContents.send("fromExport", err);
  } finally {
    logger.end();
  }

  console.log("filePath", filePath);
  
});


