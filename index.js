'use strict';
const browserify = require('browserify');
const cdp = require('chrome-remote-interface');
const chromeLauncher = require('chrome-launcher');
const fs = require('fs');

/// Async function to convert stream to a string
function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
    stream.on('error', err => reject(err));
  });
}

/// Loads chrome with remote interface
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

  // This needs to be a local file because we need permission to load other
  // local files
  const frameId = await Page.navigate({
    url: `file://${__dirname}/blank.html`
  });
  await Page.loadEventFired();

  return {
    chrome: chrome,
    protocol: protocol,
    frameId: frameId,
  };
}

/// Load and process user script
async function prepareUserScript(scriptLocation) {
  return await streamToString(browserify(scriptLocation, {
    insertGlobalVars: {
      'process': undefined,
    }
  }).bundle());
}

/// Add all style sheets in order
async function addStyleSheets(CSS, frameId, styles) {
  for (const css of styles) {
    const {
      styleSheetId
    } = await CSS.createStyleSheet(frameId);
    await CSS.setStyleSheetText({
      styleSheetId: styleSheetId,
      text: css,
    });
  }
}

/// Run users script
async function executeUserScript(Runtime, script, argv) {
  const setupScript =
    `process = {
    argv: ${JSON.stringify(argv)},
    cwd: () => ${JSON.stringify(process.cwd())},
    env: ${JSON.stringify(process.env)},
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

/// Measure important space
async function measureSize(Runtime) {
  const rectId = await Runtime.evaluate({
    expression: 'document.documentElement.getBoundingClientRect()',
  });
  const rect = await Runtime.getProperties({
    objectId: rectId.result.objectId,
    accessorPropertiesOnly: true,
  });
  return {
    width: rect.result.filter(prop => prop.name === 'width')[0].value.value /
      96,
    height: rect.result.filter(prop => prop.name === 'height')[0].value.value /
      96,
  };
}

/// The public api
async function headlesspdf(scriptLocation, options) {
  const {
    styles,
    argv,
  } = options || {};

  // Launch headless chrome, and load all files into memory
  // TODO If an exception is thrown here, chrome and protocol might not get
  // closed...
  const [{
    chrome,
    protocol,
    frameId,
  }, script] = await Promise.all([
    prepareChrome(),
    prepareUserScript(scriptLocation),
  ]);
  const {
    Page,
    Runtime,
    CSS,
  } = protocol;

  try {
    await Promise.all([
      executeUserScript(Runtime, script, argv || []),
      addStyleSheets(CSS, frameId, styles || []),
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
  }
}

module.exports = headlesspdf;
