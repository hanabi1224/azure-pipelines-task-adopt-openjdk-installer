import * as fs from 'fs';
import * as path from 'path';
import * as stream from 'stream';
import { promisify } from 'util';
import * as rm from 'typed-rest-client/RestClient'
import * as ifm from 'typed-rest-client/Interfaces';
import * as _ from 'lodash';
import * as taskLib from 'azure-pipelines-task-lib/task';
import * as toolLib from 'azure-pipelines-tool-lib/tool';
import * as querystring from 'querystring';

type AdoptOpenJDKApiBinaryEntry = {
    architecture: ArchitectureType,
    download_count: number,
    heap_size: string,
    image_type: 'jdk' | 'jre',
    jvm_impl: JvmType,
    os: OsType,
    project: string,
    scm_ref: string,
    updated_at: string,
    package: {
        checksum: string,
        checksum_link: string,
        download_count: number,
        link: string,
        name: string,
        size: number,
    },
    release_name: string,
};

type AdoptOpenJDKApiResultEntry = {
    release_name: string,
    binaries: AdoptOpenJDKApiBinaryEntry[],
};
type AdoptOpenJDKApiResult = AdoptOpenJDKApiResultEntry[];

let userAgent = 'adopt-openjdk-installer-devops/1.0';

let requestOptions = {
    // ignoreSslError: true,
    proxy: taskLib.getHttpProxyConfiguration(),
    cert: taskLib.getHttpCertConfiguration(),
    allowRedirects: true,
    allowRetries: true,
    maxRetries: 2
} as ifm.IRequestOptions;

const pipeline = promisify(stream.pipeline);

function getChildDirectories(root: string): string[] {
    return fs.readdirSync(root, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
}

export async function fetch(os: OsType, jvm: JvmType, majorVersion: number, arch: ArchitectureType): Promise<AdoptOpenJDKApiBinaryEntry[]> {
    // const url = `https://api.adoptopenjdk.net/v3/assets/latest/${majorVersion}/${jvm}?release=latest`;

    const url = `https://api.adoptopenjdk.net/v3/assets/feature_releases/${majorVersion}/ga?jvm_impl=${jvm}&os=${os}&vendor=adoptopenjdk&`;

    const client = new rm.RestClient(userAgent, undefined, undefined, requestOptions);

    const response = await client.get<AdoptOpenJDKApiResult>(url);

    response.result.forEach(release => {
        
        release.binaries.forEach(b => {            
            b.release_name = release.release_name
            b.package.link = querystring.unescape(b.package.link);
        })
    });

    return _.chain(response.result).map(e => e.binaries).flatten().filter(
        entry => entry?.os === os
            && entry?.architecture === arch
            && entry.image_type === 'jdk'
            && entry?.package?.name?.length > 0
            && entry?.release_name?.length > 0
            && (entry.package.name.endsWith('.zip') || entry.package.name.endsWith('.tar.gz'))).value();
}

export function filter(entries: AdoptOpenJDKApiBinaryEntry[], versionFilter: string) {
    return _.chain(entries).find(entry => !versionFilter || entry.release_name.indexOf(versionFilter) >= 0).value();
}

export async function downloadAndChecksum(entry: AdoptOpenJDKApiBinaryEntry, jdkRoot: string, useCache: boolean) {
    const toolName = `openjdk-${entry.jvm_impl}`;

    const name = entry.package.name;
    const link = entry.package.link;
    const checksum = entry.package.checksum;
    const arch = entry.architecture;

    if (jdkRoot.indexOf(arch) <= 0) {
        jdkRoot = path.join(jdkRoot);
    }

    const subDirName = entry.release_name;
    const jdkDir = process.platform === 'darwin' ? path.join(jdkRoot, subDirName, 'Contents', 'Home') : path.join(jdkRoot, subDirName);
    if (taskLib.exist(jdkDir)) {
        if (useCache) {
            console.log(`Using cache jdk directory ${jdkDir}`);
            return jdkDir;
        }
        else {
            taskLib.rmRF(jdkDir);
        }
    }

    // const cacheJdkDir = toolLib.findLocalTool(toolName, entry.release_name, entry.binary.architecture);
    // if (cacheJdkDir) {
    //     console.log(`Using cache jdk directory ${cacheJdkDir}`);
    //     return cacheJdkDir;
    // }

    console.log(`Cache for jdk directory is not found.`);
    if (!taskLib.exist(jdkRoot)) {
        console.log(`Creating jdk root ${jdkRoot}`);
        taskLib.mkdirP(jdkRoot);
    }
    else {
        console.log(`Using jdk root ${jdkRoot}`);
    }

    console.log(`Downloading: ${link}`);

    const downloaded = await toolLib.downloadTool(link);
    console.log(`Downloaded file: ${downloaded}`);

    // TODO: Validate checksum

    const extractedFolder = downloaded + '-extracted';

    if (!taskLib.exist(extractedFolder)) {
        console.log(`Creating temporary extract folder ${extractedFolder}`);
        taskLib.mkdirP(extractedFolder);
    }
    else {
        console.log(`Using temporary extract folder ${extractedFolder}`);
    }

    // const cached = await toolLib.cacheFile(downloaded, name, 'openjdk-archive', entry.release_name, entry.binary.architecture);
    if (name.endsWith('.zip')) {
        try {
            await toolLib.extractZip(downloaded, extractedFolder);
        } catch (error) {
            await toolLib.extract7z(downloaded, extractedFolder);
        }
    }
    else if (name.endsWith('.tar') || name.endsWith('.tar.gz')) {
        await toolLib.extractTar(downloaded, extractedFolder);
    } else {
        await toolLib.extract7z(downloaded, extractedFolder);
    }    

    let childFolders: string[] = getChildDirectories(extractedFolder);

    if (childFolders) {
        if (childFolders.length == 1) {
            console.log(`Moving ${childFolders[0]} to ${jdkDir}`);
            taskLib.mv(path.join(extractedFolder, childFolders[0]), jdkDir, '-f');
        } else {
            throw `Found wrong number of child folders in ${extractedFolder} : ${childFolders.length}`
        }
    } else {
        throw `Unable to locate child folders in ${extractedFolder}`
    }

    // console.log(`Caching jdk directory ${jdkDir}`);
    // return await toolLib.cacheDir(jdkDir, toolName, entry.release_name, entry.binary.architecture);
    if (taskLib.exist(jdkDir)) {
        return jdkDir;
    }
    else {
        throw `JDK directory ${jdkDir} is not extracted properly.`;
    }
}

export function detectOS(): OsType {
    if (process.platform === "win32") {
        return 'windows'
    }
    else if (process.platform === 'darwin') {
        return 'mac';
    }
    else if (process.platform === 'linux') {
        return 'linux';
    }
    else {
        throw `Unsupported os ${process.platform}`;
    }
}
