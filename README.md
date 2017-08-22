Headlesspdf
===========

[![npm](https://img.shields.io/npm/v/headlesspdf.svg?style=flat-square)](https://www.npmjs.com/package/headlesspdf)
[![Travis](https://img.shields.io/travis/erikbrinkman/headlesspdf.svg?style=flat-square)](https://travis-ci.org/erikbrinkman/headlesspdf)

A module for generating pdfs using node and headless chrome.
This module allows writing code that manipulates the dom using node and then outputs the result as a pdf, using a combination of browserify and headless chrome.
The primary intended purpose is to use this in combination with `d3` to make pretty static graphs.
As a result, in the node file you pass in, all of the standard web variables like `document` and `window` will be defined, but so will standard node variables like `__filename` and `process`, and the node variables will contain relevant information.
Additionally a shim `fs` module can be loaded that will read files relative to the cwd this was started from.


Usage
-----

From the command line:
```
headlesspdf -i myfile.js -o output.pdf
headlesspdf -i myfile.js -o output.pdf -c style.css arg1 arg2
```

or via the api:
```
const headlesspdf = require('headlesspdf');
const fs = require('fs');

fs.writeFileSync('output.pdf', headlesspdf('myfile.js'), 'base64', err => {
  if (err) {
    console.error(err);
  }
});

const style = fs.readFileSync('style.css', 'utf8');
fs.writeFileSync('output.pdf', headlesspdf('myfile.js', {styles: [style], argv: ['arg1', 'arg2']}), 'base64', err => {
  if (err) {
    console.error(err);
  }
});
```

The command line and api calls produce identical results.
Your javascript file has to be a flat file so the require lookup by browserify will work.

Installation
------------

```
npm install -g headlesspdf
```

To Do
-----

- Potentially update `__filename` and `__dirname`.
  Not sure if this is possible without breaking modules, and it's probably not that important to make non-relative.
- Add protection options, e.g. don't give access to files, reveal absolute path, environment, send files over ssl, etc.
