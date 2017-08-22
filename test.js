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
  let called = false;
  let logged = null;
  console.log = msg => {
    logged = msg;
    called = true;
  };
  const stringStream = new stream.Readable();
  stringStream.push(script);
  stringStream.push(null);
  await headlesspdf(stringStream);
  return {called: called, msg: logged};
}

const testText = fs.readFileSync('test.js', 'utf8');
const testText64 = fs.readFileSync('test.js', 'base64');
const dirText = JSON.stringify(fs.readdirSync('.').sort());
const log = console.log;

(async() => {
  let result;

  // Verify that we can capture what we want to log
  result = await headlessString('console.log("test");');
  assert(result.called, "log wasn't called");
  assert.deepEqual(result.msg, 'test', "didn't log 'test'");

  // Verify we can read files
  result = await headlessString('console.log(require("fs").readFileSync("test.js", "utf8"));');
  assert(result.called, "log wasn't called");
  assert.deepEqual(result.msg, testText, "didn't log contents of test.js");

  // Verify we can read files in base64 and asynchronously
  result = await headlessString('require("fs").readFile("test.js", "base64", (err, res) => console.log(res));');
  assert(result.called, "log wasn't called");
  assert.deepEqual(result.msg, testText64, "didn't log contents of test.js in base64");

})().catch(err => {
  console.error(err);
  process.exit(1);
});
