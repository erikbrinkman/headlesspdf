#!/usr/bin/env node
'use strict';
const commander = require('commander');
const fs = require('fs');
const headlesspdf = require('.');
const linewrap = require('linewrap');

commander
  .name('headlesspdf')
  .version('0.0.1')
  .option('-c, --css <css>',
    'append a stylesheet, can be specified multiple times', (v, m) => {
      m.push(v);
      return m
    }, [])
  .option('-i, --input <file>', 'run the specified node file (default: stdin)',
    '-')
  .option('-o, --output <file>', 'output pdf to file (default: stdout)', '-')
  .description(linewrap(process.stdout.columns - 2, {
    wrapLineIndent: 2,
    whitespace: 'collapse'
  })(
    'Execute input node javascript file in a headless browser and then save the resulting page as pdf. The page will be trimmed to the dimensions of the html element. Command line arguments not parsed by this will be passed to `process.argv`. To use fancier command line flags, append arguments after --. `xhrfs` will allow reading files.'
  ))
  .parse(process.argv);


/// Async/await style read file
function readFileAsync(file, options) {
  return new Promise((resolve, reject) => {
    fs.readFile(file, options, (err, res) => {
      if (err) {
        reject(err);
      } else {
        resolve(res);
      }
    });
  });
}


(async() => {
  const scriptLocation = commander.input === '-' ? process.stdin : commander.input;
  const argv = [commander.rawArgs[0], commander.input].concat(commander.args);
  const styles = await Promise.all(commander.css.map(name => readFileAsync(
    name, 'utf8')));
  const data = await headlesspdf(scriptLocation, {
    styles: styles,
    argv: argv,
  });

  if (commander.output === '-') {
    fs.writeSync(process.stdout.fd, data, undefined, 'base64');
  } else {
    fs.writeFileSync(commander.output, data, 'base64', err => {
      if (err) {
        console.error(err);
      }
    });
  }
})().catch(err => {
  console.error(err.toString());
  process.exit(1);
});
