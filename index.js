'use strict';
const browserify = require('browserify');
const cdp = require('chrome-remote-interface');
const chromeLauncher = require('chrome-launcher');
const fs = require('fs');
const httpServer = require('http-server');
const portfinder = require('portfinder');

/** Async function to convert stream to a string */
function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
    stream.on('error', err => reject(err));
  });
}

/** Loads chrome with remote interface */
async function prepareChrome() {
  const chrome = await chromeLauncher.launch({
    chromeFlags: [
      '--disable-gpu',
      '--headless',
      '--allow-file-access-from-files',
    ]
  });
  const protocol = await cdp({
    port: chrome.port
  });
  const {
    Page,
    DOM,
    Runtime,
    CSS,
  } = protocol;
  await Promise.all([Page.enable(), DOM.enable(), Runtime.enable(), CSS.enable()]);

  // Forward console messages, this doesn't work that well
  Runtime.consoleAPICalled(evt => {
    console[evt.type](...evt.args.map(arg => arg.value ? arg.value : arg.preview));
  });

  return {
    chrome: chrome,
    protocol: protocol,
  };
}

/** Get a free port */
function getPort() {
  return new Promise((resolve, reject) => {
    portfinder.getPort((err, port) => {
      if (err) {
        reject(err);
      } else {
        resolve(port);
      }
    });
  });
}

/** Start a file server at the cwd */
function startServer(server, host, port) {
  return new Promise((resolve, reject) => {
    server.listen(port, host, resolve);
  });
}

/** Start a new local file server for fs */
async function prepareFileServer() {
  const server = httpServer.createServer({
    showDir: 'false',
  });
  const host = 'localhost';
  const port = await getPort();
  await startServer(server, host, port);
  return {server: server, host: host, port: port};
}

/** Load and process user script */
async function prepareUserScript(scriptLocation) {
  return await streamToString(browserify(scriptLocation, {
    insertGlobalVars: {
      'process': undefined,
    },
    debug: true,
  }).require(__dirname + '/fs.js', {expose: 'fs'}).bundle());
}

/** Add all style sheets in order */
async function addStyleSheets(CSS, frameId, styles) {
  for (const css of styles) {
    const { styleSheetId } = await CSS.createStyleSheet(frameId);
    await CSS.setStyleSheetText({
      styleSheetId: styleSheetId,
      text: css,
    });
  }
}

/** Run users script */
async function executeUserScript(Runtime, script, host, port, argv) {
  const setupScript =
    `process = {
      argv: ${JSON.stringify(argv)},
      cwd: () => '/',
      env: ${JSON.stringify(process.env)},
      _host: ${JSON.stringify(host)},
      _port: ${JSON.stringify(port)},
      title: 'browser',
      browser: true,
      version: '',
      versions: {},
      on: () => {},
      addListener: () => {},
      once: () => {},
      off: () => {},
      removeListener: () => {},
      removeAllListeners: () => {},
      emit: () => {},
      prependListener: () => {},
      prependOnceListener: () => {},
      listeners: name => [],
      binding: name => { throw new Error('process.binding is not supported'); },
      chdir: dir => { throw new Error('process.chdir is not supported'); },
      umask: () => 0,
    };`
  await Runtime.evaluate({
    expression: setupScript,
  });

  const {
    result,
    exceptionDetails
  } = await Runtime.evaluate({
    expression: script,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception.description);
  }
}

/** Measure size of html in inches */
async function measureSize(Runtime) {
  const rectId = await Runtime.evaluate({
    expression: 'document.documentElement.getBoundingClientRect()',
  });
  const {result} = await Runtime.getProperties({
    objectId: rectId.result.objectId,
    accessorPropertiesOnly: true,
  });
  return {
    width: result.filter(prop => prop.name === 'width')[0].value.value / 96,
    height: result.filter(prop => prop.name === 'height')[0].value.value / 96,
  };
}

/** The public api
 * @param {string | stream} scriptLocation Where the script to execute is located
 * @param {object} options {styles, argv} for execution
 */
async function headlesspdf(scriptLocation, options) {
  const {
    styles = [],
    argv = [],
  } = options || {};

  // Launch headless chrome, launch file server, and load all files into memory
  // TODO If an exception is thrown here, chrome and protocol might not get
  // closed...
  const [{
    chrome,
    protocol,
  }, {
    server,
    host,
    port,
  }, script] = await Promise.all([
    prepareChrome(),
    prepareFileServer(),
    prepareUserScript(scriptLocation),
  ]);
  const {
    Page,
    Runtime,
    CSS,
  } = protocol;

  try {
    // Load initial frame loaded from same host as file server
    const {frameId} = await Page.navigate({
      url: `http://${host}:${port}`,
    });
    await Page.loadEventFired();
    Page.setDocumentContent({frameId: frameId, html: '<html><head></head><body></body></html>'});

    await Promise.all([
      executeUserScript(Runtime, script, host, port, argv),
      addStyleSheets(CSS, frameId, styles),
    ]);

    // Generate pdf data
    const size = await measureSize(Runtime);
    if (!size.height || !size.width) {
      throw new Error("No bounding box found, content probably wasn't rendered");
    }
    const pdf = await Page.printToPDF({
      printBackground: true,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
      paperWidth: size.width,
      paperHeight: size.height,
      pageRanges: '1',
    });

    return pdf.data;
  } finally {
    protocol.close();
    chrome.kill();
    server.close();
  }
}

module.exports = headlesspdf;
