const assert = require('assert');
const path = require('path');
const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const _ = require('lodash');
const yaml = require('js-yaml');
const depcheck = require('depcheck');

const ROOT_DIR = path.join(__dirname, '..');

suite('Repo Meta Tests', function() {

  test('All packages in CI', async function() {
    const tcconf = path.join(ROOT_DIR, '.taskcluster.yml');
    const tcyml = yaml.safeLoad(fs.readFileSync(tcconf, 'utf8'));
    const configured = tcyml.tasks['$let'].packages;

    const {stdout, stderr} = await exec('yarn workspaces info -s');
    const existing = Object.keys(JSON.parse(stdout));

    const extra = _.difference(configured, existing);
    const missing = _.difference(existing, configured);

    const warning = 'CI configuration in .taskcluster.yml is misconfigured.';
    assert(missing.length === 0, `${warning} Missing: ${JSON.stringify(missing)}`);
    assert(extra.length === 0, `${warning} Remove: ${JSON.stringify(extra)}`);
  });

  test('Dependencies are not missing/unused', async function() {
    const depOptions = {
      ignoreMatches: [
        'morgan', // Peer dependency of morgan-debug
        'ejs', // This dependency is used in web-server (see createApp.js)
      ],
      specials: [], // don't target webpack
    };
    const root = await depcheck(ROOT_DIR, depOptions);
    assert(Object.keys(root.missing).length === 0, `Missing root deps: ${JSON.stringify(root.missing)}`);

    const rootPkg = require(path.join(ROOT_DIR, 'package.json'));
    const rootDeps = (Object.keys(rootPkg.dependencies || {})).concat((Object.keys(rootPkg.devDependencies || {})));

    const {stdout, stderr} = await exec('yarn workspaces info -s');
    const packages = Object.values(JSON.parse(stdout)).map(p => p.location);
    const unused = {};
    const missing = {};
    for (pkg of packages) {
      const leaf = await depcheck(path.join(ROOT_DIR, pkg), depOptions);
      if (leaf.dependencies.length !== 0) {
        unused[pkg] = leaf.dependencies;
      }

      // Note that this will be not take into account whether it will be in production or not
      const missed = _.difference(Object.keys(leaf.missing), rootDeps);
      if (missed.length !== 0) {
        missing[pkg] = _.pick(leaf.missing, missed);
      }
    }

    assert(Object.keys(unused).length === 0, `Unused dependencies: ${JSON.stringify(unused, null, 2)}`);
    assert(Object.keys(missing).length === 0, `Missing dependencies: ${JSON.stringify(missing, null, 2)}`);
  });

});
