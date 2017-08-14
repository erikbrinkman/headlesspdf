const assert = require('assert');
const fs = require('fs');
const headlesspdf = require('.');
const stream = require('stream');

/* These tests follow a simple principle. All console messages are relogged, so
 * we can use them to pass information back to the calling process. We the call
 * headlesspdf on simple programs and test that we get appropriate output. The
 * capturing means that we have to mess up console.log, and so we can't run
 * them simultaneously. */

async function headlessString(script) {
  const stringStream = new stream.Readable();
  stringStream.push(script);
  stringStream.push(null);
  return await headlesspdf(stringStream);
}

const testText = fs.readFileSync('test.js', 'utf8');
const testText64 = fs.readFileSync('test.js', 'base64');
const dirText = JSON.stringify(fs.readdirSync('.').sort());
const log = console.log;

(async() => {
  // Verify that we can capture what we want to log
  let called = false;
  console.log = msg => {
    assert.deepEqual(msg, 'test', "didn't log 'test'");
    called = true;
  };
  await headlessString('console.log("test");');
  assert(called, "log wasn't called");

  // Verify we can read files
  called = false;
  console.log = msg => {
    assert.deepEqual(msg, testText, "didn't log contents of test.js");
    called = true;
  };
  await headlessString('console.log(require("fs").readFileSync("test.js", "utf8"));');
  assert(called, "log wasn't called");

  // Verify we can read files in base64 and asynchronously
  called = false;
  console.log = msg => {
    assert.deepEqual(msg, testText64, "didn't log contents of test.js in base64");
    called = true;
  };
  await headlessString('require("fs").readFile("test.js", "base64", (err, res) => console.log(res));');
  assert(called, "log wasn't called");

  /* XXX Directory reading is disabled until I can load the root of the file
   * server without also reading the contents of the directory.
  // Verify we can read directories
  called = false;
  console.log = msg => {
    assert.deepEqual(msg, dirText, "didn't log directory contents");
    called = true;
  };
  await headlessString('console.log(JSON.stringify(require("fs").readdirSync(".").sort()));');
  assert(called, "log wasn't called");

  // Verify we can read directories async
  called = false;
  console.log = msg => {
    assert.deepEqual(msg, dirText, "didn't log directory contents");
    called = true;
  };
  await headlessString('require("fs").readdir(".", (err, res) => console.log(JSON.stringify(res.sort())));');
  assert(called, "log wasn't called");
  */

})().catch(err => {
  console.error(err);
  process.exit(1);
});
