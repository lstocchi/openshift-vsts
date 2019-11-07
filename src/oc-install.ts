'use strict';

import tl = require('vsts-task-lib/task');
import fs = require('fs');
import path = require('path');
import { ToolRunner } from 'vsts-task-lib/toolrunner';
import { LINUX, OC_TAR_GZ, MACOSX, WIN, OC_ZIP, OPENSHIFT_V3_BASE_URL, OPENSHIFT_V4_BASE_URL, LATEST } from './constants';

const validUrl = require('valid-url');
const decompress = require('decompress');
const decompressTargz = require('decompress-targz');
const Zip = require('adm-zip');

export class InstallHandler {
  /**
   * Downloads the specified version of the oc CLI and returns the full path to
   * the executable.
   *
   * @param downloadVersion the version of `oc` to install.
   * @param osType the OS type. One of 'Linux', 'Darwin' or 'Windows_NT'. See https://nodejs.org/api/os.html#os_os_type
   * @return the full path to the installed executable or null if the install failed.
   */
  static async installOc(
    downloadVersion: string,
    osType: string
  ): Promise<string | null> {
    if (!downloadVersion) {
      downloadVersion = await InstallHandler.latestStable(osType);
      if (downloadVersion === null) {
        return Promise.reject('Unable to determine latest oc download URL');
      }
    }    

    tl.debug('creating download directory');
    let downloadDir =
      process.env['SYSTEM_DEFAULTWORKINGDIRECTORY'] + '/.download';
    if (!fs.existsSync(downloadDir)) {
      let mkdir: ToolRunner = tl.tool('mkdir');
      mkdir.arg('-p').arg(downloadDir);
      await mkdir.exec();
    }

    let url: string | null;
    if (validUrl.isWebUri(downloadVersion)) {
      url = downloadVersion;
    } else {
      url = await InstallHandler.ocBundleURL(downloadVersion, osType);
    }

    if (url === null) {
      return Promise.reject('Unable to determine oc download URL.');
    }

    tl.debug(`downloading: ${url}`);
    let ocBinary = await InstallHandler.downloadAndExtract(
      url,
      downloadDir,
      osType
    );
    if (ocBinary === null) {
      return Promise.reject('Unable to download or extract oc binary.');
    }

    return ocBinary;
  }

  /**
   * Determines the latest stable version of the OpenShift CLI on mirror.openshift.
   *
   * @return the url of the latest OpenShift CLI on mirror.openshift.
   */
  static async latestStable(osType: string): Promise<string | null> {
    tl.debug('determining latest oc version');

    const bundle = await this.getOcBundleByOS(osType);
    if (!bundle) {
      tl.debug('Unable to find bundle url');
      return null;
    }

    const url = `${OPENSHIFT_V4_BASE_URL}/${LATEST}/${bundle}`;

    tl.debug(`latest stable oc version: ${url}`);
    return url;
  }

  /**
   * Returns the download URL for the oc CLI for a given version.
   * The binary type is determined by the agent's operating system.
   *
   * @param {string} version Oc version.
   * @param osType the OS type. One of 'Linux', 'Darwin' or 'Windows_NT'.
   * @returns {Promise} Promise string representing the URL to the tarball. null is returned
   * if no matching URL can be determined for the given tag.
   */
  static async ocBundleURL(
    version: string,
    osType: string
  ): Promise<string | null> {
    tl.debug(`determining tarball URL for version ${version}`);

    if (!version) {
      return null;
    }

    // remove char v if present to ensure old pipelines keep working when the extension will be updated
    if (version.startsWith('v')) {
      version = version.substr(1);
    }

    let url: string = '';
    // determine the base_url based on version
    const reg = new RegExp('\\d+(?=\\.)');
    const vMajorRegEx: RegExpExecArray = reg.exec(version);
    if (!vMajorRegEx || vMajorRegEx.length === 0) {
      tl.debug('Error retrieving version');
      return null;
    }
    const vMajor: number = +vMajorRegEx[0];

    if (vMajor === 3) {
      url = `${OPENSHIFT_V3_BASE_URL}/${version}/`;
    } else if (vMajor === 4) {
      url = `${OPENSHIFT_V4_BASE_URL}/${version}/`;
    } else {
      tl.debug('Invalid version');
      return null;
    }

    const bundle = await this.getOcBundleByOS(osType);
    if (!bundle) {
      tl.debug('Unable to find bundle url');
      return null;
    }

    url += bundle;

    tl.debug(`archive URL: ${url}`);
    return url;
  }

  static async getOcBundleByOS(osType: string): Promise<string | null> {
    let url: string = '';

    // determine the bundle path based on the OS type
    switch (osType) {
      case 'Linux': {
        url += `${LINUX}/${OC_TAR_GZ}`;
        break;
      }
      case 'Darwin': {
        url += `${MACOSX}/${OC_TAR_GZ}`;
        break;
      }
      case 'Windows_NT': {
        url += `${WIN}/${OC_ZIP}`;
        break;
      }
      default: {
        return null;
      }
    }

    return url;
  }

  /**
   * Downloads and extract the oc release archive.
   *
   * @param url the oc release download URL.
   * @param downloadDir the directory into which to extract the archive.
   * @param osType the OS type. One of 'Linux', 'Darwin' or 'Windows_NT'.
   * It is the responsibility of the caller to ensure that the directory exist.
   */
  static async downloadAndExtract(
    url: string,
    downloadDir: string,
    osType: string
  ): Promise<string | null> {
    if (!url) {
      return null;
    }

    downloadDir = path.normalize(downloadDir);

    if (!tl.exist(downloadDir)) {
      throw `${downloadDir} does not exist.`;
    }

    let parts = url.split('/');
    let archive = parts[parts.length - 1];
    let archivePath = path.join(downloadDir, archive);

    if (!tl.exist(archivePath)) {
      let curl: ToolRunner = tl.tool('curl');
      curl
        .arg('-s')
        .arg('-L')
        .arg('-o')
        .arg(archivePath)
        .arg(url);
      await curl.exec();
    }

    let archiveType = path.extname(archive);
    let expandDir = archive.replace(archiveType, '');
    // handle tar.gz explicitly
    if (path.extname(expandDir) == '.tar') {
      archiveType = '.tar.gz';
      expandDir = expandDir.replace('.tar', '');
    }

    let expandPath = path.join(downloadDir, expandDir);
    if (!tl.exist(expandPath)) {
      tl.debug(`expanding ${archivePath} into ${expandPath}`);

      switch (archiveType) {
        case '.zip': {
          let zip = new Zip(archivePath);
          zip.extractAllTo(expandPath);
          break;
        }
        case '.tgz':
        case '.tar.gz': {
          await decompress(archivePath, downloadDir, {
            plugins: [decompressTargz()]
          });
          break;
        }
        default: {
          throw `unknown archive format ${archivePath}`;
        }
      }
    }

    let ocBinary: string;
    switch (osType) {
      case 'Windows_NT': {
        ocBinary = 'oc.exe';
        break;
      }
      default: {
        ocBinary = 'oc';
      }
    }

    ocBinary = path.join(expandPath, ocBinary);
    if (!tl.exist(ocBinary)) {
      return null;
    } else {
      fs.chmodSync(ocBinary, '0755');
      return ocBinary;
    }
  }

  /**
   * Adds oc to the PATH environment variable.
   *
   * @param ocPath the full path to the oc binary. Must be a non null.
   * @param osType the OS type. One of 'Linux', 'Darwin' or 'Windows_NT'.
   */
  static async addOcToPath(ocPath: string, osType: string) {
    if (ocPath === null || ocPath === '') {
      throw new Error('path cannot be null or empty');
    }

    if (osType == 'Windows_NT') {
      let dir = ocPath.substr(0, ocPath.lastIndexOf('\\'));
      tl.setVariable('PATH', dir + ';' + tl.getVariable('PATH'));
    } else {
      let dir = ocPath.substr(0, ocPath.lastIndexOf('/'));
      tl.setVariable('PATH', dir + ':' + tl.getVariable('PATH'));
    }
  }
}
