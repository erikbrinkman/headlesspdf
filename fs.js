'use strict';
const path = require('path');

/** Get encoding from an options passed in */
function getEncoding(options) {
  const type = typeof options;
  if (!options) {
    return options;
  } else if (type === 'string' || options instanceof String) {
    return options;
  } else if (type == 'object') {
    return options.encoding;
  } else {
    throw new TypeError(
      `"options" must be a string or an object, got ${type} instead.`)
  }
}

async function readFileAsync(filePath, options) {
  if (typeof filePath !== 'string' && !(filePath instanceof String)) {
    throw new TypeError("path must be a string");
  }
  const encoding = getEncoding(options);
  const req = await fetch(`http://${process._host}:${process._port}${path.resolve(filePath)}`);
  const buffer = await req.arrayBuffer();
  const buff = Buffer.from(buffer);
  if (encoding) {
    return buff.toString(encoding);
  } else {
    return buff;
  }
}

/** Clone of fs.readFile but uses XHR with local fileserver */
function readFile(filePath, options, callback) {
  if (typeof filePath !== 'string' && !(filePath instanceof String)) {
    throw new TypeError("path must be a string");
  }
  if (callback === undefined) {
    callback = options;
    options = undefined;
  }
  readFileAsync(filePath, options).then(res => callback(null, res), err => callback(err, null));
}

/** Clone of fs.readFileSync but uses XHR with local fileserver */
function readFileSync(filePath, options) {
  if (typeof filePath !== 'string' && !(filePath instanceof String)) {
    throw new TypeError("path must be a string");
  }
  const encoding = getEncoding(options);
  if (encoding !== 'utf8') {
    throw new Error(
      `only utf8 encoding is allowed for synchronous reads got ${encoding}`);
  }
  const req = new XMLHttpRequest();
  req.open('GET', `http://${process._host}:${process._port}${path.resolve(filePath)}`, false);
  req.send();
  if (req.status === 200 || req.status === 0) {
    return req.responseText;
  } else {
    // FIXME Handle errors
    throw req.statusText;
  }
}

/** Take the html returned from webserver and return array of files */
function processDirectory(response, encoding) {
  const html = new DOMParser().parseFromString(response, 'text/html');
  const names = Array.from(html.querySelectorAll('td.display-name')).map(x => x.innerText.replace(/(\/|\\)$/, ''));
  if (encoding === 'buffer') {
    return names.map(name => Buffer.from(name));
  } else {
    return names;
  }
}

/** Clone of fs.readdir but can't actually know if you read a directory */
function readdir(dirPath, options, callback) {
  if (typeof dirPath !== 'string' && !(dirPath instanceof String)) {
    throw new TypeError("path must be a string");
  }
  if (callback === undefined) {
    callback = options;
    options = undefined;
  }
  const encoding = getEncoding(options);
  readFile(dirPath, 'utf8', (err, res) => {
    if (err) {
      callback(err, null);
    } else {
      callback(null, processDirectory(res, encoding));
    }
  });
}

/** Clone of fs.readdirSync but can't actually know if you read a directory */
function readdirSync(dirPath, options) {
  if (typeof dirPath !== 'string' && !(dirPath instanceof String)) {
    throw new TypeError("path must be a string");
  }
  const encoding = getEncoding(options);
  const res = readFileSync(dirPath, 'utf8');
  return  processDirectory(res, encoding);
}

// XXX Directory reading is disabled, as there was no way to set the current
// page to point to the file server, without also loading the cwd, and
// therefore reading from all files in the current directory.
module.exports = {
  readFile: readFile,
  readFileSync: readFileSync,
  // readdir: readdir,
  // readdirSync: readdirSync,
};
