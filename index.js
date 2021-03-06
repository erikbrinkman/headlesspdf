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

async function fetchObject(Runtime, obj) {
  // object, function
  if (obj.type === 'undefined') {
    return undefined;
  } else if (obj.type === 'number') {
    return obj.unserializableValue ? parseFloat(obj.unserializableValue) : obj.value;
  } else if (obj.type === 'string') {
    return obj.value;
  } else if (obj.type === 'boolean') {
    return obj.value;
  } else if (obj.type === 'function') {
    return obj.description;
  } else if (obj.type === 'symbol') {
    return obj.description;
    // TODO node, regexp, date, map, set, weakmap, weakset, iterator, generator, error, proxy, promise, typedarray
  } else if (obj.subtype === 'null') {
    return null;
  } else if (obj.subtype === 'array') {
    const {
      result
    } = await Runtime.getProperties({
      objectId: obj.objectId,
      ownProperties: true
    });
    const length = result.filter(p => p.name === 'length')[0].value.value;
    const array = new Array(length);
    result.forEach(e => {
      if (e.name !== '__proto__' && e.name !== 'length') {
        array[e.name] = fetchObject(Runtime, e.value);
      }
    });
    return await Promise.all(array);
  } else if (obj.subtype === 'regexp') {
    return obj.description;
  } else if (obj.preview === undefined) {
    return {};
  } else { // object
    const valid = {};
    const sent = Symbol();
    obj.preview.properties.forEach(p => valid[p.name] = sent);
    const {
      result
    } = await Runtime.getProperties({
      objectId: obj.objectId
    });
    const props = await Promise.all(result.filter(p => valid[p.name] === sent).map(
      async p => {
        const value = await fetchObject(Runtime, p.value);
        return await [p.name, value];
      }));
    const ret = {};
    props.forEach(([name, value]) => ret[name] = value);
    return ret;
  }
}

/** Setup chrome for usage */
async function prepareChrome(chrome, protocol) {
  const {
    Page,
    DOM,
    Runtime,
    CSS,
  } = protocol;
  await Promise.all([Page.enable(), DOM.enable(), Runtime.enable(), CSS.enable()]);

  // Forward console messages, this doesn't work that well
  await Runtime.consoleAPICalled(async evt => {
    try {
      const args = await Promise.all(evt.args.map(a => fetchObject(Runtime,
        a)));
      console[evt.type](...args);
    } catch (ex) {
      console.log(ex);
      process.exit(1);
    }
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
  // XXX There is a race condition here where we pick a "free" port before
  // actually using it, so especially if two of these processes are started
  // close together, one will likely request a busy port. We solve this by
  // starting at a random port, but this is mostly a stopgap and doesn't remove
  // the race condition. Unfortunately, it's impossible to listen for the
  // connection error, and as such, this is the only option.
  // TODO Maybe it's possible to try starting it up with a timeout and then
  // checking to see if the server is still up?
  portfinder.basePort = Math.floor(Math.random() * 16384) + 49152;
  const port = await portfinder.getPortPromise();
  await startServer(server, host, port);
  return {
    server: server,
    host: host,
    port: port
  };
}

/** Load and process user script */
async function prepareUserScript(scriptLocation) {
  // FIXME Debug doesn't seem to debug exactly. Line numbers are still listed
  // as being in the anonymous megafile these are all concatenated into.
  return await streamToString(browserify(scriptLocation, {
    insertGlobalVars: {
      'process': undefined,
    },
    debug: true,
  }).require(__dirname + '/fs.js', {
    expose: 'fs'
  }).bundle());
}

/** Add all style sheets in order */
// TODO For some reason, this doesn't modify the document, it only modifies the
// style as far the execution is concerned. Hopefully it's possible to actually
// update in the document itself so that writes of the HTML preserve the style.
async function addStyleSheets(CSS, frameId, styles) {
  for (const css of styles) {
    const {
      styleSheetId
    } = await CSS.createStyleSheet({
      frameId: frameId
    });
    await CSS.setStyleSheetText({
      styleSheetId: styleSheetId,
      text: css,
    });
  }
}

/** Run users script */
async function executeUserScript(Runtime, script, host, port, argv) {
  // Most of these defaults were copied from browserify, some are added for our
  // own purposes.
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
  const {
    result
  } = await Runtime.getProperties({
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

  let chrome, protocol, server, host, port;
  try {
    // These are all done serially, so if one fails, the rest will be cleaned
    chrome = await chromeLauncher.launch({
      chromeFlags: [
        '--disable-gpu',
        '--headless',
      ]
    });
    protocol = await cdp({
      port: chrome.port
    });
    ({
      server,
      host,
      port,
    } = await prepareFileServer());
    const [script, ] = await Promise.all([prepareUserScript(scriptLocation),
      prepareChrome(chrome, protocol)
    ]);
    const {
      Page,
      Runtime,
      CSS,
    } = protocol;

    // Load initial frame loaded from same host as file server
    const {
      frameId
    } = await Page.navigate({
      url: `http://${host}:${port}`,
    });
    await Page.loadEventFired();
    Page.setDocumentContent({
      frameId: frameId,
      html: '<html><head></head><body></body></html>'
    });

    // add sheets and execute
    await addStyleSheets(CSS, frameId, styles);
    await executeUserScript(Runtime, script, host, port, argv);

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
    if (server !== undefined) {
      server.close();
    }
    if (protocol !== undefined) {
      await protocol.close();
    }
    if (chrome !== undefined) {
      await chrome.kill();
    }
  }
}

module.exports = headlesspdf;
