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

/** Clone of fs.readFile but uses XHR with local fileserver */
function readFile(filePath, options, callback) {
  if (typeof filePath !== 'string' && !(filePath instanceof String)) {
    throw new TypeError("path must be a string");
  }
  if (callback === undefined) {
    callback = options;
    options = undefined;
  }
  const encoding = getEncoding(options);
  const req = new XMLHttpRequest();
  req.open('GET', `http://${process._host}:${process._port}${path.resolve(filePath)}`);
  req.responseType = 'arraybuffer';
  req.addEventListener('readystatechange', () => {
    if (req.readyState === 4) {
      if (req.status === 200 || req.status === 0) {
        const buff = Buffer.from(req.response);
        if (encoding) {
          try {
            callback(null, buff.toString(encoding));
          } catch (ex) {
            callback(ex, null);
          }
        } else {
          callback(null, buff);
        }
      } else {
        // FIXME Handle errors
        callback(req.statusText, null);
      }
    }
  });
  req.send();
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

module.exports.readFile = readFile;
module.exports.readFileSync = readFileSync;
