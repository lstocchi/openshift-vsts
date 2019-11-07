import * as chai from 'chai';
const expect = chai.expect;
// import sinon
import * as sinon from 'sinon';
import * as fs from 'fs';

import { InstallHandler } from '../src/oc-install';
import * as validUrl from 'valid-url';

import tl = require('vsts-task-lib/task');
import {
  OPENSHIFT_V4_BASE_URL,
  LATEST,
  LINUX,
  OC_TAR_GZ,
  WIN,
  OC_ZIP,
  MACOSX
} from '../src/constants';

describe('InstallHandler', function() {
  let sandbox: sinon.SinonSandbox;
  const testOutDir = `${__dirname}/../out/test/ocInstall`;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    process.env['SYSTEM_DEFAULTWORKINGDIRECTORY'] = testOutDir;
  });

  afterEach(() => {
    sandbox.restore();
    delete process.env['SYSTEM_DEFAULTWORKINGDIRECTORY'];
  });

  describe('#ocInstall', function() {
    it('check if latestStable method is called if no ocVersion is passed', async function() {
      const latestStub = sandbox
        .stub(InstallHandler, 'latestStable')
        .resolves('http://url.com/ocbundle');
      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(InstallHandler, 'ocBundleURL').resolves('url');
      sandbox.stub(InstallHandler, 'downloadAndExtract').resolves('path');
      await InstallHandler.installOc('', 'Darwin');
      expect(latestStub.calledOnce).to.be.true;
    });

    it('return error if lastest version is not found', async function() {
      sandbox.stub(InstallHandler, 'latestStable').resolves(null);
      try {
        await InstallHandler.installOc('', 'Darwin');
        expect.fail();
      } catch (ex) {
        expect(ex).equals('Unable to determine latest oc download URL');
      }
    });

    it('check if ocBundleURl is called if version number is passed as input', async function() {
      sandbox.stub(fs, 'existsSync').returns(true);
      const bundleStub = sandbox
        .stub(InstallHandler, 'ocBundleURL')
        .resolves(
          'https://mirror.openshift.com/pub/openshift-v4/clients/oc/4.1/windows/oc.zip'
        );
      sandbox.stub(InstallHandler, 'downloadAndExtract').resolves('path');
      await InstallHandler.installOc('4.1', 'Windows_NT');
      expect(bundleStub.calledOnce).to.be.true;
    });

    it('check if ocBundleURl is called twice if version number release as input is not valid', async function() {
      sandbox.stub(fs, 'existsSync').returns(true);
      const bundleStub = sandbox
        .stub(InstallHandler, 'ocBundleURL')
        .onFirstCall()
        .resolves(
          'https://mirror.openshift.com/pub/openshift-v4/clients/oc/3.1/windows/oc.zip'
        )
        .onSecondCall()
        .resolves(
          'https://mirror.openshift.com/pub/openshift-v4/clients/oc/4.1/windows/oc.zip'
        );
      sandbox.stub(InstallHandler, 'downloadAndExtract').resolves('path');
      await InstallHandler.installOc('4.1', 'Windows_NT');
      expect(bundleStub.calledTwice).to.be.true;
    });

    it('check if ocBundle is not called if uri is valid', async function() {
      sandbox.stub(fs, 'existsSync').returns(true);
      const ocBundleStub = sandbox.stub(InstallHandler, 'ocBundleURL');
      sandbox.stub(InstallHandler, 'downloadAndExtract').resolves('path');
      await InstallHandler.installOc(
        'https://github.com/openshift/origin/releases/download/v3.11.0/openshift-origin-client-tools-v3.11.0-0cbc58b-mac.zip',
        'Darwin'
      );
      expect(ocBundleStub.calledOnce).to.be.false;
    });

    it('return error if url retrieved by version number is null', async function() {
      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox
        .stub(InstallHandler, 'ocBundleURL')
        .onFirstCall()
        .resolves(
          'https://mirror.openshift.com/pub/openshift-v4/clients/oc/3.1/windows/oc.zip'
        )
        .onSecondCall()
        .resolves(null);
      try {
        await InstallHandler.installOc('4.1', 'Windows_NT');
        expect.fail();
      } catch (ex) {
        expect(ex).equals('Unable to determine oc download URL.');
      }
    });

    it('check if task fails if downloadAndExtract doesnt return a valid ocBinary', async function() {
      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(validUrl, 'isWebUri').returns('path');
      sandbox.stub(InstallHandler, 'downloadAndExtract').resolves(null);
      try {
        await InstallHandler.installOc('path', 'Darwin');
        expect.fail();
      } catch (ex) {
        expect(ex).equals('Unable to download or extract oc binary.');
      }
    });

    it('check if value returned by downloadAndExtract if valid is returned', async function() {
      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(validUrl, 'isWebUri').returns('path');
      sandbox.stub(InstallHandler, 'downloadAndExtract').resolves('path');
      const result = await InstallHandler.installOc('path', 'Darwin');
      expect(result).equals('path');
    });
  });

  describe('#latestStable', function() {
    it('check if null value returned if osType input is not valid', async function() {
      sandbox.stub(InstallHandler, 'getOcBundleByOS').resolves(null);
      const res = await InstallHandler.latestStable('fakeOS');
      expect(res).equals(null);
    });

    it('check if url returned is valid based on OSType input', async function() {
      sandbox
        .stub(InstallHandler, 'getOcBundleByOS')
        .resolves('linux/oc.tar.gz');
      const res = await InstallHandler.latestStable('linux');
      expect(res).equals(`${OPENSHIFT_V4_BASE_URL}/${LATEST}/linux/oc.tar.gz`);
    });
  });

  describe('#ocBundleURL', function() {
    it('should return null when the tag is empty', async function() {
      const result = await InstallHandler.ocBundleURL('', 'Linux');
      expect(result).to.be.null;
    });

    it('should return null when the tag is null', async function() {
      const result = await InstallHandler.ocBundleURL(null, 'Linux');
      expect(result).to.be.null;
    });
  });

  describe('#getOcBundleByOS', function() {
    it('return correct value if osType is linux', async function() {
      const res = await InstallHandler.getOcBundleByOS('Linux');
      expect(res).equals(`${LINUX}/${OC_TAR_GZ}`);
    });

    it('return correct value if osType is windows', async function() {
      const res = await InstallHandler.getOcBundleByOS('Windows_NT');
      expect(res).equals(`${WIN}/${OC_ZIP}`);
    });

    it('return correct value if osType is MACOSX', async function() {
      const res = await InstallHandler.getOcBundleByOS('Darwin');
      expect(res).equals(`${MACOSX}/${OC_TAR_GZ}`);
    });

    it('return null if osType is neither linux nor macosx nor windows', async function() {
      const res = await InstallHandler.getOcBundleByOS('fakeOS');
      expect(res).equals(null);
    });
  });

  describe('#addOcToPath', function() {
    it('adds oc to PATH under Windows', function() {
      let ocDir =
        'D:\\a\\r1\\a\\.download\\openshift-origin-client-tools-v3.10.0-dd10d17-windows';
      expect(tl.getVariable('PATH')).to.not.contain(ocDir);
      return InstallHandler.addOcToPath(`${ocDir}\\oc.exe`, 'Windows_NT').then(
        () => {
          expect(tl.getVariable('PATH')).to.contain(ocDir);
        }
      );
    });

    it('adds oc to PATH under macOS', function() {
      let ocDir =
        '/a/r1/a/.download/openshift-origin-client-tools-v3.10.0-dd10d17-mac';
      expect(tl.getVariable('PATH')).to.not.contain(ocDir);
      return InstallHandler.addOcToPath(`${ocDir}/oc`, 'Darwin').then(() => {
        expect(tl.getVariable('PATH')).to.contain(ocDir);
      });
    });

    it('adds oc to PATH under Linux', function() {
      let ocDir =
        '/a/r1/a/.download/openshift-origin-client-tools-v3.10.0-dd10d17-linux-64bit';
      expect(tl.getVariable('PATH')).to.not.contain(ocDir);
      return InstallHandler.addOcToPath(`${ocDir}/oc`, 'Linux').then(() => {
        expect(tl.getVariable('PATH')).to.contain(ocDir);
      });
    });

    it('throws error with null path', function() {
      return InstallHandler.addOcToPath(null, 'Linux')
        .then(() => {
          expect.fail('call should not succeed');
        })
        .catch(function(err: Error) {
          expect(err.message).to.eq('path cannot be null or empty');
        });
    });

    it('throws error with empty path', function() {
      return InstallHandler.addOcToPath('', 'Linux')
        .then(() => {
          expect.fail('call should not succeed');
        })
        .catch(function(err: Error) {
          expect(err.message).to.eq('path cannot be null or empty');
        });
    });
  });
});
